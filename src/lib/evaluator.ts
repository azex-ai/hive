import "server-only";
import { execFileSync } from "child_process";
import type { ReviewReport } from "./types";
import { extractJSON } from "./json-extract";

export interface GateResult {
  passed: boolean;
  results: Record<string, { passed: boolean; output: string }>;
}

export function autoGate(workdir: string, checks: string[]): GateResult {
  const gate: GateResult = { passed: true, results: {} };

  for (const check of checks) {
    try {
      const parts = check.split(/\s+/);
      const output = execFileSync(parts[0], parts.slice(1), {
        cwd: workdir || undefined,
        encoding: "utf-8",
        timeout: 60000,
        stdio: ["pipe", "pipe", "pipe"],
      });
      gate.results[check] = { passed: true, output };
    } catch (err: any) {
      gate.passed = false;
      gate.results[check] = { passed: false, output: err.stdout || err.message };
    }
  }

  return gate;
}

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
