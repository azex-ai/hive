import "server-only";
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

// --- Blueprint Types ---

export interface Blueprint {
  /** Schema version for future migrations */
  version: 1;
  /** Absolute path of the workspace */
  workspace: string;
  /** When this blueprint was last scanned */
  scannedAt: string;
  /** Project type detection */
  project: ProjectScan;
  /** Git state at scan time */
  git: GitScan | null;
  /** Checkpoint: last known good state */
  checkpoint: Checkpoint | null;
  /** Task history summaries for this workspace */
  sessions: SessionSummary[];
}

export interface ProjectScan {
  type: "node" | "go" | "mixed" | "unknown";
  /** Key config files found */
  configFiles: string[];
  /** npm scripts or Makefile targets */
  scripts: Record<string, string>;
  /** Top-level directory names (not files) */
  topDirs: string[];
  /** Dependencies (package names, not versions — keep it small) */
  deps: string[];
  /** Dev dependencies */
  devDeps: string[];
}

export interface GitScan {
  branch: string;
  commitHash: string;
  commitMessage: string;
  commitDate: string;
  /** Number of uncommitted changes */
  dirtyFiles: number;
}

export interface Checkpoint {
  /** Git commit hash at checkpoint time */
  commitHash: string;
  /** When this checkpoint was created */
  createdAt: string;
  /** What was accomplished in this session */
  summary: string;
  /** Task IDs completed in this session */
  completedTasks: string[];
}

export interface SessionSummary {
  startedAt: string;
  endedAt: string;
  commitFrom: string;
  commitTo: string;
  tasksCompleted: string[];
  summary: string;
}

// --- Blueprint Path ---

const BLUEPRINT_FILE = "blueprint.json";

function blueprintPath(workspace: string): string {
  return path.join(workspace, ".hive", BLUEPRINT_FILE);
}

// --- Read / Write ---

export function readBlueprint(workspace: string): Blueprint | null {
  const bp = blueprintPath(workspace);
  if (!fs.existsSync(bp)) return null;
  try {
    const raw = fs.readFileSync(bp, "utf-8");
    return JSON.parse(raw) as Blueprint;
  } catch {
    return null;
  }
}

export function writeBlueprint(workspace: string, blueprint: Blueprint): void {
  const dir = path.join(workspace, ".hive");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(blueprintPath(workspace), JSON.stringify(blueprint, null, 2), "utf-8");
}

// --- Scanning ---

function gitCmd(cwd: string, ...args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function scanGit(workspace: string): GitScan | null {
  // Check if it's a git repo
  const root = gitCmd(workspace, "rev-parse", "--show-toplevel");
  if (!root) return null;

  const branch = gitCmd(workspace, "rev-parse", "--abbrev-ref", "HEAD");
  const commitHash = gitCmd(workspace, "rev-parse", "HEAD");
  const commitMessage = gitCmd(workspace, "log", "-1", "--format=%s");
  const commitDate = gitCmd(workspace, "log", "-1", "--format=%aI");
  const statusOutput = gitCmd(workspace, "status", "--porcelain");
  const dirtyFiles = statusOutput ? statusOutput.split("\n").filter((l) => l.trim()).length : 0;

  return {
    branch: branch || "unknown",
    commitHash: commitHash.slice(0, 12),
    commitMessage,
    commitDate,
    dirtyFiles,
  };
}

function scanProject(workspace: string): ProjectScan {
  const scan: ProjectScan = {
    type: "unknown",
    configFiles: [],
    scripts: {},
    topDirs: [],
    deps: [],
    devDeps: [],
  };

  // Detect config files
  const configNames = [
    "package.json", "tsconfig.json", "next.config.ts", "next.config.js", "next.config.mjs",
    "go.mod", "go.sum", "Makefile", "Dockerfile",
    "vite.config.ts", "vite.config.js",
    ".eslintrc.json", "eslint.config.js", "eslint.config.mjs",
    "biome.json", "turbo.json", "pnpm-workspace.yaml",
    "hive.yaml", "CLAUDE.md",
  ];
  for (const name of configNames) {
    if (fs.existsSync(path.join(workspace, name))) {
      scan.configFiles.push(name);
    }
  }

  // Detect project type
  const hasPackageJson = scan.configFiles.includes("package.json");
  const hasGoMod = scan.configFiles.includes("go.mod");

  if (hasPackageJson && hasGoMod) {
    scan.type = "mixed";
  } else if (hasPackageJson) {
    scan.type = "node";
  } else if (hasGoMod) {
    scan.type = "go";
  }

  // Parse package.json
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspace, "package.json"), "utf-8")) as {
        scripts?: Record<string, string>;
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      scan.scripts = pkg.scripts ?? {};
      scan.deps = Object.keys(pkg.dependencies ?? {});
      scan.devDeps = Object.keys(pkg.devDependencies ?? {});
    } catch { /* ignore */ }
  }

  // Parse go.mod for module name
  if (hasGoMod) {
    try {
      const gomod = fs.readFileSync(path.join(workspace, "go.mod"), "utf-8");
      const requireBlock = gomod.match(/require\s*\(([\s\S]*?)\)/);
      if (requireBlock) {
        const goDeps = requireBlock[1]
          .split("\n")
          .map((l) => l.trim().split(/\s+/)[0])
          .filter((d) => d && !d.startsWith("//"));
        scan.deps.push(...goDeps);
      }
    } catch { /* ignore */ }
  }

  // Parse Makefile targets
  if (scan.configFiles.includes("Makefile")) {
    try {
      const makefile = fs.readFileSync(path.join(workspace, "Makefile"), "utf-8");
      const targets = makefile.match(/^([a-zA-Z_][\w-]*):/gm);
      if (targets) {
        for (const t of targets.slice(0, 20)) {
          scan.scripts[`make:${t.replace(":", "")}`] = t.replace(":", "");
        }
      }
    } catch { /* ignore */ }
  }

  // Top-level directories
  try {
    const entries = fs.readdirSync(workspace, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "vendor") continue;
      scan.topDirs.push(entry.name);
    }
    scan.topDirs.sort();
  } catch { /* ignore */ }

  return scan;
}

/** Full scan: create or update blueprint for a workspace */
export function scanWorkspace(workspace: string): Blueprint {
  const existing = readBlueprint(workspace);
  const now = new Date().toISOString();

  const blueprint: Blueprint = {
    version: 1,
    workspace,
    scannedAt: now,
    project: scanProject(workspace),
    git: scanGit(workspace),
    checkpoint: existing?.checkpoint ?? null,
    sessions: existing?.sessions ?? [],
  };

  writeBlueprint(workspace, blueprint);
  return blueprint;
}

/** Update checkpoint after task completion */
export function updateCheckpoint(
  workspace: string,
  summary: string,
  completedTasks: string[],
): void {
  const bp = readBlueprint(workspace);
  if (!bp) return;

  const git = scanGit(workspace);

  bp.checkpoint = {
    commitHash: git?.commitHash ?? "",
    createdAt: new Date().toISOString(),
    summary,
    completedTasks,
  };

  bp.scannedAt = new Date().toISOString();
  writeBlueprint(workspace, bp);
}

/** Record a completed session */
export function recordSession(
  workspace: string,
  session: SessionSummary,
): void {
  const bp = readBlueprint(workspace);
  if (!bp) return;

  bp.sessions.push(session);
  // Keep last 50 sessions
  if (bp.sessions.length > 50) {
    bp.sessions = bp.sessions.slice(-50);
  }

  bp.scannedAt = new Date().toISOString();
  writeBlueprint(workspace, bp);
}
