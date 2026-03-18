# Armatrix Go 分层架构规范

> **强制约束**。所有 Go 后端代码必须遵循本规范。不得跨层调用，不得在错误的层写业务逻辑。

---

## 1. 分层架构总览

```
HTTP Request
     ↓
Handler 层      internal/handler/{module}.go       chi http.HandlerFunc，decode → logic → encode
     ↓
Logic 实现层    internal/logic/{module}/{module}.go  业务逻辑唯一实现处
     ↓
DB 查询层       internal/db/                         sqlc 生成（make sqlc）
     ↓
PostgreSQL
```

**数据流**：`JSON Body → Input struct → logic → Output struct → JSON Response`

**依赖方向**：handler → logic → db（严格单向，禁止逆向调用）

---

## 2. 开发工作流

```
SQL → make sqlc → 实现 logic/ → 写 handler → 在 main.go 注册路由
```

```bash
make sqlc      # SQL queries → internal/db/（DAO层，sqlc生成）
make dev       # go run cmd/server/main.go
```

---

## 3. Handler 层

**路径**: `server/internal/handler/{module}.go`

**职责**: HTTP decode → 调 logic → HTTP encode。不含业务逻辑。

**结构**（chi 细节见 `.claude/skills/chi-http/SKILL.md`）：
- `struct { svc *xxx.Service }` — 构造函数注入，无全局状态
- `Register(r chi.Router)` — 统一注册，main.go 只调这一个方法
- 每个方法 = 一个 endpoint，用 `httpx.Decode/JSON/HandleError` 处理 HTTP 层

**规范**:
- 不写业务逻辑，只做参数转换
- 错误统一 `httpx.HandleError(w, err)`（自动映射 `*bizcode.AppError` → HTTP status）
- 路径参数用 `chi.URLParam(r, "id")`

---

## 4. Logic 层

**路径**: `server/internal/logic/{module}/{module}.go`

**职责**: 业务逻辑唯一实现处。通过 `db.Queries` 访问数据库。

```go
// 导出类型名 Service（handler 引用 *skill.Service）
type Service struct {
    db *db.Queries
}

func New(queries *db.Queries) *Service {
    return &Service{db: queries}
}

func (s *Service) Create(ctx context.Context, in *model.SkillCreateInput) (*model.SkillOutput, error) {
    id, err := utility.NewID()
    if err != nil {
        return nil, bizcode.Internal("generate id failed")
    }
    row, err := s.db.CreateSkill(ctx, db.CreateSkillParams{
        ID: id, Name: in.Name, Content: in.Content,
    })
    if err != nil {
        if isDuplicateKey(err) {
            return nil, bizcode.AlreadyExists("skill with this slug already exists")
        }
        return nil, fmt.Errorf("create skill: %w", err)
    }
    out := dbSkillToOutput(row)
    return &out, nil
}
```

**规范**:
- struct 名统一为 `Service`（导出）
- 构造函数 `New(queries *db.Queries) *Service`
- 错误用 `bizcode.Xxx("msg")` 表达业务错误，`fmt.Errorf("ctx: %w", err)` 包装底层错误
- 禁止调用其他 logic 包（跨 service 调用通过 main.go 编排）
- 禁止在 logic 层直接写 HTTP 相关代码

---

## 5. Model 层

**路径**: `server/internal/model/{module}.go`

**职责**: 解耦 handler 和 logic 的 Input/Output 结构。

```go
// Input — handler → logic
type SkillCreateInput struct {
    Name        string
    Slug        string
    Description string
    Content     string
    Version     string
    Source      string
}

// Output — logic → handler
type SkillOutput struct {
    ID          int64
    Name        string
    Slug        string
    Status      string
    UseCount    int32
    // ...
}
```

---

## 6. 错误处理

```go
// logic 层 — 业务错误
return nil, bizcode.NotFound("skill not found")
return nil, bizcode.AlreadyExists("slug already exists")
return nil, bizcode.InvalidInput("content is required")
return nil, bizcode.Internal("unexpected state")

// logic 层 — 底层错误透传
return nil, fmt.Errorf("list skills: %w", err)

// handler 层 — 统一处理
if err != nil { httpx.HandleError(w, err); return }
// httpx.HandleError 内部: errors.As(err, &appErr) → 映射 HTTP status
```

---

## 7. Config 访问

通过 `*config.Config` 显式传参，禁止全局 `g.Cfg()` 或 `os.Getenv` 散落在业务代码中。

```go
// main.go 统一加载
cfg, _ := config.Load("manifest/config/config.yaml")

// logic 需要 config 时显式注入
func New(queries *db.Queries, cfg *config.Config, baseURL string) *Service

// handler 不需要 config（通过 logic 间接访问）
```

---

## 8. main.go 显式 DI

```go
// 所有依赖在 main.go 明确可见
queries := db.New(pool)

skillSvc := logic_skill.New(queries)
boardSvc := logic_board.New(queries)
chatSvc  := logic_chat.New(pool, routerLLM, cfg.LLM.RouterModel, modelRouter, sandbox, skillResolver, skillLoader, notifier)

r.Route("/api", func(r chi.Router) {
    handler.NewSkillHandler(skillSvc).Register(r)
    handler.NewBoardHandler(boardSvc).Register(r)
    r.Post("/chat", handler.NewChatHandler(chatSvc).Stream)
})
```

---

## 9. 禁止清单

| ❌ 禁止 | ✅ 替代 |
|--------|---------|
| `service.Skill()` 全局单例 | `handler.NewSkillHandler(svc)` |
| `logic.Register(db)` | `logic_skill.New(queries)` |
| `g.Cfg().Get(ctx, key)` | `cfg.LLM.AnthropicAPIKey` |
| `gerror.WrapCode(...)` | `bizcode.Xxx("msg")` / `fmt.Errorf(...)` |
| `ghttp.Request` / `ghttp.Response` | `*http.Request` / `http.ResponseWriter` |
| 跨 logic 包直接调用 | 在 main.go 编排，通过构造函数传入依赖 |
| handler 层写业务逻辑 | 全部移入 logic 层 |
| Raw SQL string in Go | 只用 sqlc 生成的函数 |
