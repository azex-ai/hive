import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock server-only (no-op in test)
vi.mock("server-only", () => ({}));

// Mock SDK
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
}));

// Mock scheduler (uses better-sqlite3 which needs native bindings)
vi.mock("../scheduler", () => ({
  listTasks: vi.fn(() => []),
}));

// Mock config
vi.mock("../config", () => ({
  getConfig: vi.fn(() => ({
    repo: "/test/workspace",
    agents: { claude: { command: "claude", max_concurrent: 3 } },
    supervisor: { agent: "claude", model: "sonnet" },
  })),
}));

// Mock blueprint
vi.mock("../blueprint", () => ({
  readBlueprint: vi.fn(() => null),
}));

// Mock sdk loader
vi.mock("../sdk", () => ({
  getQueryFn: vi.fn(async () => vi.fn()),
}));

describe("extractSupervisorEnvelope", () => {
  let extractSupervisorEnvelope: typeof import("../supervisor").extractSupervisorEnvelope;

  beforeAll(async () => {
    const mod = await import("../supervisor");
    extractSupervisorEnvelope = mod.extractSupervisorEnvelope;
  });

  it("parses valid JSON output", () => {
    const result = extractSupervisorEnvelope(
      '{"intent":"reply","response":"hello"}'
    );
    expect(result.intent).toBe("reply");
    expect(result.response).toBe("hello");
  });

  it("parses create_tasks with tasks array", () => {
    const input = JSON.stringify({
      intent: "create_tasks",
      response: "Creating 2 tasks",
      tasks: [
        { title: "Task A", objective: "Do A" },
        { title: "Task B", objective: "Do B" },
      ],
    });
    const result = extractSupervisorEnvelope(input);
    expect(result.intent).toBe("create_tasks");
    expect(result.tasks).toHaveLength(2);
    expect(result.tasks![0].title).toBe("Task A");
  });

  it("falls back to reply for non-pure JSON (regex removed per Finding 4)", () => {
    // With outputFormat: json_schema, mixed text should not happen.
    // extractSupervisorEnvelope no longer regex-extracts JSON from mixed text.
    const input = 'Here is my response: {"intent":"approve","response":"Approved","task_id":"HIVE-1"} end';
    const result = extractSupervisorEnvelope(input);
    expect(result.intent).toBe("reply");
    expect(result.response).toBe(input);
  });

  it("falls back to plain reply for non-JSON", () => {
    const result = extractSupervisorEnvelope("just some text");
    expect(result.intent).toBe("reply");
    expect(result.response).toBe("just some text");
  });

  it("handles run_task intent", () => {
    const input = JSON.stringify({
      intent: "run_task",
      response: "Running task",
      task_id: "HIVE-3",
      agent: "claude",
    });
    const result = extractSupervisorEnvelope(input);
    expect(result.intent).toBe("run_task");
    expect(result.task_id).toBe("HIVE-3");
    expect(result.agent).toBe("claude");
  });

  it("handles reject intent with reason", () => {
    const input = JSON.stringify({
      intent: "reject",
      response: "Rejecting",
      task_id: "HIVE-5",
      reason: "Tests failing",
    });
    const result = extractSupervisorEnvelope(input);
    expect(result.intent).toBe("reject");
    expect(result.reason).toBe("Tests failing");
  });
});

describe("buildSupervisorSystemPrompt", () => {
  let buildSupervisorSystemPrompt: typeof import("../supervisor").buildSupervisorSystemPrompt;

  beforeAll(async () => {
    const mod = await import("../supervisor");
    buildSupervisorSystemPrompt = mod.buildSupervisorSystemPrompt;
  });

  it("includes workspace path", () => {
    const prompt = buildSupervisorSystemPrompt();
    expect(prompt).toContain("/test/workspace");
  });

  it("includes agent names", () => {
    const prompt = buildSupervisorSystemPrompt();
    expect(prompt).toContain("claude (ok)");
  });

  it("includes valid intents documentation", () => {
    const prompt = buildSupervisorSystemPrompt();
    expect(prompt).toContain("create_tasks");
    expect(prompt).toContain("run_task");
    expect(prompt).toContain("approve");
    expect(prompt).toContain("reject");
  });

  it("includes JSON output format instructions", () => {
    const prompt = buildSupervisorSystemPrompt();
    expect(prompt).toContain("JSON object");
    expect(prompt).toContain('"intent"');
  });
});
