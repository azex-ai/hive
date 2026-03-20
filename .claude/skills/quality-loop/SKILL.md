---
name: quality-loop
description: Continuous quality improvement loop for Hive-TS. Scans, diagnoses, fixes, verifies. Run via /loop 10m /quality-loop or manually.
---

# Quality Loop

自主质量改进循环。每次执行一个完整的 scan → diagnose → fix → verify 周期。

## 执行协议

### Step 1: Scan（发现问题）

按优先级扫描以下维度：

**P0 — Build Health**
```bash
npm run build 2>&1
```
任何 failure → 立即修复，不继续扫描。

**P1 — TypeScript Strictness**
```bash
npx tsc --noEmit 2>&1
```
类型错误 → 立即修复。

**P2 — Architecture Compliance**
扫描 `src/lib/` 下的引擎文件，检查：
- 不得 import React 或 client-only 模块
- `components/ui/` 不含业务逻辑
- 客户端组件不 import better-sqlite3, fs, path

**P3 — Code Quality**
- 查找 `console.log` 残留
- 查找 `any` / `as any` 使用
- 查找空 `catch {}` 块
- 查找未使用的 imports

**P4 — Stale Documentation**
检查 CLAUDE.md 里的项目结构是否与实际文件结构一致。

### Step 2: Diagnose（分析根因）

对每个发现的问题，判断：
- 严重程度（P0 阻塞 / P1 必修 / P2 应修 / P3 可选）
- 影响范围（单文件 / 跨模块 / 全局）
- 修复成本（1 行 / 10 行 / 重构）

### Step 3: Fix（自动修复）

按优先级逐个修复。每个修复后立即 verify：
```bash
npm run build
```
如果 verify 失败 → 回滚这个修复，标记为 "needs human review"。

### Step 4: Report（输出报告）

```markdown
## Quality Loop Report — {timestamp}

### Fixed
- [P2] src/lib/executor.ts: removed unused import
- [P3] src/components/task-card.tsx: added aria-label to icon button

### Needs Attention
- [P1] src/lib/scheduler.ts: `any` type on line 42

### Metrics
- Build: pass/fail
- TypeScript: pass/fail
- Architecture violations: N
- console.log residuals: N
```

## 触发方式

- 手动: `/quality-loop`
- 定时: `/loop 10m /quality-loop`

## 注意

- 只修复确定性问题（lint、missing import、unused code）
- 不做架构变更、不加新功能
- 遇到不确定的问题，report 但不修
- 每次循环最多修 5 个问题，避免大范围改动
