import "server-only";
import type { ReviewReport } from "./types";
import { extractJSON } from "./json-extract";

export function shouldAutoMerge(report: ReviewReport | null, threshold: number): boolean {
  if (!report) return false;
  let criticals = 0;
  let warnings = 0;
  for (const f of report.findings) {
    if (f.severity === "critical") criticals++;
    if (f.severity === "warning") warnings++;
  }
  return criticals === 0 && warnings <= threshold;
}

export function parseReviewReport(output: string): ReviewReport | null {
  const obj = extractJSON(output);
  return obj ? (obj as unknown as ReviewReport) : null;
}
