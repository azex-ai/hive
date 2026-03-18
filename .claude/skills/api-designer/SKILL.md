---
name: api-designer
description: >
  REST API design for Armatrix. Design endpoints, write OpenAPI specs, ensure
  consistency between Go backend and Next.js frontend. Use when adding API routes,
  designing endpoints, or mentioning "API", "endpoint", "OpenAPI", "REST", "route".
---

# API Designer

## Rules
1. **Contract-first**: Define in `api/openapi.yaml` before implementing
2. **RESTful**: Resources as nouns, HTTP methods for actions
3. **Company-scoped**: All business endpoints require company_id from auth
4. **Response format**: `{ code: int, message: string, data: any }`
5. **Pagination**: `?page=1&size=20` → `{ total, items }`
6. **Naming**: kebab-case URLs, camelCase JSON fields

## Endpoint Pattern
```
GET    /api/companies/:id/goals         # List
POST   /api/companies/:id/goals         # Create
GET    /api/companies/:id/goals/:goalId # Get
PATCH  /api/companies/:id/goals/:goalId # Update
DELETE /api/companies/:id/goals/:goalId # Delete
```

## Checklist
- [ ] Existing patterns in `server/internal/handler/`
- [ ] Types match between OpenAPI and sqlc-generated Go
- [ ] Frontend stubs in `web/lib/db/queries.ts` will map cleanly
- [ ] WebSocket for real-time (agent status, chat streaming)
