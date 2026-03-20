import "server-only";
import { checkAllRuntimes } from "./runtime";
import type { AgentHealth, AgentCfg } from "./types";

/** Check health of all registered agent runtimes */
export async function checkAllAgents(_agents: Record<string, AgentCfg>): Promise<AgentHealth[]> {
  const results = await checkAllRuntimes();
  return results.map((r) => ({
    name: r.name,
    available: r.available,
    version: r.version,
    error: r.error,
  }));
}
