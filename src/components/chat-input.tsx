"use client";

import {
  useState,
  useRef,
  useEffect,
  type KeyboardEvent,
} from "react";
import { fetchChatHistory } from "@/lib/api";
import type { ChatMessage, Task, TaskSpec } from "@/lib/types";
import { cn } from "@/lib/utils";

interface ChatInputProps {
  onTasksCreated?: (tasks: Task[]) => void;
}

interface DisplayMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  intent?: string;
  taskCount?: number;
  taskId?: string;
  created_at: string;
}

function taskSpecToTask(spec: TaskSpec): Task {
  return {
    spec,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function IntentBadge({ intent }: { intent: string }) {
  const colors: Record<string, string> = {
    create_tasks: "text-green-500",
    reply: "text-zinc-500",
    query_status: "text-blue-400",
    approve: "text-emerald-400",
    reject: "text-red-400",
    run_task: "text-yellow-400",
  };
  const labels: Record<string, string> = {
    create_tasks: "tasks created",
    reply: "reply",
    query_status: "status",
    approve: "approved",
    reject: "rejected",
    run_task: "started",
  };
  const color = colors[intent] ?? "text-zinc-500";
  const label = labels[intent] ?? intent;
  return (
    <span className={`text-[10px] ${color} opacity-70 ml-1`}>[{label}]</span>
  );
}

/** Stream status labels for intermediate events */
const STREAM_LABELS: Record<string, string> = {
  thinking: "reasoning",
  tool_use: "using tool",
  tool_result: "got result",
  text: "writing",
};

export function ChatInput({ onTasksCreated }: ChatInputProps) {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string>("");
  const [streamDetail, setStreamDetail] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, loading, streamStatus]);

  // Fetch history on mount
  useEffect(() => {
    fetchChatHistory()
      .then((history: ChatMessage[]) => {
        if (history.length > 0) {
          setMessages(
            history.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              created_at: m.created_at,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  async function handleSend() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: DisplayMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setStreamStatus("connecting");
    setStreamDetail("");

    try {
      const res = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6)) as Record<string, string>;
              handleStreamEvent(eventType, data);
            } catch {
              // ignore malformed data
            }
            eventType = "";
          }
        }
      }
    } catch (err) {
      const errMsg: DisplayMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `error: ${err instanceof Error ? err.message : "unknown error"}`,
        intent: "reply",
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setLoading(false);
      setStreamStatus("");
      setStreamDetail("");
      inputRef.current?.focus();
    }
  }

  function handleStreamEvent(event: string, data: Record<string, string>) {
    switch (event) {
      case "thinking":
        setStreamStatus("reasoning");
        setStreamDetail(data.content?.slice(0, 80) ?? "");
        break;
      case "text":
        setStreamStatus("writing");
        setStreamDetail(data.content?.slice(0, 80) ?? "");
        break;
      case "tool_use":
        setStreamStatus("using tool");
        setStreamDetail(data.content?.slice(0, 80) ?? "");
        break;
      case "tool_result":
        setStreamStatus("got result");
        setStreamDetail(data.content?.slice(0, 80) ?? "");
        break;
      case "done": {
        const assistantMsg: DisplayMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: data.response ?? "",
          intent: data.intent,
          taskCount: Array.isArray(data.tasks) ? (data.tasks as unknown[]).length : 0,
          taskId: data.task_id,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // Handle created tasks
        const tasks = data.tasks as unknown;
        if (Array.isArray(tasks) && tasks.length > 0) {
          onTasksCreated?.((tasks as TaskSpec[]).map(taskSpecToTask));
        }
        break;
      }
      case "error": {
        const errMsg: DisplayMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: `error: ${data.error ?? "unknown"}`,
          intent: "reply",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errMsg]);
        break;
      }
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-950 font-mono text-xs">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-zinc-800 text-zinc-600 text-[10px] uppercase tracking-wider select-none">
        supervisor
      </div>

      {/* Conversation log */}
      <div
        ref={logRef}
        className="flex-1 overflow-y-auto flex flex-col gap-1.5 px-3 py-3"
      >
        {messages.length === 0 && !loading && (
          <p className="text-zinc-700 text-[11px] italic">
            describe a task, ask a question, or say &ldquo;run HIVE-1&rdquo;...
          </p>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className="flex flex-col gap-0.5">
            {msg.role === "user" ? (
              <div className="flex gap-2 leading-5">
                <span className="text-green-500 shrink-0 select-none">&gt;</span>
                <span className="text-green-400 break-words">{msg.content}</span>
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                <div className="flex gap-2 leading-5 items-start">
                  <span className="text-zinc-600 shrink-0 select-none">$</span>
                  <span
                    className={
                      msg.content.startsWith("error:")
                        ? "text-red-400 break-words"
                        : "text-zinc-300 break-words"
                    }
                  >
                    {msg.content}
                  </span>
                  {msg.intent && <IntentBadge intent={msg.intent} />}
                </div>

                {msg.intent === "create_tasks" && msg.taskCount != null && msg.taskCount > 0 && (
                  <div className="ml-4 text-[10px] text-zinc-500">
                    → {msg.taskCount} task{msg.taskCount !== 1 ? "s" : ""} queued
                  </div>
                )}

                {(msg.intent === "approve" ||
                  msg.intent === "reject" ||
                  msg.intent === "run_task") &&
                  msg.taskId && (
                    <div className="ml-4 text-[10px] text-zinc-500">
                      → {msg.taskId}
                    </div>
                  )}
              </div>
            )}
          </div>
        ))}

        {/* Streaming status — shows real-time supervisor state */}
        {loading && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-2 leading-5 items-center">
              <span className="text-zinc-600 shrink-0 select-none">$</span>
              <span className="text-yellow-500/80 animate-pulse">
                {streamStatus || "thinking"}...
              </span>
            </div>
            {streamDetail && (
              <div className="ml-4 text-[10px] text-zinc-600 truncate max-w-full">
                {streamDetail}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input row */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-zinc-800">
        <span className="text-green-500 select-none shrink-0">&gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="describe a task or ask hive to do something..."
          disabled={loading}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          className="flex-1 bg-transparent text-zinc-200 placeholder:text-zinc-700 text-xs font-mono focus:outline-none disabled:opacity-50"
        />
        {loading && streamStatus && (
          <span className="text-yellow-600 text-[10px] shrink-0">
            {STREAM_LABELS[streamStatus] ?? streamStatus}
          </span>
        )}
      </div>
    </div>
  );
}
