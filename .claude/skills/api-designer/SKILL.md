---
name: api-designer
description: >
  REST API design for Hive-TS. Design Next.js Route Handler endpoints,
  ensure consistency across the API surface. Use when adding API routes,
  designing endpoints, or mentioning "API", "endpoint", "REST", "route".
---

# API Designer — Hive-TS

## Rules
1. **Route Handlers** in `src/app/api/` (Next.js 16 App Router)
2. **RESTful**: Resources as nouns, HTTP methods for actions
3. **Response format**: `{ data: T }` for success, `{ error: string }` for failure
4. **No auth** — single-user local tool, no session/token needed
5. **Naming**: kebab-case URLs, camelCase JSON fields

## Endpoint Pattern
```
GET    /api/tasks              # List all tasks
POST   /api/tasks              # Create task(s)
GET    /api/tasks/[id]         # Get task detail
POST   /api/tasks/[id]/run     # Execute task
POST   /api/tasks/[id]/approve # Approve task
POST   /api/tasks/[id]/reject  # Reject task
GET    /api/tasks/[id]/files   # List output files
GET    /api/tasks/[id]/stream  # SSE stream for task
GET    /api/tasks/[id]/log     # Get task log
GET    /api/tasks/[id]/diff    # Get task diff
```

## Route Handler Template
```tsx
import { NextRequest, NextResponse } from "next/server";

// GET — no body
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;  // MUST await in Next.js 16
  // ... query SQLite
  return NextResponse.json({ data: result });
}

// POST — with body
export async function POST(req: NextRequest) {
  const body = await req.json();
  // ... validate + process
  return NextResponse.json({ data: result }, { status: 201 });
}
```

## SSE Pattern
```tsx
export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      // subscribe to events...
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

## Checklist
- [ ] Route file at correct path in `src/app/api/`
- [ ] `params` awaited (Next.js 16 requirement)
- [ ] Returns `{ data }` or `{ error }` consistently
- [ ] Error responses include proper HTTP status codes
- [ ] SQLite queries use parameterized `?` placeholders
