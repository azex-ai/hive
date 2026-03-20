import { NextRequest, NextResponse } from "next/server";
import { getTask, updateTaskStatus, getTaskBranch } from "@/lib/scheduler";
import { publishEvent } from "@/lib/events";
import { getConfig } from "@/lib/config";
import { mergeBranch, removeWorktree, detectGitRepo } from "@/lib/worktree";
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
  let mergeResult: { merged: boolean; branch?: string; error?: string } = { merged: false };

  // If task has a branch, merge it into the current branch
  if (branchInfo?.branch) {
    const repoPath = config.repo ? path.resolve(config.repo) : null;
    const repoRoot = repoPath ? detectGitRepo(repoPath) : null;

    if (repoRoot) {
      const result = mergeBranch(repoRoot, branchInfo.branch);
      mergeResult = {
        merged: result.success,
        branch: branchInfo.branch,
        error: result.error,
      };

      if (result.success) {
        // Cleanup branch after successful merge
        const baseDir = config.worktree?.base_dir || path.join(repoRoot, ".hive/worktrees");
        removeWorktree(repoRoot, baseDir, branchInfo.branch);

        publishEvent({
          type: "task.merged",
          task_id: id,
          data: { branch: branchInfo.branch },
        });
      }
    }
  }

  updateTaskStatus(id, "evaluated");
  publishEvent({ type: "task.approved", data: { task_id: id, ...mergeResult } });

  return NextResponse.json({
    data: { task_id: id, status: "evaluated", ...mergeResult },
  });
}
