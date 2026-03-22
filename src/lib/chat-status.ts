import "server-only";
import { subscribe } from "./events";
import type { SSEEvent } from "./types";

interface ChatStatus {
  state: "idle" | "thinking" | "reasoning" | "using_tool" | "writing";
  detail: string;
  updatedAt: string;
}

// In-memory state — updated by subscribing to chat.status SSE events
let currentStatus: ChatStatus = {
  state: "idle",
  detail: "",
  updatedAt: new Date().toISOString(),
};

// Subscribe to chat.status events published by the chat route
subscribe((event: SSEEvent) => {
  if (event.type === "chat.status") {
    const data = event.data as { state?: string; detail?: string } | undefined;
    if (data?.state) {
      currentStatus = {
        state: data.state as ChatStatus["state"],
        detail: (data.detail ?? "").slice(0, 200),
        updatedAt: new Date().toISOString(),
      };
    }
  }
});

export function getChatStatus(): ChatStatus {
  return currentStatus;
}
