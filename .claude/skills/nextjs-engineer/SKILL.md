---
name: nextjs-engineer
description: >
  Next.js frontend development for Hive. Build pages, components, hooks,
  UI/UX design, accessibility, performance.
  Auto-activate when editing src/**/*.tsx files or discussing
  "frontend", "component", "page", "chat UI", "shadcn", "React",
  "UI", "design", "layout", "responsive", "dark mode", "theme",
  "accessibility", "a11y", "performance", "bundle", "LCP".
---

# Next.js Engineer — Hive-TS

Tech: Next.js 16 + shadcn/ui (base-nova) + Tailwind CSS v4 + Geist fonts

> **Deep-dive references** (read on demand, not always):
> - `references/ui-components.md` — shadcn catalog, theming, design patterns, status configs, responsive, review checklist
> - `references/composition-patterns.md` — React composition patterns (compound components, state lifting, React 19)

## Architecture Overview

```
src/
├── app/
│   ├── api/            Route Handlers (REST API)
│   │   ├── agents/     Agent registry + spawn
│   │   ├── chat/       Supervisor chat (Claude SDK)
│   │   ├── events/     SSE event stream
│   │   ├── tasks/      Task lifecycle (CRUD, approve, reject, run, stream)
│   │   ├── skills/     Skill CRUD
│   │   ├── workspace/  Workspace init + status
│   │   ├── status/     System status
│   │   ├── health/     Health check
│   │   └── shutdown/   Graceful shutdown
│   ├── tasks/          Task pages (board + detail)
│   ├── setup/          Setup wizard
│   └── layout.tsx      Root layout (Geist fonts, dark-only)
├── components/
│   ├── ui/             shadcn primitives (button, card, input, tabs...)
│   └── *.tsx           Business components (task-board, chat, panels)
└── lib/
    ├── agents.ts       Agent registry + spawn (Claude Code SDK, Codex via execa)
    ├── api.ts          REST API helpers
    ├── chat-store.ts   In-memory chat history
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

## Next.js 16 Constraints (MUST FOLLOW)

### params/searchParams are Promises
```tsx
// For pages that only pass params to a client component — keep synchronous
export default function Page() {
  return <ClientComponent />;  // Client reads useParams()
}

// For pages that MUST use params server-side (rare: metadata, redirects)
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
}
```

### Route Handler params (MUST await)
```tsx
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
}
```

### Server vs Client Components
- **Server Components by default** — zero client JS
- **`"use client"` only for**: event handlers, useState, useEffect, SSE listeners, forms
- Push `"use client"` boundaries as far down as possible
- **proxy.ts** replaces middleware.ts in Next.js 16 (Node.js runtime, not Edge)

### Async Request APIs (Next.js 16)
```tsx
const cookieStore = await cookies();
const headerList = await headers();
```

### Data Layer — SQLite (better-sqlite3)
- **Sync API** — no async/await needed for DB calls
- **Server-only** — NEVER import better-sqlite3 in client components
- File: `data/hive.db`
- All types in `lib/types.ts`

### Route Segment Files
Every route segment SHOULD have:
- `loading.tsx` — Suspense fallback (skeleton UI)
- `error.tsx` — Error boundary (MUST be `"use client"`)

### Server Actions vs Route Handlers
| Use Case | Use |
|----------|-----|
| Form mutations (CRUD) | **Server Action** (`'use server'`) |
| SSE streaming | **Route Handler** |
| Complex multi-step ops | **Route Handler** |
| Data fetching (server) | **Server Component** (direct SQLite) |
| Data fetching (client) | **fetch('/api/...')** |

### Turbopack (default in Next.js 16)
- Config is top-level in `next.config.ts`, NOT under `experimental.turbopack`
- Dynamic fs/path ops trigger NFT warnings — scope to specific subdirs

## Libraries (Approved Stack)

| Purpose | Library |
|---------|---------|
| UI primitives | shadcn/ui (base-nova) |
| Icons | lucide-react |
| Class composition | clsx + tailwind-merge (via `cn()`) |
| Fonts | Geist Sans + Geist Mono (next/font) |
| Animation | tw-animate-css |
| Database | better-sqlite3 (sync, server-only) |
| AI agents | @anthropic-ai/claude-code SDK |
| Process spawn | execa |
| Config | js-yaml |

## shadcn/ui Conventions

- Components in `components/ui/` — you own the code, edit freely
- Always use `cn()` from `lib/utils` for class composition
- Theming via CSS variables in `globals.css` (OKLCH in v4)
- **Dark mode only** — `className="dark"` on `<html>`, no light mode
- `asChild` prop for semantic element composition
- Install new components: `npx shadcn@latest add <component>`

## Code Style

- TypeScript strict — no `any`, no `as any`
- Use `cn()` for all conditional classes
- Named exports for components
- One component per file
- Errors: always show user feedback, never empty `catch {}`
- `"use client"` only when interactive

## Design Principles

1. **Dashboard-first**: Task board is primary interface
2. **shadcn/ui**: All components use shadcn primitives
3. **Dark mode only**: All components dark theme
4. **Monospace aesthetic**: Geist Mono for IDs, timestamps, terminal output, commands
5. **Dense information**: Show agent status, task progress, terminal output compactly
6. **Minimal noise**: Only show what users need

## Accessibility

- `aria-label` on icon-only buttons
- Heading hierarchy: h1 → h2 → h3 (never skip)
- Keyboard: Tab/Enter/Escape on all interactive elements
- Color contrast: ≥ 4.5:1 body text

## UI States (Every Component Must Handle)

| State | Pattern |
|-------|---------|
| **Loading** | `<Skeleton>` matching final layout shape |
| **Empty** | Centered icon + message + optional CTA |
| **Error** | Inline `<Alert variant="destructive">` or toast |
| **Success** | Toast or inline confirmation |
