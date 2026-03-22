import "server-only";
import type { SSEEvent } from "./types";

export type { SSEEvent };

type Subscriber = (event: SSEEvent) => void;

const subscribers = new Set<Subscriber>();

/**
 * Set of task IDs currently in a rate-limited pause.
 * Updated by executor when rate_limited / task-end events fire.
 */
export const rateLimitPausedTasks = new Set<string>();

export function setRateLimitPaused(paused: boolean, taskId?: string): void {
  if (taskId) {
    if (paused) {
      rateLimitPausedTasks.add(taskId);
    } else {
      rateLimitPausedTasks.delete(taskId);
    }
  } else {
    // Legacy path: clear all when no taskId provided
    if (!paused) rateLimitPausedTasks.clear();
  }
}

export function isRateLimitPaused(): boolean {
  return rateLimitPausedTasks.size > 0;
}

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function publishEvent(event: SSEEvent): void {
  if (!event.timestamp) event.timestamp = new Date().toISOString();
  for (const fn of subscribers) {
    try {
      fn(event);
    } catch {
      /* skip slow consumers */
    }
  }
}
