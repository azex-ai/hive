@.claude/skills/nextjs-engineer/SKILL.md
@docs/DESIGN.md

# Hive-TS — Agent Control Plane

Unified Next.js 16 fullstack app. Orchestrates AI coding agents (Claude Code, Codex) in parallel.

> **设计哲学**：代码是概率生成器的副产品，约束和测试才是资产。详见 `docs/DESIGN.md`。

## Architecture

```
src/
├── app/
│   ├── api/            Route Handlers (REST endpoints)
│   │   ├── agents/     Agent management
│   │   ├── chat/       Supervisor chat
│   │   ├── events/     SSE event stream
│   │   ├── health/     Health check
│   │   ├── skills/     Skill CRUD
│   │   ├── status/     System status
│   │   ├── tasks/      Task lifecycle
│   │   ├── workspace/  Workspace management
│   │   └── shutdown/   Graceful shutdown
│   ├── tasks/          Task pages (board + detail)
│   ├── setup/          Setup wizard
│   ├── layout.tsx      Root layout (Geist fonts, dark mode)
│   └── page.tsx        Dashboard
├── components/
│   ├── ui/             shadcn/ui primitives
│   └── *.tsx           Business components (task-board, chat, panels)
└── lib/
    ├── agents.ts       Agent registry + spawn
    ├── api.ts          REST API helpers
    ├── compiler.ts     Task spec compiler
    ├── config.ts       hive.yaml loader
    ├── evaluator.ts    Review/evaluation engine
    ├── events.ts       SSE event bus
    ├── executor.ts     Task executor (worktree isolation)
    ├── scheduler.ts    Task scheduler + lease management
    ├── supervisor.ts   Chat-based supervisor (Claude SDK)
    ├── types.ts        All type definitions
    ├── utils.ts        cn() utility
    └── worktree.ts     Git worktree management
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Database | SQLite via better-sqlite3 (file: `data/hive.db`) |
| AI | @anthropic-ai/claude-code SDK, execa for agent spawn |
| UI | shadcn/ui (base-nova) + Tailwind CSS v4 + Geist fonts |
| Config | hive.yaml (YAML) |
| Runtime | Node.js (server-only for DB + agent spawn) |

## Key Patterns

- **No ORM** — raw SQL via better-sqlite3, sync API
- **No auth** — single-user local tool
- **Dark mode only** — `className="dark"` on `<html>`
- **SSE for real-time** — event bus pushes task/agent status updates
- **Git worktree isolation** — each agent works in its own worktree
- **Config from YAML** — `hive.yaml` at project root

## Code Conventions

- TypeScript strict — no `any`, no `as any`
- `cn()` from `lib/utils` for all conditional Tailwind classes
- Server Components by default, `"use client"` only when needed
- API routes return `{ data }` or `{ error }` JSON
- All types in `lib/types.ts`
- Components: one per file, named exports
- Icons: lucide-react

## Commands

```bash
npm run dev          # Start dev server on :58080
npm run build        # Production build
npm run start        # Production server on :58080
```
