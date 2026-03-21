import { NextRequest, NextResponse } from "next/server";
import { getPipelineStatus, pausePipeline, resumePipeline } from "@/lib/pipeline/orchestrator";
import { isValidTaskId } from "@/lib/validate";

// GET /api/tasks/:id/pipeline — return pipeline status
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidTaskId(id)) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }
  const status = getPipelineStatus(id);
  return NextResponse.json({ data: status });
}

// POST /api/tasks/:id/pipeline — pause or resume
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidTaskId(id)) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }

  const body = await req.json() as { action?: string };
  const action = body.action;

  if (action === "pause") {
    pausePipeline(id);
    return NextResponse.json({ data: { action: "paused" } });
  } else if (action === "resume") {
    resumePipeline(id);
    return NextResponse.json({ data: { action: "resumed" } });
  }

  return NextResponse.json({ error: "invalid action, must be 'pause' or 'resume'" }, { status: 400 });
}
