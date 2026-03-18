import { NextRequest, NextResponse } from "next/server";
import { getOutputDir } from "@/lib/config";
import fs from "fs";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const logPath = path.join(getOutputDir(), id, "output.log");
  let log = "";
  try {
    log = fs.readFileSync(logPath, "utf-8");
  } catch {}
  return NextResponse.json({ data: { log } });
}
