import { execSync } from "child_process";
import type { ReviewReport, Finding } from "./types";

export interface GateResult {
  passed: boolean;
  results: Record<string, { passed: boolean; output: string }>;
}

export function autoGate(workdir: string, checks: string[]): GateResult {
  const gate: GateResult = { passed: true, results: {} };

  for (const check of checks) {
    try {
      const output = execSync(check, {
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
  const start = output.indexOf("{");
  if (start === -1) return null;

  // Find matching closing brace
  let depth = 0;
  let end = -1;
  let inString = false;
  let escaped = false;

  for (let i = start; i < output.length; i++) {
    const ch = output[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return null;

  try {
    return JSON.parse(output.slice(start, end + 1)) as ReviewReport;
  } catch {
    return null;
  }
}
