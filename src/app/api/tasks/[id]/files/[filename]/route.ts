import { NextRequest, NextResponse } from "next/server";
import { getOutputDir } from "@/lib/config";
import fs from "fs";
import path from "path";

export async function GET(
  _req: NextRequest,
  {
    params,
  }: { params: Promise<{ id: string; filename: string }> },
) {
  const { id, filename } = await params;

  if (filename.includes("/") || filename.includes("..")) {
    return NextResponse.json({ error: "invalid filename" }, { status: 400 });
  }

  const filePath = path.join(getOutputDir(), id, filename);
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    const ext = path.extname(filename).toLowerCase();
    const ct =
      ext === ".json"
        ? "application/json"
        : ext === ".html"
          ? "text/html"
          : "text/plain";
    return new Response(data, {
      headers: { "Content-Type": `${ct}; charset=utf-8` },
    });
  } catch {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }
}
