import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  supervisorSend,
  buildSupervisorSystemPrompt,
  extractSupervisorEnvelope,
} from "@/lib/supervisor";
import { submitTasks, updateTaskStatus } from "@/lib/scheduler";
import { runTask, scheduleDispatch } from "@/lib/executor";
import { publishEvent } from "@/lib/events";
import { addChatMessage, getChatHistory } from "@/lib/chat-store";
import type { ChatMessage } from "@/lib/types";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const message = body.message;
  if (!message)
    return NextResponse.json(
      { error: "message is required" },
      { status: 400 },
    );

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

  try {
    const rawOutput = await supervisorSend(fullPrompt);
    const env = extractSupervisorEnvelope(rawOutput);
    if (!env.response) env.response = "(no response)";

    // Save assistant message
    addChatMessage({
      id: uuidv4(),
      role: "assistant",
      content: env.response,
      created_at: new Date().toISOString(),
    });

    // Route by intent
    let createdTasks: unknown[] = [];

    switch (env.intent) {
      case "create_tasks":
        if (env.tasks?.length) {
          for (const t of env.tasks) {
            if (!t.title && t.id) t.title = t.id;
            t.id = "";
          }
          createdTasks = submitTasks(env.tasks);
          publishEvent({
            type: "chat.tasks.created",
            data: {
              count: createdTasks.length,
              summary: env.response,
            },
          });
          // Auto-dispatch: start executing newly created tasks
          scheduleDispatch();
        }
        break;

      case "approve":
        if (env.task_id) {
          updateTaskStatus(env.task_id, "evaluated");
          publishEvent({
            type: "task.approved",
            data: { task_id: env.task_id },
          });
        }
        break;

      case "reject":
        if (env.task_id) {
          updateTaskStatus(env.task_id, "failed");
          publishEvent({
            type: "task.rejected",
            data: { task_id: env.task_id },
          });
        }
        break;

      case "run_task":
        if (env.task_id) {
          const agent = env.agent || "claude";
          runTask(env.task_id, agent, "writer").catch(() => {});
        }
        break;
    }

    publishEvent({
      type: "chat.message",
      data: {
        role: "assistant",
        content: env.response,
        intent: env.intent,
      },
    });

    return NextResponse.json(
      {
        data: {
          intent: env.intent,
          response: env.response,
          tasks: createdTasks.map((t: any) => t.spec || t),
          task_id: env.task_id,
          agent: env.agent,
        },
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `supervisor error: ${errMsg}` },
      { status: 500 },
    );
  }
}
