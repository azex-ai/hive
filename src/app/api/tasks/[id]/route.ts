import { NextRequest, NextResponse } from "next/server";
import { getTask, getAttempts } from "@/lib/scheduler";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = getTask(id);
  if (!task)
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  const attempts = getAttempts(id);
  return NextResponse.json({ data: { task, attempts } });
}
