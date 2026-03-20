@.claude/skills/nextjs-engineer/SKILL.md

# Hive-TS — Agent Control Plane

Unified Next.js 16 fullstack app. Orchestrates AI coding agents (Claude Code, Codex) in parallel.

> 设计哲学和接口定义见 `docs/DESIGN.md`（按需读取，不默认加载）。

## Architecture

```
src/
├── app/
│   ├── api/              Route Handlers (REST)
│   │   ├── agents/       Agent health + registry
│   │   ├── chat/         Supervisor chat
│   │   ├── events/       SSE event stream
│   │   ├── tasks/        Task lifecycle (CRUD, run, approve, reject, stream)
│   │   ├── workspace/    Workspace init + status
│   │   ├── skills/       Skill CRUD
│   │   ├── status/       System status
│   │   ├── health/       Health check
│   │   └── shutdown/     Graceful shutdown
│   ├── tasks/            Task pages (board + detail)
│   ├── setup/            Setup wizard
│   ├── layout.tsx        Root layout (Geist fonts, dark-only)
│   └── page.tsx          Dashboard
├── components/
│   ├── ui/               shadcn/ui primitives
│   └── *.tsx             Business components
└── lib/
    ├── runtime/          ★ Pluggable agent runtimes
    │   ├── types.ts      AgentRuntime interface + AgentEvent
    │   ├── claude.ts     Claude Code SDK implementation
    │   ├── codex.ts      Codex CLI implementation
    │   └── index.ts      Registry: getRuntime(), checkAllRuntimes()
    ├── scheduler.ts      Task DB + lifecycle (SQLite)
    ├── executor.ts       Orchestrator: worktree → runtime.execute() → artifacts
    ├── supervisor.ts     Chat supervisor (Claude SDK)
    ├── compiler.ts       Prompt compiler
    ├── evaluator.ts      Auto-gate checks
    ├── worktree.ts       Git worktree + merge + branch management
    ├── events.ts         SSE event bus
    ├── config.ts         hive.yaml loader
    ├── types.ts          All type definitions
    ├── validate.ts       Path + ID validation
    ├── status.ts         Shared task status config
    ├── format.ts         Shared formatAge utility
    ├── json-extract.ts   JSON extraction from LLM output
    ├── chat-store.ts     In-memory chat history
    ├── agents.ts         Agent health check (delegates to runtime)
    ├── api.ts            REST API helpers
    └── utils.ts          cn() utility
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Database | SQLite via better-sqlite3 (`data/hive.db`) |
| Agent Runtime | Pluggable: Claude Code SDK, Codex CLI (see `lib/runtime/`) |
| UI | shadcn/ui (base-nova) + Tailwind CSS v4 + Geist fonts |
| Config | hive.yaml (YAML) |

## Key Patterns

- **Pluggable runtimes** — `AgentRuntime` interface, new agent = 1 file + 1 registration
- **No ORM** — raw SQL via better-sqlite3, sync API
- **No auth** — single-user local tool
- **Dark mode only** — `className="dark"` on `<html>`
- **SSE for real-time** — event bus pushes task/agent status
- **Git worktree isolation** — each agent works in its own branch
- **Approve → merge / Reject → cleanup** — branch lifecycle tied to task lifecycle
- **server-only** — all lib/ modules guard against client-side import

## Code Conventions

- TypeScript strict — no `any`, no `as any`
- `cn()` from `lib/utils` for all conditional Tailwind classes
- Server Components by default, `"use client"` only when needed
- API routes return `{ data }` or `{ error }` JSON
- All types in `lib/types.ts`, status config in `lib/status.ts`
- Task IDs validated via `isValidTaskId()` before filesystem ops
- Components: one per file, named exports
- Icons: lucide-react

## Commands

```bash
npm run dev          # Dev server on :58080
npm run build        # Production build
npm run start        # Production server on :58080
```
