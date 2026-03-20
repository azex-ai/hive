"use client";

import Link from "next/link";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { taskStatusConfig } from "@/lib/status";
import { formatAge } from "@/lib/format";

interface TaskRowProps {
  task: Task;
  agentName?: string;
}

export function TaskRow({ task, agentName }: TaskRowProps) {
  const cfg = taskStatusConfig[task.status] ?? taskStatusConfig.pending;
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
        <span className={cn("font-mono", cfg.color)}>
          [{cfg.label.toLowerCase()}]
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
