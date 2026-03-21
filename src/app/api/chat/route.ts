import { NextRequest, NextResponse } from "next/server";
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
import { setChatStatus } from "@/lib/chat-status";
import type { ChatMessage } from "@/lib/types";

export async function POST(req: NextRequest) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
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
    // Stream supervisor events — write status to file for frontend polling
    setChatStatus("thinking", "connecting to agent...");
    let rawOutput = "";
    let textBuffer = "";
    let currentTool = "";

    for await (const event of supervisorStream(fullPrompt)) {
      switch (event.type) {
        case "result":
          rawOutput = event.content;
          break;
        case "text":
          textBuffer += event.content;
          // Update status with latest text chunk (show tail)
          setChatStatus("writing", textBuffer.slice(-200));
          break;
        case "thinking":
          setChatStatus("reasoning", event.content.slice(-200));
          break;
        case "tool_start":
          currentTool = event.toolName ?? event.content;
          setChatStatus("using_tool", currentTool);
          break;
        case "tool_delta":
          setChatStatus("using_tool", `${currentTool}: ${event.content.slice(0, 150)}`);
          break;
        case "block_stop":
          break;
      }
    }
    setChatStatus("idle");

    const env = extractSupervisorEnvelope(rawOutput);
    if (!env.response) env.response = rawOutput.trim() || "(no response)";

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
          const config = getConfig();
          createdTasks = submitTasks(env.tasks, config.repo ?? "");
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
          runTask(env.task_id, agent, "writer").catch((err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(
              `[hive] runTask failed for ${env.task_id}:`,
              errMsg,
            );
            publishEvent({
              type: "task.error",
              task_id: env.task_id,
              data: { error: errMsg },
            });
          });
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
          tasks: createdTasks.map((t) => {
            const obj = t as { spec?: unknown };
            return obj.spec || t;
          }),
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
