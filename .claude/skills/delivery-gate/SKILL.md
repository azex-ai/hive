---
name: delivery-gate
description: Module delivery quality gate. Run after completing a sub-phase to validate before proceeding. Triggers review, tests, and architecture check.
---

# Delivery Gate

模块交付质检门。在每个 sub-phase 完成后运行，确认质量达标后才能继续下一个 sub-phase。

## 使用场景

```
开发完 scheduler → /delivery-gate
开发完 executor → /delivery-gate
开发完 task-board UI → /delivery-gate
```

## 执行协议

### Gate 1: Build Green
```bash
npm run build 2>&1
```
FAIL → 停止，修 build error。

### Gate 2: TypeScript Clean
```bash
npx tsc --noEmit 2>&1
```
FAIL → 停止，修 type error。

### Gate 3: Architecture Compliance

扫描本次新增/修改的文件：
- `src/lib/` 引擎不得 import React
- `components/ui/` 不含业务逻辑
- 客户端组件不 import server-only 模块 (better-sqlite3, fs, child_process)
- Route handlers 返回 `{ data }` 或 `{ error }`

FAIL → 列出违规文件，要求修复。

### Gate 4: Code Review

Spawn `code-reviewer` agent，审查本次 sub-phase 的所有新增/修改文件。

审查维度：
- 错误处理（不吞错误、error 正确传播）
- 类型安全（no `any`, no `as any`）
- 安全性（SQL 参数化、路径校验、无 XSS）
- 可访问性（aria-label、键盘导航）

### 输出

```
## Delivery Gate — {module name}

| Gate | Status | Detail |
|------|--------|--------|
| Build | pass/fail | |
| TypeScript | pass/fail | N errors |
| Architecture | pass/fail | N violations |
| Code Review | pass/fail | N Critical, N High |

**VERDICT: PASS** — safe to proceed to next sub-phase.
```

如果任何 Gate FAIL：
```
**VERDICT: BLOCKED** — fix issues before proceeding.
Blocking issues:
1. [Gate 3] components/task-card.tsx imports better-sqlite3
2. [Gate 4] Code review found 1 High: missing error handling in ...
```
