import "server-only";
import type { ChatMessage } from "./types";

/** Chat history per workspace. Key = workspace path, value = messages */
const historyByWorkspace = new Map<string, ChatMessage[]>();

/** Currently active workspace for chat */
let activeWorkspace = "";

export function setActiveWorkspace(workspace: string): void {
  activeWorkspace = workspace;
}

export function getActiveWorkspace(): string {
  return activeWorkspace;
}

export function getChatHistory(workspace?: string): ChatMessage[] {
  const ws = workspace ?? activeWorkspace;
  return [...(historyByWorkspace.get(ws) ?? [])];
}

export function addChatMessage(msg: ChatMessage, workspace?: string): void {
  const ws = workspace ?? activeWorkspace;
  if (!historyByWorkspace.has(ws)) {
    historyByWorkspace.set(ws, []);
  }
  const history = historyByWorkspace.get(ws)!;
  history.push(msg);
  // Cap at 200 messages per workspace
  if (history.length > 200) {
    history.splice(0, history.length - 200);
  }
}

/** Clear chat history for a workspace */
export function clearChatHistory(workspace?: string): void {
  const ws = workspace ?? activeWorkspace;
  historyByWorkspace.delete(ws);
}
