import "server-only";
import { z } from "zod";
import { getTask, listTasks, submitTasks } from "./scheduler";
import { getConfig } from "./config";
import { getActiveRuns } from "./executor";
import { checkAllRuntimes } from "./runtime";

/**
 * Create a Hive MCP server that agents can use to query/create tasks.
 * Uses createSdkMcpServer() from the Agent SDK — runs in-process, no child process.
 */
export async function createHiveMcpServer() {
  const { createSdkMcpServer, tool } = await import(
    "@anthropic-ai/claude-agent-sdk"
  );

  return createSdkMcpServer({
    name: "hive",
    version: "1.0.0",
    tools: [
      tool(
        "list_tasks",
        "List all tasks in the current workspace, optionally filtered by status",
        { status: z.string().optional().describe("Filter by status: pending, running, done, failed, etc.") },
        async (args) => {
          const config = getConfig();
          const tasks = listTasks(config.repo);
          const filtered = args.status
            ? tasks.filter((t) => t.status === args.status)
            : tasks;
          const summary = filtered.map((t) => ({
            id: t.spec.id,
            title: t.spec.title || t.spec.objective.slice(0, 60),
            status: t.status,
            priority: t.spec.priority ?? 1,
          }));
          return { content: [{ type: "text" as const, text: JSON.stringify(summary, null, 2) }] };
        },
      ),

      tool(
        "get_task",
        "Get full details of a specific task by ID",
        { task_id: z.string().describe("Task ID (e.g. HIVE-1)") },
        async (args) => {
          const task = getTask(args.task_id);
          if (!task) {
            return { content: [{ type: "text" as const, text: `Task ${args.task_id} not found` }], isError: true };
          }
          return { content: [{ type: "text" as const, text: JSON.stringify(task, null, 2) }] };
        },
      ),

      tool(
        "create_task",
        "Create a new task in Hive",
        {
          title: z.string().describe("Short title"),
          objective: z.string().describe("What needs to be done"),
          priority: z.number().optional().describe("Priority 1-5, higher = more urgent"),
          depends_on: z.array(z.string()).optional().describe("Task IDs this depends on"),
        },
        async (args) => {
          const config = getConfig();
          const tasks = submitTasks(
            [{
              id: "", // auto-assigned
              title: args.title,
              objective: args.objective,
              priority: args.priority,
              depends_on: args.depends_on,
            }],
            config.repo,
          );
          const task = tasks[0];
          return { content: [{ type: "text" as const, text: `Created task ${task.spec.id}: ${task.spec.title}` }] };
        },
      ),

      tool(
        "get_workspace_status",
        "Get current workspace status: active tasks, agent capacity, and system health",
        {},
        async () => {
          const config = getConfig();
          const tasks = listTasks(config.repo);
          const activeRuns = getActiveRuns();
          const runtimes = await checkAllRuntimes();

          const status = {
            workspace: config.repo,
            tasks: {
              total: tasks.length,
              pending: tasks.filter((t) => t.status === "pending").length,
              running: tasks.filter((t) =>
                ["running", "coding", "testing", "reviewing", "building", "linting", "integrating", "repairing"].includes(t.status),
              ).length,
              done: tasks.filter((t) => t.status === "done" || t.status === "evaluated").length,
              failed: tasks.filter((t) => t.status === "failed" || t.status === "escalated").length,
            },
            agents: {
              configured: Object.keys(config.agents || {}),
              activeRuns,
              health: runtimes,
            },
          };
          return { content: [{ type: "text" as const, text: JSON.stringify(status, null, 2) }] };
        },
      ),
    ],
  });
}
