import { NextRequest, NextResponse } from "next/server";
import { getOutputDir } from "@/lib/config";
import fs from "fs";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const patchPath = path.join(getOutputDir(), id, "diff.patch");
  let diff = "";
  try {
    diff = fs.readFileSync(patchPath, "utf-8");
  } catch {}
  return NextResponse.json({ data: { diff } });
}
