# React Composition Patterns

> Parent: `nextjs-engineer/SKILL.md`. Read when refactoring components or designing component APIs.

## 1. Avoid Boolean Props → Use Composition

```tsx
// BAD
<Card isCompact isHighlighted showBorder />

// GOOD
<Card variant="compact" className="border ring-2">
  <CardContent>{children}</CardContent>
</Card>
```

## 2. Compound Components

```tsx
function Tabs({ children, defaultValue }) {
  const [active, setActive] = useState(defaultValue)
  return <TabsContext value={{ active, setActive }}>{children}</TabsContext>
}
```

## 3. Explicit Variants Over Booleans

```tsx
// GOOD — shadcn pattern
<Button variant="default" size="lg" disabled />
```

## 4. Children Over Render Props

```tsx
// GOOD
<List>
  {items.map(item => <ItemCard key={item.id} item={item} />)}
</List>
```

## 5. React 19 APIs

- **No `forwardRef`** — ref is a regular prop:
  ```tsx
  function Input({ ref, ...props }) {
    return <input ref={ref} {...props} />
  }
  ```

- **`use()` instead of `useContext()`**:
  ```tsx
  const value = use(MyContext)
  ```
