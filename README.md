# Hive

**AI Agent Control Plane** — Orchestrate coding agents in parallel with automated quality gates.

Hive turns AI coding assistants (Claude Code, Codex) from single-conversation tools into a managed production pipeline. Describe what you want, and Hive breaks it down, dispatches agents, runs quality checks at every stage, and auto-repairs failures — like an assembly line for code.

## The Problem

AI coding agents are powerful but hard to manage at scale:

- **No orchestration** — You can only talk to one agent at a time
- **No quality gates** — Generated code goes straight to review with no automated checks
- **No repair loop** — When something fails, you manually re-prompt
- **No context persistence** — Switch projects and lose all context

## How Hive Works

```
You: "Implement user authentication"
                │
                ▼
┌─ Supervisor (Opus) ─────────────────────────┐
│  Parse intent → Design spec → Decompose     │
│  into independent subtasks                   │
└──────────────┬──────────────────────────────┘
               │
    ┌──────────┼──────────┐
    ▼          ▼          ▼
 Agent A    Agent B    Agent C     ← Parallel execution in git worktrees
 (Claude)   (Codex)   (Claude)
    │          │          │
    ▼          ▼          ▼
┌─ Quality Gates (automatic) ─────────────────┐
│  lint → build → test → review → integrate    │
│                                              │
│  Gate fails? → New agent repairs → Re-check  │
│  3 rounds failed? → Escalate to human        │
└──────────────────────────────────────────────┘
                │
                ▼
            ✅ Done
```

### Key Concepts

- **Assembly Line** — Tasks flow through stages automatically. Human intervention is the exception, not the norm.
- **Quality Gates** — Each stage (lint, build, test, review, integrate) runs independently and produces command-level evidence. No trusting agent self-reports.
- **Repair by Fresh Eyes** — When a gate fails, a *new* agent fixes it (avoids attention blindness). Like space capsule docking — fix independently, then re-integrate.
- **Workspace Blueprints** — Each project gets a `.hive/blueprint.json` with project type, structure, dependencies, and progress checkpoints.
- **Model Routing** — Deep reasoning (Opus) for architecture and review. Fast models for execution. Benchmark-driven dynamic routing over time.

## Quick Start

```bash
git clone https://github.com/azex-ai/hive.git
cd hive
npm install
npm run dev
```

Open http://localhost:58080, select a workspace, and start describing tasks.

### Requirements

- Node.js 20+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) (`claude` command available)
- Optional: [Codex CLI](https://github.com/openai/codex) for multi-agent

## Architecture

```
src/
├── app/                    Next.js 16 App Router
│   ├── api/                REST API
│   │   ├── tasks/          Task lifecycle (CRUD, run, approve, reject, pipeline)
│   │   ├── chat/           Supervisor chat (streaming + status)
│   │   ├── workspace/      Workspace init, browse, blueprint
│   │   ├── benchmarks/     Model performance tracking
│   │   └── events/         SSE real-time event stream
│   ├── tasks/[id]/         Task detail page (pipeline view, diff, terminal)
│   └── setup/              Workspace selector with directory browser
├── components/             React components (shadcn/ui, dark mode)
│   ├── pipeline-view.tsx   Real-time pipeline stage visualization
│   ├── chat-input.tsx      Streaming chat with supervisor
│   └── ...
└── lib/
    ├── pipeline/           Pipeline automation engine
    │   ├── orchestrator.ts ★ Core: runs tasks through quality gates
    │   ├── gates.ts        Quality gate implementations (lint/build/test)
    │   └── model-router.ts Benchmark-driven model selection
    ├── runtime/            Pluggable agent runtimes
    │   ├── types.ts        AgentRuntime interface
    │   ├── claude.ts       Claude Code SDK implementation
    │   └── codex.ts        Codex CLI implementation
    ├── blueprint.ts        Workspace scanning + checkpoint system
    ├── scheduler.ts        Task DB + lifecycle (SQLite)
    ├── executor.ts         Orchestrator: worktree → runtime → pipeline
    ├── supervisor.ts       Chat supervisor (streaming, session pool)
    └── worktree.ts         Git worktree isolation
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | shadcn/ui + Tailwind CSS v4 + Geist fonts |
| Database | SQLite (better-sqlite3, zero config) |
| Agent Runtime | Claude Code SDK, Codex CLI (pluggable) |
| Real-time | Server-Sent Events (SSE) |
| Isolation | Git worktrees (one branch per task) |

## Pipeline Stages

Every task automatically flows through:

| Stage | What it does | Model |
|-------|-------------|-------|
| **code** | Agent implements the task in isolated worktree | sonnet |
| **lint** | Auto-detects project type (Node/Go), runs linter | machine |
| **build** | Runs build command | machine |
| **test** | Runs test suite | machine |
| **review** | Spec ↔ output consistency check | opus |
| **integrate** | Merge verification (build + test on merged code) | machine |

Gates detect project type automatically — Node.js (`npm run lint/build/test`), Go (`go vet/build/test`), or skip if not applicable.

## Workspace Management

```
/setup → Browse directories → Select project
         ↓
     Blueprint scan:
     - Project type (Node/Go/mixed/unknown)
     - Config files, dependencies, scripts
     - Git state (branch, commit, dirty files)
     - Progress checkpoint
         ↓
     Tasks scoped to workspace
     Chat history isolated per workspace
     Supervisor context includes blueprint
```

## Configuration

Create `hive.yaml` in the project root (optional — defaults are sensible):

```yaml
repo: .
agents:
  claude:
    command: claude
    max_concurrent: 3
  codex:
    command: codex
    max_concurrent: 2

supervisor:
  agent: claude
  model: opus

pipeline:
  max_repair_rounds: 3
  self_review_probability: 0.2
  gates: [lint, build, test, review, integrate]
  model_routing:
    default:
      design: opus
      code: sonnet
      review: opus
      repair: sonnet
```

## Design Philosophy

> Code is a byproduct of probabilistic generators. Constraints and tests are the real assets.

Based on three theoretical anchors:
- **Control Theory** (Wiener) — Tests are control signals, not just verification
- **Bounded Rationality** (Simon) — Don't expect perfect output; iterate fast with feedback
- **Stigmergy** — Agents coordinate through shared environment (git, DB), not direct messaging

Inspired by Toyota Production System: WIP limits, station-level QA, andon cords, takt time.

Full design document: [`docs/DESIGN.md`](docs/DESIGN.md)

## Status

Early development. The core pipeline works end-to-end:

- [x] Task creation via chat or API
- [x] Auto-dispatch to available agents
- [x] Git worktree isolation per task
- [x] Automated quality gates (lint → build → test → review → integrate)
- [x] Repair loop with fresh agents
- [x] Pipeline visualization (real-time)
- [x] Workspace management + blueprint scanning
- [x] Token-level streaming in chat
- [x] Model benchmarking infrastructure
- [ ] Design spec generation (Layer 1 decompose)
- [ ] Cross-review rounds
- [ ] Benchmark-driven model routing (data collection phase)
- [ ] Task dependency visualization
- [ ] Workspace config persistence to YAML

## License

MIT
