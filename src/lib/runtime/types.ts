/** AgentRuntime — the core pluggable interface for coding agents */

export interface ExecutionEnv {
  workdir: string;
  branch: string;
  taskId: string;
  attemptId: string;
}

export type AgentEvent =
  | { type: "output"; line: string }
  | { type: "result"; content: string; exitCode: number }
  | { type: "andon"; reason: string }
  | { type: "artifact"; path: string; artifactType: string };

export interface AgentRuntime {
  readonly name: string;

  /** Execute a task prompt in the given environment, yielding streaming events */
  execute(prompt: string, env: ExecutionEnv): AsyncIterable<AgentEvent>;

  /** Check if this agent is available and return version info */
  healthCheck(): Promise<{ available: boolean; version?: string; error?: string }>;
}
