import { execSync } from "child_process";
import path from "path";
import fs from "fs";

export interface WorktreeInfo {
  branch: string;
  path: string;
}

function git(repoPath: string, ...args: string[]): string {
  return execSync(`git ${args.join(" ")}`, {
    cwd: repoPath,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function createWorktree(repoPath: string, baseDir: string, branch: string): string {
  const sanitized = branch.replace(/\//g, "-");
  const workdir = path.join(baseDir, sanitized);
  fs.mkdirSync(baseDir, { recursive: true });

  try {
    git(repoPath, "worktree", "add", "-b", branch, workdir, "HEAD");
    return workdir;
  } catch (err: any) {
    throw new Error(`worktree create "${branch}": ${err.message}`);
  }
}

export function removeWorktree(repoPath: string, baseDir: string, branch: string): void {
  const sanitized = branch.replace(/\//g, "-");
  const workdir = path.join(baseDir, sanitized);

  try {
    git(repoPath, "worktree", "remove", "--force", workdir);
  } catch {
    /* best effort */
  }

  try {
    git(repoPath, "branch", "-D", branch);
  } catch {
    /* best effort */
  }
}

export function getWorktreeDiff(repoPath: string, branch: string): string {
  try {
    return git(repoPath, "diff", `main...${branch}`);
  } catch {
    return "";
  }
}

export function mergeToMain(repoPath: string, branch: string): void {
  git(repoPath, "checkout", "main");
  git(repoPath, "merge", "--no-ff", branch, "-m", `merge: ${branch}`);
}
