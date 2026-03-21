import { NextRequest, NextResponse } from "next/server";
import { queryBenchmarks } from "@/lib/scheduler";

// GET /api/benchmarks?stage=review&days=30
export async function GET(req: NextRequest) {
  const stage = req.nextUrl.searchParams.get("stage") || "";
  const days = parseInt(req.nextUrl.searchParams.get("days") || "30", 10);

  if (!stage) {
    return NextResponse.json({ error: "stage parameter required" }, { status: 400 });
  }

  try {
    const data = queryBenchmarks(stage, days);
    return NextResponse.json({ data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
