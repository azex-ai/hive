"use client";

import { useState, useEffect, useCallback } from "react";
import { fetchSkills } from "@/lib/api";
import type { Skill } from "@/lib/types";

export function SkillsPanel() {
  const [skillsDir, setSkillsDir] = useState<string>("");
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Local toggle state — visual only, not persisted to backend.
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchSkills();
      setSkillsDir(data.skills_dir);
      setSkills(data.skills);
      // Initialise toggle state from server (all enabled by default).
      setEnabled((prev) => {
        const next: Record<string, boolean> = { ...prev };
        for (const s of data.skills) {
          if (!(s.name in next)) {
            next[s.name] = s.enabled;
          }
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load skills");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function toggleSkill(name: string) {
    setEnabled((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  const displayDir = skillsDir
    ? skillsDir.replace(/^\/Users\/[^/]+/, "~")
    : "not configured";

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950 font-mono text-xs">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-zinc-800 flex items-center justify-between gap-2">
        <span className="text-zinc-600 text-[10px] uppercase tracking-wider select-none">
          skills
        </span>
        <button
          onClick={load}
          disabled={loading}
          className="text-[10px] text-zinc-600 hover:text-zinc-400 border border-zinc-800 hover:border-zinc-700 px-1.5 py-0.5 transition-colors disabled:opacity-40"
        >
          {loading ? "..." : "reload"}
        </button>
      </div>

      {/* Skills dir */}
      <div
        className="shrink-0 px-3 py-1.5 border-b border-zinc-900 text-[10px] text-zinc-700 truncate"
        title={skillsDir || "not configured"}
      >
        {displayDir}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="px-3 py-4 text-zinc-700 text-[11px] animate-pulse">
            loading...
          </p>
        ) : error ? (
          <p className="px-3 py-4 text-red-400 text-[11px]">[error] {error}</p>
        ) : skills.length === 0 ? (
          <p className="px-3 py-4 text-zinc-700 text-[11px] italic">
            no skills found
          </p>
        ) : (
          <div className="flex flex-col">
            {skills.map((skill) => {
              const isOn = enabled[skill.name] ?? skill.enabled;
              return (
                <div
                  key={skill.name}
                  className="flex items-start gap-2 px-2 py-1.5 border-b border-zinc-900/50 hover:bg-zinc-900/40 transition-colors"
                >
                  {/* Toggle */}
                  <button
                    onClick={() => toggleSkill(skill.name)}
                    className={`shrink-0 mt-0.5 w-6 h-3.5 rounded-full transition-colors relative ${
                      isOn ? "bg-green-600" : "bg-zinc-700"
                    }`}
                    title={isOn ? "enabled" : "disabled"}
                    aria-label={`Toggle skill ${skill.name}`}
                  >
                    <span
                      className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-zinc-100 transition-all ${
                        isOn ? "left-[calc(100%-11px)]" : "left-0.5"
                      }`}
                    />
                  </button>

                  {/* Skill name + description */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span
                      className={`text-[11px] truncate ${
                        isOn ? "text-zinc-300" : "text-zinc-600"
                      }`}
                    >
                      {skill.name}
                    </span>
                    {skill.description && (
                      <span className="text-[10px] text-zinc-600 truncate" title={skill.description}>
                        {skill.description}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
