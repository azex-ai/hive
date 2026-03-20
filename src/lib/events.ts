import "server-only";
import type { SSEEvent } from "./types";

export type { SSEEvent };

type Subscriber = (event: SSEEvent) => void;

const subscribers = new Set<Subscriber>();

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
