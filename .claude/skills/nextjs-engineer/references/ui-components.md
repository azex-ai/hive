# UI Components & Design — Deep Reference

> Parent: `nextjs-engineer/SKILL.md`. Read when building UI, designing components, or reviewing frontend.

## shadcn/ui — Installed Components

Badge, Button, Card, Input, ScrollArea, Separator, Tabs, Textarea

Add more: `npx shadcn@latest add <component>`

## Theming (CSS Variables)

Defined in `src/app/globals.css`. OKLCH format (shadcn v4). **Dark-only app.**

| Group | Variables |
|-------|-----------|
| Surface | `--background`, `--foreground`, `--card`, `--popover` |
| Brand | `--primary`, `--secondary`, `--accent`, `--muted` |
| State | `--destructive` |
| Chrome | `--border`, `--input`, `--ring` |
| Charts | `--chart-1` through `--chart-5` |
| Sidebar | `--sidebar-*` family |
| Shape | `--radius` |

## Full shadcn Catalog (by Category)

**Layout:** Sidebar, NavigationMenu, Tabs, ScrollArea, Separator, ResizablePanelGroup

**Overlay:** Dialog, AlertDialog, Sheet, Drawer, Popover, Tooltip, DropdownMenu

**Form:** Form+FormField, Input, Textarea, Select, Checkbox, RadioGroup, Switch, Toggle

**Display:** Card, Badge, Avatar, Skeleton, Table, Accordion, Collapsible

**Feedback:** Alert, Progress, Sonner (toast)

**Utility:** Command (cmdk palette), Calendar, Label, Pagination

## Status Badge Configs

```tsx
export const taskStatusConfig = {
  pending: { label: "Pending", variant: "outline" as const },
  claimed: { label: "Claimed", variant: "secondary" as const },
  running: { label: "Running", variant: "default" as const },
  done: { label: "Done", variant: "default" as const },
  reviewing: { label: "Reviewing", variant: "secondary" as const },
  evaluated: { label: "Evaluated", variant: "default" as const },
  failed: { label: "Failed", variant: "destructive" as const },
} as const
```

## Responsive Breakpoints

| Breakpoint | Use |
|------------|-----|
| `sm` (640px) | Stack → inline |
| `md` (768px) | Collapse panels |
| `lg` (1024px) | Full layout |

## Review Checklist

- [ ] Dark mode appearance correct
- [ ] All 4 UI states handled (loading, empty, error, success)
- [ ] Accessibility: labels, focus, keyboard
- [ ] Uses `cn()` for conditional classes
- [ ] Geist Mono for code/IDs/timestamps
