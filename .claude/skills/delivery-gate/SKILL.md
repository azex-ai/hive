---
name: delivery-gate
description: Module delivery quality gate. Run after completing a sub-phase to validate before proceeding. Triggers review, tests, architecture check, and optionally spec-reviewer for financial modules.
---

# Delivery Gate

模块交付质检门。在每个 sub-phase 完成后运行，确认质量达标后才能继续下一个 sub-phase。

## 使用场景

```
开发完 transport/ → /delivery-gate
开发完 router/ → /delivery-gate
开发完 gateway.go → /delivery-gate
```

## 执行协议

### Gate 1: Build Green
```bash
cd server && go build ./...
cd server && go vet ./...
```
FAIL → 停止，修 build error。

### Gate 2: Tests Pass
```bash
cd server && go test ./... -count=1
```
FAIL → 停止，修 test。

### Gate 3: Financial Invariants（如果改了 billing/ledger 相关文件）

检查本次变更是否涉及以下路径：
- `core/ledger/`
- `llmgate/middleware/billing*`
- `adapter/postgres/credit_*`
- `adapter/postgres/ledger_*`
- `paygate/`

如果涉及：
```bash
cd server && go test ./internal/core/ledger/... -run Invariant -count=1 -v
```
FAIL → **P0 阻塞**，不允许继续。

### Gate 4: Architecture Compliance

扫描本次新增/修改的文件：
- `internal/core/` 下不得 import `net/http`, `log/slog`, `pgx`, `bizcode`, `httpx`
- handler 层不得直接 import `internal/db`（应通过 consumer-side interface）
- 无循环依赖

FAIL → 列出违规文件，要求修复。

### Gate 5: Code Review

Spawn `code-reviewer` agent，审查本次 sub-phase 的所有新增/修改文件。

审查维度：
- 接口设计（consumer-side、ISP）
- 错误处理（不吞错误、domain error 正确传播）
- 并发安全（goroutine 有退出路径、channel 正确关闭）
- 金融正确性（decimal、idempotency、no float64）

### Gate 6: Spec Review（金融模块专用）

如果变更涉及 billing/ledger/payment：
- 检查是否有对应的 Journal Trace 文档
- 如果没有 → 阻塞，要求先写 trace
- Spawn `spec-reviewer` agent 对 trace 做对抗审查

### 输出

```
## Delivery Gate — {module name}

| Gate | Status | Detail |
|------|--------|--------|
| Build | ✅ | |
| Tests | ✅ | 15/15 pass |
| Invariants | ✅ | 9/9 pass (or N/A) |
| Architecture | ✅ | 0 violations |
| Code Review | ✅ | 0 Critical, 0 High |
| Spec Review | N/A | no financial changes |

**VERDICT: PASS** — safe to proceed to next sub-phase.
```

如果任何 Gate FAIL：
```
**VERDICT: BLOCKED** — fix issues before proceeding.
Blocking issues:
1. [Gate 4] handler/billing.go imports internal/db directly
2. [Gate 5] Code review found 1 High: missing error propagation in ...
```
