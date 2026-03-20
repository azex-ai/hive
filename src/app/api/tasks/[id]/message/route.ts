import { NextRequest, NextResponse } from "next/server";
import { getTask } from "@/lib/scheduler";
import { getTaskSessionHistory, appendTaskSession } from "@/lib/executor";
import { getOutputDir } from "@/lib/config";
import { isValidTaskId } from "@/lib/validate";
import { publishEvent } from "@/lib/events";
import fs from "fs";
import path from "path";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidTaskId(id)) {
    return NextResponse.json({ error: "invalid task id" }, { status: 400 });
  }

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

  const task = getTask(id);
  if (!task)
    return NextResponse.json({ error: "task not found" }, { status: 404 });

  const history = getTaskSessionHistory(id);
  const promptParts = [`Original task: ${task.spec.objective}`];
  if (history.length > 0) {
    promptParts.push("\n--- Previous context ---");
    promptParts.push(...history);
  }
  promptParts.push("\n--- Follow-up message ---");
  promptParts.push(message);
  const combinedPrompt = promptParts.join("\n");

  const outputDir = getOutputDir();
  const taskOutDir = path.join(outputDir, id);
  fs.mkdirSync(taskOutDir, { recursive: true });

  publishEvent({
    type: "task_output",
    task_id: id,
    data: { line: `[hive] follow-up: ${message}` },
  });

  try {
    const { query } = await import("@anthropic-ai/claude-code");
    let output = "";

    for await (const msg of query({
      prompt: combinedPrompt,
      options: { abortController: new AbortController(), maxTurns: 1, cwd: taskOutDir, permissionMode: "bypassPermissions" as const },
    })) {
      if (msg.type === "result" && msg.subtype === "success") {
        output = typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result);
      }
    }

    // Publish output lines
    for (const line of output.split("\n")) {
      if (line.trim()) {
        publishEvent({ type: "task_output", task_id: id, data: { line } });
      }
    }

    // Append to log
    const logPath = path.join(taskOutDir, "output.log");
    fs.appendFileSync(
      logPath,
      `\n--- follow-up: ${message} ---\n${output}`,
    );

    appendTaskSession(id, `Follow-up: ${message}`, `Output: ${output}`);

    return NextResponse.json({ data: { task_id: id, output, exit_code: 0 } });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
