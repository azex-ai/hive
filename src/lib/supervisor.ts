import "server-only";
import type { SupervisorEnvelope } from "./types";
import { listTasks } from "./scheduler";
import { getConfig } from "./config";
import { extractJSON } from "./json-extract";
import { readBlueprint } from "./blueprint";

// Session state — per workspace
const sessionByWorkspace = new Map<string, string>();
let currentSessionWorkspace = "";

// Pre-load the SDK module at import time to avoid dynamic import latency
let _queryFn: typeof import("@anthropic-ai/claude-code")["query"] | null = null;
async function getQueryFn() {
  if (!_queryFn) {
    const mod = await import("@anthropic-ai/claude-code");
    _queryFn = mod.query;
  }
  return _queryFn;
}
// Eagerly pre-load
getQueryFn().catch(() => {});

/** Streaming event from supervisor */
export interface SupervisorStreamEvent {
  type: "connected" | "thinking" | "text" | "tool_start" | "tool_delta" | "tool_result" | "result" | "error" | "block_stop";
  content: string;
  /** For tool_start: tool name */
  toolName?: string;
}

/**
 * Stream supervisor messages as they arrive — token by token.
 * Uses `includePartialMessages: true` to get content_block_delta events.
 */
export async function* supervisorStream(prompt: string, workspace?: string): AsyncGenerator<SupervisorStreamEvent> {
  const query = await getQueryFn();

  const ws = workspace || getConfig().repo || "";

  const queryOptions: Record<string, unknown> = {
    maxTurns: 3,
    abortController: new AbortController(),
    permissionMode: "bypassPermissions" as const,
    includePartialMessages: true, // Enable token-level streaming
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
    if (msg.type === "system") {
      // system init — connected to agent
      yield { type: "connected", content: "connected" };
    } else if (msg.type === "result") {
      if (msg.subtype === "success") {
        finalResult = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
      }
      if (msg.session_id) {
        sessionByWorkspace.set(ws, msg.session_id as string);
        currentSessionWorkspace = ws;
      }
    } else if (msg.type === "stream_event") {
      // Token-level streaming events from includePartialMessages
      const evt = (msg as Record<string, unknown>).event as Record<string, unknown> | undefined;
      if (!evt) continue;

      if (evt.type === "content_block_start") {
        const block = evt.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use") {
          yield { type: "tool_start", content: String(block.name ?? "tool"), toolName: String(block.name ?? "tool") };
        }
      } else if (evt.type === "content_block_delta") {
        const delta = evt.delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        if (delta.type === "text_delta") {
          const text = delta.text as string;
          accumulated += text;
          yield { type: "text", content: text };
        } else if (delta.type === "thinking_delta") {
          yield { type: "thinking", content: delta.thinking as string };
        } else if (delta.type === "input_json_delta") {
          yield { type: "tool_delta", content: delta.partial_json as string };
        }
      } else if (evt.type === "content_block_stop") {
        yield { type: "block_stop", content: "" };
      }
    } else if (msg.type === "assistant") {
      // Complete assistant message — extract final text as fallback
      const msgAny = msg as Record<string, unknown>;
      const message = msgAny.message as { content?: unknown[] } | undefined;
      if (message && Array.isArray(message.content)) {
        for (const block of message.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text" && !accumulated) {
            accumulated = b.text as string;
          }
        }
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
