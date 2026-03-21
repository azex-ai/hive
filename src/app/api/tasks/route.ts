import { NextRequest, NextResponse } from "next/server";
import { listTasks, submitTasks } from "@/lib/scheduler";
import type { TaskSpec } from "@/lib/types";
import { getConfig } from "@/lib/config";
import { publishEvent } from "@/lib/events";
import { scheduleDispatch } from "@/lib/executor";

export async function GET(req: NextRequest) {
  const config = getConfig();
  const workspace = req.nextUrl.searchParams.get("workspace") ?? config.repo ?? "";
  const tasks = listTasks(workspace);
  return NextResponse.json({ data: tasks });
}

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  // Support both array format [spec, ...] and object format { specs: [...] }
  const specs = (
    Array.isArray(body)
      ? body
      : Array.isArray(body?.specs)
        ? body.specs
        : []
  ) as TaskSpec[];

  if (specs.length === 0) {
    return NextResponse.json({ error: "no task specs provided" }, { status: 400 });
  }

  const config = getConfig();
  const workspace = config.repo ?? "";

  // Clean specs: move id to title if title empty, clear id
  for (const s of specs) {
    if (!s.title && s.id) s.title = s.id;
    s.id = "";
  }
  const created = submitTasks(specs, workspace);
  publishEvent({ type: "tasks.submitted", data: { count: created.length } });

  // Auto-dispatch: pick up newly created tasks immediately
  scheduleDispatch();

  return NextResponse.json({ data: created }, { status: 201 });
}
