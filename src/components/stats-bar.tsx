import type { Task } from "@/lib/types";

interface StatsBarProps {
  tasks: Task[];
}

export function StatsBar({ tasks }: StatsBarProps) {
  const total = tasks.length;
  const pending = tasks.filter((t) =>
    ["pending", "claimed"].includes(t.status)
  ).length;
  const running = tasks.filter((t) => t.status === "running").length;
  const reviewing = tasks.filter((t) => t.status === "reviewing").length;
  const done = tasks.filter((t) =>
    ["done", "evaluated"].includes(t.status)
  ).length;
  const failed = tasks.filter((t) => t.status === "failed").length;

  const stats = [
    { label: "total", value: total, color: "text-zinc-300" },
    { label: "pending", value: pending, color: "text-zinc-500" },
    { label: "running", value: running, color: "text-blue-400" },
    { label: "review", value: reviewing, color: "text-yellow-400" },
    { label: "done", value: done, color: "text-green-500" },
    { label: "failed", value: failed, color: "text-red-400" },
  ];

  return (
    <div className="shrink-0 flex items-center gap-0 px-3 py-1.5 border-b border-zinc-800 bg-zinc-950 font-mono text-[11px]">
      {stats.map((s, i) => (
        <span key={s.label} className="flex items-baseline gap-1">
          {i > 0 && <span className="text-zinc-800 mx-2 select-none">|</span>}
          <span className={`font-semibold ${s.color}`}>{s.value}</span>
          <span className="text-zinc-600">{s.label}</span>
        </span>
      ))}
    </div>
  );
}
