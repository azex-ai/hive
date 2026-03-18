import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { ReviewReport, Severity, Verdict } from "@/lib/types";
import { cn } from "@/lib/utils";

const severityConfig: Record<Severity, { label: string; className: string }> = {
  critical: {
    label: "critical",
    className: "bg-red-900/60 text-red-300 border-red-700",
  },
  warning: {
    label: "warning",
    className: "bg-yellow-900/60 text-yellow-300 border-yellow-700",
  },
  nit: {
    label: "nit",
    className: "bg-zinc-700 text-zinc-400 border-zinc-600",
  },
};

const verdictConfig: Record<Verdict, { label: string; className: string }> = {
  pass: {
    label: "Pass",
    className: "text-emerald-400",
  },
  needs_fix: {
    label: "Needs Fix",
    className: "text-yellow-400",
  },
  needs_human: {
    label: "Needs Human",
    className: "text-orange-400",
  },
};

interface ReviewPanelProps {
  report: ReviewReport;
}

export function ReviewPanel({ report }: ReviewPanelProps) {
  const verdict = verdictConfig[report.verdict] ?? { label: report.verdict ?? "unknown", className: "text-zinc-400" };

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">
            reviewer:
          </span>
          <Badge
            variant="outline"
            className="text-xs font-mono bg-zinc-800 text-zinc-300 border-zinc-600"
          >
            {report.reviewer_agent}
          </Badge>
          <span className="text-xs font-mono text-muted-foreground">
            round {report.iteration}
          </span>
        </div>
        <span className={cn("text-sm font-mono font-semibold", verdict.className)}>
          {verdict.label}
        </span>
      </div>

      <Separator />

      {/* Findings */}
      {(!report.findings || report.findings.length === 0) ? (
        <div className="flex items-center justify-center h-20 border border-dashed border-border rounded-lg">
          <p className="text-sm text-muted-foreground font-mono">
            no findings
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {(report.findings ?? []).map((f) => {
            const sev = severityConfig[f.severity] ?? { label: f.severity ?? "unknown", className: "bg-zinc-700 text-zinc-400 border-zinc-600" };
            return (
              <div
                key={f.id}
                className="border border-border rounded-lg p-3 flex flex-col gap-1.5 bg-card"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0 font-mono", sev.className)}
                  >
                    {sev.label}
                  </Badge>
                  <span className="text-xs font-mono text-muted-foreground">
                    {f.file}
                    {f.line ? `:${f.line}` : ""}
                  </span>
                  {f.category && (
                    <span className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      {f.category}
                    </span>
                  )}
                </div>
                <p className="text-sm text-foreground">{f.description}</p>
                {f.suggest_fix && (
                  <p className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1.5 rounded">
                    fix: {f.suggest_fix}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
