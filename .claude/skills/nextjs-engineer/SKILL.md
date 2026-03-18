---
name: nextjs-engineer
description: >
  Next.js frontend development for Armatrix. Build pages, components, hooks,
  AI SDK integration, UI/UX design, accessibility, performance.
  Auto-activate when editing web/**/*.tsx files or discussing
  "frontend", "component", "page", "chat UI", "shadcn", "React",
  "UI", "design", "layout", "responsive", "dark mode", "theme",
  "accessibility", "a11y", "performance", "bundle", "LCP".
  Also handles browser annotations: "watch mode", "监听标注", "agentation",
  "处理标注", "check annotations", "看一下标注", "有没有标注".
---

# Next.js Engineer — Armatrix

Tech: Next.js 16 + AI SDK v6 + shadcn/ui + better-auth + Tailwind CSS v4

> **Deep-dive references** (read on demand, not always):
> - `references/data-fetching.md` — **CRITICAL**: Data fetching architecture, React Query patterns, caching, anti-patterns. Read before building any page.
> - `references/ui-components.md` — shadcn catalog, theming, design patterns, status configs, responsive, review checklist
> - `references/composition-patterns.md` — React composition patterns (compound components, state lifting, React 19)

## Architecture Overview

```
web/
├── app/
│   ├── (auth)/          Auth pages (login, register) + better-auth route handler
│   ├── (app)/           Authenticated app (layout with sidebar)
│   │   ├── chat/        AI chat with SSE streaming
│   │   ├── skills/      Skill management pages
│   │   ├── agents/      Agent dashboard + detail
│   │   ├── board/       Kanban task board
│   │   ├── settings/    Settings (connectors, providers)
│   │   └── api/         Route handlers (chat SSE proxy, auth proxy)
│   └── layout.tsx       Root layout (fonts, theme)
├── components/
│   ├── ui/              shadcn primitives (button, input, dialog...)
│   ├── generative-ui/   json-render catalog + components
│   └── [domain]/        Business components (flat → migrating to grouped)
├── lib/
│   ├── api/             Go API client modules (see Data Layer)
│   ├── db/              Type definitions (schema.ts) + legacy stubs (queries.ts)
│   ├── ai/              AI SDK config (providers, prompts)
│   ├── auth.ts          better-auth server
│   ├── auth-client.ts   better-auth client
│   ├── utils.ts         cn() + helpers
│   └── constants.ts     DEFAULT_COMPANY_ID, API_BASE
└── hooks/               Custom React hooks
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

### Server vs Client Components
- **Page.tsx: thin synchronous wrapper** — renders a client component, no data fetching
- **Client components: own all data** — React Query for fetching + caching
- **Server components: auth only** — layout reads session for sidebar/nav
- See `references/data-fetching.md` for full architecture

### Route Segment Files
Every route segment SHOULD have:
- `loading.tsx` — Suspense fallback (skeleton UI)
- `error.tsx` — Error boundary (MUST be `"use client"`)
- `not-found.tsx` — 404 UI (triggered by `notFound()`)

### Middleware (Edge Runtime)
- Runs on Edge — NO Node.js APIs, NO Go API calls, NO DB access
- Only for: cookie-based auth check + redirect
- Full session validation happens in layouts/pages

### Caching Rules
| Data type | Strategy |
|-----------|----------|
| User-specific (auth-gated) | `cache: 'no-store'` or `revalidate: 0` |
| Shared/public (skill catalog) | `next: { revalidate: 300, tags: ['skills'] }` |
| After mutations | `revalidateTag()` or `revalidatePath()` from Server Action |
| Dynamic pages (dashboard) | `export const dynamic = 'force-dynamic'` |

### Server Actions vs Route Handlers
| Use Case | Use |
|----------|-----|
| Form mutations (CRUD) | **Server Action** + `revalidateTag()` |
| SSE streaming (chat) | **Route Handler** |
| Auth callbacks | **Route Handler** (better-auth) |
| Data fetching | **Server Component** (direct fetch) |

## Auth (better-auth, NOT next-auth)

- Server: `import { auth } from "@/lib/auth"`
- Client: `import { authClient } from "@/lib/auth-client"`
- Get session (server): `auth.api.getSession({ headers: await headers() })` — `headers()` is async in Next.js 16
- Get session (client): `authClient.useSession()`
- No SessionProvider wrapper — better-auth uses nano-store internally
- Route handler: `app/(auth)/api/auth/[...all]/route.ts`
- Uses **custom pgx adapter** (not Drizzle/Prisma) — `npx @better-auth/cli migrate` does NOT apply
- Type session properly: `typeof auth.$Infer.Session` — NEVER use `as any`

## Data Layer

### API Client Architecture
All data flows through `lib/api/*.ts` → Go backend at `:8100`. NEVER bypass with raw `fetch("/api/proxy/...")`.

```
lib/api/
├── client.ts          Base fetch wrapper (API_BASE, error handling)
├── skills.ts          Skill CRUD + search + resolve
├── agents.ts          Agent list + detail
├── board.ts           Board tasks + claim + complete
├── connectors.ts      Connector list + credentials + OAuth
├── settings.ts        Provider config + model list
├── workspaces.ts      Workspace CRUD
├── templates.ts       Template list + match
├── routines.ts        Routine list + toggle
└── parse-go-sse.ts    SSE event parser for Go backend format
```

### Auth
- User ID comes from session token only — Go backend reads from auth context
- **No user_id in API calls** — removed, Go auth middleware handles it
- Session: HTTP-only cookie `armatrix_session`, validated server-side

### Type Definitions
`lib/db/schema.ts` — Pure TypeScript interfaces (NOT Drizzle/ORM schema):
AuthUser, Chat, DBMessage, Skill, Member, Run, RunTrace, DailyUsage, BoardTask,
Workspace, Connector, ConnectorConfig, Template, Routine

### Data Fetching (React Query v5)
**→ See `references/data-fetching.md` for full architecture, patterns, and anti-patterns.**

All data fetching uses TanStack Query hooks in `lib/queries/`:
```tsx
import { useQuery } from '@tanstack/react-query'
import { listMembers } from '@/lib/api/agents'
import { queryKeys } from './keys'

export function useAgents(params?: { type?: string }) {
  return useQuery({
    queryKey: queryKeys.agents.list(params),
    queryFn: () => listMembers(params),
    refetchInterval: 30_000,
  })
}
```

Cache: staleTime 60s, gcTime 5min, refetchOnWindowFocus.

## AI Chat Architecture

- **Go backend is the AI executor** — Anthropic SDK runs server-side in Go
- Next.js `app/(app)/api/chat/route.ts` is an SSE proxy to Go `POST /api/chat`
- AI SDK `useChat` on client reads the proxied SSE stream
- Vercel AI Gateway / ToolLoopAgent do NOT apply to this project
- Generative UI catalog: `components/generative-ui/catalog.ts`
  - Registered: `template-match` (TemplateMatchCard), `morning-brief` (MorningBrief)

## Libraries (Approved Stack)

| Purpose | Library | Notes |
|---------|---------|-------|
| Data fetching | `@tanstack/react-query` v5 | Mutations + cache invalidation + polling |
| Forms | `react-hook-form` + `zod` v4 | shadcn Form component built on this |
| Date/time | `date-fns` v4 | Tree-shakable, shadcn date picker standard |
| Cron display | `cronstrue` | Cron expression → human-readable |
| Toast | `sonner` | Official shadcn toast component |
| State (client) | `zustand` v5 | 1.16KB, for UI state (not server state) |
| Tables | `@tanstack/react-table` v8 | shadcn DataTable recipe |
| Animation | `motion` v12 | Use LazyMotion (~4.6KB) |
| Charts | `recharts` | shadcn Chart wrapper uses this |
| Markdown | `react-markdown` + `remark-gfm` + `rehype-pretty-code` | Shiki-backed |
| Virtualization | `@tanstack/react-virtual` v3 | For long lists (runs, traces) |
| Icons | `lucide-react` | |
| DnD | `@dnd-kit` | Kanban board |

## shadcn/ui Conventions

- Components live in `components/ui/` — you own the code, edit freely
- Always use `cn()` from `lib/utils` for class composition
- Theming via CSS variables in `globals.css` (OKLCH in v4)
- Dark mode: class-based (`.dark` on `<html>`)
- `asChild` prop for semantic element composition
- Form pattern: `Form` + `FormField` + `FormItem` + `FormControl` + `FormMessage` + `zodResolver`
- Chart pattern: `ChartContainer` + config + `--chart-1..5` CSS vars

## Component Organization (Target)

```
components/
├── ui/                  shadcn primitives
├── generative-ui/       json-render catalog + components
├── skills/              skill-card, skill-list, skill-detail, skill-upload-dialog
├── agents/              agent-status-card, create-agent-dialog, run-timeline, cost-panel, trace-events
├── board/               task-board, task-card, create-task-dialog, mini-board-summary
├── chat/                message, chat-header, chat-input, thought-chain
├── layout/              sidebar, workspace-panel, app-header
└── shared/              Reusable cross-domain components
```

## Shared Utilities (Extract to `lib/`)

| Module | Contents |
|--------|----------|
| `lib/format.ts` | `relativeTime()`, `truncateText()`, `cronToHuman()` |
| `lib/status-config.ts` | `statusColor()`, `skillStatusConfig`, `agentStatusConfig` |
| `lib/constants.ts` | `DEFAULT_COMPANY_ID`, `API_BASE`, `REFRESH_INTERVAL` |

## Code Style

- TypeScript strict mode — no `any`, no `as any`
- Use `cn()` for all conditional classes
- Prefer named exports for components
- One component per file (colocate types in same file if small)
- API calls only through `lib/api/*.ts` modules
- Errors: always show user feedback (Sonner toast), never empty `catch {}`

## Design Principles

1. **Chat-first**: Chat is primary interface, dashboard is secondary
2. **shadcn/ui**: All components use shadcn primitives (Radix + Tailwind)
3. **Generative UI**: Structured data renders inline via json-render catalog
4. **Mobile-first**: Chat full-screen on mobile, sidebar slides as Sheet
5. **Dark mode**: All components work in both themes (class-based `.dark`)
6. **Minimal noise**: Only show information users need; hide technical details

→ Full shadcn catalog, theming, patterns: `references/ui-components.md`

## Accessibility Essentials

- `aria-label` on icon-only buttons: `<Button size="icon" aria-label="Close"><X /></Button>`
- Heading hierarchy: h1 → h2 → h3 (never skip)
- Dialog/Modal: focus trap (Radix built-in), `aria-describedby`
- Keyboard: Tab/Enter/Escape navigation on all interactive elements
- Color contrast: ≥ 4.5:1 body text, ≥ 3:1 large text
- State changes: `aria-live="polite"` for dynamic content
- Dark mode: verify `text-muted-foreground` contrast, border visibility

## Performance Targets

- LCP < 2.5s, FID < 100ms, CLS < 0.1
- JS bundle < 200KB per route
- `next/dynamic` with `ssr: false` for: charts, DnD, anything using `window`
- `next/image` for user/external images; raw `<svg>` for icons
- `next/font` for fonts (zero layout shift)
- `<Suspense>` around individual async Server Components for streaming
- Lazy load heavy Client Components (code editor, Pyodide)
- Virtual scroll (`@tanstack/react-virtual`) for lists > 100 items

## Agentation — Browser Annotation Feedback

`<DevAgentation />` in root layout connects to agentation MCP (port 4747, dev only).
When user annotates UI in browser, process via MCP tools:

**One-shot** ("看一下标注" / "check annotations"):
1. `agentation_get_all_pending` → fix each → `agentation_resolve(id, summary)`

**Watch loop** ("watch mode" / "监听标注"):
1. Drain pending first
2. `agentation_watch_annotations` (timeout 300s, batch 15s)
3. Annotations arrive → acknowledge → locate via `sourceFile` or `reactComponents` → fix → resolve
4. Timeout → re-enter watch; user says "stop/停" → exit with summary

**Per annotation**: `acknowledge` → read code → minimal fix → `resolve`. If unclear, `agentation_reply` to ask, leave open. Never refactor surrounding code. Respect `severity` order: blocking > important > suggestion.

## UI States (Every Component Must Handle)

| State | Pattern |
|-------|---------|
| **Loading** | `<Skeleton>` matching final layout shape |
| **Empty** | Centered icon + message + optional CTA button |
| **Error** | `toast.error()` for actions; inline `<Alert variant="destructive">` for pages |
| **Success** | `toast.success()` for mutations |
| **Optimistic** | Immediate UI update, revert on failure |
