import "server-only";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { HiveConfig } from "./types";

let _config: HiveConfig | null = null;

// --- Active Workspace (persisted to data/workspace.txt) ---

const WORKSPACE_FILE = path.resolve("data", "workspace.txt");

export function getActiveWorkspacePath(): string {
  try {
    if (fs.existsSync(WORKSPACE_FILE)) {
      return fs.readFileSync(WORKSPACE_FILE, "utf-8").trim();
    }
  } catch { /* ignore */ }
  return "";
}

export function setActiveWorkspacePath(workspace: string): void {
  const dir = path.dirname(WORKSPACE_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(WORKSPACE_FILE, workspace, "utf-8");
  // Also update in-memory config
  const config = getConfig();
  config.repo = workspace;
}

export function loadConfig(configPath?: string): HiveConfig {
  if (_config) return _config;

  const p = configPath || path.resolve(process.cwd(), "hive.yaml");

  // If no config file exists, return defaults
  if (!fs.existsSync(p)) {
    _config = {
      repo: ".",
      output_dir: "./output",
      agents: {
        claude: { command: "claude", args: ["-p", "--output-format", "stream-json"], max_concurrent: 3 },
        codex: { command: "codex", args: ["exec", "--json", "-q"], max_concurrent: 2 },
      },
      supervisor: { agent: "claude", model: "sonnet" },
      scheduler: { lease_ttl: "30m", max_attempts: 3 },
      evaluation: { cross_review: true, max_review_rounds: 3, auto_merge_threshold: 2 },
      pipeline: {
        max_repair_rounds: 3,
        self_review_probability: 0.2,
        parallel_max: 3,
        gates: ["lint", "build", "test", "review", "integrate"],
        model_routing: {
          default: { design: "opus", code: "sonnet", review: "opus", repair: "sonnet" },
          benchmark_min_samples: 5,
          benchmark_window_days: 30,
        },
      },
    };
    return _config;
  }

  const raw = fs.readFileSync(p, "utf-8");
  _config = yaml.load(raw) as HiveConfig;

  if (!_config || typeof _config !== "object") {
    throw new Error("invalid hive.yaml: expected an object");
  }

  // Apply defaults
  if (!_config.output_dir) _config.output_dir = "./output";
  if (!_config.agents) _config.agents = {};
  if (!_config.pipeline) {
    _config.pipeline = {
      max_repair_rounds: 3,
      self_review_probability: 0.2,
      parallel_max: 3,
      gates: ["lint", "build", "test", "review", "integrate"],
      model_routing: {
        default: { design: "opus", code: "sonnet", review: "opus", repair: "sonnet" },
        benchmark_min_samples: 5,
        benchmark_window_days: 30,
      },
    };
  }

  return _config;
}

export function getConfig(): HiveConfig {
  const config = _config || loadConfig();
  // Override repo with persisted workspace if set
  const persisted = getActiveWorkspacePath();
  if (persisted) {
    config.repo = persisted;
  }
  return config;
}

export function getOutputDir(): string {
  const cfg = getConfig();
  const dir = cfg.output_dir || "./output";
  return path.resolve(dir);
}

export function parseDuration(s: string | undefined): number {
  // Parse Go-style duration strings like "30m", "5s", "1h" to milliseconds
  if (!s) return 30 * 60 * 1000; // default 30m
  const match = s.match(/^(\d+)(ms|s|m|h)$/);
  if (!match) return 30 * 60 * 1000;
  const val = parseInt(match[1], 10);
  switch (match[2]) {
    case "ms":
      return val;
    case "s":
      return val * 1000;
    case "m":
      return val * 60 * 1000;
    case "h":
      return val * 3600 * 1000;
    default:
      return val;
  }
}
