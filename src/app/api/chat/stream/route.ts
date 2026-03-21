import { NextRequest } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  supervisorStream,
  buildSupervisorSystemPrompt,
  extractSupervisorEnvelope,
} from "@/lib/supervisor";
import { submitTasks, updateTaskStatus } from "@/lib/scheduler";
import { getConfig } from "@/lib/config";
import { runTask, scheduleDispatch } from "@/lib/executor";
import { publishEvent } from "@/lib/events";
import { addChatMessage, getChatHistory } from "@/lib/chat-store";
import type { ChatMessage } from "@/lib/types";

/** SSE streaming chat endpoint — streams supervisor intermediate state in real-time */
export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const message = body.message;
  if (!message) {
    return new Response(JSON.stringify({ error: "message is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Append user message
  const userMsg: ChatMessage = {
    id: uuidv4(),
    role: "user",
    content: message,
    created_at: new Date().toISOString(),
  };
  addChatMessage(userMsg);

  // Build prompt with history
  const sysPrompt = buildSupervisorSystemPrompt();
  const history = getChatHistory();
  const historyLines = history.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
  );
  const fullPrompt =
    sysPrompt + "\n\nConversation history:\n" + historyLines.join("\n");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      }

      try {
        let finalContent = "";

        for await (const event of supervisorStream(fullPrompt)) {
          switch (event.type) {
            case "thinking":
              send("thinking", { content: event.content });
              break;
            case "text":
              send("text", { content: event.content });
              break;
            case "tool_use":
              send("tool_use", { content: event.content });
              break;
            case "tool_result":
              send("tool_result", { content: event.content });
              break;
            case "result":
              finalContent = event.content;
              break;
          }
        }

        // Parse final result
        const env = extractSupervisorEnvelope(finalContent);
        if (!env.response) env.response = finalContent.trim() || "(no response)";

        // Save assistant message
        addChatMessage({
          id: uuidv4(),
          role: "assistant",
          content: env.response,
          created_at: new Date().toISOString(),
        });

        // Route by intent (same logic as non-streaming endpoint)
        if (env.intent === "create_tasks" && env.tasks?.length) {
          for (const t of env.tasks) {
            if (!t.title && t.id) t.title = t.id;
            t.id = "";
          }
          const config = getConfig();
          const created = submitTasks(env.tasks, config.repo ?? "");
          publishEvent({
            type: "chat.tasks.created",
            data: { count: created.length, summary: env.response },
          });
          scheduleDispatch();
          env.tasks = created.map((t) => t.spec);
        } else if (env.intent === "approve" && env.task_id) {
          updateTaskStatus(env.task_id, "evaluated");
          publishEvent({ type: "task.approved", data: { task_id: env.task_id } });
        } else if (env.intent === "reject" && env.task_id) {
          updateTaskStatus(env.task_id, "failed");
          publishEvent({ type: "task.rejected", data: { task_id: env.task_id } });
        } else if (env.intent === "run_task" && env.task_id) {
          const agent = env.agent || "claude";
          runTask(env.task_id, agent, "writer").catch(() => {});
        }

        publishEvent({
          type: "chat.message",
          data: { role: "assistant", content: env.response, intent: env.intent },
        });

        // Send final result
        send("done", {
          intent: env.intent,
          response: env.response,
          tasks: env.tasks ?? [],
          task_id: env.task_id,
        });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        send("error", { error: errMsg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
