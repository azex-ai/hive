import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTaskStatus } from "@/lib/scheduler";
import { cancelTask } from "@/lib/executor";
import { publishEvent } from "@/lib/events";
import { isValidTaskId } from "@/lib/validate";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidTaskId(id)) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }

  const task = getTask(id);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  if (!["running", "coding", "testing", "reviewing", "repairing", "building", "linting", "integrating"].includes(task.status)) {
    return NextResponse.json({ error: `task is ${task.status}, not cancellable` }, { status: 409 });
  }

  const cancelled = cancelTask(id);
  if (!cancelled) {
    return NextResponse.json({ error: "no active execution found for task" }, { status: 409 });
  }

  updateTaskStatus(id, "failed");
  publishEvent({
    type: "task_cancelled",
    task_id: id,
    data: { status: "failed", reason: "cancelled by user" },
  });

  return NextResponse.json({ data: { task_id: id, status: "cancelled" } });
}
