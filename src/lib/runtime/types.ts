/** AgentRuntime — the core pluggable interface for coding agents */

export type AgentProfile = "coder" | "reviewer" | "tester" | "repairer";

export interface ExecutionEnv {
  workdir: string;
  branch: string;
  taskId: string;
  attemptId: string;
  // New fields (all optional for backward compat)
  budgetUsd?: number;
  agentProfile?: AgentProfile;
  effort?: "low" | "medium" | "high";
  persistSession?: boolean;
  enableCheckpointing?: boolean;
  /** Enable 1M context window (Sonnet 4/4.5 only) */
  use1mContext?: boolean;
  /** AbortSignal from caller — runtime uses this to interrupt the query */
  abortSignal?: AbortSignal;
  /** Fallback model when primary model is unavailable (default: haiku) */
  fallbackModel?: string;
}

export type AgentEvent =
  | { type: "output"; line: string }
  | { type: "result"; content: string; exitCode: number }
  | { type: "andon"; reason: string }
  | { type: "artifact"; path: string; artifactType: string }
  | { type: "tool_use"; toolName: string; elapsed: number }
  | { type: "progress"; summary: string }
  | { type: "cost"; totalUsd: number; inputTokens: number; outputTokens: number }
  | { type: "rate_limited"; retryAfterMs?: number }
  | { type: "compacted"; trigger: string }
  | { type: "subtask"; status: string; summary?: string };

export interface AgentRuntime {
  readonly name: string;

  /** Execute a task prompt in the given environment, yielding streaming events */
  execute(prompt: string, env: ExecutionEnv): AsyncIterable<AgentEvent>;

  /** Check if this agent is available and return version info */
  healthCheck(): Promise<{ available: boolean; version?: string; error?: string }>;
}
