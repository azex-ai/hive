import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock SDK - capture query calls
const mockQuery = vi.fn();
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: mockQuery,
  createSdkMcpServer: vi.fn(() => ({ type: "sdk", name: "hive" })),
  tool: vi.fn(),
}));

vi.mock("../sdk", () => ({
  getQueryFn: vi.fn(async () => mockQuery),
}));

// Mock MCP server
vi.mock("../mcp-server", () => ({
  createHiveMcpServer: vi.fn(async () => ({ type: "sdk", name: "hive" })),
}));

import type { AgentProfile } from "../runtime/types";

describe("ClaudeRuntime profiles", () => {
  let ClaudeRuntime: typeof import("../runtime/claude").ClaudeRuntime;

  beforeAll(async () => {
    const mod = await import("../runtime/claude");
    ClaudeRuntime = mod.ClaudeRuntime;
  });

  function setupMockQuery(resultText = "done") {
    mockQuery.mockReset();
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: "result" as const,
          subtype: "success" as const,
          result: resultText,
          session_id: "test-session",
          total_cost_usd: 0.01,
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      })()
    );
  }

  it("passes coder profile with high effort and adaptive thinking", async () => {
    setupMockQuery();
    const runtime = new ClaudeRuntime();
    const events = [];

    for await (const evt of runtime.execute("test prompt", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-1",
      attemptId: "a1",
      agentProfile: "coder",
    })) {
      events.push(evt);
    }

    expect(mockQuery).toHaveBeenCalledOnce();
    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.effort).toBe("high");
    expect(opts.thinking).toEqual({ type: "adaptive" });
    expect(opts.permissionMode).toBe("bypassPermissions");
    expect(opts.allowDangerouslySkipPermissions).toBe(true);
    expect(opts.persistSession).toBe(false);
    expect(opts.agentProgressSummaries).toBe(true);
  });

  it("passes reviewer profile with disallowed tools", async () => {
    setupMockQuery();
    const runtime = new ClaudeRuntime();

    for await (const _evt of runtime.execute("review this", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-2",
      attemptId: "a2",
      agentProfile: "reviewer",
    })) {
      // drain
    }

    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.effort).toBe("medium");
    expect(opts.disallowedTools).toEqual(["Write", "Edit", "Bash", "NotebookEdit"]);
  });

  it("passes tester profile with specific tools and disabled thinking", async () => {
    setupMockQuery();
    const runtime = new ClaudeRuntime();

    for await (const _evt of runtime.execute("run tests", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-3",
      attemptId: "a3",
      agentProfile: "tester",
    })) {
      // drain
    }

    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.effort).toBe("high");
    expect(opts.thinking).toEqual({ type: "disabled" });
    expect(opts.tools).toEqual(["Bash", "Read", "Grep", "Glob", "Write", "Edit"]);
  });

  it("passes budget when configured", async () => {
    setupMockQuery();
    const runtime = new ClaudeRuntime();

    for await (const _evt of runtime.execute("test", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-4",
      attemptId: "a4",
      budgetUsd: 0.50,
    })) {
      // drain
    }

    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.maxBudgetUsd).toBe(0.50);
  });

  it("enables 1M context when configured", async () => {
    setupMockQuery();
    const runtime = new ClaudeRuntime();

    for await (const _evt of runtime.execute("test", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-5",
      attemptId: "a5",
      use1mContext: true,
    })) {
      // drain
    }

    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.betas).toEqual(["context-1m-2025-08-07"]);
  });

  it("enables file checkpointing for coder profile", async () => {
    setupMockQuery();
    const runtime = new ClaudeRuntime();

    for await (const _evt of runtime.execute("test", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-6",
      attemptId: "a6",
      enableCheckpointing: true,
    })) {
      // drain
    }

    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.enableFileCheckpointing).toBe(true);
  });

  it("emits cost event from result", async () => {
    setupMockQuery();
    const runtime = new ClaudeRuntime();
    const events = [];

    for await (const evt of runtime.execute("test", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-7",
      attemptId: "a7",
    })) {
      events.push(evt);
    }

    const costEvent = events.find((e) => e.type === "cost");
    expect(costEvent).toBeDefined();
    if (costEvent && costEvent.type === "cost") {
      expect(costEvent.totalUsd).toBe(0.01);
      expect(costEvent.inputTokens).toBe(100);
      expect(costEvent.outputTokens).toBe(50);
    }
  });

  it("emits result event", async () => {
    setupMockQuery("task completed successfully");
    const runtime = new ClaudeRuntime();
    const events = [];

    for await (const evt of runtime.execute("test", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-8",
      attemptId: "a8",
    })) {
      events.push(evt);
    }

    const resultEvent = events.find((e) => e.type === "result");
    expect(resultEvent).toBeDefined();
    if (resultEvent && resultEvent.type === "result") {
      expect(resultEvent.content).toBe("task completed successfully");
      expect(resultEvent.exitCode).toBe(0);
    }
  });

  it("env.effort overrides profile default", async () => {
    setupMockQuery();
    const runtime = new ClaudeRuntime();

    for await (const _evt of runtime.execute("test", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-9",
      attemptId: "a9",
      agentProfile: "coder", // default high
      effort: "low", // override to low
    })) {
      // drain
    }

    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.effort).toBe("low"); // override wins
  });

  it("includes MCP server in options", async () => {
    setupMockQuery();
    const runtime = new ClaudeRuntime();

    for await (const _evt of runtime.execute("test", {
      workdir: "/tmp",
      branch: "test",
      taskId: "HIVE-10",
      attemptId: "a10",
    })) {
      // drain
    }

    const opts = mockQuery.mock.calls[0][0].options;
    expect(opts.mcpServers).toBeDefined();
    expect(opts.mcpServers.hive).toBeDefined();
  });
});
