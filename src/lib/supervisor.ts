import "server-only";
import type { SupervisorEnvelope } from "./types";
import { listTasks } from "./scheduler";
import { getConfig } from "./config";
import { extractJSON } from "./json-extract";
import { readBlueprint } from "./blueprint";

import fs from "fs";
import path from "path";

// Session state — persisted to file for cross-module consistency (Turbopack workaround)
const SESSION_FILE = "/tmp/hive-supervisor-sessions.json";

function loadSessions(): Record<string, string> {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      return JSON.parse(fs.readFileSync(SESSION_FILE, "utf-8")) as Record<string, string>;
    }
  } catch { /* ignore */ }
  return {};
}

function saveSession(workspace: string, sessionId: string): void {
  const sessions = loadSessions();
  sessions[workspace] = sessionId;
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions), "utf-8");
}

function getSession(workspace: string): string | undefined {
  return loadSessions()[workspace];
}

function deleteSession(workspace: string): void {
  const sessions = loadSessions();
  delete sessions[workspace];
  fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions), "utf-8");
}

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

// --- Session Pool ---
// Pre-warm sessions so chat requests have near-zero connection latency

interface WarmSession {
  sessionId: string;
  workspace: string;
  warmedAt: number;
}

const warmPool = new Map<string, WarmSession>();
const warmingInProgress = new Set<string>();

/**
 * Pre-warm a session for a workspace. Sends a lightweight init query
 * to establish a Claude Code process + session, so subsequent queries
 * resume instantly.
 */
export async function warmSession(workspace: string): Promise<void> {
  // Skip if already warm or warming
  if (warmPool.has(workspace) || warmingInProgress.has(workspace)) return;
  if (getSession(workspace)) return; // Already has an active session

  warmingInProgress.add(workspace);

  try {
    const query = await getQueryFn();

    const sysPrompt = buildSupervisorSystemPrompt();

    for await (const msg of query({
      prompt: sysPrompt + "\n\nRespond with: {\"intent\":\"reply\",\"response\":\"ready\"}",
      options: {
        maxTurns: 1,
        abortController: new AbortController(),
        permissionMode: "bypassPermissions" as const,
        cwd: workspace || undefined,
      },
    })) {
      if (msg.type === "result" && msg.session_id) {
        const sessionId = msg.session_id as string;
        saveSession(workspace, sessionId);
        warmPool.set(workspace, {
          sessionId,
          workspace,
          warmedAt: Date.now(),
        });
        console.log(`[hive] session warmed for ${workspace} (${sessionId.slice(0, 8)}...)`);
      }
    }
  } catch (err) {
    console.error(`[hive] session warm failed for ${workspace}:`, err instanceof Error ? err.message : String(err));
  } finally {
    warmingInProgress.delete(workspace);
  }
}

/** Check if a workspace has a warm session ready */
export function hasWarmSession(workspace: string): boolean {
  return warmPool.has(workspace) || !!getSession(workspace);
}

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

  const existingSession = getSession(ws);
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
        saveSession(ws, msg.session_id as string);
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
    deleteSession(workspace);
    warmPool.delete(workspace);
  } else {
    try { fs.unlinkSync(SESSION_FILE); } catch { /* ignore */ }
    warmPool.clear();
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
