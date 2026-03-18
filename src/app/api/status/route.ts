import { NextResponse } from "next/server";
import { listTasks } from "@/lib/scheduler";
import { getActiveRuns } from "@/lib/executor";
import { getConfig } from "@/lib/config";

const startTime = Date.now();

export async function GET() {
  const tasks = listTasks();
  const running = tasks.filter((t: any) => t.status === "running").length;

  const agentsActive: Record<string, number> = {};
  const config = getConfig();
  for (const name of Object.keys(config.agents || {})) {
    agentsActive[name] = 0;
  }
  const runs = getActiveRuns();
  for (const [name, count] of Object.entries(runs)) {
    agentsActive[name] = count as number;
  }

  const uptime = Math.round((Date.now() - startTime) / 1000);

  return NextResponse.json({
    data: {
      uptime: `${uptime}s`,
      tasks_total: tasks.length,
      tasks_running: running,
      agents_active: agentsActive,
    },
  });
}
