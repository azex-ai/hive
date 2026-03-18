"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { fetchWorkspace, initWorkspace, fetchHealth } from "@/lib/api";
import type { AgentHealth } from "@/lib/types";

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

  async function handleInit() {
    const path = repoPath.trim();
    if (!path) return;
    setLoading(true);
    setError(null);
    setInitResult(null);
    try {
      const result = await initWorkspace(path);
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

        {/* Separator */}
        <div className="border-t border-zinc-800 mb-6" />

        {/* Input */}
        <div className="flex flex-col gap-2 mb-4">
          <label className="text-zinc-400 text-xs">project directory</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleInit()}
              placeholder="/Users/aaron/azex/azex"
              className="flex-1 bg-zinc-900 border border-zinc-700 text-zinc-200 text-xs px-3 py-2 font-mono placeholder:text-zinc-600 focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-800"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              onClick={handleInit}
              disabled={loading || !repoPath.trim()}
              className="px-4 py-2 text-xs font-mono bg-green-950 border border-green-700 text-green-400 hover:bg-green-900 hover:text-green-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? "initializing..." : "initialize hive"}
            </button>
          </div>
        </div>

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
              path{" "}
              <span className="text-zinc-200">{repoPath}</span>
            </div>
            <div className="text-zinc-400">
              git repo{" "}
              <span className={initResult.is_git_repo ? "text-green-400" : "text-zinc-500"}>
                {initResult.is_git_repo ? "detected" : "not found"}
              </span>
            </div>
            <div className="text-zinc-400">
              status{" "}
              <span className="text-zinc-200">{initResult.status}</span>
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
