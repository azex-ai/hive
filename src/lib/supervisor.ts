import "server-only";
import type { SupervisorEnvelope } from "./types";
import { listTasks } from "./scheduler";
import { getConfig } from "./config";
import { extractJSON } from "./json-extract";
import { readBlueprint } from "./blueprint";

// Session state — per workspace
const sessionByWorkspace = new Map<string, string>();
let currentSessionWorkspace = "";

/** Streaming event from supervisor */
export interface SupervisorStreamEvent {
  type: "thinking" | "text" | "tool_use" | "tool_result" | "result" | "error";
  content: string;
}

/**
 * Stream supervisor messages as they arrive.
 * Yields intermediate events (thinking, tool use, text) and a final result.
 */
export async function* supervisorStream(prompt: string, workspace?: string): AsyncGenerator<SupervisorStreamEvent> {
  const { query } = await import("@anthropic-ai/claude-code");

  const ws = workspace || getConfig().repo || "";

  const queryOptions: Record<string, unknown> = {
    maxTurns: 3,
    abortController: new AbortController(),
    permissionMode: "bypassPermissions" as const,
  };

  if (ws) {
    queryOptions.cwd = ws;
  }

  const existingSession = sessionByWorkspace.get(ws);
  if (existingSession) {
    queryOptions.resume = existingSession;
  }

  const options = { prompt, options: queryOptions };

  let finalResult = "";
  let accumulated = "";

  for await (const msg of query(options)) {
    const msgAny = msg as Record<string, unknown>;

    if (msg.type === "result") {
      if (msg.subtype === "success") {
        finalResult = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
      }
      if (msg.session_id) {
        sessionByWorkspace.set(ws, msg.session_id as string);
        currentSessionWorkspace = ws;
      }
    } else if (msg.type === "assistant" && msgAny.message) {
      const message = msgAny.message as { content?: unknown[] };
      if (Array.isArray(message.content)) {
        for (const block of message.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text") {
            accumulated += b.text as string;
            yield { type: "text" as const, content: b.text as string };
          } else if (b.type === "thinking") {
            yield { type: "thinking" as const, content: (b.thinking as string) || "" };
          } else if (b.type === "tool_use") {
            yield { type: "tool_use" as const, content: `${b.name ?? "tool"}(${JSON.stringify(b.input ?? {}).slice(0, 200)})` };
          } else if (b.type === "tool_result") {
            const text = typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? "");
            yield { type: "tool_result" as const, content: text.slice(0, 500) };
          }
        }
      }
    } else if (msg.type === "stream_event") {
      // Stream events may contain tool usage info
      const eventData = msgAny.event as Record<string, unknown> | undefined;
      if (eventData?.type === "tool_use") {
        yield { type: "tool_use" as const, content: `${eventData.name ?? "tool"}(${JSON.stringify(eventData.input ?? {}).slice(0, 200)})` };
      } else if (eventData?.type === "tool_result") {
        const text = typeof eventData.content === "string" ? eventData.content : "";
        yield { type: "tool_result" as const, content: text.slice(0, 500) };
      }
    }
  }

  yield { type: "result", content: finalResult || accumulated };
}

/** Non-streaming wrapper for backward compatibility */
export async function supervisorSend(prompt: string, workspace?: string): Promise<string> {
  let result = "";
  for await (const event of supervisorStream(prompt, workspace)) {
    if (event.type === "result") {
      result = event.content;
    }
  }
  return result;
}

/** Reset supervisor session for a workspace (called on workspace switch) */
export function resetSupervisorSession(workspace?: string): void {
  if (workspace) {
    sessionByWorkspace.delete(workspace);
  } else {
    sessionByWorkspace.clear();
  }
}

export function buildSupervisorSystemPrompt(): string {
  const config = getConfig();
  const workspace = config.repo || "";
  const repoPath = workspace || "(not configured)";

  const agentNames =
    Object.keys(config.agents || {})
      .map((n) => `${n} (ok)`)
      .join(", ") || "none configured";

  // Workspace-scoped tasks
  const tasks = listTasks(workspace);
  const running = tasks
    .filter((t) => ["running", "claimed", "coding", "linting", "building", "testing", "reviewing", "integrating", "repairing"].includes(t.status))
    .map((t) => `${t.spec.id} [${t.status}] ${t.spec.title || t.spec.objective.slice(0, 40)}`);
  const pending = tasks
    .filter((t) => t.status === "pending")
    .map((t) => `${t.spec.id} ${t.spec.title || t.spec.objective.slice(0, 40)}`);
  const done = tasks
    .filter((t) => t.status === "done" || t.status === "evaluated")
    .map((t) => `${t.spec.id} ${t.spec.title || t.spec.objective.slice(0, 40)}`);
  const failed = tasks
    .filter((t) => t.status === "failed" || t.status === "escalated")
    .map((t) => `${t.spec.id} [${t.status}] ${t.spec.title || t.spec.objective.slice(0, 40)}`);

  // Blueprint context
  let blueprintContext = "";
  if (workspace) {
    const bp = readBlueprint(workspace);
    if (bp) {
      blueprintContext = `
Project blueprint:
- Type: ${bp.project.type}
- Config files: ${bp.project.configFiles.join(", ")}
- Top dirs: ${bp.project.topDirs.join(", ")}
- Deps: ${bp.project.deps.length} packages
- Scripts: ${Object.keys(bp.project.scripts).join(", ")}`;
      if (bp.git) {
        blueprintContext += `
- Git: ${bp.git.branch} @ ${bp.git.commitHash} — ${bp.git.commitMessage}${bp.git.dirtyFiles > 0 ? ` (${bp.git.dirtyFiles} dirty)` : ""}`;
      }
      if (bp.checkpoint) {
        blueprintContext += `
- Last checkpoint: ${bp.checkpoint.summary} (${bp.checkpoint.completedTasks.length} tasks, ${bp.checkpoint.createdAt})`;
      }
    }
  }

  return `You are Hive Supervisor, a local AI agent coordinator. You manage coding tasks executed by Claude Code and Codex CLI agents.

Current workspace: ${repoPath}
${blueprintContext}

Task status:
- Active: ${running.length > 0 ? running.join("; ") : "none"}
- Pending: ${pending.length > 0 ? pending.join("; ") : "none"}
- Done: ${done.length > 0 ? done.join("; ") : "none"}
- Failed: ${failed.length > 0 ? failed.join("; ") : "none"}
- Available agents: ${agentNames}

You can:
1. Create tasks when the user describes work to do
2. Answer questions about the project or tasks
3. Check task status
4. Approve or reject completed tasks
5. Start task execution

Respond with a JSON object. Do NOT include markdown or explanation -- output ONLY the JSON object.

Valid intents and their required fields:
- create_tasks: {"intent":"create_tasks","response":"...","tasks":[{"title":"...","objective":"...","constraints":[],"inputs":[],"outputs":[],"depends_on":[],"priority":1},...]}
- reply:        {"intent":"reply","response":"..."}
- query_status: {"intent":"query_status","response":"..."}
- approve:      {"intent":"approve","response":"...","task_id":"HIVE-N"}
- reject:       {"intent":"reject","response":"...","task_id":"HIVE-N","reason":"..."}
- run_task:     {"intent":"run_task","response":"...","task_id":"HIVE-N","agent":"claude"}

For create_tasks, the "tasks" array must contain valid task specs with at minimum "title" and "objective".
Always include a human-readable "response" field that summarises what you are doing.`;
}

export function extractSupervisorEnvelope(output: string): SupervisorEnvelope {
  const obj = extractJSON(output);
  if (obj && "intent" in obj) {
    return obj as unknown as SupervisorEnvelope;
  }
  // Fallback: treat as plain reply
  return { intent: "reply", response: output.trim() };
}
