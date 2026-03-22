import "server-only";
import { execFileSync } from "child_process";
import type { AgentRuntime, AgentEvent, ExecutionEnv, AgentProfile } from "./types";
import { getQueryFn } from "../sdk";
import type {
  PostToolUseHookInput,
  PostToolUseFailureHookInput,
  NotificationHookInput,
  StopHookInput,
  WorktreeCreateHookInput,
  WorktreeRemoveHookInput,
  HookInput,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";

// ---- Profile definitions ------------------------------------------------

interface ProfileConfig {
  disallowedTools?: string[];
  tools?: string[];
  effort: "low" | "medium" | "high";
  thinking: { type: "adaptive" } | { type: "disabled" };
}

const PROFILES: Record<AgentProfile, ProfileConfig> = {
  coder: {
    effort: "high",
    thinking: { type: "adaptive" },
  },
  reviewer: {
    disallowedTools: ["Write", "Edit", "Bash", "NotebookEdit"],
    effort: "medium",
    thinking: { type: "adaptive" },
  },
  tester: {
    tools: ["Bash", "Read", "Grep", "Glob", "Write", "Edit"],
    effort: "high",
    thinking: { type: "disabled" },
  },
  repairer: {
    effort: "high",
    thinking: { type: "adaptive" },
  },
};

// ---- Hive MCP server (per-query instance) ----------------------------------

async function createHiveMcp() {
  const { createHiveMcpServer } = await import("../mcp-server");
  return createHiveMcpServer();
}

// ---- Runtime ---------------------------------------------------------------

export class ClaudeRuntime implements AgentRuntime {
  readonly name = "claude";

  async *execute(prompt: string, env: ExecutionEnv): AsyncIterable<AgentEvent> {
    const query = await getQueryFn();
    const hiveMcp = await createHiveMcp();

    const profile = env.agentProfile ? PROFILES[env.agentProfile] : undefined;

    // Effort: explicit env override > profile default > undefined (SDK decides)
    const effort: "low" | "medium" | "high" | undefined =
      env.effort ?? profile?.effort;

    // Thinking config from profile
    const thinking = profile?.thinking;

    // Tool restrictions from profile
    const disallowedTools = profile?.disallowedTools;
    const tools = profile?.tools;

    // Connect caller's AbortSignal to our own AbortController so the SDK
    // query can be interrupted when the task is cancelled.
    const abortController = new AbortController();
    if (env.abortSignal) {
      if (env.abortSignal.aborted) {
        abortController.abort();
      } else {
        env.abortSignal.addEventListener("abort", () => abortController.abort(), { once: true });
      }
    }

    // Collect tool_use events via a shared queue that the generator drains.
    // We use a simple push array because the hook and the generator loop run
    // on the same microtask queue (no true concurrency inside one async generator).
    const toolUseQueue: Array<{ toolName: string; elapsed: number }> = [];
    // Queue for artifact events emitted from worktree hooks
    const artifactQueue: Array<{ path: string; artifactType: string }> = [];

    const hookCallback = async (
      input: HookInput,
      _toolUseID: string | undefined,
      _options: { signal: AbortSignal },
    ): Promise<HookJSONOutput> => {
      if (input.hook_event_name === "PostToolUse") {
        const ptInput = input as PostToolUseHookInput;
        toolUseQueue.push({
          toolName: ptInput.tool_name,
          // elapsed is not available in PostToolUse; use 0 as placeholder
          elapsed: 0,
        });
      } else if (input.hook_event_name === "PostToolUseFailure") {
        const failInput = input as PostToolUseFailureHookInput;
        // Log MCP-related failures for observability — we can't reconnect
        // since we don't hold the Query object after it's been iterated.
        if (failInput.error && failInput.error.toLowerCase().includes("mcp")) {
          console.warn(
            `[claude-runtime] MCP tool failure on ${failInput.tool_name}: ${failInput.error}`,
          );
        }
      } else if (input.hook_event_name === "Notification") {
        const notifInput = input as NotificationHookInput;
        toolUseQueue.push({
          // Reuse toolUseQueue as a general side-channel; we'll differentiate below.
          // Instead, we yield directly from here is not possible — use a dedicated queue.
          toolName: `[notification] ${notifInput.message}`,
          elapsed: -1, // sentinel: this is a notification, not a real tool use
        });
      } else if (input.hook_event_name === "Stop") {
        const stopInput = input as StopHookInput;
        console.log(
          `[claude-runtime] agent stopped gracefully (stop_hook_active=${stopInput.stop_hook_active})`,
        );
      } else if (input.hook_event_name === "WorktreeCreate") {
        const wtInput = input as WorktreeCreateHookInput;
        artifactQueue.push({ path: wtInput.name, artifactType: "worktree_create" });
      } else if (input.hook_event_name === "WorktreeRemove") {
        const wtInput = input as WorktreeRemoveHookInput;
        artifactQueue.push({ path: wtInput.worktree_path, artifactType: "worktree_remove" });
      }
      return { continue: true };
    };

    let finalResult = "";
    let exitCode = 0;

    try {
      for await (const msg of query({
        prompt,
        options: {
          abortController,
          maxTurns: 50,
          permissionMode: "bypassPermissions" as const,
          allowDangerouslySkipPermissions: true,
          ...(env.workdir ? { cwd: env.workdir } : {}),
          ...(env.budgetUsd !== undefined ? { maxBudgetUsd: env.budgetUsd } : {}),
          ...(effort !== undefined ? { effort } : {}),
          ...(thinking !== undefined ? { thinking } : {}),
          ...(disallowedTools !== undefined ? { disallowedTools } : {}),
          ...(tools !== undefined ? { tools } : {}),
          persistSession: env.persistSession ?? false,
          // File checkpointing is only enabled when the caller explicitly opts in
          // (executor sets this to true for coder profiles where rewinding is useful).
          enableFileCheckpointing: env.enableCheckpointing ?? false,
          ...(env.use1mContext ? { betas: ["context-1m-2025-08-07" as const] } : {}),
          // Fallback model: explicit env override, default to haiku for cost efficiency
          fallbackModel: env.fallbackModel ?? "haiku",
          agentProgressSummaries: true,
          mcpServers: { hive: hiveMcp },
          hooks: {
            PostToolUse: [{ hooks: [hookCallback] }],
            PostToolUseFailure: [{ hooks: [hookCallback] }],
            Notification: [{ hooks: [hookCallback] }],
            Stop: [{ hooks: [hookCallback] }],
            WorktreeCreate: [{ hooks: [hookCallback] }],
            WorktreeRemove: [{ hooks: [hookCallback] }],
          },
        },
      })) {
        // Drain any queued tool_use / notification events before processing the current message
        for (const evt of toolUseQueue.splice(0)) {
          if (evt.elapsed === -1) {
            // This is a notification masquerading as a tool_use entry
            yield { type: "output", line: evt.toolName };
          } else {
            yield { type: "tool_use", toolName: evt.toolName, elapsed: evt.elapsed };
          }
        }
        // Drain artifact events from worktree hooks
        for (const evt of artifactQueue.splice(0)) {
          yield { type: "artifact", path: evt.path, artifactType: evt.artifactType };
        }

        if (msg.type === "rate_limit_event") {
          // SDKRateLimitEvent — surface so executor can publish an SSE event
          const resetsAt = msg.rate_limit_info?.resetsAt;
          const retryAfterMs =
            resetsAt !== undefined ? Math.max(0, resetsAt - Date.now()) : undefined;
          yield { type: "rate_limited", retryAfterMs };
        } else if (msg.type === "tool_progress") {
          yield {
            type: "tool_use",
            toolName: msg.tool_name,
            elapsed: msg.elapsed_time_seconds,
          };
        } else if (msg.type === "system" && msg.subtype === "compact_boundary") {
          // SDKCompactBoundaryMessage — context window was compacted
          const trigger = msg.compact_metadata?.trigger ?? "auto";
          yield { type: "compacted", trigger };
        } else if (msg.type === "system" && msg.subtype === "task_started") {
          // SDKTaskStartedMessage — a background subtask started
          yield { type: "subtask", status: "started", summary: msg.description };
        } else if (msg.type === "system" && msg.subtype === "task_notification") {
          // SDKTaskNotificationMessage — a background subtask completed/failed/stopped
          yield { type: "subtask", status: msg.status, summary: msg.summary };
        } else if (msg.type === "system" && msg.subtype === "task_progress") {
          const summary = msg.summary ?? msg.description;
          if (summary) {
            yield { type: "progress", summary };
          }
        } else if (msg.type === "result") {
          if (msg.subtype === "success") {
            finalResult = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
            // Emit cost event
            const usage = msg.usage;
            yield {
              type: "cost",
              totalUsd: msg.total_cost_usd,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
            };
          } else {
            // error result — capture errors, still emit cost if available
            const errResult = msg as unknown as {
              subtype: string;
              errors?: string[];
              total_cost_usd: number;
              usage: { input_tokens: number; output_tokens: number };
            };
            finalResult = Array.isArray(errResult.errors) && errResult.errors.length > 0
              ? errResult.errors.join("; ")
              : `Task stopped: ${errResult.subtype}`;
            exitCode = 1;
            yield {
              type: "cost",
              totalUsd: errResult.total_cost_usd,
              inputTokens: errResult.usage.input_tokens,
              outputTokens: errResult.usage.output_tokens,
            };
          }
        } else if (msg.type === "assistant" && msg.message) {
          if (Array.isArray(msg.message.content)) {
            for (const block of msg.message.content) {
              if (
                typeof block === "object" &&
                block !== null &&
                "type" in block &&
                block.type === "text" &&
                "text" in block &&
                typeof block.text === "string"
              ) {
                for (const line of block.text.split("\n")) {
                  if (line.trim()) {
                    yield { type: "output", line };
                  }
                }
              }
            }
          }
        }
      }

      // Drain any remaining queued events
      for (const evt of toolUseQueue.splice(0)) {
        if (evt.elapsed === -1) {
          yield { type: "output", line: evt.toolName };
        } else {
          yield { type: "tool_use", toolName: evt.toolName, elapsed: evt.elapsed };
        }
      }
      for (const evt of artifactQueue.splice(0)) {
        yield { type: "artifact", path: evt.path, artifactType: evt.artifactType };
      }
    } catch (err: unknown) {
      finalResult = err instanceof Error ? err.message : String(err);
      exitCode = 1;
    }

    yield { type: "result", content: finalResult, exitCode };
  }

  healthCheck(): Promise<{ available: boolean; version?: string; error?: string }> {
    // We use execFileSync("claude", ["--version"]) rather than the SDK here
    // because: (1) it's synchronous and fast (~50ms vs ~2s for SDK init),
    // (2) it doesn't require API auth, and (3) version check is all we need
    // to verify the CLI binary is installed and on $PATH.
    try {
      const output = execFileSync("claude", ["--version"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      const version = output.split("\n").find((l) => l.trim())?.trim().slice(0, 80) || "";
      return Promise.resolve({ available: true, version });
    } catch (err: unknown) {
      return Promise.resolve({ available: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
