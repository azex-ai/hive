"use client";

import { useState } from "react";
import Link from "next/link";
import type { Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { taskStatusConfig } from "@/lib/status";
import { formatAge } from "@/lib/format";

interface RunningPanelProps {
  tasks: Task[];
}

type FilterKey = "all" | "running" | "pending" | "done" | "failed";

const filterConfig: Record<FilterKey, { label: string; statuses: TaskStatus[]; dotClass: string }> = {
  all: { label: "all", statuses: [], dotClass: "bg-zinc-500" },
  running: { label: "running", statuses: ["running", "claimed"], dotClass: "bg-blue-500" },
  pending: { label: "pending", statuses: ["pending", "reviewing"], dotClass: "bg-zinc-500" },
  done: { label: "done", statuses: ["done", "evaluated"], dotClass: "bg-green-500" },
  failed: { label: "failed", statuses: ["failed"], dotClass: "bg-red-500" },
};

const filterOrder: FilterKey[] = ["all", "running", "pending", "done", "failed"];

function getStatusGroup(status: TaskStatus): FilterKey {
  if (status === "running" || status === "claimed") return "running";
  if (status === "pending" || status === "reviewing") return "pending";
  if (status === "failed") return "failed";
  return "done";
}

function getStatusDot(status: string) {
  const cfg = taskStatusConfig[status] ?? taskStatusConfig.pending;
  return { dot: cfg.dot, text: cfg.color, pulse: cfg.dot.includes("animate-pulse") };
}

function TaskRow({ task }: { task: Task }) {
  const displayName = task.spec.title || task.spec.objective;
  const age = formatAge(task.updated_at);
  const sd = getStatusDot(task.status);

  return (
    <Link href={`/tasks/${task.spec.id}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-900/60 transition-colors cursor-pointer group border-b border-zinc-900/50">
        {/* Status dot */}
        <span className={cn("shrink-0 w-2 h-2 rounded-full", sd.dot, sd.pulse && "animate-pulse")} />

        {/* Task ID */}
        <span className={cn("shrink-0 font-mono text-[11px] tabular-nums w-16", sd.text)}>
          {task.spec.id}
        </span>

        {/* Status label */}
        <span className={cn("shrink-0 font-mono text-[10px] w-14", sd.text)}>
          [{task.status}]
        </span>

        {/* Objective */}
        <span className="flex-1 font-mono text-[11px] text-zinc-500 group-hover:text-zinc-300 truncate" title={displayName}>
          {displayName}
        </span>

        {/* Age */}
        <span className="shrink-0 font-mono text-[10px] text-zinc-700 tabular-nums">{age}</span>
      </div>
    </Link>
  );
}

export function RunningPanel({ tasks }: RunningPanelProps) {
  const [filter, setFilter] = useState<FilterKey>("all");

  // Count per group
  const counts: Record<FilterKey, number> = { all: tasks.length, running: 0, pending: 0, done: 0, failed: 0 };
  for (const t of tasks) {
    counts[getStatusGroup(t.status)]++;
  }

  // Filter tasks
  const filtered = filter === "all"
    ? tasks
    : tasks.filter((t) => filterConfig[filter].statuses.includes(t.status));

  // Sort: running first, then pending, then failed, then done
  const sortOrder: Record<string, number> = { running: 0, claimed: 0, pending: 1, reviewing: 1, failed: 2, done: 3, evaluated: 3 };
  const sorted = [...filtered].sort((a, b) => {
    const oa = sortOrder[a.status] ?? 9;
    const ob = sortOrder[b.status] ?? 9;
    if (oa !== ob) return oa - ob;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950 font-mono text-xs">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-zinc-800">
        <div className="text-zinc-600 text-[10px] uppercase tracking-wider select-none mb-2">
          tasks
        </div>

        {/* Filter buttons */}
        <div className="flex gap-1 flex-wrap" role="tablist" aria-label="Task status filters">
          {filterOrder.map((f) => {
            const count = counts[f];
            const active = filter === f;
            return (
              <button
                key={f}
                role="tab"
                aria-selected={active}
                onClick={() => setFilter(f)}
                className={cn(
                  "flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono border transition-colors",
                  active
                    ? "border-zinc-600 text-zinc-200 bg-zinc-800"
                    : "border-transparent text-zinc-600 hover:text-zinc-400"
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full", filterConfig[f].dotClass)} />
                {filterConfig[f].label}
                {count > 0 && (
                  <span className={cn("tabular-nums", active ? "text-zinc-300" : "text-zinc-600")}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Task list header */}
      <div className="shrink-0 grid grid-cols-[1.2rem_4rem_3.5rem_1fr_2.5rem] gap-x-1 px-3 py-1 border-b border-zinc-800 text-[9px] text-zinc-700 uppercase tracking-wider select-none">
        <span />
        <span>id</span>
        <span>status</span>
        <span>objective</span>
        <span className="text-right">age</span>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <p className="px-3 py-6 text-zinc-700 text-[11px] text-center">
            {filter === "all" ? "no tasks yet — use chat to create some" : `no ${filter} tasks`}
          </p>
        ) : (
          sorted.map((task) => <TaskRow key={task.spec.id} task={task} />)
        )}
      </div>

      {/* Footer: task summary */}
      <div className="shrink-0 px-3 py-1.5 border-t border-zinc-800 text-[10px] text-zinc-700 flex gap-3">
        {counts.running > 0 && <span className="text-blue-400">{counts.running} running</span>}
        {counts.pending > 0 && <span className="text-zinc-400">{counts.pending} pending</span>}
        {counts.failed > 0 && <span className="text-red-400">{counts.failed} failed</span>}
        {counts.done > 0 && <span className="text-zinc-600">{counts.done} done</span>}
        {tasks.length === 0 && <span>0 tasks</span>}
      </div>
    </div>
  );
}
