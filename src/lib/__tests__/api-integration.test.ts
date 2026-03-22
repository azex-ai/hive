import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ChildProcess, spawn } from "child_process";

const BASE_URL = "http://localhost:58080";
let serverProcess: ChildProcess | null = null;

async function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start within ${timeoutMs}ms`);
}

describe("API Integration Tests", () => {
  beforeAll(async () => {
    // Check if dev server is already running
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        console.log("Dev server already running, using it");
        return;
      }
    } catch {
      // Not running, start it
    }

    console.log("Starting dev server...");
    serverProcess = spawn("npm", ["run", "dev"], {
      cwd: process.cwd(),
      stdio: "pipe",
      env: { ...process.env, NODE_ENV: "development" },
    });

    serverProcess.stderr?.on("data", (data: Buffer) => {
      const msg = data.toString();
      if (msg.includes("Error") || msg.includes("error")) {
        console.error("[dev-server]", msg.trim());
      }
    });

    await waitForServer(BASE_URL);
    console.log("Dev server ready");
  }, 60000);

  afterAll(() => {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      serverProcess = null;
    }
  });

  // --- Health ---

  it("GET /api/health returns agent info", async () => {
    const res = await fetch(`${BASE_URL}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.agents).toBeDefined();
    expect(Array.isArray(body.data.agents)).toBe(true);
  });

  // --- Status ---

  it("GET /api/status returns server status", async () => {
    const res = await fetch(`${BASE_URL}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.uptime).toBeDefined();
  });

  // --- Tasks CRUD ---

  it("GET /api/tasks returns task list", async () => {
    const res = await fetch(`${BASE_URL}/api/tasks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("POST /api/tasks creates a task", async () => {
    const res = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specs: [
          {
            title: "Test task from integration test",
            objective: "Verify task creation works end-to-end",
            priority: 1,
          },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(1);
    expect(body.data[0].spec.title).toBe("Test task from integration test");
    expect(body.data[0].status).toBe("pending");
  });

  it("GET /api/tasks/:id returns task detail", async () => {
    // First create a task
    const createRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specs: [{ title: "Detail test", objective: "Test detail endpoint" }],
      }),
    });
    const createBody = await createRes.json();
    const taskId = createBody.data[0].spec.id;

    const res = await fetch(`${BASE_URL}/api/tasks/${taskId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.task.spec.id).toBe(taskId);
    expect(body.data.task.spec.title).toBe("Detail test");
  });

  it("GET /api/tasks/:id returns 404 for nonexistent task", async () => {
    const res = await fetch(`${BASE_URL}/api/tasks/HIVE-99999`);
    expect(res.status).toBe(404);
  });

  // --- Cancel ---

  it("POST /api/tasks/:id/cancel handles cancel request", async () => {
    // Create a task (auto-dispatch may start it immediately)
    const createRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specs: [{ title: "Cancel test", objective: "Test cancel endpoint" }],
      }),
    });
    const createBody = await createRes.json();
    const taskId = createBody.data[0].spec.id;

    const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/cancel`, { method: "POST" });
    // Might be 200 (cancelled), 409 (not running / no controller), depends on timing
    expect([200, 409]).toContain(res.status);
  });

  it("POST /api/tasks/:id/cancel returns 404 for nonexistent task", async () => {
    const res = await fetch(`${BASE_URL}/api/tasks/HIVE-99999/cancel`, { method: "POST" });
    expect(res.status).toBe(404);
  });

  // --- Task Approve/Reject ---

  it("POST /api/tasks/:id/approve responds for any task", async () => {
    const createRes = await fetch(`${BASE_URL}/api/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        specs: [{ title: "Approve test", objective: "Test approve" }],
      }),
    });
    const createBody = await createRes.json();
    const taskId = createBody.data[0].spec.id;

    const res = await fetch(`${BASE_URL}/api/tasks/${taskId}/approve`, { method: "POST" });
    // API accepts approve regardless of status (200) — validates endpoint is reachable
    expect(res.status).toBeLessThan(500);
  });

  // --- Agents ---

  it("GET /api/agents returns agent list", async () => {
    const res = await fetch(`${BASE_URL}/api/agents`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });

  // --- Events SSE ---

  it("GET /api/events returns SSE stream", async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${BASE_URL}/api/events`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/event-stream");
    } catch (err: unknown) {
      // AbortError is expected — we just want to verify the connection starts
      if (err instanceof Error && err.name !== "AbortError") throw err;
    } finally {
      clearTimeout(timeout);
      controller.abort();
    }
  });

  // --- Workspace ---

  it("GET /api/workspace returns workspace status", async () => {
    const res = await fetch(`${BASE_URL}/api/workspace`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
  });
});
