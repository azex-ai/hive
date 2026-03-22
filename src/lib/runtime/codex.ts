import "server-only";
import { execFileSync } from "child_process";
import type { AgentRuntime, AgentEvent, ExecutionEnv } from "./types";

export class CodexRuntime implements AgentRuntime {
  readonly name = "codex";

  async *execute(prompt: string, env: ExecutionEnv): AsyncIterable<AgentEvent> {
    const { execa } = await import("execa");

    let output = "";
    let exitCode = 0;

    try {
      const proc = execa("codex", ["exec", "--json", "-q", prompt], {
        cwd: env.workdir || undefined,
        timeout: 10 * 60 * 1000, // 10 min
        cancelSignal: env.abortSignal,
      });

      if (proc.stdout) {
        for await (const chunk of proc.stdout) {
          const text = typeof chunk === "string" ? chunk : chunk.toString();
          for (const line of text.split("\n")) {
            if (line.trim()) {
              yield { type: "output", line };
              output += line + "\n";
            }
          }
        }
      }

      const result = await proc;
      exitCode = result.exitCode ?? 0;
    } catch (err: unknown) {
      if (err && typeof err === "object" && "stdout" in err) {
        output = String((err as { stdout: unknown }).stdout);
      }
      exitCode = 1;
    }

    yield { type: "result", content: output, exitCode };
  }

  async healthCheck(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const output = execFileSync("codex", ["--version"], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      const version = output.split("\n").find((l) => l.trim())?.trim().slice(0, 80) || "";
      return { available: true, version };
    } catch {
      try {
        const output = execFileSync("codex", ["-v"], {
          encoding: "utf-8",
          timeout: 5000,
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
        const version = output.split("\n").find((l) => l.trim())?.trim().slice(0, 80) || "";
        return { available: true, version };
      } catch (err: unknown) {
        return { available: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  }
}
