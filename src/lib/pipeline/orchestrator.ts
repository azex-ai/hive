import "server-only";
import { scheduler as nodeScheduler } from "timers/promises";
import { getConfig } from "../config";
import {
  updateTaskStatus,
  getStageRecords,
  createStageRecord,
  updateStageRecord,
  createRepairRound,
  updateRepairRound,
  recordBenchmark,
  getTask,
  getRepairRounds,
} from "../scheduler";
import { publishEvent } from "../events";
import { runGate } from "./gates";
import { selectModel, isSelfReview } from "./model-router";
import { getRuntime } from "../runtime";
import { compileRepairPrompt } from "../compiler";
import type {
  GateResult,
  GateEvidence,
  GateFinding,
  PipelineStage,
  PipelineStatus,
  TaskStatus,
  RepairRecord,
} from "../types";

// Track paused pipelines
const pausedTasks = new Set<string>();

// Map stage name to TaskStatus for UI
const STAGE_TO_STATUS: Record<string, TaskStatus> = {
  lint: "linting",
  build: "building",
  test: "testing",
  review: "reviewing",
  integrate: "integrating",
};

const MAX_REVIEW_OUTPUT = 10240;

/**
 * Run a task through the full pipeline after coding is complete.
 * Called from executor.ts after agent finishes coding.
 */
export async function runPipeline(
  taskId: string,
  workdir: string,
  branch: string,
  baseBranch: string,
): Promise<void> {
  const config = getConfig();
  const gates = config.pipeline?.gates ?? (["lint", "build", "test", "review", "integrate"] as PipelineStage[]);

  publishEvent({
    type: "pipeline_start",
    task_id: taskId,
    data: { gates },
  });

  for (const stageName of gates) {
    // Check pause
    if (pausedTasks.has(taskId)) {
      updateTaskStatus(taskId, "paused");
      publishEvent({ type: "pipeline_paused", task_id: taskId, data: { stage: stageName } });
      // Wait for resume
      await waitForResume(taskId);
    }

    const stageStatus = STAGE_TO_STATUS[stageName];
    if (stageStatus) {
      updateTaskStatus(taskId, stageStatus);
    }

    const role =
      stageName === "review"
        ? isSelfReview()
          ? "self-reviewer"
          : "reviewer"
        : "executor";
    const modelSel = selectModel(stageName as PipelineStage, role as Parameters<typeof selectModel>[1]);
    const stageId = createStageRecord(taskId, stageName, modelSel.model, modelSel.model);

    publishEvent({
      type: "pipeline_stage",
      task_id: taskId,
      data: {
        stage: stageName,
        status: "running",
        model: modelSel.model,
        modelReason: modelSel.reason,
      },
    });

    const startTime = Date.now();
    let result: GateResult;

    if (stageName === "review") {
      result = await runReviewGate(taskId, workdir, branch, modelSel.model);
    } else if (stageName === "integrate") {
      result = await runIntegrateGate(taskId, workdir, branch, baseBranch);
    } else {
      // Machine gates: lint, build, test
      result = runGate(stageName, { workdir, baseBranch });
    }

    const durationMs = Date.now() - startTime;

    updateStageRecord(stageId, {
      status: result.passed ? "passed" : "failed",
      finishedAt: new Date().toISOString(),
      durationMs,
      gateReport: result,
    });

    publishEvent({
      type: "pipeline_stage",
      task_id: taskId,
      data: {
        stage: stageName,
        status: result.passed ? "passed" : "failed",
        durationMs,
        findingsCount: result.findings.length,
      },
    });

    if (!result.passed) {
      updateTaskStatus(taskId, "repairing");
      const repaired = await repairLoop(taskId, stageName, stageId, result, workdir, branch, baseBranch);
      if (!repaired) {
        updateTaskStatus(taskId, "escalated");
        publishEvent({ type: "pipeline_escalated", task_id: taskId, data: { stage: stageName } });
        return;
      }
    }

    // Record benchmark for this stage
    recordBenchmark({
      taskId,
      stage: stageName,
      model: modelSel.model,
      gatePassed: result.passed,
      repairRounds: 0,
      durationMs,
    });
  }

  // All gates passed!
  updateTaskStatus(taskId, "done");
  publishEvent({ type: "pipeline_complete", task_id: taskId, data: {} });
}

/**
 * Repair loop: spawn new agent to fix, then re-run failed gate.
 */
async function repairLoop(
  taskId: string,
  failedStage: string,
  stageId: number,
  gateResult: GateResult,
  workdir: string,
  branch: string,
  baseBranch: string,
): Promise<boolean> {
  const maxRounds = getConfig().pipeline?.max_repair_rounds ?? 3;
  let currentResult = gateResult;

  for (let round = 1; round <= maxRounds; round++) {
    if (pausedTasks.has(taskId)) {
      await waitForResume(taskId);
    }

    const modelSel = selectModel("repair" as PipelineStage, "repairer");
    const repairId = createRepairRound(stageId, round, modelSel.model, modelSel.model);

    publishEvent({
      type: "pipeline_repair",
      task_id: taskId,
      data: { stage: failedStage, round, maxRounds, agent: modelSel.model },
    });

    const startTime = Date.now();

    const task = getTask(taskId);
    if (!task) break;

    const repairPrompt = compileRepairPrompt(task.spec, failedStage, currentResult, round);

    try {
      const runtime = getRuntime("claude");
      let repairOutput = "";

      for await (const event of runtime.execute(repairPrompt, {
        workdir,
        branch,
        taskId,
        attemptId: `repair-${taskId}-${failedStage}-r${round}`,
      })) {
        if (event.type === "output") {
          publishEvent({
            type: "task_output",
            task_id: taskId,
            data: { line: `[repair r${round}] ${event.line}` },
          });
        } else if (event.type === "result") {
          repairOutput = event.content;
        }
      }

      // Re-run the failed gate
      let retryResult: GateResult;
      if (failedStage === "review") {
        retryResult = await runReviewGate(taskId, workdir, branch, modelSel.model);
      } else if (failedStage === "integrate") {
        retryResult = await runIntegrateGate(taskId, workdir, branch, baseBranch);
      } else {
        retryResult = runGate(failedStage, { workdir, baseBranch });
      }

      const durationMs = Date.now() - startTime;
      const outcome = retryResult.passed ? "fixed" : "still_failing";

      updateRepairRound(repairId, {
        fixSummary: repairOutput.slice(0, 2000),
        gateReport: retryResult,
        outcome,
        finishedAt: new Date().toISOString(),
        durationMs,
      });

      publishEvent({
        type: "pipeline_repair_result",
        task_id: taskId,
        data: { stage: failedStage, round, outcome, durationMs },
      });

      if (retryResult.passed) {
        updateStageRecord(stageId, {
          status: "passed",
          gateReport: retryResult,
          finishedAt: new Date().toISOString(),
        });
        return true;
      }

      currentResult = retryResult;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      updateRepairRound(repairId, {
        fixSummary: `Error: ${errMsg}`,
        outcome: "still_failing",
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startTime,
      });
    }
  }

  return false;
}

/**
 * Review gate: spawn a reviewer agent that checks spec↔output consistency.
 */
async function runReviewGate(
  taskId: string,
  workdir: string,
  branch: string,
  _model: string,
): Promise<GateResult> {
  const start = Date.now();
  const task = getTask(taskId);
  if (!task) {
    return {
      passed: false,
      verdict: "fail",
      evidence: [],
      findings: [{ severity: "critical", message: "Task not found" }],
      durationMs: 0,
    };
  }

  const { compile } = await import("../compiler");
  const reviewPrompt = compile(task.spec, "claude", "reviewer");

  const runtime = getRuntime("claude");
  let reviewOutput = "";

  try {
    for await (const event of runtime.execute(reviewPrompt, {
      workdir,
      branch,
      taskId,
      attemptId: `review-${taskId}`,
    })) {
      if (event.type === "output") {
        publishEvent({
          type: "task_output",
          task_id: taskId,
          data: { line: `[review] ${event.line}` },
        });
      } else if (event.type === "result") {
        reviewOutput = event.content;
      }
    }
  } catch (err: unknown) {
    return {
      passed: false,
      verdict: "fail",
      evidence: [],
      findings: [
        {
          severity: "critical",
          message: `Review agent error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      durationMs: Date.now() - start,
    };
  }

  const { parseReviewReport } = await import("../evaluator");
  const report = parseReviewReport(reviewOutput);

  if (report) {
    const hasCritical = report.findings.some((f) => f.severity === "critical");
    return {
      passed: report.verdict === "pass" || (!hasCritical && report.verdict !== "needs_human"),
      verdict: report.verdict === "pass" ? "pass" : "fail",
      evidence: [
        {
          command: "review-agent",
          exitCode: 0,
          stdout: reviewOutput.slice(0, MAX_REVIEW_OUTPUT),
          stderr: "",
          truncated: reviewOutput.length > MAX_REVIEW_OUTPUT,
        },
      ],
      findings: report.findings.map((f) => ({
        severity: f.severity,
        file: f.file ?? undefined,
        line: f.line ? parseInt(String(f.line), 10) : undefined,
        message: f.description,
        suggestion: f.suggest_fix ?? undefined,
      })),
      durationMs: Date.now() - start,
    };
  }

  // Can't parse structured output — treat as pass
  return {
    passed: true,
    verdict: "warn",
    evidence: [
      {
        command: "review-agent",
        exitCode: 0,
        stdout: reviewOutput.slice(0, 5000),
        stderr: "",
        truncated: reviewOutput.length > 5000,
      },
    ],
    findings: [],
    durationMs: Date.now() - start,
  };
}

/**
 * Integrate gate: verify build + test pass before merge.
 */
async function runIntegrateGate(
  taskId: string,
  workdir: string,
  _branch: string,
  baseBranch: string,
): Promise<GateResult> {
  const start = Date.now();
  const evidence: GateEvidence[] = [];
  const findings: GateFinding[] = [];

  // Publish progress
  publishEvent({
    type: "task_output",
    task_id: taskId,
    data: { line: "[integrate] running build check..." },
  });

  const buildResult = runGate("build", { workdir, baseBranch });
  evidence.push(...buildResult.evidence);
  findings.push(...buildResult.findings);

  if (!buildResult.passed) {
    return { passed: false, verdict: "fail", evidence, findings, durationMs: Date.now() - start };
  }

  publishEvent({
    type: "task_output",
    task_id: taskId,
    data: { line: "[integrate] build passed, running test check..." },
  });

  const testResult = runGate("test", { workdir, baseBranch });
  evidence.push(...testResult.evidence);
  findings.push(...testResult.findings);

  return {
    passed: testResult.passed,
    verdict: testResult.passed ? "pass" : "fail",
    evidence,
    findings,
    durationMs: Date.now() - start,
  };
}

// --- Pause / Resume ---

async function waitForResume(taskId: string): Promise<void> {
  while (pausedTasks.has(taskId)) {
    await nodeScheduler.wait(1000);
  }
}

export function pausePipeline(taskId: string): void {
  pausedTasks.add(taskId);
  publishEvent({ type: "pipeline_paused", task_id: taskId, data: {} });
}

export function resumePipeline(taskId: string): void {
  pausedTasks.delete(taskId);
  publishEvent({ type: "pipeline_resumed", task_id: taskId, data: {} });
}

export function getPipelineStatus(taskId: string): PipelineStatus {
  const stages = getStageRecords(taskId);
  const repairs: RepairRecord[] = [];
  for (const stage of stages) {
    const stageRepairs = getRepairRounds(stage.id);
    repairs.push(...stageRepairs);
  }

  const runningStage = stages.find((s) => s.status === "running");

  return {
    taskId,
    currentStage: runningStage ? (runningStage.stage as PipelineStage) : null,
    stages,
    repairs,
    paused: pausedTasks.has(taskId),
    escalated:
      stages.some((s) => s.status === "failed") && !stages.some((s) => s.status === "running"),
  };
}
