"use client";

import { useState, useEffect, useCallback, use, useRef } from "react";
import Link from "next/link";
import { fetchTask, fetchTaskDiff, fetchTaskReview, runTask, sendTaskMessage, fetchTaskFiles, fetchTaskFileContent } from "@/lib/api";
import type { Task, Attempt, ReviewReport, TaskFile } from "@/lib/types";
import { DiffViewer } from "@/components/diff-viewer";
import { ReviewPanel } from "@/components/review-panel";
import { ApproveGate } from "@/components/approve-gate";
import { LiveTerminal } from "@/components/live-terminal";
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

function durationLabel(attempt: Attempt): string {
  if (!attempt.completed_at) return "running";
  const start = new Date(attempt.started_at).getTime();
  const end = new Date(attempt.completed_at).getTime();
  const secs = Math.round((end - start) / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.round(secs / 60)}m`;
}

type Tab = "attempts" | "diff" | "review" | "files";

export default function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [task, setTask] = useState<Task | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [diff, setDiff] = useState<string>("");
  const [review, setReview] = useState<ReviewReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("attempts");
  const [runAgent, setRunAgent] = useState<string>("claude");
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  // Follow-up message state
  const [followUpMsg, setFollowUpMsg] = useState<string>("");
  const [followUpSending, setFollowUpSending] = useState(false);
  const [followUpError, setFollowUpError] = useState<string | null>(null);
  const followUpInputRef = useRef<HTMLInputElement>(null);

  // Files tab state
  const [taskFiles, setTaskFiles] = useState<TaskFile[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [filesLoading, setFilesLoading] = useState(false);

  // Sync isRunning with task status on load and refresh.
  useEffect(() => {
    if (task) {
      setIsRunning(task.status === "running" || task.status === "claimed");
    }
  }, [task]);

  // Poll task status while running to detect completion.
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(async () => {
      try {
        const detail = await fetchTask(id);
        setTask(detail.task);
        setAttempts(detail.attempts ?? []);
        if (detail.task.status !== "running" && detail.task.status !== "claimed") {
          setIsRunning(false);
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(interval);
  }, [isRunning, id]);

  const handleRun = useCallback(async () => {
    setRunError(null);
    setIsRunning(true);
    try {
      await runTask(id, runAgent, "writer");
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "failed to start task");
      setIsRunning(false);
    }
  }, [id, runAgent]);

  const load = useCallback(async () => {
    try {
      const detail = await fetchTask(id);
      setTask(detail.task);
      setAttempts(detail.attempts ?? []);

      const [diffResult, reviewResult] = await Promise.allSettled([
        fetchTaskDiff(id),
        fetchTaskReview(id),
      ]);

      if (diffResult.status === "fulfilled") setDiff(diffResult.value);
      if (reviewResult.status === "fulfilled") setReview(reviewResult.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load task");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Load file list when files tab is active.
  useEffect(() => {
    if (tab !== "files") return;
    setFilesLoading(true);
    fetchTaskFiles(id)
      .then((res) => setTaskFiles(res.files))
      .catch(() => setTaskFiles([]))
      .finally(() => setFilesLoading(false));
  }, [tab, id]);

  const handleSelectFile = useCallback(async (name: string) => {
    setSelectedFile(name);
    setFileContent(null);
    try {
      const content = await fetchTaskFileContent(id, name);
      setFileContent(content);
    } catch {
      setFileContent("(error loading file)");
    }
  }, [id]);

  const handleFollowUp = useCallback(async () => {
    if (!followUpMsg.trim()) return;
    setFollowUpError(null);
    setFollowUpSending(true);
    try {
      await sendTaskMessage(id, followUpMsg.trim(), runAgent);
      setFollowUpMsg("");
    } catch (err) {
      setFollowUpError(err instanceof Error ? err.message : "failed to send message");
    } finally {
      setFollowUpSending(false);
      followUpInputRef.current?.focus();
    }
  }, [id, followUpMsg, runAgent]);

  // (isRunning sync is handled above with polling)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <p className="text-xs font-mono text-zinc-600 animate-pulse">loading...</p>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div className="text-center font-mono">
          <p className="text-xs text-red-400">[error] {error ?? "task not found"}</p>
          <Link href="/" className="text-xs text-zinc-600 hover:text-zinc-400 mt-2 inline-block">
            &larr; dashboard
          </Link>
        </div>
      </div>
    );
  }

  const needsApproval = task.status === "reviewing";
  const shortId = task.spec.id.slice(0, 8);

  return (
    <div className="flex flex-col flex-1 font-mono text-xs overflow-y-auto">
      {/* Breadcrumb / header */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-zinc-800 text-zinc-600 text-[11px]">
        <Link href="/" className="hover:text-zinc-400 transition-colors">dashboard</Link>
        <span>/</span>
        <Link href="/tasks" className="hover:text-zinc-400 transition-colors">tasks</Link>
        <span>/</span>
        <span className="text-zinc-400">{shortId}</span>
        <div className="flex-1" />
        <span className={cn("font-mono", statusStyle[task.status] ?? "text-zinc-500")}>
          [{task.status}]
        </span>
      </div>

      {/* Task objective */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <p className="text-zinc-200 text-sm leading-snug mb-2">{task.spec.objective}</p>
        {task.spec.constraints && task.spec.constraints.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-2">
            <span className="text-[10px] text-zinc-600 uppercase tracking-wider mb-1">constraints</span>
            {task.spec.constraints.map((c, i) => (
              <span key={i} className="text-zinc-500">· {c}</span>
            ))}
          </div>
        )}
        {task.spec.tags && task.spec.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {task.spec.tags.map((tag) => (
              <span key={tag} className="text-[10px] text-zinc-600 bg-zinc-900 px-1.5 py-0.5 border border-zinc-800">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Approve gate */}
      {needsApproval && (
        <div className="px-4 py-3 border-b border-yellow-800/50 bg-yellow-950/20">
          <div className="text-yellow-400 mb-2">[review required]</div>
          <ApproveGate taskId={id} />
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        {(["attempts", "diff", "review", "files"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-[11px] font-mono border-b-2 transition-colors",
              tab === t
                ? "border-green-500 text-green-400"
                : "border-transparent text-zinc-600 hover:text-zinc-400"
            )}
          >
            {t}{t === "attempts" ? ` (${attempts.length})` : ""}
            {t === "files" && taskFiles.length > 0 ? ` (${taskFiles.length})` : ""}
          </button>
        ))}
      </div>

      {/* Run Task controls */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-3 flex-wrap">
        <span className="text-[10px] text-zinc-600 uppercase tracking-wider">run task</span>
        <select
          value={runAgent}
          onChange={(e) => setRunAgent(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-mono px-2 py-1 focus:outline-none focus:border-zinc-500"
        >
          <option value="claude">claude</option>
          <option value="codex">codex</option>
        </select>
        <button
          onClick={handleRun}
          disabled={isRunning}
          className={cn(
            "text-xs font-mono px-3 py-1 border transition-colors",
            isRunning
              ? "border-zinc-700 text-zinc-600 cursor-not-allowed"
              : "border-green-700 text-green-400 hover:bg-green-900/20"
          )}
        >
          {isRunning ? "running..." : "▶ run"}
        </button>
        {runError && (
          <span className="text-[11px] text-red-400 font-mono">{runError}</span>
        )}
      </div>

      {/* Follow-up message input — visible when task has been run at least once */}
      {(task.status === "done" || task.status === "running" || task.status === "evaluated" || task.status === "failed") && (
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2 flex-wrap">
          <span className="text-green-500 font-mono text-xs shrink-0">follow-up &gt;</span>
          <input
            ref={followUpInputRef}
            type="text"
            value={followUpMsg}
            onChange={(e) => setFollowUpMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !followUpSending) handleFollowUp(); }}
            placeholder="change the title color to red..."
            disabled={followUpSending}
            className="flex-1 min-w-0 bg-zinc-900 border border-zinc-700 text-zinc-300 text-xs font-mono px-2 py-1 focus:outline-none focus:border-zinc-500 placeholder:text-zinc-700 disabled:opacity-50"
          />
          <button
            onClick={handleFollowUp}
            disabled={followUpSending || !followUpMsg.trim()}
            className={cn(
              "text-xs font-mono px-3 py-1 border transition-colors shrink-0",
              followUpSending || !followUpMsg.trim()
                ? "border-zinc-700 text-zinc-600 cursor-not-allowed"
                : "border-green-700 text-green-400 hover:bg-green-900/20"
            )}
          >
            {followUpSending ? "sending..." : "send"}
          </button>
          {followUpError && (
            <span className="w-full text-[11px] text-red-400 font-mono">{followUpError}</span>
          )}
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "attempts" && (
          <div className="flex flex-col">
            {attempts.length === 0 ? (
              <div className="flex items-center justify-center h-24 m-4 border border-dashed border-zinc-800">
                <p className="text-zinc-600">no attempts yet</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="grid grid-cols-[5rem_5rem_1fr_5rem_4rem] gap-x-3 px-4 py-1.5 border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-wider">
                  <span>agent</span>
                  <span>role</span>
                  <span>branch</span>
                  <span>status</span>
                  <span>duration</span>
                </div>
                {attempts.map((attempt) => (
                  <div
                    key={attempt.id}
                    className="grid grid-cols-[5rem_5rem_1fr_5rem_4rem] gap-x-3 px-4 py-2 border-b border-zinc-900 text-xs font-mono"
                  >
                    <span className="text-zinc-300">{attempt.agent}</span>
                    <span className="text-zinc-500">{attempt.role}</span>
                    <span className="text-zinc-500 truncate">{attempt.branch}</span>
                    <span
                      className={cn(
                        attempt.status === "done"
                          ? "text-green-500"
                          : attempt.status === "failed"
                          ? "text-red-400"
                          : "text-blue-400"
                      )}
                    >
                      [{attempt.status}]
                    </span>
                    <span className="text-zinc-600">{durationLabel(attempt)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {tab === "diff" && (
          <div className="p-4">
            <DiffViewer diff={diff} />
          </div>
        )}

        {tab === "review" && (
          <div className="p-4">
            {review ? (
              <ReviewPanel report={review} />
            ) : (
              <div className="flex items-center justify-center h-24 border border-dashed border-zinc-800">
                <p className="text-zinc-600">no review available yet</p>
              </div>
            )}
          </div>
        )}

        {tab === "files" && (
          <div className="flex flex-col gap-0 font-mono text-xs">
            {filesLoading ? (
              <div className="flex items-center justify-center h-24">
                <p className="text-zinc-600 animate-pulse">scanning output dir...</p>
              </div>
            ) : taskFiles.length === 0 ? (
              <div className="flex items-center justify-center h-24 m-4 border border-dashed border-zinc-800">
                <p className="text-zinc-600">no output files yet</p>
              </div>
            ) : (
              <>
                {/* File list header */}
                <div className="grid grid-cols-[1fr_6rem_10rem] gap-x-3 px-4 py-1.5 border-b border-zinc-800 text-[10px] text-zinc-600 uppercase tracking-wider">
                  <span>name</span>
                  <span className="text-right">size</span>
                  <span>modified</span>
                </div>
                {taskFiles.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => handleSelectFile(f.name)}
                    className={cn(
                      "grid grid-cols-[1fr_6rem_10rem] gap-x-3 px-4 py-2 border-b border-zinc-900 text-left transition-colors hover:bg-zinc-900/50",
                      selectedFile === f.name && "bg-zinc-900 border-l-2 border-l-green-600"
                    )}
                  >
                    <span className={cn("truncate", selectedFile === f.name ? "text-green-400" : "text-zinc-300")}>
                      {f.name}
                    </span>
                    <span className="text-zinc-600 text-right tabular-nums">
                      {f.size < 1024 ? `${f.size}B` : f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(1)}K` : `${(f.size / 1024 / 1024).toFixed(1)}M`}
                    </span>
                    <span className="text-zinc-600 truncate">
                      {new Date(f.modified).toLocaleTimeString()}
                    </span>
                  </button>
                ))}
                {/* File content viewer */}
                {selectedFile && (
                  <div className="border-t border-zinc-800">
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-900 border-b border-zinc-800">
                      <span className="text-[10px] text-zinc-500 uppercase tracking-wider">viewing</span>
                      <span className="text-zinc-300">{selectedFile}</span>
                    </div>
                    <pre className="px-4 py-3 overflow-x-auto text-[11px] leading-relaxed text-green-400 bg-zinc-950 max-h-[400px] overflow-y-auto whitespace-pre-wrap break-all">
                      {fileContent === null ? (
                        <span className="text-zinc-600 animate-pulse">loading...</span>
                      ) : (
                        fileContent
                      )}
                    </pre>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Live terminal output */}
      <div className="px-4 pb-4 pt-2">
        <LiveTerminal taskId={id} />
      </div>
    </div>
  );
}
