import { NextRequest } from "next/server";
import { subscribe } from "@/lib/events";

export async function GET(req: NextRequest) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`event: connected\ndata: {}\n\n`));

      const unsubscribe = subscribe((event) => {
        try {
          // Emit as unnamed "message" events so EventSource.onmessage fires.
          // The event type is encoded inside the JSON payload (event.type).
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify(event)}\n\n`,
            ),
          );
        } catch {
          /* stream closed */
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`event: ping\ndata: {}\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
