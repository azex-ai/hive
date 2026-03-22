import "server-only";
import fs from "fs";
import path from "path";
import { compile } from "./compiler";
import { getTask, listTasks, updateTaskStatus, createAttempt, saveAttemptBranch, completeAttempt, saveArtifact } from "./scheduler";
import { getConfig, getOutputDir } from "./config";
import { createWorktree, detachWorktree, getWorktreeDiff, detectGitRepo } from "./worktree";
import { publishEvent, setRateLimitPaused } from "./events";
import { getRuntime } from "./runtime";
import { runPipeline } from "./pipeline/orchestrator";
import type { Role, TaskStatus, AgentProfile } from "./types";

// Track active runs per agent
const activeRuns: Record<string, number> = {};
// Track session history per task for follow-ups
const taskSessions: Record<string, string[]> = {};
// Track AbortControllers for cancel support
const taskAbortControllers = new Map<string, AbortController>();
// Prevent concurrent dispatch loops
let dispatching = false;

export function getActiveRuns(): Record<string, number> {
  return { ...activeRuns };
}

/** Cancel a running task by signaling its abort controller */
export function cancelTask(taskId: string): boolean {
  const controller = taskAbortControllers.get(taskId);
  if (!controller) return false;
  controller.abort();
  taskAbortControllers.delete(taskId);
  return true;
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
      } catch (err: unknown) {
        // Fall back to output dir
        const taskOutDir = path.join(outputDir, taskId);
        fs.mkdirSync(taskOutDir, { recursive: true });
        workdir = taskOutDir;
        publishEvent({
          type: "task_output",
          task_id: taskId,
          data: { line: `[warn] worktree create failed: ${err instanceof Error ? err.message : String(err)} -- using output dir` },
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

    // Map role to agent profile for the new SDK
    const roleToProfile: Record<string, AgentProfile> = {
      writer: "coder",
      reviewer: "reviewer",
      tester: "tester",
      fixer: "repairer",
    };
    const agentProfile = roleToProfile[role] ?? "coder";

    // Track abort controller for cancel support
    const abortController = new AbortController();
    taskAbortControllers.set(taskId, abortController);

    // Run the agent via pluggable runtime
    let output = "";
    let exitCode = 0;
    const startTime = Date.now();
    const runtime = getRuntime(agentName);

    for await (const event of runtime.execute(prompt, {
      workdir,
      branch,
      taskId,
      attemptId,
      agentProfile,
      enableCheckpointing: agentProfile === "coder",
      budgetUsd: config.budget?.max_per_task,
      use1mContext: config.budget?.use_1m_context,
      fallbackModel: config.budget?.fallback_model,
      // Pass the abort signal so the runtime can interrupt the SDK query
      abortSignal: abortController.signal,
    })) {
      // Check if cancelled (belt-and-suspenders — runtime should stop on its own via signal)
      if (abortController.signal.aborted) {
        exitCode = 130; // SIGINT convention
        output = "Task cancelled by user";
        break;
      }

      switch (event.type) {
        case "output":
          publishEvent({
            type: "task_output",
            task_id: taskId,
            data: { line: event.line },
          });
          break;
        case "result":
          output = event.content;
          exitCode = event.exitCode;
          break;
        case "andon":
          publishEvent({
            type: "task_andon",
            task_id: taskId,
            data: { reason: event.reason },
          });
          break;
        case "artifact":
          saveArtifact(attemptId, event.artifactType, event.path);
          break;
        case "tool_use":
          publishEvent({
            type: "agent_tool_use",
            task_id: taskId,
            data: { tool: event.toolName, elapsed: event.elapsed },
          });
          break;
        case "progress":
          publishEvent({
            type: "agent_progress",
            task_id: taskId,
            data: { summary: event.summary },
          });
          break;
        case "cost":
          publishEvent({
            type: "task_cost",
            task_id: taskId,
            data: { totalUsd: event.totalUsd, inputTokens: event.inputTokens, outputTokens: event.outputTokens },
          });
          break;
        case "rate_limited":
          setRateLimitPaused(true, taskId);
          publishEvent({
            type: "rate_limit",
            task_id: taskId,
            data: { retryAfterMs: event.retryAfterMs },
          });
          break;
        case "compacted":
          publishEvent({
            type: "task_output",
            task_id: taskId,
            data: { line: `[hive] context compacted (trigger=${event.trigger})` },
          });
          break;
        case "subtask":
          publishEvent({
            type: "task_output",
            task_id: taskId,
            data: { line: `[hive] subtask ${event.status}${event.summary ? `: ${event.summary}` : ""}` },
          });
          break;
      }
    }

    // Cleanup abort controller
    taskAbortControllers.delete(taskId);
    // Clear rate-limit pause flag once the task loop exits
    setRateLimitPaused(false, taskId);

    const duration = Date.now() - startTime;
    const success = exitCode === 0;

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

    // Update attempt status
    completeAttempt(attemptId, success ? "done" : "failed");

    if (success && workdir && branch) {
      // Enter pipeline: run through quality gates automatically
      publishEvent({
        type: "task_output",
        task_id: taskId,
        data: { line: "[hive] agent completed, entering pipeline..." },
      });

      // Run pipeline (don't await in finally block — let executor return)
      runPipeline(taskId, workdir, branch, "main").catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[hive] pipeline error for ${taskId}:`, errMsg);
        updateTaskStatus(taskId, "failed");
        publishEvent({
          type: "pipeline_error",
          task_id: taskId,
          data: { error: errMsg },
        });
      });
    } else if (success) {
      // No worktree/branch — skip pipeline, mark done directly
      updateTaskStatus(taskId, "done");
      publishEvent({
        type: "task_complete",
        task_id: taskId,
        data: { status: "done", exit_code: "0" },
      });
    } else {
      // Agent failed
      updateTaskStatus(taskId, "failed");
      publishEvent({
        type: "task_error",
        task_id: taskId,
        data: { status: "failed", exit_code: String(exitCode), branch: branch || undefined },
      });
    }

    // Detach worktree dir but KEEP the branch for review/merge
    // (only if NOT entering pipeline — pipeline needs the workdir)
    if (!success && branch && repoRoot) {
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
