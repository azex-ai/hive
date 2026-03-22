import "server-only";
import type { SupervisorEnvelope } from "./types";
import { listTasks } from "./scheduler";
import { getConfig } from "./config";
import { readBlueprint } from "./blueprint";
import { getQueryFn } from "./sdk";

// --- Structured output schema ---
const SUPERVISOR_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["create_tasks", "reply", "query_status", "approve", "reject", "run_task"],
    },
    response: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          objective: { type: "string" },
          constraints: { type: "array", items: { type: "string" } },
          inputs: { type: "array", items: { type: "string" } },
          outputs: { type: "array", items: { type: "string" } },
          depends_on: { type: "array", items: { type: "string" } },
          priority: { type: "number" },
        },
      },
    },
    task_id: { type: "string" },
    agent: { type: "string" },
    reason: { type: "string" },
  },
  required: ["intent", "response"],
} as const;

// In-memory session map: workspace -> sessionId
// SDK handles the actual session persistence internally
const sessionMap = new Map<string, string>();

/** warmSession is a no-op — sessions are created on first use */
export async function warmSession(_workspace: string): Promise<void> {
  // No-op: the SDK resumes sessions lazily on first query
}

/** Check if a workspace has a known session */
export function hasWarmSession(workspace: string): boolean {
  return sessionMap.has(workspace);
}

/** Streaming event from supervisor */
export interface SupervisorStreamEvent {
  type:
    | "connected"
    | "thinking"
    | "text"
    | "tool_start"
    | "tool_delta"
    | "tool_result"
    | "result"
    | "error"
    | "block_stop"
    | "suggestion";
  content: string;
  /** For tool_start: tool name */
  toolName?: string;
}

/**
 * Stream supervisor messages as they arrive — token by token.
 *
 * Uses per-request query() calls with resume: sessionId for continuity.
 * The SDK maintains session history internally; no manual history injection needed.
 */
export async function* supervisorStream(
  prompt: string,
  workspace?: string,
): AsyncGenerator<SupervisorStreamEvent> {
  const ws = workspace || getConfig().repo || "";
  const config = getConfig();
  const supervisorModel = config.supervisor?.model || "sonnet";

  const query = await getQueryFn();
  const existingSessionId = sessionMap.get(ws);

  const queryOptions: Record<string, unknown> = {
    maxTurns: 5,
    model: supervisorModel,
    abortController: new AbortController(),
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    persistSession: false,
    thinking: { type: "disabled" },
    systemPrompt: buildSupervisorSystemPrompt(),
    outputFormat: {
      type: "json_schema",
      schema: SUPERVISOR_OUTPUT_SCHEMA,
    },
  };

  if (ws) queryOptions.cwd = ws;
  if (existingSessionId) queryOptions.resume = existingSessionId;

  let finalResult = "";

  for await (const msg of query({
    prompt,
    options: queryOptions as Parameters<typeof query>[0]["options"],
  })) {
    if (msg.type === "system") {
      yield { type: "connected", content: "connected" };
    } else if (msg.type === "result") {
      if (msg.subtype === "success") {
        const structured = (msg as Record<string, unknown>).structured_output;
        const textResult =
          typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
        finalResult = structured ? JSON.stringify(structured) : textResult;
      }
      if (msg.session_id) {
        sessionMap.set(ws, msg.session_id as string);
      }
    } else if (msg.type === "prompt_suggestion") {
      const suggestion = (msg as Record<string, unknown>).suggestion;
      yield { type: "suggestion", content: typeof suggestion === "string" ? suggestion : "" };
    } else if (msg.type === "stream_event") {
      const evt = (msg as Record<string, unknown>).event as Record<string, unknown> | undefined;
      if (!evt) continue;

      if (evt.type === "content_block_start") {
        const block = evt.content_block as Record<string, unknown> | undefined;
        if (block?.type === "tool_use") {
          yield {
            type: "tool_start",
            content: String(block.name ?? "tool"),
            toolName: String(block.name ?? "tool"),
          };
        }
      } else if (evt.type === "content_block_delta") {
        const delta = evt.delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        if (delta.type === "text_delta") {
          yield { type: "text", content: delta.text as string };
        } else if (delta.type === "thinking_delta") {
          yield { type: "thinking", content: delta.thinking as string };
        } else if (delta.type === "input_json_delta") {
          yield { type: "tool_delta", content: delta.partial_json as string };
        }
      } else if (evt.type === "content_block_stop") {
        yield { type: "block_stop", content: "" };
      }
    } else if (msg.type === "assistant") {
      const msgAny = msg as Record<string, unknown>;
      const message = msgAny.message as { content?: unknown[] } | undefined;
      if (message && Array.isArray(message.content)) {
        for (const block of message.content) {
          const b = block as Record<string, unknown>;
          if (b.type === "text") {
            yield { type: "text", content: b.text as string };
          }
        }
      }
    }
  }

  yield { type: "result", content: finalResult };
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
    sessionMap.delete(workspace);
  } else {
    sessionMap.clear();
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
    .filter((t) =>
      ["running", "claimed", "coding", "linting", "building", "testing", "reviewing", "integrating", "repairing"].includes(t.status),
    )
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
  // With outputFormat: json_schema, the result should already be valid JSON
  try {
    const obj = JSON.parse(output) as Record<string, unknown>;
    if (obj && "intent" in obj) {
      return obj as unknown as SupervisorEnvelope;
    }
  } catch { /* fall through */ }

  // Last resort: treat as plain reply
  return { intent: "reply", response: output.trim() };
}
