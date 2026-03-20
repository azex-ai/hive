"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchWorkspace, fetchStatus, fetchHealth, shutdownServer } from "@/lib/api";
import type { WorkspaceConfig, ServerStatus, AgentHealth } from "@/lib/types";

export function TopBar() {
  const [workspace, setWorkspace] = useState<WorkspaceConfig | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [connected, setConnected] = useState(true);
  const [shutting, setShutting] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [agentHealths, setAgentHealths] = useState<AgentHealth[]>([]);

  useEffect(() => {
    fetchWorkspace()
      .then(setWorkspace)
      .catch(() => setConnected(false));

    fetchStatus()
      .then(setStatus)
      .catch(() => {});

    fetchHealth()
      .then((h) => setAgentHealths(h.agents))
      .catch(() => {});
  }, []);

  // Poll status every 5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      fetchStatus()
        .then((s) => {
          setStatus(s);
          setConnected(true);
        })
        .catch(() => setConnected(false));
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const handleStop = useCallback(async () => {
    if (!confirmStop) {
      setConfirmStop(true);
      return;
    }
    setShutting(true);
    setConfirmStop(false);
    try {
      await shutdownServer();
    } catch {
      // expected — process may exit before response completes
    }
  }, [confirmStop]);

  const repoPath = workspace?.repo_path || "";
  const displayPath = repoPath
    ? repoPath.replace(/^\/Users\/[^/]+/, "~")
    : "no workspace";

  return (
    <header className="shrink-0 flex items-center gap-0 h-9 border-b border-zinc-800 bg-zinc-950 px-3 font-mono text-xs">
      {/* Logo */}
      <Link href="/" className="text-green-500 font-bold tracking-tight mr-3 hover:text-green-400">
        hive
      </Link>

      {/* Separator */}
      <span className="text-zinc-700 mr-3">·</span>

      {/* Workspace path */}
      <Link
        href="/setup"
        className="text-zinc-400 hover:text-zinc-200 truncate max-w-xs transition-colors"
        title={repoPath || "click to set workspace"}
      >
        {displayPath}
      </Link>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Task counts */}
      {status && (
        <span className="text-zinc-500 mr-4">
          <span className="text-zinc-300">{status.tasks_running}</span> running
          {" / "}
          <span className="text-zinc-300">{status.tasks_total}</span> total
        </span>
      )}

      {/* Agent status dots — reflect real health check results + active run counts */}
      {agentHealths.length > 0 && (
        <div className="flex items-center gap-1.5 mr-4">
          {agentHealths.map((a) => {
            const activeCount = status?.agents_active?.[a.name] ?? 0;
            const maxConcurrent = 1; // default; could come from /api/agents in future
            const isRunning = activeCount > 0;
            return (
              <span
                key={a.name}
                className="flex items-center gap-1"
                title={a.available ? `${a.name} ${a.version ?? ""}`.trim() : `${a.name}: ${a.error ?? "unavailable"}`}
              >
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full ${
                    !a.available ? "bg-red-500" : isRunning ? "bg-green-500" : "bg-zinc-600"
                  }`}
                  aria-label={`${a.name}: ${!a.available ? "unavailable" : isRunning ? "running" : "idle"}`}
                />
                <span className={!a.available ? "text-zinc-600" : isRunning ? "text-green-400" : "text-zinc-500"}>
                  {a.name} ({activeCount}/{maxConcurrent})
                </span>
              </span>
            );
          })}
        </div>
      )}

      {/* Connection indicator */}
      <span className="flex items-center gap-1.5 mr-4">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full ${
            connected ? "bg-green-500" : "bg-red-500"
          }`}
          aria-label={connected ? "Server connected" : "Server disconnected"}
        />
        <span className={connected ? "text-zinc-500" : "text-red-400"}>
          {connected ? "running" : "disconnected"}
        </span>
      </span>

      {/* Stop button */}
      {confirmStop ? (
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono text-red-400">stop hive?</span>
          <button
            onClick={handleStop}
            disabled={shutting}
            className="px-2 py-0.5 text-[11px] font-mono border border-red-600 text-red-300 bg-red-950 hover:bg-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {shutting ? "stopping..." : "yes"}
          </button>
          <button
            onClick={() => setConfirmStop(false)}
            className="px-2 py-0.5 text-[11px] font-mono border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            no
          </button>
        </span>
      ) : (
        <button
          onClick={handleStop}
          disabled={shutting}
          className="px-2 py-0.5 text-[11px] font-mono border border-red-800 text-red-400 hover:bg-red-950 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {shutting ? "stopping..." : "stop"}
        </button>
      )}
    </header>
  );
}
