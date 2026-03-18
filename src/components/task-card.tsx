"use client";

import Link from "next/link";
import type { Task, TaskStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const statusConfig: Record<TaskStatus, { label: string; className: string }> = {
  pending: { label: "pending", className: "text-zinc-500" },
  claimed: { label: "claimed", className: "text-blue-400" },
  running: { label: "running", className: "text-blue-400" },
  reviewing: { label: "review", className: "text-yellow-400" },
  done: { label: "done", className: "text-green-500" },
  evaluated: { label: "evaluated", className: "text-green-500" },
  failed: { label: "failed", className: "text-red-400" },
};

function formatAge(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

interface TaskRowProps {
  task: Task;
  agentName?: string;
}

export function TaskRow({ task, agentName }: TaskRowProps) {
  const status = statusConfig[task.status] ?? statusConfig.pending;
  // Display title if available, else fall back to objective.
  const displayName = task.spec.title || task.spec.objective;

  return (
    <Link href={`/tasks/${task.spec.id}`}>
      <div className="grid grid-cols-[6rem_1fr_6rem_7rem_6rem] gap-x-3 px-3 py-2 border-b border-zinc-900 hover:bg-zinc-900/60 transition-colors cursor-pointer group font-mono text-xs">
        {/* HIVE-N ID */}
        <span className="text-zinc-600 group-hover:text-zinc-400 truncate font-mono" title={task.spec.id}>
          {task.spec.id}
        </span>

        {/* Title / objective */}
        <div className="flex flex-col min-w-0">
          <span className="text-zinc-300 group-hover:text-zinc-100 truncate">
            {displayName}
          </span>
          {task.spec.title && task.spec.title !== task.spec.objective && (
            <span className="text-zinc-600 truncate text-[10px]">
              {task.spec.objective}
            </span>
          )}
        </div>

        {/* Agent */}
        <span className="text-zinc-500 truncate">
          {agentName ?? "—"}
        </span>

        {/* Status badge */}
        <span className={cn("font-mono", status.className)}>
          [{status.label}]
        </span>

        {/* Age */}
        <span className="text-zinc-600">
          {formatAge(task.updated_at)}
        </span>
      </div>
    </Link>
  );
}

// Keep TaskCard as alias so existing imports don't break
export { TaskRow as TaskCard };
