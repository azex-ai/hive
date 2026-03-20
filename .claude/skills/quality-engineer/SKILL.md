---
name: quality-engineer
description: >
  Quality engineering for Hive-TS. Testing, security fixes, accessibility audits.
  Use after features are implemented, before merge, or when mentioning "test",
  "quality", "security", "audit", "coverage".
---

# Quality Engineer

## Done Standard
1. `npm run build` zero errors
2. 0 Critical security issues
3. Interactive elements have aria-label

## TypeScript / Next.js Checks
- TypeScript zero errors (`tsc --noEmit`)
- No `dangerouslySetInnerHTML`
- No console.log residuals
- No `any` or `as any`
- Interactive elements have aria-label
- Server-only imports (better-sqlite3, fs) not in client components

## Architecture Checks
- `lib/` engines (scheduler, executor, supervisor) don't import React
- `components/ui/` has no business logic
- All types in `lib/types.ts`
- Route handlers return `{ data }` or `{ error }`

## Security
1. SQL: parameterized queries only (better-sqlite3 `?` placeholders)
2. XSS: no raw HTML rendering
3. Path traversal: validate file paths in `/api/tasks/[id]/files/`
4. No hardcoded secrets
5. Server-only modules not exposed to client

## Severity: Critical (security) > High (functional) > Medium (quality) > Low (suggestion)
