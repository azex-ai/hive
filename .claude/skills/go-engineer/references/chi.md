# chi HTTP — Armatrix Patterns

chi wraps `net/http` with a thin, composable router. Every handler is `http.HandlerFunc`.
No magic. No code generation. Explicit DI via constructor injection.

---

## Router Setup

```go
r := chi.NewRouter()

// Global middleware (applied to all routes)
r.Use(httpx.CORS)
r.Use(chimiddleware.Recoverer)

// Route groups
r.Get("/health", healthHandler.Check)

r.Route("/api", func(r chi.Router) {
    skillHandler.Register(r)   // handler registers its own routes
    boardHandler.Register(r)
    r.Post("/chat", chatHandler.Stream)
})

http.ListenAndServe(":8100", r)
```

---

## Handler Struct Pattern (standard)

```go
type SkillHandler struct {
    svc *skill.Service
}

func NewSkillHandler(svc *skill.Service) *SkillHandler {
    return &SkillHandler{svc: svc}
}

// Register wires all routes for this handler onto the given router.
func (h *SkillHandler) Register(r chi.Router) {
    r.Get("/skills", h.List)
    r.Post("/skills", h.Create)
    r.Get("/skills/{id}", h.Get)
    r.Patch("/skills/{id}/status", h.UpdateStatus)
}

func (h *SkillHandler) List(w http.ResponseWriter, r *http.Request) {
    out, err := h.svc.List(r.Context(), &model.SkillListInput{
        Status: r.URL.Query().Get("status"),
    })
    if err != nil { httpx.HandleError(w, err); return }
    httpx.JSON(w, http.StatusOK, out)
}

func (h *SkillHandler) Get(w http.ResponseWriter, r *http.Request) {
    id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
    if err != nil { httpx.Error(w, http.StatusBadRequest, "invalid id"); return }
    out, err := h.svc.Get(r.Context(), &model.SkillGetInput{ID: id})
    if err != nil { httpx.HandleError(w, err); return }
    httpx.JSON(w, http.StatusOK, out)
}
```

---

## URL Parameters

```go
chi.URLParam(r, "id")           // string from {id} in route pattern
chi.URLParam(r, "slug")         // string from {slug}

// Parse to typed value in handler:
id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
```

---

## Middleware

```go
// Global: applied to router
r.Use(httpx.CORS)
r.Use(chimiddleware.Recoverer)
r.Use(chimiddleware.RequestID)

// Scoped: only for a route group
r.Route("/admin", func(r chi.Router) {
    r.Use(authMiddleware)   // only applies inside /admin
    r.Get("/users", handler)
})

// Inline: only for one endpoint
r.With(rateLimitMiddleware).Post("/expensive", handler)
```

### Writing middleware

```go
func AuthMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        token := r.Header.Get("Authorization")
        if token == "" {
            httpx.Error(w, http.StatusUnauthorized, "missing token")
            return
        }
        // Pass enriched context downstream
        ctx := context.WithValue(r.Context(), ctxKeyUser, userID)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

---

## Request Decoding

```go
// Decode JSON body
var req struct {
    Name    string `json:"name"`
    Content string `json:"content"`
}
if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
    httpx.Error(w, http.StatusBadRequest, "invalid request body")
    return
}

// Query params
page := r.URL.Query().Get("page")
limit := r.URL.Query().Get("limit")
```

---

## SSE (Server-Sent Events)

```go
func (h *ChatHandler) Stream(w http.ResponseWriter, r *http.Request) {
    // Set SSE headers BEFORE writing any data
    w.Header().Set("Content-Type", "text/event-stream")
    w.Header().Set("Cache-Control", "no-cache")
    w.Header().Set("Connection", "keep-alive")
    w.Header().Set("X-Accel-Buffering", "no")  // disable nginx buffering

    // Write events
    fmt.Fprintf(w, "data: %s\n\n", jsonBytes)
    if f, ok := w.(http.Flusher); ok { f.Flush() }
}
```

---

## httpx Helpers (internal/httpx/)

```go
// JSON response
httpx.JSON(w, http.StatusOK, payload)
httpx.JSON(w, http.StatusCreated, payload)

// Error response
httpx.Error(w, http.StatusBadRequest, "invalid id")
httpx.HandleError(w, err)   // maps *bizcode.AppError → HTTP status automatically

// Decode request body
if err := httpx.Decode(r, &req); err != nil {
    httpx.Error(w, http.StatusBadRequest, "invalid request body")
    return
}
```

---

## Route Mounting (subrouters)

```go
// Mount attaches a sub-router at a prefix
r.Mount("/api/v2", v2Router)

// Route creates an inline sub-router
r.Route("/api", func(r chi.Router) {
    r.Route("/skills", func(r chi.Router) {
        r.Get("/", h.List)
        r.Post("/", h.Create)
        r.Get("/{id}", h.Get)
    })
})
```

---

## Context Values (request-scoped)

```go
// Unexported key type prevents collisions
type ctxKey int
const ctxKeyCompanyID ctxKey = 0

// Set in middleware
ctx := context.WithValue(r.Context(), ctxKeyCompanyID, int64(1))
next.ServeHTTP(w, r.WithContext(ctx))

// Read in handler
companyID := r.Context().Value(ctxKeyCompanyID).(int64)
```

---

## Available chi Middleware (chimiddleware package)

| Middleware | Use |
|---|---|
| `Recoverer` | Panic recovery → 500 |
| `RequestID` | Inject X-Request-ID |
| `Logger` | Request logging |
| `Timeout(d)` | Per-request timeout |
| `Compress(level)` | Gzip compression |
| `StripSlashes` | Strip trailing slashes |
| `CleanPath` | Remove double slashes |

---

## Anti-Patterns

```go
// ❌ Global state in handler
var globalSvc *skill.Service   // never

// ✅ Constructor injection
func NewSkillHandler(svc *skill.Service) *SkillHandler

// ❌ Accessing body twice
body, _ := io.ReadAll(r.Body)
json.Unmarshal(body, &req)     // fine but verbose

// ✅ Stream decode
json.NewDecoder(r.Body).Decode(&req)

// ❌ Writing header after body
w.Write([]byte("data"))
w.WriteHeader(201)             // ignored, headers already sent

// ✅ Always WriteHeader before Write (or let httpx.JSON handle it)
```
