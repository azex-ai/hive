"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { fetchWorkspace, initWorkspace, fetchHealth } from "@/lib/api";
import type { AgentHealth } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Folder, FolderGit2, ChevronUp, ChevronRight } from "lucide-react";

interface BrowseDir {
  name: string;
  path: string;
  isGitRepo: boolean;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  isGitRepo: boolean;
  dirs: BrowseDir[];
}

export default function SetupPage() {
  const router = useRouter();
  const [repoPath, setRepoPath] = useState("");
  const [loading, setLoading] = useState(false);
  const [initResult, setInitResult] = useState<{
    is_git_repo: boolean;
    status: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [agentHealths, setAgentHealths] = useState<AgentHealth[]>([]);
  const [outputDir, setOutputDir] = useState<string>("");
  const [healthLoading, setHealthLoading] = useState(true);

  // Directory browser state
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseData, setBrowseData] = useState<BrowseResult | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  useEffect(() => {
    fetchWorkspace()
      .then((ws) => {
        if (ws.repo_path) setRepoPath(ws.repo_path);
      })
      .catch(() => {});

    fetchHealth()
      .then((h) => {
        setAgentHealths(h.agents);
        setOutputDir(h.output_dir);
      })
      .catch(() => {})
      .finally(() => setHealthLoading(false));
  }, []);

  const browseTo = useCallback(async (dir?: string) => {
    setBrowseLoading(true);
    try {
      const params = dir ? `?dir=${encodeURIComponent(dir)}` : "";
      const res = await fetch(`/api/workspace/browse${params}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setBrowseData(json.data);
      setBrowseOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "browse failed");
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  function selectDir(dirPath: string) {
    setRepoPath(dirPath);
    setBrowseOpen(false);
  }

  async function handleInit() {
    const trimmed = repoPath.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setInitResult(null);
    try {
      const result = await initWorkspace(trimmed);
      setInitResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "initialization failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8 font-mono">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="mb-8">
          <div className="text-green-500 text-sm mb-1">hive</div>
          <div className="text-zinc-200 text-base font-semibold">workspace setup</div>
          <div className="text-zinc-500 text-xs mt-1">
            point hive at a git repository to begin
          </div>
        </div>

        <div className="border-t border-zinc-800 mb-6" />

        {/* Input + Browse */}
        <div className="flex flex-col gap-2 mb-4">
          <label className="text-zinc-400 text-xs">project directory</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInit()}
              placeholder="/path/to/your/project"
              className="flex-1 bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-3 py-2 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-800"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              onClick={() => browseTo()}
              disabled={browseLoading}
              className="px-3 py-2 text-xs font-mono bg-zinc-900 border border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-40 transition-colors"
              title="Browse directories"
            >
              <Folder className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleInit}
              disabled={loading || !repoPath.trim()}
              className="px-4 py-2 text-xs font-mono bg-green-950 border border-green-700 text-green-400 hover:bg-green-900 hover:text-green-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "initializing..." : "initialize"}
            </button>
          </div>
        </div>

        {/* Directory Browser */}
        {browseOpen && browseData && (
          <div className="border border-zinc-700 bg-zinc-900 mb-4 max-h-72 flex flex-col">
            {/* Breadcrumb path — each segment is clickable */}
            <div className="flex items-center gap-0 px-3 py-2 border-b border-zinc-800 bg-zinc-950 shrink-0 overflow-x-auto">
              <div className="flex items-center gap-0 text-xs flex-1 min-w-0">
                {browseData.current.split("/").filter(Boolean).map((seg, i, arr) => {
                  const segPath = "/" + arr.slice(0, i + 1).join("/");
                  const isLast = i === arr.length - 1;
                  return (
                    <span key={segPath} className="flex items-center shrink-0">
                      {i > 0 && <span className="text-zinc-700 mx-0.5">/</span>}
                      <button
                        onClick={() => browseTo(segPath)}
                        className={cn(
                          "hover:text-green-400 transition-colors px-0.5",
                          isLast ? "text-zinc-200" : "text-zinc-500",
                        )}
                      >
                        {seg}
                      </button>
                    </span>
                  );
                })}
              </div>
              {browseData.isGitRepo && (
                <span className="text-green-500 text-[10px] border border-green-800 px-1.5 py-0.5 shrink-0 ml-2">
                  git
                </span>
              )}
              <button
                onClick={() => selectDir(browseData.current)}
                className="text-green-400 text-[11px] hover:text-green-300 border border-green-800 px-2 py-0.5 hover:bg-green-950 transition-colors shrink-0 ml-2"
              >
                select
              </button>
            </div>

            {/* Directory list */}
            <div className="overflow-y-auto flex-1">
              {browseData.dirs.length === 0 ? (
                <div className="text-zinc-600 text-xs px-3 py-4 text-center">
                  no subdirectories
                </div>
              ) : (
                browseData.dirs.map((d) => (
                  <button
                    key={d.path}
                    onClick={() => browseTo(d.path)}
                    onDoubleClick={() => selectDir(d.path)}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-zinc-800 transition-colors group",
                      d.isGitRepo && "bg-zinc-800/30",
                    )}
                  >
                    {d.isGitRepo ? (
                      <FolderGit2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
                    ) : (
                      <Folder className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
                    )}
                    <span
                      className={cn(
                        "truncate",
                        d.isGitRepo ? "text-green-400" : "text-zinc-400",
                      )}
                    >
                      {d.name}
                    </span>
                    <ChevronRight className="w-3 h-3 text-zinc-700 ml-auto shrink-0 opacity-0 group-hover:opacity-100" />
                    {d.isGitRepo && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          selectDir(d.path);
                        }}
                        className="text-[10px] text-green-500 border border-green-800 px-1.5 py-0.5 hover:bg-green-950 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        select
                      </button>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-red-400 text-xs px-3 py-2 border border-red-900 bg-red-950/30 mb-4">
            [error] {error}
          </div>
        )}

        {/* Result */}
        {initResult && (
          <div className="border border-zinc-800 bg-zinc-900/50 p-4 mb-6 text-xs flex flex-col gap-2">
            <div className="text-green-500">[ok] workspace initialized</div>
            <div className="text-zinc-400">
              path <span className="text-zinc-200">{repoPath}</span>
            </div>
            <div className="text-zinc-400">
              git repo{" "}
              <span className={initResult.is_git_repo ? "text-green-400" : "text-zinc-500"}>
                {initResult.is_git_repo ? "detected" : "not found"}
              </span>
            </div>
            <div className="text-zinc-400">
              status <span className="text-zinc-200">{initResult.status}</span>
            </div>
            <div className="border-t border-zinc-800 mt-2 pt-2">
              <button
                onClick={() => router.push("/")}
                className="text-green-500 hover:text-green-400 underline underline-offset-2"
              >
                go to dashboard
              </button>
            </div>
          </div>
        )}

        {/* Agent health */}
        <div className="border-t border-zinc-800 pt-4 mb-4">
          <div className="text-zinc-600 text-xs mb-2">agent health</div>
          {healthLoading ? (
            <div className="text-zinc-600 text-xs animate-pulse">checking agents...</div>
          ) : agentHealths.length === 0 ? (
            <div className="text-zinc-600 text-xs">no agents configured — edit hive.yaml</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {agentHealths.map((a) => (
                <div key={a.name} className="flex items-center gap-2 text-xs">
                  <span
                    className={`w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 ${
                      a.available ? "bg-green-500" : "bg-red-500"
                    }`}
                  />
                  <span className={a.available ? "text-zinc-300" : "text-zinc-500"}>
                    {a.name}
                  </span>
                  {a.available && a.version ? (
                    <span className="text-zinc-600 truncate max-w-xs">{a.version}</span>
                  ) : !a.available && a.error ? (
                    <span className="text-red-500 truncate max-w-xs">{a.error}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Output directory */}
        {outputDir && (
          <div className="border-t border-zinc-800 pt-4">
            <div className="text-zinc-600 text-xs mb-1">output directory</div>
            <div className="text-zinc-400 text-xs font-mono">{outputDir}</div>
          </div>
        )}
      </div>
    </div>
  );
}
