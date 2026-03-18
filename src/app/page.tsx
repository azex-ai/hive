"use client";

import { useState, useEffect, useCallback } from "react";
import { ChatInput } from "@/components/chat-input";
import { RunningPanel } from "@/components/running-panel";
import { SkillsPanel } from "@/components/skills-panel";
import { fetchTasks, connectSSE } from "@/lib/api";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";

type RightTab = "chat" | "skills";

export default function DashboardPage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rightTab, setRightTab] = useState<RightTab>("chat");

  const loadTasks = useCallback(async () => {
    try {
      const data = await fetchTasks();
      setTasks(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load tasks");
    }
  }, []);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    const cleanup = connectSSE(() => {
      loadTasks();
    });
    return cleanup;
  }, [loadTasks]);

  function handleTasksCreated(newTasks: Task[]) {
    setTasks((prev) => {
      const ids = new Set(newTasks.map((t) => t.spec.id));
      return [...prev.filter((t) => !ids.has(t.spec.id)), ...newTasks];
    });
  }

  return (
    <div className="grid grid-cols-[6fr_4fr] h-full min-h-0 flex-1">
      {/* Left panel: Task board (always visible) */}
      <div className="flex flex-col h-full min-h-0 overflow-hidden">
        {error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center font-mono">
              <p className="text-xs text-red-400">[error] {error}</p>
              <p className="text-[11px] text-zinc-600 mt-1">
                is the backend running?
              </p>
            </div>
          </div>
        ) : (
          <RunningPanel tasks={tasks} />
        )}
      </div>

      {/* Right panel: Chat / Skills (switchable tabs) */}
      <div className="flex flex-col h-full min-h-0 overflow-hidden border-l border-zinc-800">
        {/* Tab switcher */}
        <div className="flex shrink-0 border-b border-zinc-800">
          {(["chat", "skills"] as RightTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setRightTab(t)}
              className={cn(
                "flex-1 px-4 py-2 text-[11px] font-mono uppercase tracking-wider border-b-2 transition-colors",
                rightTab === t
                  ? "border-green-500 text-green-400 bg-zinc-900/30"
                  : "border-transparent text-zinc-600 hover:text-zinc-400"
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {rightTab === "chat" && (
            <ChatInput onTasksCreated={handleTasksCreated} />
          )}
          {rightTab === "skills" && (
            <SkillsPanel />
          )}
        </div>
      </div>
    </div>
  );
}
