---
name: go-engineer
description: >
  Go backend development for Azex. Covers chi HTTP handlers, business logic,
  sqlc queries, concurrency patterns, and LLM/payment integrations.
  Auto-activate when editing server/**/*.go or discussing Go implementation,
  "backend", "API", "handler", "logic", "sqlc", "chi", "route", "middleware",
  "goroutine", "channel", "concurrent", "pipeline", "generics", "interface".
---

# Go Engineer — Azex Backend

Tech: Go 1.25 + chi v5 + pgx v5 + sqlc + PostgreSQL 18

> **分层架构是强制约束**，详见 `references/layer.md`。

---

## 开发工作流

```
SQL → make sqlc → 实现 logic（模块内部）→ 写 handler → main.go 注册路由
```

```bash
make sqlc      # SQL → server/internal/db/
make dev       # Go server with hot reload
make test      # go test ./...
make build     # go build -o bin/azex cmd/azex/main.go
make db-reset  # drop + recreate + seed
```

---

## 目录结构

```
server/
├── cmd/azex/main.go          chi router + explicit DI wiring (唯一入口)
├── internal/
│   ├── core/                  共享核心
│   │   ├── auth/              Twitter OAuth2
│   │   ├── user/              用户模型
│   │   ├── apikey/            API Key (bcrypt + AES)
│   │   └── ledger/            双分录账本
│   ├── llmgate/               LLM 网关
│   │   ├── provider/          4 Provider adapter (接口 + 注册表)
│   │   ├── transport/         HTTP + SSE (+ WebSocket 预留)
│   │   ├── capability/        模型能力声明
│   │   ├── router/            路由决策
│   │   └── middleware/        鉴权/限流/计量
│   ├── paygate/               支付网关
│   │   ├── checkout/          收银台
│   │   ├── deposit/           CREATE2 充值
│   │   ├── scanner/           链上监控 (Base/Arb/Mainnet)
│   │   └── wallet/            地址管理
│   ├── handler/               HTTP handlers (one per resource)
│   ├── db/                    sqlc generated (不手动改)
│   └── pkg/                   工具 (bizcode, httpx, crypto, decimal)
├── manifest/sql/              DDL + queries
├── sqlc.yaml
└── go.mod
```

---

## 各层职责

| 层 | 职责 | 关键约束 |
|---|---|---|
| `handler/` | HTTP decode + call logic + HTTP encode | 不含业务逻辑 |
| `core/`, `llmgate/`, `paygate/` | 业务逻辑 | 构造函数注入依赖 |
| `db/` | sqlc DAO | make sqlc 生成，不手动改 |
| `pkg/httpx/` | JSON/Error helpers | handler 共享 |
| `pkg/bizcode/` | AppError 错误码 | 按模块分段 |

---

## Interface Design (核心)

```go
// 接口定义在消费者侧，1-3 个方法
type ChannelStore interface {
    GetActiveChannels(ctx context.Context, model string) ([]Channel, error)
}

// Accept interfaces, return structs
func NewRouter(store ChannelStore, health HealthChecker) *Router

// 组合小接口
type LLMProvider interface {
    RequestConverter
    ResponseConverter
    TokenCounter
}

// -er 命名：Reader, Writer, Scanner, Recorder, Deployer
```

## Goroutine Patterns

```go
// 异步后处理：channel + worker pool
h.postProcess <- PostJob{Usage: usage}

// 并行：errgroup
g, ctx := errgroup.WithContext(ctx)

// 信号量：buffered channel
var sem = make(chan struct{}, maxConcurrent)

// 每个 goroutine 必须有 ctx.Done() 退出路径
```

## Generics

```go
type Result[T any] struct { Code int; Message string; Data T }
type PageRes[T any] struct { Items []T; Total int64 }
func Map[T, U any](items []T, fn func(T) U) []U
func Filter[T any](items []T, fn func(T) bool) []T
```

---

## Key Libraries

| Purpose | Library |
|---------|---------|
| HTTP router | go-chi/chi v5 |
| DB driver | jackc/pgx v5 |
| SQL codegen | sqlc |
| Decimal | shopspring/decimal |
| Concurrency | x/sync/errgroup |
| Logging | log/slog |
| HTTP client | net/http (stdlib) |
| Crypto | crypto/aes + crypto/cipher (AES-256-GCM) |
| UUID v7 | google/uuid (v7 support) |

---

## TDD 前置（强制）

写新 .go 实现文件前：
1. 先创建对应的 _test.go
2. 写至少一个测试用例（可以是 TODO 占位）
3. 确认 go test 能运行（即使 fail）
4. 然后写实现让测试 pass

例外：
- 纯 DTO / 常量文件（无逻辑）
- sqlc 生成的代码
- adapter 层的纯映射代码（如 pgtype → domain 转换）

---

## References

| Topic | File |
|-------|------|
| 分层架构规范 | `references/layer.md` |
| chi 路由 + handler 模式 | `references/chi.md` |
| Go 并发模式 | `references/concurrency.md` |
