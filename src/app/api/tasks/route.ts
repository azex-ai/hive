import { NextRequest, NextResponse } from "next/server";
import { listTasks, submitTasks } from "@/lib/scheduler";
import { publishEvent } from "@/lib/events";

export async function GET() {
  const tasks = listTasks();
  return NextResponse.json({ data: tasks });
}

export async function POST(req: NextRequest) {
  const specs = await req.json();
  // Clean specs: move id to title if title empty, clear id
  for (const s of specs) {
    if (!s.title && s.id) s.title = s.id;
    s.id = "";
  }
  const created = submitTasks(specs);
  publishEvent({ type: "tasks.submitted", data: { count: created.length } });
  return NextResponse.json({ data: created }, { status: 201 });
}
