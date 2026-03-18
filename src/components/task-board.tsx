"use client";

import { useMemo } from "react";
import { TaskRow } from "@/components/task-card";
import type { Task, TaskStatus, Attempt } from "@/lib/types";

interface TaskBoardProps {
  tasks: Task[];
  attempts: Attempt[];
}

// Sort order: running > claimed > pending > reviewing > done/evaluated > failed
const statusOrder: Record<TaskStatus, number> = {
  running: 0,
  claimed: 1,
  pending: 2,
  reviewing: 3,
  done: 4,
  evaluated: 5,
  failed: 6,
};

export function TaskBoard({ tasks, attempts }: TaskBoardProps) {
  const taskAgent = useMemo(() => {
    const map: Record<string, string> = {};
    for (const a of attempts) {
      map[a.task_id] = a.agent;
    }
    return map;
  }, [attempts]);

  const sorted = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99)
      ),
    [tasks]
  );

  if (sorted.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 border border-dashed border-zinc-800">
        <p className="text-xs text-zinc-600 font-mono">
          no tasks — use the terminal below to create some
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full font-mono text-xs">
      {/* Table header */}
      <div className="grid grid-cols-[6rem_1fr_6rem_7rem_6rem] gap-x-3 px-3 py-1.5 border-b border-zinc-800 text-zinc-600 uppercase tracking-wider text-[10px]">
        <span>id</span>
        <span>objective</span>
        <span>agent</span>
        <span>status</span>
        <span>updated</span>
      </div>

      {/* Rows */}
      <div className="flex flex-col">
        {sorted.map((task) => (
          <TaskRow
            key={task.spec.id}
            task={task}
            agentName={taskAgent[task.spec.id]}
          />
        ))}
      </div>
    </div>
  );
}
