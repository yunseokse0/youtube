import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** DevTools EventStream·서버 로그 부담을 줄이기 위해 ping은 길게 유지 */
const SSE_PING_MS = 60_000;

/** Render 무료 인스턴스: SSE·OBS 소스가 많으면 연결 폭주 → 502 유발 가능 */
const MAX_SSE_CLIENTS = 80;

let clients: ReadableStreamDefaultController[] = [];

function trimSseClients() {
  while (clients.length > MAX_SSE_CLIENTS) {
    const old = clients.shift();
    try {
      old?.close();
    } catch {
      /* ignore */
    }
  }
}

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      trimSseClients();
      clients.push(controller);

      try {
        controller.enqueue(`retry: 5000\n\n`);
        controller.enqueue(`event: hello\ndata: "ok"\n\n`);
      } catch {
        /* ignore */
      }

      const interval = setInterval(() => {
        try {
          controller.enqueue(`data: ping\n\n`);
        } catch {
          clearInterval(interval);
          clients = clients.filter((c) => c !== controller);
        }
      }, SSE_PING_MS);

      request.signal.addEventListener("abort", () => {
        clearInterval(interval);
        clients = clients.filter((c) => c !== controller);
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

    trimSseClients();
    clients.forEach((controller) => {
      try {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        clients = clients.filter((c) => c !== controller);
      }
    });

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error("[API/Events] 이벤트 처리 실패", error);
    return new Response("Internal Server Error", { status: 500 });
  }
}
