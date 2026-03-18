import { NextRequest, NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import path from "path";

export async function GET() {
  const config = getConfig();
  let repoPath = config.repo || "";
  if (repoPath && !path.isAbsolute(repoPath)) {
    repoPath = path.resolve(repoPath);
  }

  const agents = Object.keys(config.agents || {}).map((name) => ({
    name,
    available: true,
  }));

  return NextResponse.json({
    data: {
      repo_path: repoPath,
      status: repoPath ? "configured" : "unconfigured",
      agents,
    },
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  if (!body.repo_path)
    return NextResponse.json(
      { error: "repo_path is required" },
      { status: 400 },
    );

  const config = getConfig();
  config.repo = body.repo_path;

  return NextResponse.json({
    data: { repo_path: body.repo_path, status: "configured" },
  });
}
