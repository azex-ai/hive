import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface DiffViewerProps {
  diff: string;
}

export function DiffViewer({ diff }: DiffViewerProps) {
  if (!diff) {
    return (
      <div className="flex items-center justify-center h-32 border border-dashed border-border rounded-lg">
        <p className="text-sm text-muted-foreground font-mono">no diff available</p>
      </div>
    );
  }

  const lines = diff.split("\n");

  return (
    <ScrollArea className="h-full max-h-[500px] w-full rounded-lg border border-border bg-zinc-950">
      <pre className="p-4 text-xs font-mono leading-relaxed overflow-x-auto">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "px-2 -mx-2",
              line.startsWith("+") && !line.startsWith("+++")
                ? "bg-emerald-950/60 text-emerald-300"
                : line.startsWith("-") && !line.startsWith("---")
                ? "bg-red-950/60 text-red-300"
                : line.startsWith("@@")
                ? "text-blue-400"
                : line.startsWith("diff ") || line.startsWith("index ")
                ? "text-zinc-500"
                : "text-zinc-300"
            )}
          >
            {line || "\u00a0"}
          </div>
        ))}
      </pre>
    </ScrollArea>
  );
}
