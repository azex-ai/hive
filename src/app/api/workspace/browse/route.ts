import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";

/** List directories at a given path for the workspace browser */
export async function GET(req: NextRequest) {
  const dir = req.nextUrl.searchParams.get("dir") || os.homedir();

  // Security: must be absolute, no traversal
  if (!path.isAbsolute(dir) || dir.includes("..")) {
    return NextResponse.json(
      { error: "must be an absolute path without .." },
      { status: 400 },
    );
  }

  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "not a directory" }, { status: 400 });
    }
  } catch {
    return NextResponse.json(
      { error: "path does not exist" },
      { status: 400 },
    );
  }

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const dirs: Array<{ name: string; path: string; isGitRepo: boolean }> = [];

    for (const entry of entries) {
      // Skip hidden dirs except .git detection, skip node_modules
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (!entry.isDirectory()) continue;

      const fullPath = path.join(dir, entry.name);
      const isGitRepo = fs.existsSync(path.join(fullPath, ".git"));
      dirs.push({ name: entry.name, path: fullPath, isGitRepo });
    }

    // Sort: git repos first, then alphabetical
    dirs.sort((a, b) => {
      if (a.isGitRepo !== b.isGitRepo) return a.isGitRepo ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const parentDir = path.dirname(dir);
    const isGitRepo = fs.existsSync(path.join(dir, ".git"));

    return NextResponse.json({
      data: {
        current: dir,
        parent: parentDir !== dir ? parentDir : null,
        isGitRepo,
        dirs,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "cannot read directory" },
      { status: 500 },
    );
  }
}
