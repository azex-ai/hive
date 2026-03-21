import "server-only";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import type { GateResult, GateEvidence, GateFinding, PipelineStage } from "../types";

export interface GateContext {
  workdir: string;
  baseBranch: string;
}

export interface QualityGate {
  readonly name: PipelineStage;
  check(ctx: GateContext): GateResult;
}

const MAX_OUTPUT = 10240; // 10KB

/** Run a shell command and capture evidence */
function runCommand(command: string, args: string[], cwd: string, timeoutMs = 60000): GateEvidence {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: "utf-8",
      timeout: timeoutMs,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const truncated = stdout.length > MAX_OUTPUT;
    return {
      command: `${command} ${args.join(" ")}`,
      exitCode: 0,
      stdout: truncated ? stdout.slice(-MAX_OUTPUT) : stdout,
      stderr: "",
      truncated,
    };
  } catch (err: unknown) {
    const execErr = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    const stdout = (execErr.stdout ?? "").toString();
    const stderr = (execErr.stderr ?? "").toString();
    return {
      command: `${command} ${args.join(" ")}`,
      exitCode: execErr.status ?? 1,
      stdout: stdout.length > MAX_OUTPUT ? stdout.slice(-MAX_OUTPUT) : stdout,
      stderr: stderr.length > MAX_OUTPUT ? stderr.slice(-MAX_OUTPUT) : stderr,
      truncated: stdout.length > MAX_OUTPUT || stderr.length > MAX_OUTPUT,
    };
  }
}

/** Detect which lint command to use based on package.json scripts */
function detectLintCommand(workdir: string): { cmd: string; args: string[] } | null {
  const pkg = path.join(workdir, "package.json");
  if (!fs.existsSync(pkg)) return null;
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkg, "utf-8")) as { scripts?: Record<string, string> };
    if (pkgJson.scripts?.lint) return { cmd: "npm", args: ["run", "lint"] };
    if (pkgJson.scripts?.typecheck) return { cmd: "npm", args: ["run", "typecheck"] };
  } catch { /* invalid package.json */ }
  return { cmd: "npx", args: ["tsc", "--noEmit"] };
}

/** Detect test command */
function detectTestCommand(workdir: string): { cmd: string; args: string[] } | null {
  const pkg = path.join(workdir, "package.json");
  if (!fs.existsSync(pkg)) return null;
  try {
    const pkgJson = JSON.parse(fs.readFileSync(pkg, "utf-8")) as { scripts?: Record<string, string> };
    if (pkgJson.scripts?.test) return { cmd: "npm", args: ["run", "test"] };
  } catch { /* invalid package.json */ }
  return null;
}

/** Parse lint/build output into findings */
function parseFindings(output: string): GateFinding[] {
  const findings: GateFinding[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(.+?):(\d+):\d*\s*(error|warning|Error|Warning)[:\s]+(.+)/);
    if (match) {
      findings.push({
        severity: match[3].toLowerCase().startsWith("error") ? "critical" : "warning",
        file: match[1],
        line: parseInt(match[2], 10),
        message: match[4].trim(),
      });
    }
  }
  return findings;
}

// --- Built-in Gates ---

class LintGate implements QualityGate {
  readonly name = "lint" as const;
  check(ctx: GateContext): GateResult {
    const start = Date.now();
    const cmd = detectLintCommand(ctx.workdir);
    if (!cmd) {
      return { passed: true, verdict: "pass", evidence: [], findings: [], durationMs: Date.now() - start };
    }
    const ev = runCommand(cmd.cmd, cmd.args, ctx.workdir);
    const findings = ev.exitCode !== 0 ? parseFindings(ev.stdout + "\n" + ev.stderr) : [];
    return {
      passed: ev.exitCode === 0,
      verdict: ev.exitCode === 0 ? "pass" : "fail",
      evidence: [ev],
      findings,
      durationMs: Date.now() - start,
    };
  }
}

class BuildGate implements QualityGate {
  readonly name = "build" as const;
  check(ctx: GateContext): GateResult {
    const start = Date.now();
    const ev = runCommand("npm", ["run", "build"], ctx.workdir, 120000);
    const findings = ev.exitCode !== 0 ? parseFindings(ev.stdout + "\n" + ev.stderr) : [];
    return {
      passed: ev.exitCode === 0,
      verdict: ev.exitCode === 0 ? "pass" : "fail",
      evidence: [ev],
      findings,
      durationMs: Date.now() - start,
    };
  }
}

class TestGate implements QualityGate {
  readonly name = "test" as const;
  check(ctx: GateContext): GateResult {
    const start = Date.now();
    const cmd = detectTestCommand(ctx.workdir);
    if (!cmd) {
      return { passed: true, verdict: "pass", evidence: [], findings: [], durationMs: Date.now() - start };
    }
    const ev = runCommand(cmd.cmd, cmd.args, ctx.workdir, 300000);
    const findings = ev.exitCode !== 0 ? parseFindings(ev.stdout + "\n" + ev.stderr) : [];
    return {
      passed: ev.exitCode === 0,
      verdict: ev.exitCode === 0 ? "pass" : "fail",
      evidence: [ev],
      findings,
      durationMs: Date.now() - start,
    };
  }
}

// --- Registry ---

const gateRegistry: Record<string, QualityGate> = {
  lint: new LintGate(),
  build: new BuildGate(),
  test: new TestGate(),
};

export function getGate(name: string): QualityGate | null {
  return gateRegistry[name] ?? null;
}

export function runGate(name: string, ctx: GateContext): GateResult {
  const gate = getGate(name);
  if (!gate) {
    return { passed: true, verdict: "pass", evidence: [], findings: [], durationMs: 0 };
  }
  return gate.check(ctx);
}

export { runCommand, parseFindings };
