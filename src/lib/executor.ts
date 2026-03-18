import fs from "fs";
import path from "path";
import { compile } from "./compiler";
import { getTask, updateTaskStatus } from "./scheduler";
import { getConfig, getOutputDir } from "./config";
import { createWorktree, removeWorktree, getWorktreeDiff } from "./worktree";
import { publishEvent } from "./events";
import type { Role, TaskStatus } from "./types";

// Track active runs per agent
const activeRuns: Record<string, number> = {};
// Track session history per task for follow-ups
const taskSessions: Record<string, string[]> = {};

export function getActiveRuns(): Record<string, number> {
  return { ...activeRuns };
}

export function getTaskSessionHistory(taskId: string): string[] {
  return taskSessions[taskId] || [];
}

export function appendTaskSession(taskId: string, ...entries: string[]): void {
  if (!taskSessions[taskId]) taskSessions[taskId] = [];
  taskSessions[taskId].push(...entries);
}

export async function runTask(taskId: string, agentName: string, role: string): Promise<void> {
  activeRuns[agentName] = (activeRuns[agentName] || 0) + 1;

  try {
    const task = getTask(taskId);
    if (!task) throw new Error(`task ${taskId} not found`);

    // Update to running
    updateTaskStatus(taskId, "running");
    publishEvent({
      type: "task_status",
      task_id: taskId,
      data: { status: "running", agent: agentName, role },
    });

    // Compile prompt
    const prompt = compile(task.spec, agentName, role as Role);

    // Create worktree
    const config = getConfig();
    const outputDir = getOutputDir();
    let workdir = "";
    let branch = "";

    if (config.repo) {
      const shortId = taskId.length > 8 ? taskId.slice(0, 8) : taskId;
      branch = `task/${shortId}/${agentName}-${Date.now()}`;
      const baseDir = config.worktree?.base_dir || path.join(config.repo, ".hive/worktrees");

      try {
        workdir = createWorktree(config.repo, baseDir, branch);
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

    // Save artifacts
    const taskOutDir = path.join(outputDir, taskId);
    fs.mkdirSync(taskOutDir, { recursive: true });
    fs.writeFileSync(path.join(taskOutDir, "output.log"), output);

    if (workdir && branch && config.repo) {
      try {
        const diff = getWorktreeDiff(config.repo, branch);
        if (diff) fs.writeFileSync(path.join(taskOutDir, "diff.patch"), diff);
      } catch {
        /* best effort */
      }
    }

    // Save session history
    appendTaskSession(taskId, `Prompt: ${prompt}`, `Output: ${output}`);

    // Update status
    updateTaskStatus(taskId, finalStatus);

    publishEvent({
      type: success ? "task_complete" : "task_error",
      task_id: taskId,
      data: { status: finalStatus, exit_code: String(exitCode) },
    });

    // Cleanup worktree
    if (branch && config.repo) {
      try {
        const baseDir = config.worktree?.base_dir || path.join(config.repo, ".hive/worktrees");
        removeWorktree(config.repo, baseDir, branch);
      } catch {
        /* best effort */
      }
    }
  } finally {
    activeRuns[agentName] = Math.max(0, (activeRuns[agentName] || 0) - 1);
  }
}
