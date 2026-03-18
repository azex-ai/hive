import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTaskStatus } from "@/lib/scheduler";
import { publishEvent } from "@/lib/events";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = getTask(id);
  if (!task)
    return NextResponse.json({ error: "task not found" }, { status: 404 });

  updateTaskStatus(id, "failed");
  publishEvent({ type: "task.rejected", data: { task_id: id } });

  return NextResponse.json({ data: { task_id: id, status: "failed" } });
}
