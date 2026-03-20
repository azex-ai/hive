import "server-only";
import type { ChatMessage } from "./types";

const chatHistory: ChatMessage[] = [];

export function getChatHistory(): ChatMessage[] {
  return [...chatHistory];
}

export function addChatMessage(msg: ChatMessage): void {
  chatHistory.push(msg);
}
