# Go Concurrency — Rob Pike Patterns

> "Do not communicate by sharing memory; instead, share memory by communicating."

---

## Channel Fundamentals

```go
// Typed direction — always constrain at API boundaries
func producer() <-chan int      // receive-only to caller
func consumer(in <-chan int)    // cannot accidentally send

// Unbuffered: synchronizes. Buffered: decouples.
ch := make(chan int)       // default: unbuffered
ch := make(chan int, 100)  // buffered

// Sender closes, receiver ranges
go func() {
    defer close(out)
    for _, v := range items { out <- v }
}()
for v := range out { process(v) }
```

---

## Generator (returns channel)

```go
func generate(nums ...int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for _, n := range nums { out <- n }
    }()
    return out
}
```

---

## Pipeline (stages connected by channels)

```go
func sq(in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in { out <- n * n }
    }()
    return out
}
// sq(sq(generate(2, 3))) → 16, 81
```

---

## Fan-out / Fan-in

```go
// Fan-in: merge N channels into one
func merge(done <-chan struct{}, cs ...<-chan int) <-chan int {
    var wg sync.WaitGroup
    out := make(chan int)
    output := func(c <-chan int) {
        defer wg.Done()
        for n := range c {
            select {
            case out <- n:
            case <-done:
                return
            }
        }
    }
    wg.Add(len(cs))
    for _, c := range cs { go output(c) }
    go func() { wg.Wait(); close(out) }()
    return out
}
```

---

## Cancellation (done channel)

```go
done := make(chan struct{})
defer close(done) // broadcasts cancel to ALL goroutines

func sq(done <-chan struct{}, in <-chan int) <-chan int {
    out := make(chan int)
    go func() {
        defer close(out)
        for n := range in {
            select {
            case out <- n * n:
            case <-done:
                return
            }
        }
    }()
    return out
}
```

---

## Context (preferred for HTTP/RPC)

```go
// Always first param, never store in struct
func DoWork(ctx context.Context, ...) error {
    for _, item := range items {
        if err := ctx.Err(); err != nil { return err }
        process(item)
    }
    return nil
}

// Blocking ops
select {
case result := <-ch:
    return result, nil
case <-ctx.Done():
    return nil, ctx.Err()
}

ctx, cancel := context.WithTimeout(parent, 5*time.Second)
defer cancel()
```

---

## Select Patterns

```go
// Timeout per operation
select {
case s := <-ch:
    use(s)
case <-time.After(1 * time.Second):
    log.Println("timed out")
}

// Non-blocking
select {
case v := <-ch: use(v)
default:         // nothing ready
}
```

---

## Semaphore (limit concurrency)

```go
sem := make(chan struct{}, maxConcurrency)
for _, item := range items {
    sem <- struct{}{}
    go func(item Item) {
        defer func() { <-sem }()
        process(item)
    }(item)
}
```

---

## sync vs channels

| Situation | Use |
|-----------|-----|
| Protecting shared variable (counter, map) | `sync.Mutex` |
| Multiple readers, rare writers | `sync.RWMutex` |
| One-time initialization | `sync.Once` |
| Waiting for N goroutines | `sync.WaitGroup` |
| Transferring ownership of data | channel |
| Distributing work | channel |
| Signaling an event | channel (`close(done)`) |

---

## Goroutine Leak Prevention

Every goroutine must have a way to exit.

```go
// ❌ Leaks if caller returns early
go func() { out <- compute() }()

// ✅ Buffer 1: sender never blocks
out := make(chan int, 1)
go func() { out <- compute() }()

// ✅ done channel
go func() {
    select {
    case out <- compute():
    case <-done:
    }
}()
```

**Checklist**: for every `go func()`, answer: "What makes this goroutine stop?"

---

## Anti-Patterns

```go
// ❌ Closing from receiver (panics)
// ❌ Sending on closed channel (panics)
// ❌ Naked goroutine with no lifecycle
go backgroundWork()

// ❌ Loop variable capture
for _, v := range items {
    go func() { process(v) }()  // all see last v
}
// ✅ Pass as argument
for _, v := range items {
    go func(v Item) { process(v) }(v)
}
```

---

## Rob Pike's Google Search — Parallel + Timeout

```go
func Google(query string) (results []Result) {
    c := make(chan Result, 3)
    go func() { c <- Web(query) }()
    go func() { c <- Image(query) }()
    go func() { c <- Video(query) }()
    timeout := time.After(80 * time.Millisecond)
    for i := 0; i < 3; i++ {
        select {
        case result := <-c:
            results = append(results, result)
        case <-timeout:
            return
        }
    }
    return
}
```

> "Concurrency is about **structure**. Parallelism is about **execution**."

For bounded parallelism pipelines → see `references/pipelines.md`

---

## Bounded Semaphore Pattern

Used in `routine/runner.go` to limit concurrent routine executions. A buffered channel acts as a counting semaphore — goroutines block on send when all slots are taken.

```go
// Limit to N concurrent goroutines.
sem := make(chan struct{}, 3) // max 3 concurrent

for _, task := range tasks {
    sem <- struct{}{}        // acquire slot (blocks if full)
    go func(t Task) {
        defer func() { <-sem }() // release slot
        process(t)
    }(task)
}
```

Why this works:
- Buffered channel capacity = max concurrency
- `sem <- struct{}{}` blocks when buffer is full (all slots taken)
- `<-sem` in defer releases the slot even on panic
- Zero allocation per slot (`struct{}{}` is zero-size)

Use case: cron runner limiting concurrent routine executions to avoid overwhelming external APIs or database connections.

---

## errgroup (`golang.org/x/sync/errgroup`)

Parallel execution with first-error-wins semantics. Preferred over raw `sync.WaitGroup` when goroutines return errors.

```go
import "golang.org/x/sync/errgroup"

g, ctx := errgroup.WithContext(ctx)

for _, item := range items {
    g.Go(func() error {
        return process(ctx, item)
    })
}

if err := g.Wait(); err != nil {
    return err // first error from any goroutine
}
```

Key points:
- Context is cancelled when any goroutine returns an error — other goroutines should check `ctx.Err()` to exit early
- `Wait()` blocks until all goroutines finish, returns the first non-nil error
- Combine with semaphore for bounded parallel work: `g.SetLimit(5)`
- Unlike `sync.WaitGroup`, no manual `Add`/`Done` bookkeeping

Used in: `agent/loop.go`, `routine/feed_collector.go`

```go
// Bounded errgroup — max 5 concurrent goroutines
g, ctx := errgroup.WithContext(ctx)
g.SetLimit(5)

for _, item := range items {
    g.Go(func() error {
        return process(ctx, item)
    })
}
return g.Wait()
```
