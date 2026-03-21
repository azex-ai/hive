import { NextRequest, NextResponse } from "next/server";
import { getConfig, setActiveWorkspacePath } from "@/lib/config";
import { scanWorkspace, readBlueprint } from "@/lib/blueprint";
import { setActiveWorkspace } from "@/lib/chat-store";
import { resetSupervisorSession } from "@/lib/supervisor";
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

  // Persist workspace switch + reset session state
  const config = getConfig();
  const previousWorkspace = config.repo;
  setActiveWorkspacePath(body.repo_path);

  // Isolate: switch chat history and reset supervisor session
  setActiveWorkspace(body.repo_path);
  if (previousWorkspace !== body.repo_path) {
    resetSupervisorSession(previousWorkspace);
  }

  // Scan workspace and create/update blueprint
  const blueprint = scanWorkspace(body.repo_path);
  const isFirstTime = !readBlueprint(body.repo_path)?.checkpoint;

  return NextResponse.json({
    data: {
      repo_path: body.repo_path,
      is_git_repo: isGitRepo,
      status: isFirstTime ? "initialized" : "resumed",
      blueprint,
    },
  });
}
