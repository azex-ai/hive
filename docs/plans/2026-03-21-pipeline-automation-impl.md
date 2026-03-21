# Pipeline Automation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the fully automated pipeline from the design doc (`2026-03-21-pipeline-automation-design.md`), turning Hive from "run agent + manually approve" into "auto-run through quality gates with repair loop."

**Architecture:** Three-layer pipeline (Decompose → Execute → Repair) with quality gates at each stage, benchmark-driven model routing, and full history tracking in SQLite.

**Tech Stack:** Next.js 16, better-sqlite3 (sync), AgentRuntime interface, SSE events

**Design doc:** `docs/plans/2026-03-21-pipeline-automation-design.md`

---

## Phase 1: Schema + Types + Constants

> Foundation layer. All subsequent phases depend on this.

### Task 1.1: Add Pipeline Types to `lib/types.ts`

**Files:**
- Modify: `src/lib/types.ts`

**Step 1: Add pipeline types**

Append after the existing types (after line ~199):

```typescript
// --- Pipeline Automation ---

export type PipelineStage = "design" | "code" | "lint" | "build" | "test" | "review" | "integrate";
export type PipelineStageStatus = "pending" | "running" | "passed" | "failed" | "skipped";
export type RepairOutcome = "fixed" | "still_failing" | "escalated";
export type ModelTier = "opus" | "sonnet" | "haiku";
export type AgentRole = "executor" | "reviewer" | "architect" | "repairer";

export interface GateEvidence {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface GateFinding {
  severity: Severity;
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface GateResult {
  passed: boolean;
  verdict: "pass" | "fail" | "warn";
  evidence: GateEvidence[];
  findings: GateFinding[];
  durationMs: number;
}

export interface StageRecord {
  id: number;
  taskId: string;
  stage: PipelineStage;
  status: PipelineStageStatus;
  agent?: string;
  model?: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  inputHash?: string;
  outputHash?: string;
  gateReport?: GateResult;
}

export interface RepairRecord {
  id: number;
  stageId: number;
  round: number;
  agent: string;
  model?: string;
  fixSummary?: string;
  gateReport?: GateResult;
  outcome: RepairOutcome;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface PipelineStatus {
  taskId: string;
  currentStage: PipelineStage | null;
  stages: StageRecord[];
  repairs: RepairRecord[];
  paused: boolean;
  escalated: boolean;
}

export interface ModelSelection {
  model: ModelTier;
  source: "default" | "benchmark";
  score?: number;
  reason: string;
}

export interface PipelineConfig {
  max_repair_rounds: number;
  self_review_probability: number;
  parallel_max: number;
  gates: PipelineStage[];
  model_routing: {
    default: Record<string, ModelTier>;
    benchmark_min_samples: number;
    benchmark_window_days: number;
  };
}
```

**Step 2: Extend HiveConfig**

Add `pipeline?: PipelineConfig` field to the `HiveConfig` interface.

**Step 3: Extend TaskStatus**

Update `TaskStatus` to include pipeline states:

```typescript
export type TaskStatus =
  | "pending" | "claimed" | "running" | "done"
  | "reviewing" | "evaluated" | "failed"
  | "decomposed" | "coding" | "linting" | "building"
  | "testing" | "integrating" | "repairing" | "escalated" | "paused";
```

**Step 4: Commit**

```
feat(pipeline): add pipeline automation types
```

---

### Task 1.2: Database Migration — Add Pipeline Tables

**Files:**
- Modify: `src/lib/scheduler.ts` (the `migrate()` function)

**Step 1: Add 3 new tables to the migrate function**

After the existing `CREATE TABLE IF NOT EXISTS artifacts` block, add:

```sql
CREATE TABLE IF NOT EXISTS pipeline_stages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id     TEXT NOT NULL,
  stage       TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending',
  agent       TEXT,
  model       TEXT,
  started_at  TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  input_hash  TEXT,
  output_hash TEXT,
  gate_report TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_stages_task ON pipeline_stages(task_id);
CREATE INDEX IF NOT EXISTS idx_stages_status ON pipeline_stages(status);

CREATE TABLE IF NOT EXISTS repair_rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id    INTEGER NOT NULL,
  round       INTEGER NOT NULL,
  agent       TEXT NOT NULL,
  model       TEXT,
  fix_summary TEXT,
  gate_report TEXT,
  outcome     TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  duration_ms INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_repairs_stage ON repair_rounds(stage_id);

CREATE TABLE IF NOT EXISTS model_benchmarks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       TEXT NOT NULL,
  stage         TEXT NOT NULL,
  model         TEXT NOT NULL,
  gate_passed   INTEGER NOT NULL,
  repair_rounds INTEGER DEFAULT 0,
  duration_ms   INTEGER,
  token_cost    INTEGER,
  user_verdict  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bench_stage_model ON model_benchmarks(stage, model);
```

**Step 2: Add CRUD functions for pipeline_stages**

```typescript
export function createStageRecord(taskId: string, stage: PipelineStage, agent?: string, model?: string): number
export function updateStageRecord(id: number, updates: Partial<StageRecord>): void
export function getStageRecords(taskId: string): StageRecord[]
export function getLatestStage(taskId: string): StageRecord | null
```

**Step 3: Add CRUD functions for repair_rounds**

```typescript
export function createRepairRound(stageId: number, round: number, agent: string, model?: string): number
export function updateRepairRound(id: number, updates: Partial<RepairRecord>): void
export function getRepairRounds(stageId: number): RepairRecord[]
```

**Step 4: Add CRUD functions for model_benchmarks**

```typescript
export function recordBenchmark(data: { taskId: string; stage: string; model: string; gatePassed: boolean; repairRounds: number; durationMs: number; tokenCost?: number }): void
export function updateBenchmarkVerdict(taskId: string, stage: string, verdict: string): void
export function queryBenchmarks(stage: string, windowDays: number): Array<{ model: string; samples: number; passRate: number; avgRepairs: number; rejectRate: number; score: number }>
```

**Step 5: Commit**

```
feat(pipeline): add pipeline_stages, repair_rounds, model_benchmarks tables
```

---

### Task 1.3: Pipeline Config Defaults

**Files:**
- Modify: `src/lib/config.ts`

**Step 1: Add pipeline defaults to loadConfig**

When no `pipeline` key exists in hive.yaml, apply defaults:

```typescript
if (!_config.pipeline) {
  _config.pipeline = {
    max_repair_rounds: 3,
    self_review_probability: 0.2,
    parallel_max: 3,
    gates: ["lint", "build", "test", "review", "integrate"],
    model_routing: {
      default: { design: "opus", code: "sonnet", review: "opus", repair: "sonnet" },
      benchmark_min_samples: 5,
      benchmark_window_days: 30,
    },
  };
}
```

**Step 2: Commit**

```
feat(pipeline): add pipeline config defaults
```

---

## Phase 2: Quality Gates

> Core gate infrastructure. Each gate runs commands independently and returns evidence.

### Task 2.1: Gate Interface + Registry

**Files:**
- Create: `src/lib/pipeline/gates.ts`
- Create: `src/lib/pipeline/index.ts`

**Step 1: Implement gate interface and built-in gates**

`src/lib/pipeline/gates.ts`:

```typescript
import "server-only";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type { GateResult, GateEvidence, GateFinding, PipelineStage } from "../types";

interface GateContext {
  workdir: string;
  baseBranch: string;
}

interface QualityGate {
  readonly name: PipelineStage;
  check(ctx: GateContext): GateResult;
}

/** Run a shell command and capture evidence */
function runCommand(command: string, args: string[], cwd: string, timeoutMs = 60000): GateEvidence {
  const MAX_OUTPUT = 10240; // 10KB
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const truncated = stdout.length > MAX_OUTPUT;
    return {
      command: `${command} ${args.join(" ")}`,
      exitCode: 0,
      stdout: truncated ? stdout.slice(-MAX_OUTPUT) : stdout,
      stderr: "",
      truncated,
    };
  } catch (err: any) {
    const stdout = (err.stdout || "").toString();
    const stderr = (err.stderr || "").toString();
    return {
      command: `${command} ${args.join(" ")}`,
      exitCode: err.status ?? 1,
      stdout: stdout.length > MAX_OUTPUT ? stdout.slice(-MAX_OUTPUT) : stdout,
      stderr: stderr.length > MAX_OUTPUT ? stderr.slice(-MAX_OUTPUT) : stderr,
      truncated: stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT,
    };
  }
}

/** Detect which lint command to use */
function detectLintCommand(workdir: string): { cmd: string; args: string[] } | null {
  const pkg = path.join(workdir, "package.json");
  if (!fs.existsSync(pkg)) return null;
  const pkgJson = JSON.parse(fs.readFileSync(pkg, "utf-8"));
  if (pkgJson.scripts?.lint) return { cmd: "npm", args: ["run", "lint"] };
  if (pkgJson.scripts?.typecheck) return { cmd: "npm", args: ["run", "typecheck"] };
  // fallback: try tsc
  return { cmd: "npx", args: ["tsc", "--noEmit"] };
}

/** Detect test command */
function detectTestCommand(workdir: string): { cmd: string; args: string[] } | null {
  const pkg = path.join(workdir, "package.json");
  if (!fs.existsSync(pkg)) return null;
  const pkgJson = JSON.parse(fs.readFileSync(pkg, "utf-8"));
  if (pkgJson.scripts?.test) return { cmd: "npm", args: ["run", "test"] };
  return null;
}

/** Parse lint/build output into findings */
function parseFindings(output: string): GateFinding[] {
  const findings: GateFinding[] = [];
  // Simple pattern: file:line: error/warning message
  const lines = output.split("\n");
  for (const line of lines) {
    const match = line.match(/^(.+?):(\d+):\d*\s*(error|warning|Error|Warning)[:\s]+(.+)/);
    if (match) {
      findings.push({
        severity: match[3].toLowerCase().startsWith("error") ? "critical" : "warning",
        file: match[1],
        line: parseInt(match[2], 10),
        message: match[4].trim(),
      });
    }
  }
  return findings;
}

// --- Built-in Gates ---

class LintGate implements QualityGate {
  readonly name = "lint" as const;
  check(ctx: GateContext): GateResult {
    const start = Date.now();
    const cmd = detectLintCommand(ctx.workdir);
    if (!cmd) {
      return { passed: true, verdict: "pass", evidence: [], findings: [], durationMs: Date.now() - start };
    }
    const ev = runCommand(cmd.cmd, cmd.args, ctx.workdir);
    const findings = ev.exitCode !== 0 ? parseFindings(ev.stdout + "\n" + ev.stderr) : [];
    return {
      passed: ev.exitCode === 0,
      verdict: ev.exitCode === 0 ? "pass" : "fail",
      evidence: [ev],
      findings,
      durationMs: Date.now() - start,
    };
  }
}

class BuildGate implements QualityGate {
  readonly name = "build" as const;
  check(ctx: GateContext): GateResult {
    const start = Date.now();
    const ev = runCommand("npm", ["run", "build"], ctx.workdir, 120000);
    const findings = ev.exitCode !== 0 ? parseFindings(ev.stdout + "\n" + ev.stderr) : [];
    return {
      passed: ev.exitCode === 0,
      verdict: ev.exitCode === 0 ? "pass" : "fail",
      evidence: [ev],
      findings,
      durationMs: Date.now() - start,
    };
  }
}

class TestGate implements QualityGate {
  readonly name = "test" as const;
  check(ctx: GateContext): GateResult {
    const start = Date.now();
    const cmd = detectTestCommand(ctx.workdir);
    if (!cmd) {
      return { passed: true, verdict: "pass", evidence: [], findings: [], durationMs: Date.now() - start };
    }
    const ev = runCommand(cmd.cmd, cmd.args, ctx.workdir, 300000);
    const findings = ev.exitCode !== 0 ? parseFindings(ev.stdout + "\n" + ev.stderr) : [];
    return {
      passed: ev.exitCode === 0,
      verdict: ev.exitCode === 0 ? "pass" : "fail",
      evidence: [ev],
      findings,
      durationMs: Date.now() - start,
    };
  }
}

// --- Registry ---

const gateRegistry: Record<string, QualityGate> = {
  lint: new LintGate(),
  build: new BuildGate(),
  test: new TestGate(),
};

export function getGate(name: string): QualityGate | null {
  return gateRegistry[name] || null;
}

export function runGate(name: string, ctx: GateContext): GateResult {
  const gate = getGate(name);
  if (!gate) {
    return { passed: true, verdict: "pass", evidence: [], findings: [], durationMs: 0 };
  }
  return gate.check(ctx);
}

export { runCommand, parseFindings };
export type { QualityGate, GateContext };
```

**Step 2: Create pipeline index**

`src/lib/pipeline/index.ts`:

```typescript
export { runGate, getGate } from "./gates";
export type { QualityGate, GateContext } from "./gates";
```

**Step 3: Commit**

```
feat(pipeline): implement quality gate infrastructure with lint/build/test gates
```

---

### Task 2.2: Model Router

**Files:**
- Create: `src/lib/pipeline/model-router.ts`

**Step 1: Implement model selection logic**

Default routing table + benchmark-driven selection when enough data exists.
Uses `queryBenchmarks()` from scheduler.

```typescript
import "server-only";
import { getConfig } from "../config";
import { queryBenchmarks } from "../scheduler";
import type { PipelineStage, ModelTier, ModelSelection } from "../types";

const MODEL_COST: Record<ModelTier, number> = { haiku: 1, sonnet: 2, opus: 5 };

const DEFAULT_ROUTES: Record<string, Record<string, ModelTier>> = {
  design:    { architect: "opus" },
  code:      { executor: "sonnet" },
  review:    { reviewer: "opus", "self-reviewer": "sonnet" },
  repair:    { repairer: "sonnet" },
  integrate: { reviewer: "opus" },
};

export function selectModel(stage: PipelineStage, role: string): ModelSelection {
  const config = getConfig();
  const pCfg = config.pipeline;

  // Check benchmark data
  const windowDays = pCfg?.model_routing?.benchmark_window_days ?? 30;
  const minSamples = pCfg?.model_routing?.benchmark_min_samples ?? 5;

  let benchmarks: Array<{ model: string; samples: number; score: number }> = [];
  try {
    benchmarks = queryBenchmarks(stage, windowDays);
  } catch {
    // DB not ready or no data — use defaults
  }

  const hasSufficientData = benchmarks.some(b => b.samples >= minSamples);

  if (!hasSufficientData) {
    // Use configured default or hardcoded default
    const configured = pCfg?.model_routing?.default?.[stage];
    const hardcoded = DEFAULT_ROUTES[stage]?.[role] || "sonnet";
    const model = (configured || hardcoded) as ModelTier;
    return { model, source: "default", reason: "insufficient benchmark data" };
  }

  // Sort by score descending
  const eligible = benchmarks.filter(b => b.samples >= minSamples);
  eligible.sort((a, b) => b.score - a.score);

  // If top two are within 10%, pick the cheaper one
  if (eligible.length >= 2 && eligible[0].score - eligible[1].score < 0.1) {
    const cheaperCandidates = eligible.slice(0, 2).sort(
      (a, b) => MODEL_COST[a.model as ModelTier] - MODEL_COST[b.model as ModelTier]
    );
    const chosen = cheaperCandidates[0];
    return {
      model: chosen.model as ModelTier,
      source: "benchmark",
      score: chosen.score,
      reason: "scores within 10%, choosing cheaper model",
    };
  }

  const best = eligible[0];
  return {
    model: best.model as ModelTier,
    source: "benchmark",
    score: best.score,
    reason: "highest benchmark score",
  };
}

/** Decide if this review round should be self-review */
export function isSelfReview(): boolean {
  const config = getConfig();
  const prob = config.pipeline?.self_review_probability ?? 0.2;
  return Math.random() < prob;
}
```

**Step 2: Export from pipeline/index.ts**

**Step 3: Commit**

```
feat(pipeline): implement benchmark-driven model router
```

---

## Phase 3: Pipeline Orchestrator

> The engine that drives tasks through all stages automatically.

### Task 3.1: Pipeline Orchestrator Core

**Files:**
- Create: `src/lib/pipeline/orchestrator.ts`

**Step 1: Implement the orchestrator**

This is the core engine. It:
1. Takes a task that just finished `coding` stage
2. Runs it through each gate sequentially
3. On failure, enters repair loop (new agent)
4. On success, advances to next stage
5. Publishes SSE events at every transition

Key functions:

```typescript
export async function runPipeline(taskId: string): Promise<void>
export function pausePipeline(taskId: string): void
export function resumePipeline(taskId: string): void
export function getPipelineStatus(taskId: string): PipelineStatus
```

The `runPipeline` function replaces the end of the current `runTask()` flow.
Instead of going directly to `done`, it enters: `lint → build → test → review → integrate`.

**Pseudocode:**

```typescript
async function runPipeline(taskId: string): Promise<void> {
  const config = getConfig();
  const gates = config.pipeline?.gates ?? ["lint", "build", "test", "review", "integrate"];

  for (const stageName of gates) {
    if (isPaused(taskId)) { await waitForResume(taskId); }

    updateTaskStatus(taskId, stageName as TaskStatus);  // e.g., "linting"
    const stageId = createStageRecord(taskId, stageName, ...);
    publishEvent({ type: "pipeline_stage", task_id: taskId, data: { stage: stageName, status: "running" } });

    let result: GateResult;

    if (stageName === "review") {
      result = await runReviewGate(taskId, stageId);
    } else if (stageName === "integrate") {
      result = await runIntegrateGate(taskId, stageId);
    } else {
      result = runGate(stageName, { workdir, baseBranch });
    }

    updateStageRecord(stageId, { status: result.passed ? "passed" : "failed", gateReport: result });
    publishEvent({ type: "pipeline_stage", task_id: taskId, data: { stage: stageName, status: result.passed ? "passed" : "failed", result } });

    if (!result.passed) {
      const repaired = await repairLoop(taskId, stageName, stageId, result);
      if (!repaired) {
        updateTaskStatus(taskId, "escalated");
        publishEvent({ type: "pipeline_escalated", task_id: taskId, data: { stage: stageName } });
        return;
      }
    }

    recordBenchmark({ taskId, stage: stageName, model, gatePassed: result.passed, ... });
  }

  updateTaskStatus(taskId, "done");
  publishEvent({ type: "pipeline_complete", task_id: taskId, data: {} });
}
```

**Step 2: Implement repair loop**

```typescript
async function repairLoop(taskId: string, failedStage: string, stageId: number, gateResult: GateResult): Promise<boolean> {
  const maxRounds = getConfig().pipeline?.max_repair_rounds ?? 3;

  for (let round = 1; round <= maxRounds; round++) {
    const repairId = createRepairRound(stageId, round, agentName, model);

    publishEvent({ type: "pipeline_repair", task_id: taskId, data: { stage: failedStage, round } });

    // Build repair context and spawn new agent
    const repairPrompt = compileRepairPrompt(taskId, failedStage, gateResult, repairHistory);
    await spawnRepairAgent(taskId, repairPrompt, agentName, model);

    // Re-run the failed gate
    const retryResult = runGate(failedStage, { workdir, baseBranch });

    updateRepairRound(repairId, {
      outcome: retryResult.passed ? "fixed" : "still_failing",
      gateReport: retryResult,
    });

    if (retryResult.passed) {
      // Update the stage record to passed
      updateStageRecord(stageId, { status: "passed", gateReport: retryResult });
      return true;
    }

    gateResult = retryResult; // Pass updated failure to next round
  }

  return false; // Exceeded max rounds
}
```

**Step 3: Implement review gate (special — spawns reviewer agent)**

The review gate uses opus by default (80%) or same model for self-review (20%).
It compiles a review prompt with the design spec + code diff + test results,
then runs a reviewer agent and parses the structured output.

**Step 4: Implement integrate gate (merge + re-verify)**

Merge branch into base, then run build + test. If merge conflicts or tests fail, it's a failure.

**Step 5: Commit**

```
feat(pipeline): implement pipeline orchestrator with repair loop
```

---

### Task 3.2: Wire Orchestrator into Executor

**Files:**
- Modify: `src/lib/executor.ts`

**Step 1: After agent completes coding, call runPipeline**

Replace the current end of `runTask()` (lines ~143-208) where it sets `done`/`failed`:

```typescript
// After agent execution completes...
if (success) {
  // Enter pipeline: run through quality gates
  publishEvent({ type: "task_output", task_id: taskId, data: { line: "[hive] entering pipeline..." } });
  await runPipeline(taskId);
} else {
  // Agent failed to produce anything — skip pipeline
  updateTaskStatus(taskId, "failed");
}
```

The pipeline takes over from here — lint, build, test, review, integrate.

**Step 2: Commit**

```
feat(pipeline): wire orchestrator into executor — auto-pipeline after coding
```

---

### Task 3.3: Repair Prompt Compiler

**Files:**
- Modify: `src/lib/compiler.ts`

**Step 1: Add repair prompt template**

```typescript
export function compileRepairPrompt(
  spec: TaskSpec,
  failedGate: string,
  gateResult: GateResult,
  repairHistory: RepairSummary[],
): string {
  // Structured prompt with: what failed, the evidence, what was tried before
}
```

**Step 2: Add design prompt template**

For future Layer 1 Decompose pipeline — the architect prompt.

**Step 3: Commit**

```
feat(pipeline): add repair and design prompt templates
```

---

## Phase 4: API Routes

### Task 4.1: Pipeline Status API

**Files:**
- Create: `src/app/api/tasks/[id]/pipeline/route.ts`

**Step 1: GET endpoint returning PipelineStatus**

Returns `{ stages, repairs, currentStage, paused, escalated }` for a given task.
Reads from `pipeline_stages` and `repair_rounds` tables.

**Step 2: POST endpoint for pause/resume**

```
POST /api/tasks/:id/pipeline { action: "pause" | "resume" }
```

**Step 3: Commit**

```
feat(pipeline): add pipeline status and control API
```

---

### Task 4.2: Benchmarks API

**Files:**
- Create: `src/app/api/benchmarks/route.ts`

**Step 1: GET endpoint returning benchmark data**

```
GET /api/benchmarks?stage=review&days=30
```

Returns per-model scores, pass rates, repair counts.

**Step 2: Commit**

```
feat(pipeline): add model benchmarks API
```

---

## Phase 5: SSE Events + Frontend API Client

### Task 5.1: Pipeline SSE Event Types

**Files:**
- Modify: `src/lib/events.ts` (add types)
- Modify: `src/lib/api.ts` (add client functions)

**Step 1: Document new SSE event types**

```
pipeline_stage   — { stage, status, result? }     — stage transition
pipeline_repair  — { stage, round, agent }         — repair started
pipeline_escalated — { stage, round }              — escalated to human
pipeline_complete — {}                             — all gates passed
```

**Step 2: Add client-side API functions**

```typescript
export async function fetchPipelineStatus(taskId: string): Promise<PipelineStatus>
export async function controlPipeline(taskId: string, action: "pause" | "resume"): Promise<void>
export async function fetchBenchmarks(stage?: string, days?: number): Promise<BenchmarkData[]>
```

**Step 3: Commit**

```
feat(pipeline): add pipeline SSE events and API client functions
```

---

## Phase 6: Frontend — Pipeline Visualization

### Task 6.1: Pipeline Progress Component

**Files:**
- Create: `src/components/pipeline-view.tsx`

**Step 1: Build the pipeline stage visualizer**

A horizontal progress bar showing each stage:
```
[lint ✅] → [build ✅] → [test 🔄] → [review ⏳] → [integrate ⏳]
```

Each stage shows: status icon, duration, and is clickable to expand gate details.
On repair, shows the repair round count.

Uses SSE events to update in real-time.

**Step 2: Commit**

```
feat(pipeline): add pipeline progress visualization component
```

---

### Task 6.2: Integrate Pipeline View into Task Detail

**Files:**
- Modify: `src/app/tasks/[id]/page.tsx`

**Step 1: Add "Pipeline" tab to task detail page**

New tab alongside existing tabs (attempts, diff, review, files).
Shows `<PipelineView>` with full stage history, gate reports, repair rounds.

**Step 2: Add pause/resume controls**

Button to pause/resume pipeline when it's running.

**Step 3: Commit**

```
feat(pipeline): integrate pipeline view into task detail page
```

---

### Task 6.3: Update TopBar with Pipeline Awareness

**Files:**
- Modify: `src/components/top-bar.tsx`

**Step 1: Show pipeline stage in task counts**

Instead of just "N running / M total", show breakdown:
```
2 coding · 1 testing · 1 reviewing / 8 total
```

**Step 2: Commit**

```
feat(pipeline): update top bar with pipeline stage counts
```

---

## Phase Summary

| Phase | Tasks | Deliverable |
|-------|-------|-------------|
| 1. Schema + Types | 1.1, 1.2, 1.3 | Types, DB tables, config defaults |
| 2. Quality Gates | 2.1, 2.2 | Gate infrastructure, model router |
| 3. Orchestrator | 3.1, 3.2, 3.3 | Pipeline engine, executor wiring, repair prompts |
| 4. API Routes | 4.1, 4.2 | Pipeline status/control, benchmarks |
| 5. SSE + Client | 5.1 | Event types, API client |
| 6. Frontend | 6.1, 6.2, 6.3 | Pipeline viz, task detail integration, top bar |

**Dependency order:** Phase 1 → Phase 2 → Phase 3 → Phase 4+5 (parallel) → Phase 6

**Parallelizable:** Phase 4 and 5 can run in parallel. Within Phase 6, tasks 6.1-6.3 are sequential.
