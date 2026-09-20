import { NextRequest } from "next/server";
import { broadcastSseEvent, registerSseClient } from "@/lib/sse-clients-hub";
import {
  isRedisStreamsEnabled,
  redisStreamReadNewer,
} from "@/lib/sse-streams-broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nginx·프록시 기본 read timeout(60s)보다 짧게 — ERR_INCOMPLETE_CHUNKED_ENCODING·끊김 완화 */
const SSE_PING_MS = 20_000;
const SSE_STREAMS_POLL_MS = 1_500;

export async function GET(request: NextRequest) {
  let streamsCursor = "$";
  let streamsWorkerTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;
  const stream = new ReadableStream({
    start(controller) {
      const unregister = registerSseClient(controller);

      const enqueueDataRaw = (raw: string) => {
        if (destroyed) return;
        try {
          controller.enqueue(raw);
        } catch {
          /* ignore */
        }
      };

      try {
        controller.enqueue(`retry: 5000\n\n`);
        controller.enqueue(`event: hello\ndata: "ok"\n\n`);
      } catch {
        /* ignore */
      }

      const interval = setInterval(() => {
        try {
          controller.enqueue(`: keep-alive ${Date.now()}\n\n`);
          controller.enqueue(`data: ping\n\n`);
        } catch {
          clearInterval(interval);
          unregister();
        }
      }, SSE_PING_MS);

      if (isRedisStreamsEnabled()) {
        streamsWorkerTimer = setInterval(() => {
          if (destroyed) return;
          void (async () => {
            try {
              const r = await redisStreamReadNewer(streamsCursor, {
                blockMs: 1,
                count: 32,
              });
              if (!r.ok) return;
              for (const e of r.entries) {
                if (e.payload == null) continue;
                enqueueDataRaw(
                  `data: ${JSON.stringify(e.payload)}\n\n`
                );
              }
              if (r.nextId) streamsCursor = r.nextId;
            } catch {
              /* ignore */
            }
          })();
        }, SSE_STREAMS_POLL_MS);
      }

      request.signal.addEventListener("abort", () => {
        destroyed = true;
        if (streamsWorkerTimer) {
          clearInterval(streamsWorkerTimer);
          streamsWorkerTimer = null;
        }
        clearInterval(interval);
        unregister();
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const maxBytes = 512_000;
    const cl = request.headers.get("content-length");
    if (cl && Number(cl) > maxBytes) {
      return new Response("Payload too large", { status: 413 });
    }
    const data = await request.json();
    broadcastSseEvent(data);
    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[API/Events] 이벤트 처리 실패", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
