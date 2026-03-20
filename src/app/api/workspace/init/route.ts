import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import fs from "fs";
import path from "path";

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.repo_path)
    return NextResponse.json(
      { error: "repo_path is required" },
      { status: 400 },
    );

  if (!path.isAbsolute(body.repo_path) || body.repo_path.includes("..")) {
    return NextResponse.json(
      { error: "repo_path must be an absolute path without .." },
      { status: 400 },
    );
  }

  try {
    const stat = fs.statSync(body.repo_path);
    if (!stat.isDirectory()) throw new Error("not a directory");
  } catch {
    return NextResponse.json(
      { error: "path does not exist or is not a directory" },
      { status: 400 },
    );
  }

  const isGitRepo = fs.existsSync(path.join(body.repo_path, ".git"));

  const hiveDir = path.join(body.repo_path, ".hive");
  fs.mkdirSync(hiveDir, { recursive: true });

  const config = getConfig();
  config.repo = body.repo_path;

  return NextResponse.json({
    data: {
      repo_path: body.repo_path,
      is_git_repo: isGitRepo,
      status: "initialized",
    },
  });
}
