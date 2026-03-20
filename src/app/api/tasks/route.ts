import { NextRequest, NextResponse } from "next/server";
import { listTasks, submitTasks } from "@/lib/scheduler";
import { publishEvent } from "@/lib/events";
import { scheduleDispatch } from "@/lib/executor";

export async function GET() {
  const tasks = listTasks();
  return NextResponse.json({ data: tasks });
}

export async function POST(req: NextRequest) {
  let specs;
  try {
    specs = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  // Clean specs: move id to title if title empty, clear id
  for (const s of specs) {
    if (!s.title && s.id) s.title = s.id;
    s.id = "";
  }
  const created = submitTasks(specs);
  publishEvent({ type: "tasks.submitted", data: { count: created.length } });

  // Auto-dispatch: pick up newly created tasks immediately
  scheduleDispatch();

  return NextResponse.json({ data: created }, { status: 201 });
}
