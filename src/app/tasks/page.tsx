"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { fetchTasks } from "@/lib/api";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

const statusStyle: Record<string, string> = {
  pending: "text-zinc-500",
  claimed: "text-blue-400",
  running: "text-blue-400",
  reviewing: "text-yellow-400",
  done: "text-green-500",
  evaluated: "text-green-500",
  failed: "text-red-400",
};

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchTasks();
      setTasks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="flex flex-col flex-1 font-mono text-xs">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 text-zinc-600">
        <span className="uppercase tracking-wider text-[10px]">tasks</span>
        <span className="text-zinc-700">{tasks.length} total</span>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-zinc-600 animate-pulse">loading...</p>
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-40">
          <p className="text-red-400">[error] {error}</p>
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex items-center justify-center h-40 border border-dashed border-zinc-800 m-4">
          <p className="text-zinc-600">no tasks yet — use the chat to create some</p>
        </div>
      ) : (
        <div className="flex flex-col overflow-y-auto">
          {/* Table header */}
          <div className="grid grid-cols-[6rem_1fr_7rem_6rem] gap-x-3 px-3 py-1.5 border-b border-zinc-800 text-zinc-600 uppercase tracking-wider text-[10px]">
            <span>id</span>
            <span>objective</span>
            <span>status</span>
            <span>updated</span>
          </div>
          {tasks.map((task) => (
            <Link
              key={task.spec.id}
              href={`/tasks/${task.spec.id}`}
              className="grid grid-cols-[6rem_1fr_7rem_6rem] gap-x-3 px-3 py-2 border-b border-zinc-900 hover:bg-zinc-900/60 transition-colors"
            >
              <span className="text-zinc-600 truncate">{task.spec.id.slice(0, 8)}</span>
              <span className="text-zinc-300 truncate">{task.spec.objective}</span>
              <span className={cn("font-mono", statusStyle[task.status] ?? "text-zinc-500")}>
                [{task.status}]
              </span>
              <span className="text-zinc-600">
                {new Date(task.updated_at).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
