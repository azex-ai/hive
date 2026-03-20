import "server-only";
import fs from "fs";
import path from "path";
import { compile } from "./compiler";
import { getTask, listTasks, updateTaskStatus, createAttempt, saveAttemptBranch, completeAttempt, saveArtifact } from "./scheduler";
import { getConfig, getOutputDir } from "./config";
import { createWorktree, detachWorktree, getWorktreeDiff, detectGitRepo } from "./worktree";
import { publishEvent } from "./events";
import type { Role, TaskStatus } from "./types";

// Track active runs per agent
const activeRuns: Record<string, number> = {};
// Track session history per task for follow-ups
const taskSessions: Record<string, string[]> = {};
// Prevent concurrent dispatch loops
let dispatching = false;

export function getActiveRuns(): Record<string, number> {
  return { ...activeRuns };
}

export function getTaskSessionHistory(taskId: string): string[] {
  return taskSessions[taskId] || [];
}

export function appendTaskSession(taskId: string, ...entries: string[]): void {
  if (!taskSessions[taskId]) taskSessions[taskId] = [];
  taskSessions[taskId].push(...entries);
  if (taskSessions[taskId].length > 50) {
    taskSessions[taskId] = taskSessions[taskId].slice(-50);
  }
}

export async function runTask(taskId: string, agentName: string, role: string): Promise<void> {
  try {
    const task = getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);

    // Create attempt record in DB
    const attemptId = createAttempt(taskId, agentName, role);

    // Update to running
    updateTaskStatus(taskId, "running");
    publishEvent({
      type: "task_status",
      task_id: taskId,
      data: { status: "running", agent: agentName, role, attempt_id: attemptId },
    });

    // Compile prompt
    const prompt = compile(task.spec, agentName, role as Role);

    // Resolve working directory: git worktree or output dir
    const config = getConfig();
    const outputDir = getOutputDir();
    let workdir = "";
    let branch = "";
    let repoRoot: string | null = null;

    // Auto-detect git repo from configured repo path
    const repoPath = config.repo ? path.resolve(config.repo) : null;
    if (repoPath) {
      repoRoot = detectGitRepo(repoPath);
    }

    if (repoRoot) {
      // Git repo mode: create worktree branch for isolated work
      const shortId = taskId.length > 8 ? taskId.slice(0, 8) : taskId;
      branch = `hive/${shortId}/${agentName}`;
      const baseDir = config.worktree?.base_dir || path.join(repoRoot, ".hive/worktrees");

      try {
        workdir = createWorktree(repoRoot, baseDir, branch);
        // Save branch info to attempt for later merge/cleanup
        saveAttemptBranch(attemptId, branch);
      } catch (err: any) {
        // Fall back to output dir
        const taskOutDir = path.join(outputDir, taskId);
        fs.mkdirSync(taskOutDir, { recursive: true });
        workdir = taskOutDir;
        publishEvent({
          type: "task_output",
          task_id: taskId,
          data: { line: `[warn] worktree create failed: ${err.message} -- using output dir` },
        });
      }
    } else {
      // No git repo: output dir mode
      const taskOutDir = path.join(outputDir, taskId);
      fs.mkdirSync(taskOutDir, { recursive: true });
      workdir = taskOutDir;
    }

    publishEvent({
      type: "task_output",
      task_id: taskId,
      data: { line: `[hive] running ${agentName} in workdir=${workdir || "(cwd)"}` },
    });
    publishEvent({
      type: "task_output",
      task_id: taskId,
      data: { line: `[hive] prompt length: ${prompt.length} chars` },
    });

    // Run the agent using Claude Code SDK
    let output = "";
    let exitCode = 0;
    const startTime = Date.now();

    try {
      const { query } = await import("@anthropic-ai/claude-code");

      for await (const msg of query({
        prompt,
        options: {
          abortController: new AbortController(),
          maxTurns: 3,
          permissionMode: "bypassPermissions" as const,
          ...(workdir ? { cwd: workdir } : {}),
        },
      })) {
        if (msg.type === "result") {
          if (msg.subtype === "success") {
            output = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
          }
        } else if (msg.type === "assistant" && msg.message) {
          if (Array.isArray(msg.message.content)) {
            for (const block of msg.message.content) {
              if (block.type === "text") {
                // Stream output lines
                for (const line of block.text.split("\n")) {
                  if (line.trim()) {
                    publishEvent({
                      type: "task_output",
                      task_id: taskId,
                      data: { line },
                    });
                  }
                }
              }
            }
          }
        }
      }
    } catch (err: any) {
      output = err.message;
      exitCode = 1;
    }

    const duration = Date.now() - startTime;
    const success = exitCode === 0;
    const finalStatus: TaskStatus = success ? "done" : "failed";

    if (!success) {
      publishEvent({
        type: "task_error",
        task_id: taskId,
        data: { line: `[hive] agent exited with code ${exitCode}` },
      });
    } else {
      publishEvent({
        type: "task_output",
        task_id: taskId,
        data: { line: `[hive] completed in ${Math.round(duration / 1000)}s` },
      });
    }

    // Save artifacts to disk + DB
    const taskOutDir = path.join(outputDir, taskId);
    fs.mkdirSync(taskOutDir, { recursive: true });

    const logPath = path.join(taskOutDir, "output.log");
    fs.writeFileSync(logPath, output);
    saveArtifact(attemptId, "log", logPath);

    if (repoRoot && branch) {
      try {
        const diff = getWorktreeDiff(repoRoot, branch);
        if (diff) {
          const diffPath = path.join(taskOutDir, "diff.patch");
          fs.writeFileSync(diffPath, diff);
          saveArtifact(attemptId, "diff", diffPath);
        }
      } catch {
        /* best effort */
      }
    }

    // Save session history
    appendTaskSession(taskId, `Prompt: ${prompt}`, `Output: ${output}`);

    // Update attempt + task status
    completeAttempt(attemptId, success ? "done" : "failed");
    updateTaskStatus(taskId, finalStatus);

    publishEvent({
      type: success ? "task_complete" : "task_error",
      task_id: taskId,
      data: { status: finalStatus, exit_code: String(exitCode), branch: branch || undefined },
    });

    // Detach worktree dir but KEEP the branch for review/merge
    if (branch && repoRoot) {
      try {
        const baseDir = config.worktree?.base_dir || path.join(repoRoot, ".hive/worktrees");
        detachWorktree(repoRoot, baseDir, branch);
      } catch {
        /* best effort */
      }
    }
  } finally {
    activeRuns[agentName] = Math.max(0, (activeRuns[agentName] || 0) - 1);
    // After a task completes, try to dispatch more pending tasks
    scheduleDispatch();
  }
}

/**
 * Auto-dispatch: pick up pending tasks and run them on available agents.
 * Respects max_concurrent per agent. Called after task creation and task completion.
 */
export function scheduleDispatch(): void {
  // Debounce — wait a tick so batch-created tasks are all visible
  setTimeout(() => autoDispatch(), 50);
}

function autoDispatch(): void {
  if (dispatching) return;
  dispatching = true;

  try {
    const config = getConfig();
    const agents = config.agents || {};

    // Find pending tasks whose deps are all done
    const tasks = listTasks();
    const pending = tasks.filter((t) => {
      if (t.status !== "pending") return false;
      // Check deps are satisfied (scheduler already filters this in claimTask,
      // but we do a simple check here too)
      const deps = t.spec.depends_on || [];
      return deps.every((depId) => {
        const dep = tasks.find((d) => d.spec.id === depId);
        return dep && dep.status === "done";
      });
    });

    if (pending.length === 0) return;

    // Pick agent with available capacity (prefer claude, fall back to codex)
    const agentOrder = Object.keys(agents);

    for (const task of pending) {
      let assigned = false;

      for (const agentName of agentOrder) {
        const maxConcurrent = agents[agentName]?.max_concurrent || 3;
        const current = activeRuns[agentName] || 0;

        if (current < maxConcurrent) {
          publishEvent({
            type: "task_output",
            task_id: task.spec.id,
            data: { line: `[hive] auto-dispatching to ${agentName}` },
          });
          // Increment synchronously BEFORE starting async task
          activeRuns[agentName] = (activeRuns[agentName] || 0) + 1;
          runTask(task.spec.id, agentName, "writer").catch((err) => {
            console.error(`[hive] auto-dispatch error for ${task.spec.id}:`, err);
          });
          assigned = true;
          break;
        }
      }

      // If no agent has capacity, stop trying (will retry when a task finishes)
      if (!assigned) break;
    }
  } finally {
    dispatching = false;
  }
}
