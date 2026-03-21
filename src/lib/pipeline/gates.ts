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

// --- Project Type Detection ---

type ProjectType = "node" | "go" | "unknown";

interface ProjectInfo {
  type: ProjectType;
  hasPackageJson: boolean;
  hasGoMod: boolean;
  scripts: Record<string, string>;
}

/** Detect project type from workdir contents */
function detectProject(workdir: string): ProjectInfo {
  const info: ProjectInfo = {
    type: "unknown",
    hasPackageJson: false,
    hasGoMod: false,
    scripts: {},
  };

  // Check for package.json (Node/TS)
  const pkgPath = path.join(workdir, "package.json");
  if (fs.existsSync(pkgPath)) {
    info.hasPackageJson = true;
    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
        scripts?: Record<string, string>;
      };
      info.scripts = pkgJson.scripts ?? {};
      info.type = "node";
    } catch {
      /* invalid package.json — still mark as node since file exists */
      info.type = "node";
    }
  }

  // Check for go.mod (Go)
  const goModPath = path.join(workdir, "go.mod");
  if (fs.existsSync(goModPath)) {
    info.hasGoMod = true;
    // If both exist, go.mod takes precedence only if no package.json
    if (!info.hasPackageJson) {
      info.type = "go";
    }
  }

  return info;
}

function skipResult(durationMs: number): GateResult {
  return { passed: true, verdict: "pass", evidence: [], findings: [], durationMs };
}

/** Check if Node.js deps are installed (node_modules exists) */
function hasNodeModules(workdir: string): boolean {
  return fs.existsSync(path.join(workdir, "node_modules"));
}

/** Check if Go toolchain is available */
function hasGoToolchain(): boolean {
  try {
    execFileSync("go", ["version"], { encoding: "utf-8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

// --- Command Runner ---

/** Run a shell command and capture evidence */
function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 60000,
): GateEvidence {
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
    const execErr = err as {
      status?: number;
      stdout?: string;
      stderr?: string;
      message?: string;
    };
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

// --- Findings Parser ---

/** Parse lint/build output into findings (works for both TS and Go output) */
function parseFindings(output: string): GateFinding[] {
  const findings: GateFinding[] = [];
  for (const line of output.split("\n")) {
    // TS/JS pattern: file.ts:42:10 - error TS2345: ...
    // Go pattern: ./file.go:42:10: error message
    const match = line.match(
      /^(.+?):(\d+):\d*\s*[-:]?\s*(error|warning|Error|Warning)[:\s]+(.+)/,
    );
    if (match) {
      findings.push({
        severity: match[3].toLowerCase().startsWith("error")
          ? "critical"
          : "warning",
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
    const proj = detectProject(ctx.workdir);

    if (proj.type === "node") {
      // Skip if deps not installed (worktree without node_modules)
      if (!hasNodeModules(ctx.workdir)) return skipResult(Date.now() - start);

      // Try project scripts first, then fallback to tsc
      const cmd = proj.scripts.lint
        ? { cmd: "npm", args: ["run", "lint"] }
        : proj.scripts.typecheck
          ? { cmd: "npm", args: ["run", "typecheck"] }
          : fs.existsSync(path.join(ctx.workdir, "tsconfig.json"))
            ? { cmd: "npx", args: ["tsc", "--noEmit"] }
            : null;

      if (!cmd) return skipResult(Date.now() - start);

      const ev = runCommand(cmd.cmd, cmd.args, ctx.workdir);
      const findings =
        ev.exitCode !== 0
          ? parseFindings(ev.stdout + "\n" + ev.stderr)
          : [];
      return {
        passed: ev.exitCode === 0,
        verdict: ev.exitCode === 0 ? "pass" : "fail",
        evidence: [ev],
        findings,
        durationMs: Date.now() - start,
      };
    }

    if (proj.type === "go") {
      if (!hasGoToolchain()) return skipResult(Date.now() - start);
      // go vet for linting
      const ev = runCommand("go", ["vet", "./..."], ctx.workdir);
      const findings =
        ev.exitCode !== 0
          ? parseFindings(ev.stdout + "\n" + ev.stderr)
          : [];
      return {
        passed: ev.exitCode === 0,
        verdict: ev.exitCode === 0 ? "pass" : "fail",
        evidence: [ev],
        findings,
        durationMs: Date.now() - start,
      };
    }

    // Unknown project type — skip lint
    return skipResult(Date.now() - start);
  }
}

class BuildGate implements QualityGate {
  readonly name = "build" as const;

  check(ctx: GateContext): GateResult {
    const start = Date.now();
    const proj = detectProject(ctx.workdir);

    if (proj.type === "node") {
      if (!proj.scripts.build || !hasNodeModules(ctx.workdir)) return skipResult(Date.now() - start);
      const ev = runCommand("npm", ["run", "build"], ctx.workdir, 120000);
      const findings =
        ev.exitCode !== 0
          ? parseFindings(ev.stdout + "\n" + ev.stderr)
          : [];
      return {
        passed: ev.exitCode === 0,
        verdict: ev.exitCode === 0 ? "pass" : "fail",
        evidence: [ev],
        findings,
        durationMs: Date.now() - start,
      };
    }

    if (proj.type === "go") {
      if (!hasGoToolchain()) return skipResult(Date.now() - start);
      const ev = runCommand("go", ["build", "./..."], ctx.workdir, 120000);
      const findings =
        ev.exitCode !== 0
          ? parseFindings(ev.stdout + "\n" + ev.stderr)
          : [];
      return {
        passed: ev.exitCode === 0,
        verdict: ev.exitCode === 0 ? "pass" : "fail",
        evidence: [ev],
        findings,
        durationMs: Date.now() - start,
      };
    }

    // Unknown — skip
    return skipResult(Date.now() - start);
  }
}

class TestGate implements QualityGate {
  readonly name = "test" as const;

  check(ctx: GateContext): GateResult {
    const start = Date.now();
    const proj = detectProject(ctx.workdir);

    if (proj.type === "node") {
      if (!proj.scripts.test || !hasNodeModules(ctx.workdir)) return skipResult(Date.now() - start);
      const ev = runCommand("npm", ["run", "test"], ctx.workdir, 300000);
      const findings =
        ev.exitCode !== 0
          ? parseFindings(ev.stdout + "\n" + ev.stderr)
          : [];
      return {
        passed: ev.exitCode === 0,
        verdict: ev.exitCode === 0 ? "pass" : "fail",
        evidence: [ev],
        findings,
        durationMs: Date.now() - start,
      };
    }

    if (proj.type === "go") {
      if (!hasGoToolchain()) return skipResult(Date.now() - start);
      const ev = runCommand(
        "go",
        ["test", "-v", "./..."],
        ctx.workdir,
        300000,
      );
      const findings =
        ev.exitCode !== 0
          ? parseFindings(ev.stdout + "\n" + ev.stderr)
          : [];
      return {
        passed: ev.exitCode === 0,
        verdict: ev.exitCode === 0 ? "pass" : "fail",
        evidence: [ev],
        findings,
        durationMs: Date.now() - start,
      };
    }

    // Unknown — skip
    return skipResult(Date.now() - start);
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

export { runCommand, parseFindings, detectProject };
export type { ProjectInfo, ProjectType };
