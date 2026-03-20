import "server-only";
import { execFileSync } from "child_process";
import path from "path";
import fs from "fs";

export interface WorktreeInfo {
  branch: string;
  path: string;
}

function git(repoPath: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoPath,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/** Detect if a directory is inside a git repository. Returns repo root or null. */
export function detectGitRepo(dir: string): string | null {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return root || null;
  } catch {
    return null;
  }
}

/** Get the current branch name of a repo */
export function getCurrentBranch(repoPath: string): string {
  try {
    return git(repoPath, "rev-parse", "--abbrev-ref", "HEAD");
  } catch {
    return "main";
  }
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

/** Remove worktree directory only, keep the branch for merge/review */
export function detachWorktree(repoPath: string, baseDir: string, branch: string): void {
  const sanitized = branch.replace(/\//g, "-");
  const workdir = path.join(baseDir, sanitized);

  try {
    git(repoPath, "worktree", "remove", "--force", workdir);
  } catch {
    /* best effort */
  }
}

/** Full cleanup: remove worktree + delete branch */
export function removeWorktree(repoPath: string, baseDir: string, branch: string): void {
  detachWorktree(repoPath, baseDir, branch);

  try {
    git(repoPath, "branch", "-D", branch);
  } catch {
    /* best effort */
  }
}

export function getWorktreeDiff(repoPath: string, branch: string): string {
  try {
    const baseBranch = getCurrentBranch(repoPath);
    return git(repoPath, "diff", `${baseBranch}...${branch}`);
  } catch {
    return "";
  }
}

/** Merge a task branch into the current branch */
export function mergeBranch(repoPath: string, branch: string): { success: boolean; error?: string } {
  try {
    git(repoPath, "merge", "--no-ff", branch, "-m", `hive: merge ${branch}`);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** Check if a branch has any commits ahead of the base */
export function branchHasChanges(repoPath: string, branch: string): boolean {
  try {
    const baseBranch = getCurrentBranch(repoPath);
    const count = git(repoPath, "rev-list", "--count", `${baseBranch}..${branch}`);
    return parseInt(count, 10) > 0;
  } catch {
    return false;
  }
}
