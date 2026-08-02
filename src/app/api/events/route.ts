import { NextRequest } from "next/server";
import { broadcastSseEvent, registerSseClient } from "@/lib/sse-clients-hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Nginx·프록시 기본 read timeout(60s)보다 짧게 — ERR_INCOMPLETE_CHUNKED_ENCODING·끊김 완화 */
const SSE_PING_MS = 20_000;

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      const unregister = registerSseClient(controller);

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

      request.signal.addEventListener("abort", () => {
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
