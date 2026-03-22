export const taskStatusConfig: Record<
  string,
  { label: string; color: string; bg: string; dot: string }
> = {
  pending: {
    label: "Pending",
    color: "text-zinc-400",
    bg: "bg-zinc-400/10 text-zinc-400 border-zinc-400/30",
    dot: "bg-zinc-400",
  },
  claimed: {
    label: "Claimed",
    color: "text-blue-400",
    bg: "bg-blue-400/10 text-blue-400 border-blue-400/30",
    dot: "bg-blue-400",
  },
  running: {
    label: "Running",
    color: "text-amber-400",
    bg: "bg-amber-400/10 text-amber-400 border-amber-400/30",
    dot: "bg-amber-400 animate-pulse",
  },
  done: {
    label: "Done",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10 text-emerald-400 border-emerald-400/30",
    dot: "bg-emerald-400",
  },
  reviewing: {
    label: "Reviewing",
    color: "text-purple-400",
    bg: "bg-purple-400/10 text-purple-400 border-purple-400/30",
    dot: "bg-purple-400",
  },
  evaluated: {
    label: "Evaluated",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10 text-emerald-400 border-emerald-400/30",
    dot: "bg-emerald-400",
  },
  failed: {
    label: "Failed",
    color: "text-red-400",
    bg: "bg-red-400/10 text-red-400 border-red-400/30",
    dot: "bg-red-400",
  },
  decomposed: {
    label: "Decomposed",
    color: "text-zinc-400",
    bg: "bg-zinc-400/10 text-zinc-400 border-zinc-400/30",
    dot: "bg-zinc-400",
  },
  coding: {
    label: "Coding",
    color: "text-blue-400",
    bg: "bg-blue-400/10 text-blue-400 border-blue-400/30",
    dot: "bg-blue-400 animate-pulse",
  },
  linting: {
    label: "Linting",
    color: "text-amber-400",
    bg: "bg-amber-400/10 text-amber-400 border-amber-400/30",
    dot: "bg-amber-400 animate-pulse",
  },
  building: {
    label: "Building",
    color: "text-amber-400",
    bg: "bg-amber-400/10 text-amber-400 border-amber-400/30",
    dot: "bg-amber-400 animate-pulse",
  },
  testing: {
    label: "Testing",
    color: "text-amber-400",
    bg: "bg-amber-400/10 text-amber-400 border-amber-400/30",
    dot: "bg-amber-400 animate-pulse",
  },
  integrating: {
    label: "Integrating",
    color: "text-blue-400",
    bg: "bg-blue-400/10 text-blue-400 border-blue-400/30",
    dot: "bg-blue-400 animate-pulse",
  },
  repairing: {
    label: "Repairing",
    color: "text-orange-400",
    bg: "bg-orange-400/10 text-orange-400 border-orange-400/30",
    dot: "bg-orange-400 animate-pulse",
  },
  escalated: {
    label: "Escalated",
    color: "text-red-400",
    bg: "bg-red-400/10 text-red-400 border-red-400/30",
    dot: "bg-red-400",
  },
  paused: {
    label: "Paused",
    color: "text-yellow-400",
    bg: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
    dot: "bg-yellow-400",
  },
};
