"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchWorkspace, fetchStatus, fetchHealth, shutdownServer, fetchTasks } from "@/lib/api";
import type { WorkspaceConfig, ServerStatus, AgentHealth, Task, TaskStatus } from "@/lib/types";

// Pipeline-active task statuses — shown as stage breakdown instead of generic "running"
const PIPELINE_STATUSES: TaskStatus[] = [
  "coding", "linting", "building", "testing", "integrating", "repairing", "escalated", "paused",
];

// Short display labels for pipeline statuses
const PIPELINE_STATUS_LABELS: Partial<Record<TaskStatus, string>> = {
  coding: "coding",
  linting: "linting",
  building: "building",
  testing: "testing",
  integrating: "integrating",
  repairing: "repairing",
  escalated: "escalated",
  paused: "paused",
};

export function TopBar() {
  const [workspace, setWorkspace] = useState<WorkspaceConfig | null>(null);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [connected, setConnected] = useState(true);
  const [shutting, setShutting] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [agentHealths, setAgentHealths] = useState<AgentHealth[]>([]);
  const [pipelineCounts, setPipelineCounts] = useState<Partial<Record<TaskStatus, number>>>({});

  const refreshTasks = useCallback(() => {
    fetchTasks()
      .then((tasks: Task[]) => {
        const counts: Partial<Record<TaskStatus, number>> = {};
        for (const t of tasks) {
          if (PIPELINE_STATUSES.includes(t.status)) {
            counts[t.status] = (counts[t.status] ?? 0) + 1;
          }
        }
        setPipelineCounts(counts);
      })
      .catch(() => {});
  }, []);

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

    refreshTasks();
  }, [refreshTasks]);

  // Poll status every 5 seconds
  useEffect(() => {
    const id = setInterval(() => {
      fetchStatus()
        .then((s) => {
          setStatus(s);
          setConnected(true);
        })
        .catch(() => setConnected(false));
      refreshTasks();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshTasks]);

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

      {/* Task counts — show pipeline stage breakdown when active */}
      {status && (
        <span className="text-zinc-500 mr-4 flex items-center gap-1.5">
          {(() => {
            const activeStages = PIPELINE_STATUSES.filter((s) => (pipelineCounts[s] ?? 0) > 0);
            if (activeStages.length > 0) {
              return (
                <>
                  {activeStages.map((s, i) => (
                    <span key={s}>
                      <span className="text-zinc-300">{pipelineCounts[s]}</span>
                      {" "}
                      <span className="text-zinc-500">{PIPELINE_STATUS_LABELS[s]}</span>
                      {i < activeStages.length - 1 && <span className="text-zinc-700 mx-0.5">·</span>}
                    </span>
                  ))}
                  <span className="text-zinc-700 mx-0.5">/</span>
                  <span className="text-zinc-300">{status.tasks_total}</span>
                  <span className="text-zinc-500">total</span>
                </>
              );
            }
            return (
              <>
                <span className="text-zinc-300">{status.tasks_running}</span>
                <span>running</span>
                <span className="text-zinc-700">/</span>
                <span className="text-zinc-300">{status.tasks_total}</span>
                <span>total</span>
              </>
            );
          })()}
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
