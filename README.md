# Hive — Local AI Agent Orchestration Control Plane

> Coordinate Claude Code / Codex / Gemini CLI agents to work on the same project in parallel.

Hive is a **local-first** control plane for heterogeneous coding agents. It provides structured task handoff, durable state, cross-agent review, and model-heterogeneous dispatch — all through a single Next.js fullstack application.

## Features

- **Supervisor Chat** — Natural language interface powered by Claude Code SDK with persistent session (sub-2s response after first call)
- **Task Queue** — SQLite-backed scheduler with HIVE-N auto-IDs, lease-based claiming, and dependency graphs
- **Cross-Agent Review** — Different AI models review each other's work (Claude writes → Codex reviews, or vice versa)
- **Live Terminal** — Real-time SSE streaming of agent output
- **Three-Column Layout** — Task board (60%) + Chat/Skills panel (40%)
- **Git Worktree Isolation** — Each task runs in its own git worktree
- **Multi-Agent Health** — Auto-detect available agents (Claude Code, Codex CLI)
- **Skills Integration** — Load and display .claude/skills/ for context-aware prompting

## Architecture

```
Single Next.js Process (localhost:58080)
├── Frontend (React 19 + shadcn/ui + Tailwind CSS v4)
│   ├── Dashboard — task board + chat + skills panel
│   ├── Task Detail — live terminal + diff viewer + review panel
│   └── SSE — real-time updates via EventSource
│
├── API Routes (Next.js Route Handlers)
│   ├── /api/tasks — CRUD + run + stream + files
│   ├── /api/chat — Supervisor agent (Claude Code SDK)
│   ├── /api/health — Agent availability checks
│   └── /api/events — Global SSE event stream
│
└── Backend Modules (TypeScript)
    ├── scheduler.ts — SQLite task queue (better-sqlite3)
    ├── supervisor.ts — Claude Code SDK session management
    ├── compiler.ts — TaskSpec → agent-specific prompt
    ├── evaluator.ts — Three-level evaluation pipeline
    ├── executor.ts — Task orchestration (compile → worktree → run → artifacts)
    ├── worktree.ts — Git worktree lifecycle management
    └── events.ts — In-memory SSE pub/sub broker
```

## Tech Stack

| Component | Choice | Reason |
|-----------|--------|--------|
| Framework | Next.js 15 | Fullstack TypeScript, single process |
| Agent SDK | @anthropic-ai/claude-code | Native session persistence, <2s subsequent calls |
| Database | better-sqlite3 | Synchronous API, single file, zero config |
| UI | shadcn/ui + Tailwind CSS v4 | Dark theme, component library |
| Fonts | Geist Sans + Geist Mono | Vercel design system |
| Icons | Lucide React | Consistent iconography |
| SSE | ReadableStream + TextEncoder | Native Next.js streaming |

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev
# → http://localhost:58080

# Production build
npm run build && npm start
```

## Configuration

Create `hive.yaml` in the project root:

```yaml
repo: .
output_dir: ./output

agents:
  claude:
    command: claude
    args: ["-p", "--output-format", "stream-json"]
    max_concurrent: 3
  codex:
    command: codex
    args: ["exec", "--json", "-q"]
    max_concurrent: 2

supervisor:
  agent: claude
  model: sonnet

scheduler:
  lease_ttl: 30m
  max_attempts: 3

evaluation:
  cross_review: true
  max_review_rounds: 3
  auto_merge_threshold: 2
```

## Supervisor Intents

The chat interface routes natural language to structured intents:

| Intent | Description |
|--------|-------------|
| `create_tasks` | Break user request into parallelizable tasks |
| `reply` | Conversational response |
| `query_status` | Check task/system status |
| `approve` | Approve a completed task |
| `reject` | Reject a task with reason |
| `run_task` | Execute a task with a specific agent |

## Task Lifecycle

```
pending → claimed → running → done → evaluated
                      ↓
                    failed
```

## Rewrite from Go

This project was rewritten from a Go backend + Next.js frontend architecture. Key improvement:

**Before (Go):** Each supervisor call spawned a new `claude -p` process (~10s cold start)
**After (TypeScript):** Uses `@anthropic-ai/claude-code` SDK with session persistence (<2s subsequent calls)

## License

Private — Azex internal tool.
