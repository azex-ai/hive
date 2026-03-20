import "server-only";
import { execFileSync } from "child_process";
import type { AgentCfg, AgentHealth } from "./types";

export function checkAgentHealth(name: string, command: string): AgentHealth {
  try {
    const output = execFileSync(command, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    const version =
      output
        .split("\n")
        .find((l) => l.trim())
        ?.trim()
        .slice(0, 80) || "";
    return { name, available: true, version };
  } catch {
    try {
      const output = execFileSync(command, ["-v"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      const version =
        output
          .split("\n")
          .find((l) => l.trim())
          ?.trim()
          .slice(0, 80) || "";
      return { name, available: true, version };
    } catch (err: any) {
      return { name, available: false, error: err.message };
    }
  }
}

export function checkAllAgents(agents: Record<string, AgentCfg>): AgentHealth[] {
  return Object.entries(agents).map(([name, cfg]) => checkAgentHealth(name, cfg.command));
}
