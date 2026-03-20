import "server-only";
import { ClaudeRuntime } from "./claude";
import { CodexRuntime } from "./codex";
import type { AgentRuntime } from "./types";

export type { AgentRuntime, AgentEvent, ExecutionEnv } from "./types";

/** Registry of available runtimes. New agents = add here, nothing else changes. */
const runtimes: Record<string, AgentRuntime> = {
  claude: new ClaudeRuntime(),
  codex: new CodexRuntime(),
};

/** Get a runtime by agent name. Falls back to claude. */
export function getRuntime(agentName: string): AgentRuntime {
  return runtimes[agentName] || runtimes.claude;
}

/** List all registered runtime names */
export function listRuntimes(): string[] {
  return Object.keys(runtimes);
}

/** Health check all runtimes */
export async function checkAllRuntimes(): Promise<
  Array<{ name: string; available: boolean; version?: string; error?: string }>
> {
  const results = await Promise.all(
    Object.entries(runtimes).map(async ([name, rt]) => {
      const health = await rt.healthCheck();
      return { name, ...health };
    }),
  );
  return results;
}
