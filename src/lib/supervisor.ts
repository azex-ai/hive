import "server-only";
import type { SupervisorEnvelope } from "./types";
import { listTasks } from "./scheduler";
import { getConfig } from "./config";
import { extractJSON } from "./json-extract";
import { readBlueprint } from "./blueprint";

// Session state
let supervisorSessionId: string | null = null;

export async function supervisorSend(prompt: string, workdir?: string): Promise<string> {
  // Dynamic import since @anthropic-ai/claude-code is ESM
  const { query } = await import("@anthropic-ai/claude-code");

  const queryOptions: any = {
    maxTurns: 1,
    abortController: new AbortController(),
    permissionMode: "bypassPermissions" as const,
  };

  if (workdir) {
    queryOptions.cwd = workdir;
  }

  // Resume session if we have one (this is the key perf improvement)
  if (supervisorSessionId) {
    queryOptions.resume = supervisorSessionId;
  }

  const options = { prompt, options: queryOptions };

  let finalResult = "";
  let accumulated = "";

  for await (const msg of query(options)) {
    if (msg.type === "result") {
      if (msg.subtype === "success") {
        finalResult = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
      }
      if (msg.session_id) {
        supervisorSessionId = msg.session_id;
      }
    } else if (msg.type === "assistant" && msg.message) {
      // Accumulate text from content blocks as fallback
      if (Array.isArray(msg.message.content)) {
        for (const block of msg.message.content) {
          if (block.type === "text") {
            accumulated += block.text;
          }
        }
      }
    }
  }

  // Prefer final result; fall back to accumulated streaming text
  return finalResult || accumulated;
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
