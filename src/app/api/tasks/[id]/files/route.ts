import { NextRequest, NextResponse } from "next/server";
import { getOutputDir } from "@/lib/config";
import fs from "fs";
import path from "path";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const outputDir = getOutputDir();
  const taskOutDir = path.join(outputDir, id);

  try {
    const entries = fs.readdirSync(taskOutDir, { withFileTypes: true });
    const files = entries
      .filter((e) => !e.isDirectory())
      .map((e) => {
        const stat = fs.statSync(path.join(taskOutDir, e.name));
        return {
          name: e.name,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        };
      });
    return NextResponse.json({ data: { output_dir: taskOutDir, files } });
  } catch {
    return NextResponse.json({ data: { output_dir: taskOutDir, files: [] } });
  }
}
