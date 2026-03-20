# Hive-TS — Production Pipeline Design

> 本文档是 hive-ts 的理论基础和架构蓝图。所有工具、agent、reviewer 在做决策时应参考此文档。

## 理论基础

### 核心命题

**代码是概率生成器的副产品。约束和测试才是资产。**

LLM 是概率采样器——不推导，猜。猜得准但终归是猜。传统软件工程假设"想清楚 → 写对 → 维护"，LLM 做不到。但它有别的强项：快。生成成本从天降到秒。

因此软件开发不再是写作问题，而是**控制问题**：

```
传统:  想清楚 → 写对 → 维护           (雕塑)
LLM:   定义约束 → 快速生成 → 测试反馈 → 再修 → 收敛  (控制系统调参)
```

### 三个理论锚点

| 理论 | 核心要点 | 对 Hive 的意义 |
|------|---------|---------------|
| **控制论** (Wiener) | 感知偏差 → 修正 → 收敛 | 测试不是验证代码对不对，是作为控制信号引导概率生成器收敛 |
| **有限理性** (Simon) | 别指望全局最优，"够好"就行 | 不逼 agent 一次写对，让它快速出一版，约束校正 |
| **痕迹协作** (Stigmergy) | 不直接通信，在共享环境留痕迹 | Agent 不互相对话（上下文炸）；读环境 → 做判断 → 写回环境 |

### TPS → AI 生产线映射

从丰田生产方式（TPS）提取的 7 个可操作原则：

| 工业原则 | Hive 实现 | 接口 |
|---------|----------|------|
| **专业分工** — 每站只做一件事 | Agent 按 role 分工 (writer/reviewer/tester) | `Role` type |
| **WIP 限制** — 不让管道溢出 | `max_concurrent` per agent | `AgentCfg.max_concurrent` |
| **工站质检** — 每站出口检查 | Gate 机制（每个 phase 出口） | `Gate` interface |
| **安灯绳** — 发现问题可停线 | Agent 主动报告方向性问题 | `Andon` signal |
| **节拍时间** — 产出 ≤ review 速率 | Throttle when review queue > threshold | `TaktController` |
| **防错装置** — 约束越多越好 | Skills、CLAUDE.md、类型系统 | `Constraint` |
| **改善** — 持续微小改进 | Learnings 写回 skills | `Learning` |

---

## 生产线架构（Pipeline）

### 分层概览

```
Layer 0: Intent        用户的自然语言意图
Layer 1: Spec          结构化的 What（技术无关）
Layer 2: Plan          结构化的 How（架构决策）
Layer 3: Tasks         自包含的执行单元
Layer 4: Execution     Agent 在隔离环境中执行
Layer 5: Review        质量门禁 + 人类判断
Layer 6: Integration   Merge + 反馈收敛
```

### 关键特征：每层速度不同

```
Layer 0  ████░░░░░░  慢 — 人类思考，不可加速
Layer 1  ██████░░░░  中 — LLM 生成，人类确认
Layer 2  ██████░░░░  中 — LLM 生成，人类确认
Layer 3  ████████░░  快 — LLM 自动拆解
Layer 4  ██████████  最快 — 多 agent 并行
Layer 5  ████░░░░░░  慢 — 人类 review 是瓶颈
Layer 6  ██████░░░░  中 — 自动 merge + 冲突处理
```

**瓶颈在 Layer 0 和 Layer 5**。整条线的吞吐量 = min(人类意图输入速率, 人类 review 速率)。

Layer 4 再快也没用，如果 Layer 5 消化不了。这就是 Takt Time 的意义。

---

## 接口定义

### Layer 0 → 1: Intent → Spec

```typescript
interface IntentToSpec {
  /** 从自然语言生成结构化 spec */
  generate(intent: string, context: RepoContext): Promise<Spec>;
}

interface Spec {
  title: string;
  objective: string;          // What, not How
  acceptance: string[];       // Given/When/Then
  constraints: string[];      // 不变量、边界条件
  out_of_scope: string[];     // 明确排除
}

interface RepoContext {
  root: string;               // git repo root
  structure: string;          // 项目结构摘要
  conventions: string;        // CLAUDE.md / skills 摘要
}
```

**设计原则**：Spec 不包含任何技术实现细节。"用户能用 Google 登录" 而不是 "用 NextAuth + JWT + Redis"。技术决策在下一层。

### Layer 1 → 2: Spec → Plan

```typescript
interface SpecToPlan {
  /** 从 spec 生成实现方案 */
  generate(spec: Spec, codebase: CodebaseSnapshot): Promise<Plan>;
}

interface Plan {
  approach: string;           // 一段话描述方案
  decisions: Decision[];      // 关键技术选择
  files_to_change: string[];  // 预计改动的文件
  risks: string[];            // 已知风险
}

interface Decision {
  what: string;               // 选了什么
  why: string;                // 为什么（LLM 推导不了 why）
  alternatives: string[];     // 考虑过的替代方案
}
```

### Layer 2 → 3: Plan → Tasks

```typescript
interface PlanToTasks {
  /** 从 plan 拆解为自包含任务 */
  decompose(plan: Plan, spec: Spec): Promise<TaskSpec[]>;
}

// TaskSpec 已存在于 types.ts — 每个 task 必须自包含
// Self-contained = agent 拿到即可开工，无需猜测
```

### Layer 4: Execution

```typescript
interface AgentRuntime {
  /** 在隔离环境中执行任务 */
  execute(task: TaskSpec, env: ExecutionEnv): AsyncIterable<AgentEvent>;
  /** 检查 agent 是否可用 */
  healthCheck(): Promise<AgentHealth>;
}

interface ExecutionEnv {
  workdir: string;            // worktree 或 output dir
  branch: string;             // git branch name
  constraints: string[];      // 注入的约束（skills, rules）
}

type AgentEvent =
  | { type: "output"; line: string }
  | { type: "result"; content: string; exitCode: number }
  | { type: "andon"; reason: string }   // 停线信号
  | { type: "artifact"; path: string; artifactType: string };
```

**可插拔**：Claude Code、Codex、未来的 agent 都实现同一个 `AgentRuntime` 接口。切换 agent = 换一个实现，不改 pipeline。

### Layer 4.5: Verification（Agent 自验证）

验证是 Layer 4 和 Layer 5 之间的自动化层。核心基础设施是 **Vercel agent-browser**——用 accessibility tree snapshot（不是截图）理解页面，token 消耗降 80-90%。

```typescript
interface Verifier {
  /** Agent 完成 task 后自动验证产出 */
  verify(taskId: string, spec: Spec, env: ExecutionEnv): Promise<VerifyResult>;
}

interface VerifyResult {
  pass: boolean;
  checks: VerifyCheck[];
  snapshot?: string;         // accessibility tree snapshot
  screenshots?: string[];    // 关键页面截图路径
  summary: string;           // AI 生成的纯文字验证报告（非技术用户可读）
}

interface VerifyCheck {
  type: "acceptance" | "visual" | "gate" | "regression";
  description: string;       // 自然语言描述
  pass: boolean;
  evidence?: string;         // 截图路径或 snapshot diff
}
```

#### 三层验证策略

```
┌─────────────────────────────────────────────────────┐
│ Layer A: Gate (自动, 秒级)                           │
│   build ✓  typecheck ✓  lint ✓  test ✓              │
│   → 全过 = 继续; 任一失败 = 回到 Agent fix loop      │
├─────────────────────────────────────────────────────┤
│ Layer B: Browser Verification (自动, 分钟级)         │
│   agent-browser open → snapshot → diff              │
│   对比 spec.acceptance 的 Given/When/Then           │
│   → AI 判断："页面上出现了注册按钮" = pass            │
│   → 生成 summary (非技术用户可读)                    │
│   → 截图作为 artifact 存入 DB                       │
├─────────────────────────────────────────────────────┤
│ Layer C: Human Review (可选, 仅复杂场景)             │
│   非技术用户看到的不是代码 diff，而是：              │
│   ① AI 验证报告（纯文字总结）                       │
│   ② Before/After 截图对比                          │
│   ③ 验收标准的 pass/fail 清单                       │
│   → Approve / Reject / 要求修改                     │
└─────────────────────────────────────────────────────┘
```

#### agent-browser 在 Hive 中的使用模式

```bash
# Agent 完成 task 后，Hive 自动执行：

# 1. 启动 dev server（如果项目是 web 应用）
# 2. 打开浏览器验证
agent-browser open http://localhost:3000
agent-browser wait --load networkidle

# 3. 拍快照（accessibility tree，极低 token）
agent-browser snapshot -i

# 4. 对比变更前后
agent-browser diff snapshot

# 5. 针对 spec 中的验收标准逐条检查
agent-browser find text "Sign Up" click    # 验证按钮存在
agent-browser wait --url "**/register"     # 验证导航正确
agent-browser snapshot -i                  # 重新快照

# 6. 截图留档（给人类 reviewer 看）
agent-browser screenshot --annotate verify-result.png

# 7. 关闭
agent-browser close
```

#### 为什么用 agent-browser 而不是 Playwright 直接写测试

| | agent-browser | Playwright 测试 |
|---|---|---|
| Token 消耗 | accessibility tree snapshot, ~500 tokens/page | 截图 ~10K tokens/page |
| 灵活性 | 自然语言描述意图，AI 理解 | 硬编码 selector，脆弱 |
| 维护成本 | 零——UI 改了 AI 自动适应 | 高——selector 变了测试就挂 |
| 适合谁 | AI agent 自验证 | 人类写的回归测试 |

**两者互补**：agent-browser 做灵活的验收验证，Playwright 做稳定的回归测试。

### Layer 5: Review

```typescript
interface Gate {
  name: string;
  /** 检查通过/失败 */
  check(taskId: string, env: ExecutionEnv): Promise<GateResult>;
}

interface GateResult {
  pass: boolean;
  findings: Finding[];
}

// 内置 gates: build, typecheck, lint, test
// 可扩展: security-scan, a11y-check, visual-regression, custom
```

#### 非技术用户的 Review 界面

非技术用户看不懂 diff。他们需要看到的是：

```
┌─────────────────────────────────────────┐
│ Task: HIVE-7 "添加用户注册功能"          │
│ Agent: Claude Code                       │
│ Status: ✅ 验证通过，等待确认            │
├─────────────────────────────────────────┤
│                                         │
│ 📋 验收检查                             │
│ ✅ 注册页面可访问 (/register)           │
│ ✅ 表单包含 email + password 字段       │
│ ✅ 提交后跳转到 dashboard               │
│ ✅ 重复 email 显示错误提示              │
│                                         │
│ 📸 截图对比                             │
│ [Before]  [After]                       │
│                                         │
│ 📝 变更摘要                             │
│ "新增了 /register 页面，包含邮箱密码     │
│  注册表单。提交后自动登录并跳转到首页。  │
│  已处理重复邮箱的错误场景。"             │
│                                         │
│ [✅ 确认合并]  [❌ 拒绝]  [💬 备注]     │
└─────────────────────────────────────────┘
```

### Layer 6: Integration

```typescript
interface Integrator {
  /** 合并任务分支到主分支 */
  merge(taskId: string, branch: string): Promise<MergeResult>;
  /** 清理被拒绝的任务 */
  cleanup(taskId: string, branch: string): Promise<void>;
}

interface MergeResult {
  success: boolean;
  conflicts?: string[];
}
```

---

## 信号流（不是数据流）

Hive 的核心不是数据在层间流动，而是**控制信号**在流动：

```
User intent ──→ Spec ──→ Plan ──→ Tasks ──→ Agents
                                              │
                ┌──────────────────────────────┘
                │ (控制信号回路)
                ▼
            Artifacts (diff, log, test results)
                │
                ▼
            Gates (build? test? lint?)
                │
          ┌─────┴─────┐
          ▼           ▼
        PASS        FAIL ──→ Fix Loop ──→ 回到 Agent
          │                     │
          ▼                     └─→ 超过 max_attempts → Andon → 人类介入
     Browser Verify
     (agent-browser)
          │
    ┌─────┴─────┐
    ▼           ▼
  PASS        FAIL ──→ 再修一轮
    │
    ▼
  生成验证报告 (summary + screenshots + acceptance checklist)
    │
    ▼
  Human Review (看报告，不看代码)
    │
  ┌─┴──┐
  ▼    ▼
Merge  Reject
```

**两个反馈回路**：
1. **快回路** — Gate 失败 → Agent 自修 → 秒级
2. **慢回路** — Browser verify / Human review → 修改 spec 或 plan → 分钟级

---

## 环境协作（Stigmergy）

Agent 不互相对话。它们通过共享环境协调：

| 环境介质 | 写入者 | 读取者 | 内容 |
|---------|--------|--------|------|
| `hive.db` (tasks/attempts/artifacts) | Scheduler, Executor | 所有 agent, UI | 任务状态、产出物 |
| Git branches | Agent | Reviewer, Integrator | 代码变更 |
| `output/` (logs, diffs, screenshots) | Agent, Verifier | UI, Gate | 执行 + 验证产出 |
| SSE events | Engine | UI | 实时状态 |
| CLAUDE.md + Skills | 人类, Kaizen | Agent | 约束、上下文 |
| agent-browser snapshots | Verifier | UI, Human | 页面状态（accessibility tree）|

**没有 agent-to-agent 消息传递**。所有协调通过环境状态完成。

---

## 约束即资产

在这个架构中，真正有价值的不是生成的代码，而是：

1. **不变量** — "转账后总余额守恒" 比任何 API 文档值钱 100 倍
2. **Interface 定义** — 本身就是 spec，不需要自然语言翻译
3. **ADR (Why)** — LLM 能推导 how，推导不了 why
4. **测试** — 控制信号，不是验证工具
5. **Skills** — 沉淀的约束，比代码活得久

---

## 扩展点

当引入新的生产模式时，只需实现对应接口：

| 变更 | 改什么 | 不改什么 |
|------|-------|---------|
| 新增 Agent (如 Gemini Code) | 实现 `AgentRuntime` | Pipeline, UI, DB |
| 新增 Gate (如 security scan) | 实现 `Gate` | Pipeline, Agent, UI |
| 新增验证方式 (如 API 测试) | 实现 `Verifier` | Pipeline, Agent, Gate |
| 新增 Spec 格式 | 实现 `IntentToSpec` | 下游所有层 |
| 新增 Integration 方式 (如 PR) | 实现 `Integrator` | Pipeline, Agent |
| 新增 UI (如 CLI / mobile) | 消费 SSE events + VerifyResult | Engine 层 |
| 切换浏览器验证工具 | 换 `Verifier` 实现 | Spec, Agent, Gate |

**最小改动原则**：每次扩展只动一个接口的一个实现。如果需要改两层，说明接口切错了。
