import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/scheduler";
import { runTask } from "@/lib/executor";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const agent = body.agent || "claude";
  const role = body.role || "writer";

  const task = getTask(id);
  if (!task)
    return NextResponse.json({ error: "task not found" }, { status: 404 });

  // Launch async - don't await
  runTask(id, agent, role).catch(() => {});

  return NextResponse.json(
    { data: { status: "started", task_id: id } },
    { status: 202 },
  );
}
