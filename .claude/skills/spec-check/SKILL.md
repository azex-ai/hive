---
name: spec-check
description: Validate feature spec completeness before development starts. Ensures all mandatory fields exist and are filled. Use before Phase 1 of any feature.
---

# Spec Completeness Check

## Mandatory Spec Fields

Every feature spec MUST include:

```yaml
# Feature Spec Template
title: ""
priority: P0 | P1 | P2
owner: ""              # Which agent/person implements

# API
api_endpoints:         # List of new/modified endpoints
  - method: GET|POST|PATCH|DELETE
    path: /api/...
    description: ""

# Database
schema_changes:        # New tables, columns, indexes (SQLite)
  - table: ""
    change: add_table | add_column | add_index
    details: ""

# Frontend
ui_changes:            # Pages, components affected
  - route: /...
    component: ""
    description: ""

# Quality
a11y: ""               # Accessibility requirements
test_plan: ""          # What to test, coverage target

# Dependencies
depends_on: []         # Other features/phases this blocks on
blocked_by: []         # What must complete first
```

## Gate Rules

- **FAIL**: Any mandatory field is empty or missing
- **WARN**: `test_plan` is vague ("add tests" instead of specific scenarios)
- **WARN**: `api_endpoints` listed but no corresponding `schema_changes`
- **PASS**: All fields filled with specific, actionable content

## Usage

Before starting any Phase 1 work:
1. Write spec using template above
2. Run `/spec-check` to validate
3. Fix any FAIL/WARN items
4. Only then proceed to implementation

**Phase 0 gate**: spec-check must PASS before dev agents are spawned.
