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
