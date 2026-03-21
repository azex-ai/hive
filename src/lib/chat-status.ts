import "server-only";
import fs from "fs";
import path from "path";

// Use /tmp for cross-module file sharing — avoids Turbopack cwd inconsistencies
const STATUS_FILE = "/tmp/hive-chat-status.json";

interface ChatStatus {
  state: "idle" | "thinking" | "reasoning" | "using_tool" | "writing";
  detail: string;
  updatedAt: string;
}

export function setChatStatus(state: ChatStatus["state"], detail = ""): void {
  const dir = path.dirname(STATUS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    STATUS_FILE,
    JSON.stringify({ state, detail: detail.slice(0, 200), updatedAt: new Date().toISOString() }),
    "utf-8",
  );
}

export function getChatStatus(): ChatStatus {
  try {
    if (fs.existsSync(STATUS_FILE)) {
      return JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8")) as ChatStatus;
    }
  } catch { /* ignore */ }
  return { state: "idle", detail: "", updatedAt: new Date().toISOString() };
}
