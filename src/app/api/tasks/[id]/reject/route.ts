import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTaskStatus, getTaskBranch } from "@/lib/scheduler";
import { publishEvent } from "@/lib/events";
import { getConfig } from "@/lib/config";
import { removeWorktree, detectGitRepo } from "@/lib/worktree";
import path from "path";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const task = getTask(id);
  if (!task)
    return NextResponse.json({ error: "task not found" }, { status: 404 });

  const config = getConfig();
  const branchInfo = getTaskBranch(id);

  // If task has a branch, clean it up (delete branch + worktree)
  if (branchInfo?.branch) {
    const repoPath = config.repo ? path.resolve(config.repo) : null;
    const repoRoot = repoPath ? detectGitRepo(repoPath) : null;

    if (repoRoot) {
      const baseDir = config.worktree?.base_dir || path.join(repoRoot, ".hive/worktrees");
      removeWorktree(repoRoot, baseDir, branchInfo.branch);

      publishEvent({
        type: "task.branch_cleaned",
        task_id: id,
        data: { branch: branchInfo.branch },
      });
    }
  }

  updateTaskStatus(id, "failed");
  publishEvent({ type: "task.rejected", data: { task_id: id } });

  return NextResponse.json({ data: { task_id: id, status: "failed" } });
}
