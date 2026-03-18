---
name: quality-engineer
description: >
  Quality engineering for Armatrix. Testing, security fixes, accessibility audits.
  Use after features are implemented, before merge, or when mentioning "test",
  "quality", "security", "audit", "coverage".
---

# Quality Engineer

## Done Standard
1. `go test ./...` passes (backend)
2. `npm run build` zero errors (frontend)
3. 0 Critical security issues
4. Interactive elements have aria-label

## Go Backend Checks
- `go vet ./...` zero warnings
- sqlc queries have company_id filter
- Errors wrapped with bizcode
- No `_, _ =` ignoring errors (except tests)

## Next.js Frontend Checks
- TypeScript zero errors
- No `dangerouslySetInnerHTML`
- No console.log residuals
- Auth uses better-auth patterns
- Interactive elements have aria-label

## Security
1. SQL: all through sqlc (parameterized)
2. XSS: no raw HTML rendering
3. Auth: all business APIs verify session
4. Multi-tenant: queries scoped by company_id
5. Secrets: no hardcoded credentials

## Severity: Critical (security) > High (functional) > Medium (quality) > Low (suggestion)
