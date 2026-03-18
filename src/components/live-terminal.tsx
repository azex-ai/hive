"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { cn } from "@/lib/utils";

interface TerminalLine {
  timestamp: string;
  text: string;
  kind: "output" | "error" | "status" | "system";
}

interface LiveTerminalProps {
  taskId: string;
}

function formatTime(iso?: string): string {
  const d = iso ? new Date(iso) : new Date();
  return d.toTimeString().slice(0, 8);
}

export function LiveTerminal({ taskId }: LiveTerminalProps) {
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [connected, setConnected] = useState(false);
  const [userScrolled, setUserScrolled] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  const appendLine = useCallback((text: string, kind: TerminalLine["kind"], ts?: string) => {
    setLines((prev) => [...prev, { timestamp: formatTime(ts), text, kind }]);
  }, []);

  // Load historical output from saved log file on mount.
  useEffect(() => {
    fetch(`/api/tasks/${taskId}/log`)
      .then((r) => r.json())
      .then((data) => {
        const log = data?.data?.log;
        if (log && typeof log === "string" && log.trim()) {
          const logLines: TerminalLine[] = log.split("\n").filter(Boolean).map((line: string) => ({
            timestamp: "--:--:--",
            text: line,
            kind: "output" as const,
          }));
          setLines(logLines);
        }
      })
      .catch(() => {})
      .finally(() => setHistoryLoaded(true));
  }, [taskId]);

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    // SSE streams from the same Next.js server — no separate backend needed.
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setConnected(true);
      appendLine("stream connected", "system");
    });

    es.addEventListener("task_status", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        const d = ev.data as Record<string, string>;
        appendLine(`status → ${d.status}  agent: ${d.agent ?? ""}  role: ${d.role ?? ""}`, "status", ev.timestamp);
      } catch {
        appendLine(e.data, "status");
      }
    });

    es.addEventListener("task_output", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        const d = ev.data as Record<string, string>;
        appendLine(d.line ?? e.data, "output", ev.timestamp);
      } catch {
        appendLine(e.data, "output");
      }
    });

    es.addEventListener("task_error", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        const d = ev.data as Record<string, string>;
        appendLine(d.line ?? d.error ?? e.data, "error", ev.timestamp);
      } catch {
        appendLine(e.data, "error");
      }
    });

    es.addEventListener("task_complete", (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data);
        const d = ev.data as Record<string, string>;
        appendLine(`complete — exit ${d.exit_code ?? "0"}`, "status", ev.timestamp);
      } catch {
        appendLine("task complete", "status");
      }
    });

    es.addEventListener("ping", () => {
      // heartbeat — no-op
    });

    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects, but log the disconnect.
      appendLine("stream disconnected — reconnecting...", "system");
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [taskId, appendLine]);

  useEffect(() => {
    const cleanup = connect();
    return cleanup;
  }, [connect]);

  // Auto-scroll to bottom unless user has scrolled up.
  useEffect(() => {
    if (!userScrolled && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [lines, userScrolled]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
    setUserScrolled(!atBottom);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setUserScrolled(false);
  };

  return (
    <div className="flex flex-col w-full border border-zinc-800 bg-zinc-950">
      {/* Terminal header bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 bg-zinc-900">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider">live output</span>
          <span
            className={cn(
              "inline-block w-1.5 h-1.5 rounded-full",
              connected ? "bg-green-500" : "bg-zinc-600"
            )}
          />
          <span className={cn("text-[10px] font-mono", connected ? "text-green-500" : "text-zinc-600")}>
            {connected ? "connected" : "disconnected"}
          </span>
        </div>
        {userScrolled && (
          <button
            onClick={scrollToBottom}
            className="text-[10px] font-mono text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ↓ scroll to bottom
          </button>
        )}
      </div>

      {/* Terminal body */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="h-[400px] overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {lines.length === 0 ? (
          <span className="text-zinc-600">waiting for output...</span>
        ) : (
          lines.map((line, i) => (
            <div key={i} className="flex gap-2 min-w-0">
              <span className="shrink-0 text-zinc-600">[{line.timestamp}]</span>
              <span
                className={cn(
                  "break-all whitespace-pre-wrap",
                  line.kind === "error" && "text-red-400",
                  line.kind === "status" && "text-yellow-400",
                  line.kind === "system" && "text-zinc-500",
                  line.kind === "output" && "text-green-400"
                )}
              >
                {line.text}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
