# Data Fetching & Caching Patterns

> Parent: `nextjs-engineer/SKILL.md`. Read when building new pages, adding API calls, optimizing page load performance, or debugging slow navigation.

## Core Principle

**Server components do NOT fetch data. React Query owns all data fetching and caching client-side.**

This is a deliberate architectural choice for Armatrix:
- Go backend is on Fly.io (Singapore), Vercel functions may run elsewhere
- SSR data fetching adds network round-trips that block page render
- React Query provides instant cache-based rendering on revisits
- Middleware must never make network calls — only check cookie existence

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  page.tsx    │────▶│ Client Comp  │────▶│ React Query │
│ (sync, thin) │     │ (useQuery)   │     │   Cache     │
└─────────────┘     └──────┬───────┘     └──────┬──────┘
                           │ fetch                │ cache hit
                    ┌──────▼───────┐     ┌──────▼──────┐
                    │ /api/proxy/* │     │ Instant     │
                    │ (auth fwd)   │     │ Render      │
                    └──────┬───────┘     └─────────────┘
                    ┌──────▼───────┐
                    │ Go Backend   │
                    │ (Fly.io)     │
                    └──────────────┘
```

**Data flow:**
- Browser → `/api/proxy/*` → Go backend (client-side, with cookie → Authorization header)
- React Query caches response → instant on revisit

## Page Structure (MANDATORY)

### List pages (e.g. /skills, /workspaces, /board)

```tsx
// page.tsx — MUST be synchronous, no async, no data fetching
import { SkillsPageClient } from "./_components/skills-page-client";

export default function SkillsPage() {
  return <SkillsPageClient />;
}
```

```tsx
// _components/skills-page-client.tsx
"use client";

import { useSkills } from "@/lib/queries/skills";

export function SkillsPageClient() {
  const { data: skills = [] } = useSkills();
  // render with skills...
}
```

### Detail pages (e.g. /workspaces/[id], /agents/[id])

```tsx
// page.tsx — MUST be synchronous, use useParams in client component
import { WorkspaceDetailClient } from "./_components/workspace-detail-client";

export default function WorkspaceDetailPage() {
  return <WorkspaceDetailClient />;
}
```

```tsx
// _components/workspace-detail-client.tsx
"use client";

import { useParams } from "next/navigation";
import { useWorkspace } from "@/lib/queries/workspaces";

export function WorkspaceDetailClient() {
  const { id } = useParams<{ id: string }>();
  const { data: workspace, isLoading } = useWorkspace(id);

  if (isLoading || !workspace) return <SkeletonUI />;
  // render with workspace...
}
```

## Anti-Patterns (NEVER DO)

### 1. Async page.tsx with data fetching

```tsx
// WRONG — blocks render, no client cache, shows loading.tsx every navigation
export default async function Page({ params }) {
  const { id } = await params;
  const data = await apiGet(`/api/workspaces/${id}`); // SSR fetch
  return <ClientComponent data={data} />;
}
```

### 2. Async page.tsx with await params (for detail pages)

```tsx
// WRONG — await triggers Suspense/loading.tsx even without data fetching
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientComponent id={id} />;
}

// RIGHT — synchronous page, useParams in client
export default function Page() {
  return <ClientComponent />;
}
```

### 3. Remote validation in middleware

```tsx
// WRONG — network round-trip on every navigation
async function validateSession(token: string) {
  const res = await fetch(`${GO_API}/api/auth/me`, { ... });
  return res.ok;
}

// RIGHT — cookie existence check only, Go backend validates on API calls
const sessionToken = request.cookies.get("armatrix_session")?.value;
if (!sessionToken) return redirect("/login");
```

### 4. Hardcoded user IDs in API calls

```tsx
// WRONG — security violation, bypasses auth context
const res = await apiGet(`/api/board?user_id=1`);

// RIGHT — Go backend reads user_id from session token (Authorization header)
const res = await apiGet("/api/board");
```

### 5. Passing initialData from SSR to client

```tsx
// WRONG — SSR still fetches, React Query cache gets overwritten each navigation
export default async function Page() {
  const data = await fetchData(); // SSR
  return <Client initialData={data} />;
}

// RIGHT — no SSR fetch, React Query fetches + caches client-side
export default function Page() {
  return <Client />;
}
```

## React Query Setup

### QueryProvider

```tsx
// components/query-provider.tsx
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,          // 1 min — data considered fresh
      gcTime: 5 * 60_000,         // 5 min — cache retained after unmount
      retry: 1,
      refetchOnWindowFocus: true,  // background refresh on tab focus
    },
  },
})
```

### Query Hooks (`lib/queries/`)

```
lib/queries/
├── keys.ts          Centralized query key factory
├── agents.ts        useAgents, useAgent, useRuns, useDailyUsage
├── board.ts         useBoardOverview
├── brief.ts         useBrief
├── skills.ts        useSkills, useSkillBySlug, useSkillSearch
├── workspaces.ts    useWorkspaces, useWorkspace
└── routines.ts      useRoutines
```

### Hook Pattern

```tsx
// lib/queries/workspaces.ts
import { useQuery } from "@tanstack/react-query";
import { listWorkspaces } from "@/lib/api/workspaces";
import { queryKeys } from "./keys";

export function useWorkspaces(status?: string) {
  return useQuery({
    queryKey: queryKeys.workspaces.list(status),
    queryFn: () => listWorkspaces(status),
  });
}
```

### Query Key Convention

```tsx
// lib/queries/keys.ts
export const queryKeys = {
  workspaces: {
    all: ["workspaces"] as const,
    list: (status?: string) => [...queryKeys.workspaces.all, "list", status] as const,
    detail: (id: string) => [...queryKeys.workspaces.all, "detail", id] as const,
  },
  // ... same pattern for agents, skills, board, etc.
};
```

## API Client Architecture

### Dual routing (server vs browser)

```tsx
// lib/api/client.ts
function getApiBase(): string {
  if (typeof window === "undefined") return GO_API_BASE;  // SSR: direct
  return "";                                               // Browser: proxy
}

function proxyPath(path: string): string {
  if (typeof window === "undefined") return path;
  return path.replace(/^\/api\//, "/api/proxy/");  // /api/skills → /api/proxy/skills
}
```

### Auth header injection

- **Server-side**: `buildHeaders()` reads cookie via `import("next/headers")` → `Authorization: Bearer`
- **Client-side**: `credentials: "include"` sends cookie to `/api/proxy/*` → proxy forwards as `Authorization`
- **Proxy route** (`app/api/proxy/[...path]/route.ts`): reads cookie, adds `Authorization` header, forwards to Go

### API module pattern

```tsx
// lib/api/workspaces.ts — NO user_id params, backend reads from session
export async function listWorkspaces(status?: string): Promise<Workspace[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  const qs = params.toString();
  const res = await apiGet<{ items: Workspace[] }>(`/api/workspaces${qs ? `?${qs}` : ""}`);
  return res.items ?? [];
}
```

## Caching Behavior

| Scenario | What happens |
|----------|-------------|
| First visit to /skills | Skeleton → React Query fetches via proxy → render |
| Navigate to /board, then back to /skills (within 60s) | **Instant render from cache**, no skeleton, no fetch |
| Back to /skills after 60s | Instant render from stale cache + background refetch |
| Back to /skills after 5min | Cache garbage collected, skeleton → fresh fetch |
| Window loses and regains focus | Background refetch, UI updates silently |
| Mutation (create/delete) | `queryClient.invalidateQueries()` → refetch affected queries |

## Optimistic Updates (Board DnD example)

```tsx
// Established pattern in board-page-client.tsx
const handleDragEnd = async (event) => {
  // 1. Optimistic: update local state + React Query cache immediately
  const nextColumns = { ...columns, [destCol]: [...columns[destCol], movedTask] };
  setColumns(nextColumns);
  queryClient.setQueryData(queryKeys.board.overview(), nextColumns);

  try {
    // 2. Persist to backend
    await updateTaskStatus(taskId, newStatus);
  } catch {
    // 3. Revert on failure
    setColumns(prevColumns);
    queryClient.setQueryData(queryKeys.board.overview(), prevColumns);
  }
};
```

## Loading States

Every route should have `loading.tsx` with `<Skeleton>` matching the page layout. These show on:
- Hard refresh / first visit (before JS hydrates)
- Slow network before React Query returns

They should NOT show on:
- Sidebar navigation between cached pages (page.tsx must be synchronous)
- Revisiting a page within cache window (60s staleTime / 5min gcTime)

## Checklist for New Pages

1. `page.tsx` is **synchronous** (no `async`, no `await`, no API imports)
2. Page renders a single `"use client"` wrapper component
3. Client component uses `useQuery` hook from `lib/queries/`
4. Detail pages use `useParams()` — never `await params` in page.tsx
5. Query hook exists in `lib/queries/` with proper key from `keys.ts`
6. API function exists in `lib/api/` with no hardcoded user_id
7. `loading.tsx` exists with skeleton matching page layout
8. Loading state handled: `if (isLoading) return <Skeleton />`
9. Empty state handled: `if (data.length === 0) return <EmptyState />`
