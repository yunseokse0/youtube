/** `/api/events` SSE 클라이언트 — 서버 내부 브로드캐스트(INTERNAL_ORIGIN fetch 실패 대비) */
const MAX_SSE_CLIENTS = 80;

const clients: ReadableStreamDefaultController[] = [];

function trimSseClients(): void {
  while (clients.length > MAX_SSE_CLIENTS) {
    const old = clients.shift();
    try {
      old?.close();
    } catch {
      /* ignore */
    }
  }
}

export function registerSseClient(controller: ReadableStreamDefaultController): () => void {
  trimSseClients();
  clients.push(controller);
  return () => {
    const idx = clients.indexOf(controller);
    if (idx >= 0) clients.splice(idx, 1);
  };
}

export function broadcastSseEvent(data: unknown): void {
  trimSseClients();
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const controller of clients) {
    try {
      controller.enqueue(payload);
    } catch {
      const idx = clients.indexOf(controller);
      if (idx >= 0) clients.splice(idx, 1);
    }
  }
}

/**
 * SSE 1회만 전달. 과거에는 in-memory broadcast + POST /api/events 를 동시에 호출해
 * 같은 프로세스에서 이벤트가 2번 나가 작업 로그·큐 알림이 쌍으로 쌓였다.
 * POST 성공 시 route 가 broadcast 하므로 추가 호출하지 않고, 실패 시에만 로컬 fallback.
 */
export async function publishSseEvent(data: unknown): Promise<void> {
  const origin = process.env.INTERNAL_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3000}`;
  try {
    const res = await fetch(`${origin}/api/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) return;
  } catch {
    /* fall through */
  }
  broadcastSseEvent(data);
}
