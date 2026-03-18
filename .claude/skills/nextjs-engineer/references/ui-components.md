# UI Components & Design — Deep Reference

> Parent: `nextjs-engineer/SKILL.md`. Read this when building UI, designing components, or reviewing frontend.

## shadcn/ui Component Library

### Theming (CSS Variables)

Defined in `web/app/globals.css` under `:root` (light) and `.dark`.
Color format: OKLCH (shadcn v4). Dark mode: class-based (`.dark` on `<html>`).

| Group | Variables |
|-------|-----------|
| Surface | `--background`, `--foreground`, `--card`, `--popover` |
| Brand | `--primary`, `--secondary`, `--accent`, `--muted` |
| State | `--destructive` |
| Chrome | `--border`, `--input`, `--ring` |
| Charts | `--chart-1` through `--chart-5` |
| Sidebar | `--sidebar`, `--sidebar-primary`, `--sidebar-accent` |
| Shape | `--radius` → derives `--radius-sm/md/lg/xl` |

Base layer (always in globals.css):
```css
@layer base {
  * { @apply border-border outline-ring/50; }
  body { @apply bg-background text-foreground; }
}
```

### Available Components (by Category)

**Layout & Navigation:**
- `Sidebar` (collapsible + SidebarProvider, SidebarTrigger, SidebarContent, SidebarMenu)
- `NavigationMenu`, `Menubar`, `Breadcrumb`
- `Tabs`, `ScrollArea`, `Separator`, `ResizablePanelGroup`

**Overlay & Modal:**
- `Dialog`, `AlertDialog`, `Sheet` (side drawer), `Drawer` (bottom sheet, Vaul)
- `Popover`, `HoverCard`, `Tooltip`
- `ContextMenu`, `DropdownMenu`

**Form & Input:**
- `Form` (react-hook-form wrapper) + `FormField` + `FormItem` + `FormControl` + `FormMessage`
- `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`
- `Slider`, `Toggle`, `ToggleGroup`
- `Combobox` (Command + Popover pattern), `DatePicker` (Calendar + Popover)
- `InputOTP`

**Display & Data:**
- `Card` (CardHeader, CardTitle, CardContent, CardFooter)
- `Badge`, `Avatar`, `Skeleton`
- `Table` + DataTable (TanStack Table v8 — sorting, filtering, pagination)
- `Chart` (Recharts wrapper — ChartContainer + ChartTooltip + ChartLegend)
- `Carousel` (Embla), `Accordion`, `Collapsible`

**Feedback:**
- `Alert`, `Progress`
- `Sonner` (toast — `toast.success()`, `toast.error()`, `toast.promise()`)

**Utility:**
- `Command` (cmdk — keyboard-first command palette)
- `Calendar`, `Label`, `AspectRatio`, `Pagination`

---

## Composition Patterns

**Form pattern (standard for all forms):**
```tsx
const schema = z.object({ email: z.string().email() })

const form = useForm<z.infer<typeof schema>>({
  resolver: zodResolver(schema),
  defaultValues: { email: "" },
})

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    <FormField control={form.control} name="email" render={({ field }) => (
      <FormItem>
        <FormLabel>Email</FormLabel>
        <FormControl><Input {...field} /></FormControl>
        <FormMessage />
      </FormItem>
    )} />
    <Button type="submit">Submit</Button>
  </form>
</Form>
```

**Combobox pattern (composed, no single component):**
```tsx
<Popover>
  <PopoverTrigger asChild><Button>Select...</Button></PopoverTrigger>
  <PopoverContent>
    <Command>
      <CommandInput />
      <CommandList>
        <CommandItem onSelect={setValue}>Option</CommandItem>
      </CommandList>
    </Command>
  </PopoverContent>
</Popover>
```

**DataTable pattern:**
1. Define `ColumnDef[]` with sorting/filtering
2. Pass to `useReactTable()`
3. Render with `Table`/`TableBody`/`TableRow`/`TableCell`
4. Add pagination, column visibility via TanStack Table APIs

**Chart pattern:**
```tsx
<ChartContainer config={{ series1: { color: "var(--chart-1)", label: "Revenue" } }}>
  <BarChart data={data}>
    <Bar dataKey="value" fill="var(--color-series1)" />
    <ChartTooltip />
  </BarChart>
</ChartContainer>
```

---

## Component Organization

```
web/components/
├── ui/                  shadcn primitives (NO business logic, NO API calls)
├── generative-ui/       json-render catalog + components
│   ├── catalog.ts       Type registry
│   ├── template-match-card.tsx
│   └── morning-brief.tsx
├── skills/              Skill domain components
├── agents/              Agent domain components
├── board/               Board/task domain components
├── chat/                Chat-specific components
├── layout/              Sidebar, workspace-panel, app-header
└── shared/              Cross-domain reusable (status badges, empty states, skeletons)
```

Rules:
- `ui/` = shadcn primitives only
- Domain folders = composed from `ui/` + business logic
- `shared/` = used by 2+ domains

---

## Status & Badge Configs

Centralize in `lib/status-config.ts`:

```tsx
export const skillStatusConfig = {
  unverified: { label: "Unverified", variant: "outline" },
  verified: { label: "Verified", variant: "default" },
  trusted: { label: "Trusted", variant: "success" },
} as const

export const agentStatusConfig = {
  idle: { color: "text-muted-foreground", bg: "bg-muted" },
  running: { color: "text-green-500", bg: "bg-green-500/10" },
  error: { color: "text-destructive", bg: "bg-destructive/10" },
  paused: { color: "text-amber-500", bg: "bg-amber-500/10" },
} as const

export const connectorStatusConfig = {
  active: { icon: "CheckCircle2", color: "text-green-500" },
  configured: { icon: "CheckCircle2", color: "text-green-500" },
  expired: { icon: "AlertCircle", color: "text-amber-500" },
  not_configured: { icon: "Circle", color: "text-muted-foreground" },
} as const
```

---

## Responsive Breakpoints

| Breakpoint | Use |
|------------|-----|
| `sm` (640px) | Stack → inline |
| `md` (768px) | Hide sidebar on mobile, show as Sheet |
| `lg` (1024px) | Full sidebar + content |
| `xl` (1280px) | Wide content area |

**Mobile patterns:**
- Sidebar → `<Sheet>` (slide from left)
- Tabs → horizontal scroll
- Tables → card view or horizontal scroll
- Dialogs → full-screen on mobile (`<Drawer>` on small, `<Dialog>` on desktop)

---

## Creative Design Guidelines

When building new pages or components, commit to a clear aesthetic direction:

- **Typography**: Distinctive font choices, not generic defaults. Pair display + body fonts.
- **Color**: Dominant colors with sharp accents. Use CSS variables for consistency.
- **Motion**: High-impact moments (page load reveals, hover states). CSS-only preferred, `motion` for React.
- **Spatial**: Asymmetry, overlap, generous negative space or controlled density.
- **Background**: Gradient meshes, noise textures, layered transparencies over flat solid colors.

Match implementation complexity to vision — maximalist needs elaborate code, minimalist needs precision.

---

## Registries & Extensions

- **v0 blocks**: `npx shadcn@latest add @v0/<block>` — pre-built dashboard, auth, settings layouts
- **Custom registry**: publish `registry.json` for shared components across projects
- **Magic UI**: animation components following shadcn conventions

---

## Review Checklist

- [ ] Responsive at sm/md/lg breakpoints
- [ ] Dark mode appearance correct
- [ ] Consistent spacing (Tailwind scale: 1, 1.5, 2, 3, 4, 6, 8)
- [ ] All 4 UI states handled (loading, empty, error, success)
- [ ] Accessibility: labels, focus, keyboard navigation
- [ ] Uses `cn()` for all conditional classes
- [ ] Status colors from shared config, not hardcoded
- [ ] Toast feedback for all user actions (never empty `catch {}`)
- [ ] No technical details exposed to end users (paths, IDs, cron expressions)
- [ ] Components in correct directory (ui/ vs domain/ vs shared/)
- [ ] Web Interface Guidelines: https://github.com/vercel-labs/web-interface-guidelines
