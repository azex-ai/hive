# Pipeline Automation Design — 全自动流水线

> 基于 DESIGN.md 的分层架构（Layer 0-6），补充自动化驱动层。
> 核心理念：用户下发指令后全自动运行，人工介入是异常而非常态。

## 1. 三层 Pipeline 架构

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1 — Decompose Pipeline（拆解层）                   │
│   用户指令 → design spec → 质检 → 拆解为子任务           │
│   模型：opus（深度推理）                                 │
└──────────────────────┬──────────────────────────────────┘
                       │ 产出：N 个独立子任务（可并行）
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2 — Execute Pipeline（执行层，每个子任务）          │
│   code → lint → build → test → review → integrate       │
│   每个环节是一个 Quality Gate，全自动推进                 │
│   模型：sonnet（执行）+ opus（review）                   │
└──────────────────────┬──────────────────────────────────┘
                       │ gate 失败时触发
                       ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 3 — Repair Pipeline（修复层）                       │
│   新 agent + 独立 worktree → 修复 → 重跑失败的 gate      │
│   超过 max_repair_rounds → escalate 到人工               │
│   模型：sonnet（修复）                                   │
└─────────────────────────────────────────────────────────┘
```

### 关键设计决策

1. **Decompose 阶段用 opus** — 入口关口，决定整体质量
2. **Review 阶段用 opus** — 出口关口，做 spec↔output 一致性检查
3. **修复派新 agent** — "换脑子"策略，避免注意力盲区
4. **修复后"太空舱对接"** — merge 回主分支 + 集成测试验证兼容性
5. **所有 gate 结果写入知识库** — 用于 benchmark 驱动的模型动态路由

---

## 2. 状态机

一个子任务的完整生命周期：

```
                    ┌─────────────────────────────────┐
                    │         decomposed               │ ← Layer 1 拆出
                    └──────────┬──────────────────────┘
                               ▼
                    ┌──────────────────┐
               ┌───│      coding      │
               │   └────────┬─────────┘
               │            ▼
               │   ┌──────────────────┐
               │   │     linting      │──fail──┐
               │   └────────┬─────────┘        │
               │         pass                  │
               │            ▼                  │
               │   ┌──────────────────┐        │
               │   │     building     │──fail──┤
               │   └────────┬─────────┘        │
               │         pass                  │
               │            ▼                  ▼
               │   ┌──────────────────┐  ┌───────────┐
               │   │     testing      │  │ repairing │──fixed──→ 重跑失败的 gate
               │   └────────┬─────────┘  └─────┬─────┘
               │         pass              超过 max rounds
               │            ▼                  ▼
               │   ┌──────────────────┐  ┌───────────┐
               │   │    reviewing     │  │ escalated │ → 人工介入
               │   └────────┬─────────┘  └───────────┘
               │     pass   │   fail
               │            │     └──→ repairing（review 问题）
               │            ▼
               │   ┌──────────────────┐
               │   │   integrating    │
               │   └────────┬─────────┘
               │     pass   │   fail
               │            │     └──→ repairing（对接问题）
               │            ▼
               │   ┌──────────────────┐
               └──→│      done        │
                   └──────────────────┘
```

### 状态转换规则

| 当前状态 | 事件 | 下一状态 | 动作 |
|----------|------|----------|------|
| decomposed | 开始执行 | coding | spawn agent in worktree |
| coding | agent 完成 | linting | 自动运行 lint gate |
| linting | gate pass | building | 自动运行 build gate |
| linting | gate fail | repairing | spawn 新 agent 修复 |
| building | gate pass | testing | 自动运行 test gate |
| building | gate fail | repairing | spawn 新 agent 修复 |
| testing | gate pass | reviewing | spawn reviewer agent (opus) |
| testing | gate fail | repairing | spawn 新 agent 修复 |
| reviewing | review pass | integrating | merge + 集成测试 |
| reviewing | review fail | repairing | spawn 新 agent 修 review 问题 |
| integrating | 集成通过 | done | 清理 worktree |
| integrating | 集成失败 | repairing | spawn 新 agent 修对接问题 |
| repairing | 修复完成 | {失败的 gate} | 重跑失败的 gate |
| repairing | 超过 max rounds | escalated | 推送通知，等待人工 |
| escalated | 人工介入 | {任意} | 人工决定下一步 |
| * | 用户 pause | paused | 冻结所有后续 stage |

---

## 3. Quality Gate 接口

每个 gate 是独立检查函数，不依赖 agent 自述，自己跑命令拿证据：

```typescript
/** Quality Gate — 独立于 agent 的质检函数 */
interface QualityGate {
  readonly name: PipelineStage;

  /** 执行检查，返回命令级证据 */
  check(ctx: GateContext): Promise<GateResult>;
}

interface GateContext {
  workdir: string;         // worktree 路径
  taskSpec: TaskSpec;       // 原始任务定义
  designSpec: DesignSpec;   // design 阶段的产出（用于一致性检查）
  branch: string;          // 当前分支
  baseBranch: string;      // 要合并回去的主分支
  stageHistory: StageRecord[];  // 之前 stage 的记录（修复用）
}

interface GateResult {
  passed: boolean;
  verdict: "pass" | "fail" | "warn";
  evidence: GateEvidence[];   // 命令级证据
  findings: Finding[];        // 结构化问题列表
  durationMs: number;
}

/** 命令级证据 — 不是 agent 摘要，是实际命令输出 */
interface GateEvidence {
  command: string;        // 实际跑的命令
  exitCode: number;
  stdout: string;         // 截断到 max 10KB
  stderr: string;
  truncated: boolean;     // 是否被截断
}

interface Finding {
  severity: "critical" | "warning" | "nit";
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;    // 修复建议（传给 repair agent）
}
```

### 内置 Gates

| Gate | 命令 | Pass 条件 | 模型 |
|------|------|----------|------|
| lint | 自动检测 eslint/biome/tsc | exit 0 | 无（机器检查） |
| build | `npm run build` | exit 0 | 无（机器检查） |
| test | `npm test` | exit 0 + 解析通过率 | 无（机器检查） |
| review | spawn reviewer agent | verdict ≠ "fail" | opus（深度推理） |
| integrate | merge + build + test | 全部 exit 0 | 无（机器检查） |

### Review Gate 特殊逻辑

Review 不是简单跑命令，而是 spawn 一个 reviewer agent 做 spec↔output 一致性检查：

```typescript
/** Review gate 的 prompt 结构 */
interface ReviewPrompt {
  designSpec: DesignSpec;    // 入口：要做什么、接口定义、约束
  codeDiff: string;          // 出口：做了什么
  testResults: GateEvidence; // 证据：测试结果

  /** reviewer 必须验证的检查项 */
  checklist: [
    "spec 中定义的每个接口是否都已实现",
    "实现是否引入了 spec 未定义的副作用",
    "测试是否覆盖了 spec 中的关键场景",
    "模块边界是否与 spec 一致",
  ];
}
```

### 模型分配与注意力策略

Review 阶段的模型分配（基于注意力盲区理论）：

| 轮次 | 模型选择 | 概率 | 理由 |
|------|---------|------|------|
| 自审 | 同一个 agent 的模型 | 20% | 快速自查，作为对比基线 |
| 交叉审 | opus（或不同模型） | 80% | 深度推理，避免注意力盲区 |

选择逻辑：`Math.random() < 0.2 ? sameModel : "opus"`

---

## 4. Design Spec（Layer 1 产出物）

Decompose Pipeline 的产出是结构化 spec，通过自动质检后才进入拆解：

```typescript
interface DesignSpec {
  /** 架构概述 */
  overview: string;

  /** 模块定义 — 每个模块有明确边界 */
  modules: ModuleSpec[];

  /** 模块间接口定义 */
  interfaces: InterfaceSpec[];

  /** 测试策略 */
  testStrategy: {
    unitTests: string[];       // 每个模块的关键测试场景
    integrationTests: string[]; // 模块间对接测试
  };

  /** 约束和不变量 */
  constraints: string[];

  /** 风险和降级策略 */
  risks: RiskSpec[];
}

interface ModuleSpec {
  name: string;
  responsibility: string;     // 只做一件事
  inputs: string[];           // 依赖什么
  outputs: string[];          // 产出什么
  filesAffected: string[];    // 会改哪些文件
}

interface InterfaceSpec {
  from: string;               // 模块 A
  to: string;                 // 模块 B
  contract: string;           // 接口定义（TypeScript 类型签名）
}

interface RiskSpec {
  description: string;
  mitigation: string;
  failStrategy: "fail-closed" | "fail-open";  // R7: 方向性约束必须明确
}
```

### Design Spec 自动质检

```typescript
/** Design spec 的 quality gate */
function checkDesignSpec(spec: DesignSpec): GateResult {
  const findings: Finding[] = [];

  // 检查完整性
  if (!spec.modules.length)
    findings.push({ severity: "critical", message: "没有定义任何模块" });
  if (!spec.interfaces.length && spec.modules.length > 1)
    findings.push({ severity: "critical", message: "多模块但没有接口定义" });
  if (!spec.testStrategy.unitTests.length)
    findings.push({ severity: "critical", message: "没有测试策略" });
  if (!spec.constraints.length)
    findings.push({ severity: "warning", message: "没有定义约束/不变量" });

  // 检查模块自包含性（R6: agent 不猜 API）
  for (const mod of spec.modules) {
    if (!mod.filesAffected.length)
      findings.push({ severity: "warning", message: `模块 ${mod.name} 没有指定影响的文件` });
  }

  // 检查风险降级方向（R7）
  for (const risk of spec.risks) {
    if (!risk.failStrategy)
      findings.push({ severity: "warning", message: `风险 "${risk.description}" 没有指定降级方向` });
  }

  return {
    passed: !findings.some(f => f.severity === "critical"),
    verdict: findings.some(f => f.severity === "critical") ? "fail" : "pass",
    evidence: [],
    findings,
    durationMs: 0,
  };
}
```

---

## 5. Repair Pipeline（修复层）

Gate 失败后的修复流程：

```
Gate 失败
    │
    ▼
创建 repair task:
  ├── 原始 task spec
  ├── 当前 worktree 的代码状态
  ├── gate 的完整 GateResult（命令输出 + findings）
  └── 前几轮修复的摘要（第 3 轮起压缩前两轮）
    │
    ▼
Spawn 新 agent（新 worktree，同一个分支的新 checkout）
    │
    ▼
Agent 修复 → 提交到同一分支
    │
    ▼
重跑失败的 gate（不跳过，从失败点开始）
    │
    ├── pass → 继续 pipeline 下一个 gate
    └── fail → 检查 round < max_repair_rounds?
                ├── yes → 再创建 repair task（新 agent）
                └── no  → escalate（推送通知，等待人工）
```

### Repair 上下文传递

```typescript
interface RepairContext {
  /** 原始任务 */
  originalTask: TaskSpec;

  /** 失败的 gate 名称 */
  failedGate: PipelineStage;

  /** gate 的完整报告（命令级证据） */
  gateResult: GateResult;

  /** 当前代码的 worktree 路径 */
  workdir: string;

  /** 前几轮修复的历史 */
  repairHistory: RepairSummary[];

  /** design spec（可选 — 让修复 agent 理解全局上下文） */
  designSpec?: DesignSpec;
}

interface RepairSummary {
  round: number;
  agent: string;
  whatWasFixed: string;      // agent 的修复摘要
  stillFailing: string[];    // 仍然失败的 findings
  durationMs: number;
}
```

### 上下文压缩策略

| 修复轮次 | 传递的历史 |
|---------|-----------|
| 第 1 轮 | 无历史（首次修复） |
| 第 2 轮 | 第 1 轮完整记录 |
| 第 3 轮+ | 前几轮压缩为摘要（只保留 whatWasFixed + stillFailing） |

---

## 6. 数据模型

在现有 SQLite 数据库中新增：

### pipeline_stages 表

```sql
CREATE TABLE pipeline_stages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  stage         TEXT NOT NULL,  -- 'design'|'code'|'lint'|'build'|'test'|'review'|'integrate'
  status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'running'|'passed'|'failed'|'skipped'
  agent         TEXT,           -- 执行该阶段的 agent
  model         TEXT,           -- 使用的模型
  started_at    TEXT,
  finished_at   TEXT,
  duration_ms   INTEGER,
  input_hash    TEXT,           -- 进入该阶段时的 git commit hash
  output_hash   TEXT,           -- 完成时的 git commit hash
  gate_report   TEXT,           -- JSON: GateResult
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_stages_task ON pipeline_stages(task_id);
CREATE INDEX idx_stages_status ON pipeline_stages(status);
CREATE INDEX idx_stages_stage ON pipeline_stages(stage);
```

### repair_rounds 表

```sql
CREATE TABLE repair_rounds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id      INTEGER NOT NULL REFERENCES pipeline_stages(id),
  round         INTEGER NOT NULL,  -- 第几轮修复
  agent         TEXT NOT NULL,
  model         TEXT,
  fix_summary   TEXT,              -- agent 的修复摘要
  gate_report   TEXT,              -- JSON: 修复后重新质检的 GateResult
  outcome       TEXT NOT NULL,     -- 'fixed'|'still_failing'|'escalated'
  started_at    TEXT,
  finished_at   TEXT,
  duration_ms   INTEGER,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_repairs_stage ON repair_rounds(stage_id);
```

### model_benchmarks 表

```sql
CREATE TABLE model_benchmarks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       TEXT NOT NULL,
  stage         TEXT NOT NULL,     -- 哪个阶段
  model         TEXT NOT NULL,     -- 用的哪个模型
  gate_passed   INTEGER NOT NULL,  -- 0/1 该模型在该阶段是否一次通过
  repair_rounds INTEGER DEFAULT 0, -- 触发了几轮修复
  duration_ms   INTEGER,
  token_cost    INTEGER,           -- token 消耗（如果能拿到）
  user_verdict  TEXT,              -- 'approve'|'reject'|null
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_bench_stage_model ON model_benchmarks(stage, model);
```

### 查询场景

```sql
-- 某任务的完整 pipeline 历史
SELECT * FROM pipeline_stages WHERE task_id = ? ORDER BY id;

-- 哪个 gate 失败率最高
SELECT stage,
       COUNT(*) as total,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failures,
       ROUND(100.0 * SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) / COUNT(*), 1) as fail_rate
FROM pipeline_stages
GROUP BY stage ORDER BY fail_rate DESC;

-- 平均修几轮能修好
SELECT ps.stage,
       AVG(max_round) as avg_rounds
FROM pipeline_stages ps
JOIN (SELECT stage_id, MAX(round) as max_round FROM repair_rounds WHERE outcome = 'fixed' GROUP BY stage_id) r
  ON r.stage_id = ps.id
GROUP BY ps.stage;

-- 模型在某阶段的 benchmark 评分
SELECT model,
       COUNT(*) as samples,
       AVG(gate_passed) as pass_rate,
       AVG(repair_rounds) as avg_repairs,
       AVG(CASE WHEN user_verdict = 'reject' THEN 1.0 ELSE 0.0 END) as reject_rate,
       -- 加权评分
       AVG(gate_passed) * 0.4
         + (1.0 - AVG(repair_rounds) / 3.0) * 0.3
         + (1.0 - AVG(CASE WHEN user_verdict = 'reject' THEN 1.0 ELSE 0.0 END)) * 0.3 as score
FROM model_benchmarks
WHERE stage = ? AND created_at > datetime('now', '-30 days')
GROUP BY model
HAVING samples >= 5
ORDER BY score DESC;
```

---

## 7. 模型动态路由

### 默认路由表（冷启动）

| 阶段 | 角色 | 默认模型 | 理由 |
|------|------|---------|------|
| design | architect | opus | 深度推理，决定模块边界和接口 |
| code | executor | sonnet | 执行层，性价比 |
| lint | — | 机器 | 无需模型 |
| build | — | 机器 | 无需模型 |
| test | executor | sonnet | 写测试 + TDD |
| review (交叉审 80%) | reviewer | opus | 深度推理，spec↔output 一致性 |
| review (自审 20%) | self-reviewer | 同 executor | 注意力对比基线 |
| repair | executor | sonnet | 新 agent 修复 |
| integrate | — | 机器 + opus | merge 是机器，对接验证需全局视角 |

### Benchmark 驱动切换

```typescript
interface ModelRouter {
  /** 为指定阶段选择最优模型 */
  selectModel(stage: PipelineStage, role: AgentRole): Promise<ModelSelection>;
}

interface ModelSelection {
  model: string;              // "opus" | "sonnet" | "haiku"
  source: "default" | "benchmark";  // 从哪里来的决策
  score?: number;             // benchmark 评分（如果有）
  reason: string;             // 选择理由（写入日志）
}

/** 选择逻辑 */
async function selectModel(stage: PipelineStage, role: AgentRole): Promise<ModelSelection> {
  // 1. 查近 30 天 benchmark
  const benchmarks = queryBenchmarks(stage, { days: 30 });

  // 2. 样本不足 → 走默认路由表
  if (benchmarks.every(b => b.samples < 5)) {
    return { model: DEFAULT_ROUTES[stage][role], source: "default", reason: "样本不足" };
  }

  // 3. 按评分排序
  const ranked = benchmarks.sort((a, b) => b.score - a.score);

  // 4. 评分差距 < 10% 时偏向便宜的模型
  if (ranked.length >= 2 && ranked[0].score - ranked[1].score < 0.1) {
    const cheaper = ranked.sort((a, b) => MODEL_COST[a.model] - MODEL_COST[b.model])[0];
    return { model: cheaper.model, source: "benchmark", score: cheaper.score, reason: "评分接近，选便宜的" };
  }

  return { model: ranked[0].model, source: "benchmark", score: ranked[0].score, reason: "最高评分" };
}
```

---

## 8. Pipeline 编排器

核心组件，驱动整条 pipeline 自动运行：

```typescript
interface PipelineOrchestrator {
  /** 启动一个任务的 pipeline */
  start(taskId: string): Promise<void>;

  /** 暂停（用户手动叫停） */
  pause(taskId: string): Promise<void>;

  /** 恢复 */
  resume(taskId: string): Promise<void>;

  /** 获取 pipeline 当前状态 */
  getStatus(taskId: string): Promise<PipelineStatus>;
}

interface PipelineStatus {
  taskId: string;
  currentStage: PipelineStage;
  stages: StageRecord[];        // 所有阶段的记录
  repairRounds: RepairRecord[]; // 所有修复记录
  paused: boolean;
  escalated: boolean;
}
```

### 编排逻辑（伪代码）

```
async function runPipeline(taskId):
  stages = [lint, build, test, review, integrate]

  // Stage 0: coding（agent 执行）
  await spawnAgent(taskId, "executor", selectModel("code", "executor"))

  // Stage 1-5: 依次过 gate
  for stage in stages:
    if paused: wait for resume

    record = createStageRecord(taskId, stage)

    if stage == "review":
      // 80% 交叉审，20% 自审
      model = random() < 0.2 ? sameModel : selectModel("review", "reviewer")
      result = await spawnReviewer(taskId, model)
    else if stage == "integrate":
      result = await mergeAndVerify(taskId)
    else:
      result = await runGate(stage, taskId)

    updateStageRecord(record, result)
    publishSSE(taskId, { stage, result })

    if result.failed:
      success = await repairLoop(taskId, stage, result)
      if !success:
        escalate(taskId, stage)
        return  // 等人工

  markDone(taskId)


async function repairLoop(taskId, failedStage, gateResult):
  for round in 1..MAX_REPAIR_ROUNDS:
    repairCtx = buildRepairContext(taskId, failedStage, gateResult, round)

    // 新 agent，独立修复
    await spawnRepairAgent(taskId, repairCtx, selectModel("repair", "executor"))

    // 重跑失败的 gate
    result = await runGate(failedStage, taskId)
    recordRepairRound(taskId, failedStage, round, result)
    publishSSE(taskId, { repair: round, result })

    if result.passed:
      return true

  return false  // 超过 max rounds
```

---

## 9. 并行执行策略

独立子任务可并行跑，不必串行：

```
Layer 1 拆解后：
  Task A (改 lib/auth.ts)  ─── 独立 ───┐
  Task B (改 lib/billing.ts) ── 独立 ──┤──→ 并行执行
  Task C (改 components/nav.tsx) 独立 ──┘
  Task D (改 lib/api.ts) ── 依赖 A+B ──→ 等 A、B 都 done 后执行
```

并行约束：
- 受 `max_concurrent` per agent 限制
- 修改同一文件的任务必须串行（避免 merge conflict）
- 依赖关系（`task_deps` 表）必须满足后才能开始

---

## 10. 优化点（按优先级）

| 优化 | 说明 | 优先级 |
|------|------|--------|
| **SSE pipeline 视图** | 前端实时看每个 stage 推进，不只终端输出 | P0 — UX 核心 |
| **并行编排** | 独立子任务并行跑 | P0 — 吞吐量 |
| **早期终止** | design spec 质量太差直接 escalate | P1 — 避免浪费 |
| **增量 gate** | lint/test 只跑受影响的文件 | P1 — 大项目性能 |
| **gate 缓存** | 代码没变的 gate 不重跑（基于 input_hash） | P1 — 避免重复工作 |
| **repair 上下文压缩** | 第 3 轮起压缩前几轮历史 | P1 — 防 context 爆 |
| **热路径** | 简单任务跳过 design 直接 code→test→integrate | P2 — 小任务效率 |
| **benchmark 仪表盘** | UI 展示模型评分、gate 失败率、修复统计 | P2 — 可观测性 |

---

## 11. 与现有架构的关系

| 现有组件 | 变化 | 说明 |
|----------|------|------|
| `executor.ts` | **重构** | 从"跑一次 agent"变成"驱动整条 pipeline" |
| `evaluator.ts` | **激活** | 已有 `parseReviewReport`/`shouldAutoMerge`，接入 pipeline |
| `compiler.ts` | **扩展** | 新增 design/repair prompt 模板 |
| `scheduler.ts` | **扩展** | 新增 pipeline_stages/repair_rounds 表 |
| `runtime/` | **扩展** | 支持模型选择参数 |
| `events.ts` | **扩展** | 新增 pipeline stage 事件类型 |
| `types.ts` | **扩展** | 新增 Pipeline 相关类型 |
| `worktree.ts` | 不变 | 已支持，repair 复用 |
| 前端 | **新增** | pipeline 可视化、benchmark 仪表盘 |
| API routes | **新增** | `/api/tasks/[id]/pipeline` — pipeline 状态和历史 |

---

## 12. 配置

在 `hive.yaml` 中新增 pipeline 配置：

```yaml
pipeline:
  max_repair_rounds: 3          # 每个 gate 最多修几轮
  self_review_probability: 0.2  # 自审概率
  parallel_max: 3               # 最大并行子任务数
  gates:                        # 可按项目定制 gate 列表
    - lint
    - build
    - test
    - review
    - integrate
  model_routing:
    default:
      design: opus
      code: sonnet
      review: opus
      repair: sonnet
    benchmark_min_samples: 5    # 至少几条记录才启用 benchmark 路由
    benchmark_window_days: 30   # benchmark 计算窗口
```
