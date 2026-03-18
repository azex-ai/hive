# React Composition Patterns

> Parent: `nextjs-engineer/SKILL.md`. Read when refactoring components with boolean prop proliferation, building flexible APIs, or designing compound components.

Source: Vercel composition patterns guide.

## When to Apply

- Refactoring components with many boolean props
- Building reusable component libraries
- Designing flexible component APIs
- Reviewing component architecture

## 1. Avoid Boolean Props (HIGH)

Don't add boolean props to customize behavior — use composition instead.

```tsx
// BAD — boolean proliferation
<Card isCompact isHighlighted showBorder hasAvatar />

// GOOD — composition
<Card variant="compact" className="border ring-2">
  <CardAvatar src={user.avatar} />
  <CardContent>{children}</CardContent>
</Card>
```

## 2. Compound Components (HIGH)

Structure complex components with shared context:

```tsx
// Parent provides context
function Tabs({ children, defaultValue }) {
  const [active, setActive] = useState(defaultValue)
  return (
    <TabsContext value={{ active, setActive }}>
      {children}
    </TabsContext>
  )
}

// Children consume context
function TabsTrigger({ value, children }) {
  const { active, setActive } = use(TabsContext)
  return (
    <button onClick={() => setActive(value)} data-active={active === value}>
      {children}
    </button>
  )
}

// Usage — flexible, composable
<Tabs defaultValue="tab1">
  <TabsList>
    <TabsTrigger value="tab1">First</TabsTrigger>
    <TabsTrigger value="tab2">Second</TabsTrigger>
  </TabsList>
  <TabsContent value="tab1">Content 1</TabsContent>
</Tabs>
```

## 3. Decouple State Implementation (MEDIUM)

Provider is the only place that knows how state is managed:

```tsx
// Context interface — generic
interface ListContext<T> {
  items: T[]                    // state
  add: (item: T) => void       // actions
  remove: (id: string) => void
  isLoading: boolean            // meta
}

// Provider — implementation detail
function ListProvider({ children }) {
  const query = useQuery({ queryKey: ['items'], queryFn: fetchItems })
  const addMutation = useMutation({ mutationFn: addItem })

  return (
    <ListContext value={{
      items: query.data ?? [],
      add: addMutation.mutate,
      remove: removeMutation.mutate,
      isLoading: query.isLoading,
    }}>
      {children}
    </ListContext>
  )
}
```

Consumers don't know if state comes from useState, useReducer, TanStack Query, or Zustand.

## 4. Explicit Variants Over Boolean Modes (MEDIUM)

```tsx
// BAD
<Button primary large disabled />

// GOOD — shadcn pattern
<Button variant="default" size="lg" disabled />
```

Create explicit variant components for truly different behaviors:
```tsx
// Instead of <Dialog fullScreen={isMobile}>
// Use separate components
const ResponsiveDialog = isMobile ? Drawer : Dialog
```

## 5. Children Over Render Props (MEDIUM)

```tsx
// BAD — render prop
<List renderItem={(item) => <ItemCard item={item} />} />

// GOOD — children composition
<List>
  {items.map(item => <ItemCard key={item.id} item={item} />)}
</List>
```

## 6. React 19 APIs

- **No `forwardRef`** — ref is a regular prop in React 19:
  ```tsx
  function Input({ ref, ...props }) {
    return <input ref={ref} {...props} />
  }
  ```

- **`use()` instead of `useContext()`**:
  ```tsx
  const value = use(MyContext) // works in conditionals too
  ```
