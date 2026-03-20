import "server-only";
import { execFileSync } from "child_process";
import type { AgentRuntime, AgentEvent, ExecutionEnv } from "./types";

export class ClaudeRuntime implements AgentRuntime {
  readonly name = "claude";

  async *execute(prompt: string, env: ExecutionEnv): AsyncIterable<AgentEvent> {
    const { query } = await import("@anthropic-ai/claude-code");

    let finalResult = "";
    let exitCode = 0;

    try {
      for await (const msg of query({
        prompt,
        options: {
          abortController: new AbortController(),
          maxTurns: 3,
          permissionMode: "bypassPermissions" as const,
          ...(env.workdir ? { cwd: env.workdir } : {}),
        },
      })) {
        if (msg.type === "result") {
          if (msg.subtype === "success") {
            finalResult = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
          }
        } else if (msg.type === "assistant" && msg.message) {
          if (Array.isArray(msg.message.content)) {
            for (const block of msg.message.content) {
              if (block.type === "text") {
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
    } catch (err: unknown) {
      finalResult = err instanceof Error ? err.message : String(err);
      exitCode = 1;
    }

    yield { type: "result", content: finalResult, exitCode };
  }

  async healthCheck(): Promise<{ available: boolean; version?: string; error?: string }> {
    try {
      const output = execFileSync("claude", ["--version"], {
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
