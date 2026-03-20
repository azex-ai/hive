import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/scheduler";
import { runTask } from "@/lib/executor";
import { isValidTaskId } from "@/lib/validate";
import { publishEvent } from "@/lib/events";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidTaskId(id)) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const agent = body.agent || "claude";
  const role = body.role || "writer";

  const task = getTask(id);
  if (!task)
    return NextResponse.json({ error: "task not found" }, { status: 404 });

  // Launch async - don't await
  runTask(id, agent, role).catch((err: unknown) => {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[hive] runTask failed for ${id}:`, errMsg);
    publishEvent({
      type: "task.error",
      task_id: id,
      data: { error: errMsg },
    });
  });

  return NextResponse.json(
    { data: { status: "started", task_id: id } },
    { status: 202 },
  );
}
