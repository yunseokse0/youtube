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
 * 같은 Node 프로세스에 SSE 구독자가 있으면 루프백 HTTP 없이 직접 broadcast.
 * EC2 pm2 단일 인스턴스에서 매 후원 저장마다 /api/events POST 왕복을 제거한다.
 */
export async function publishSseEvent(data: unknown): Promise<void> {
  if (clients.length > 0) {
    broadcastSseEvent(data);
    return;
  }
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
