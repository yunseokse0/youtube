/** `/api/events` SSE 클라이언트 — 서버 내부 브로드캐스트 + Redis Streams 2Way Hybrid */
import { redisStreamPublishEvent } from "@/lib/sse-streams-broadcast";

const MAX_SSE_CLIENTS = 2048;

const clients = new Set<ReadableStreamDefaultController>();
const lruOrder: Array<{ controller: ReadableStreamDefaultController; lastTouchTs: number }> = [];

function touchController(controller: ReadableStreamDefaultController, now = Date.now()): void {
  const idx = lruOrder.findIndex((e) => e.controller === controller);
  if (idx >= 0) {
    lruOrder[idx]!.lastTouchTs = now;
    lruOrder.push(lruOrder.splice(idx, 1)[0]!);
    return;
  }
  lruOrder.push({ controller, lastTouchTs: now });
}

function dropController(controller: ReadableStreamDefaultController): void {
  clients.delete(controller);
  const idx = lruOrder.findIndex((e) => e.controller === controller);
  if (idx >= 0) lruOrder.splice(idx, 1);
  try {
    controller.close();
  } catch {
    /* ignore */
  }
}

function trimSseClients(): void {
  if (clients.size <= MAX_SSE_CLIENTS) return;
  const dropN = Math.max(8, Math.ceil((clients.size - MAX_SSE_CLIENTS) * 1.1));
  for (let i = 0; i < dropN && lruOrder.length > 0; i++) {
    const eldest = lruOrder.shift();
    if (!eldest) break;
    if (clients.has(eldest.controller)) dropController(eldest.controller);
  }
}

export function registerSseClient(controller: ReadableStreamDefaultController): () => void {
  trimSseClients();
  clients.add(controller);
  touchController(controller);
  let closed = false;
  return () => {
    if (closed) return;
    closed = true;
    dropController(controller);
  };
}

export function getSseClientCount(): number {
  return clients.size;
}

export function broadcastSseEvent(data: unknown): void {
  trimSseClients();
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  const now = Date.now();
  const failed: ReadableStreamDefaultController[] = [];
  for (const controller of clients) {
    try {
      controller.enqueue(payload);
      touchController(controller, now);
    } catch {
      failed.push(controller);
    }
  }
  for (const f of failed) dropController(f);
}

/**
 * 2Way Broadcast (P3 적용)
 *  · ① Process Local: 현재 Node 프로세스 clients[] 에 직접 enqueue (O(1) Set)
 *  · ② Redis Streams: UPSTASH_REDIS 설정 시 XADD din:sse:events:v1 — pm2 multi cluster / 다른 인스턴스 구독자에게도 도달
 *  · ③ Fallback Loopback HTTP: Redis 비활성 환경 + 로컬 구독자 0일 때만 /api/events POST 루프백 (단일 인스턴스 시나리오 커버)
 */
export async function publishSseEvent(data: unknown): Promise<void> {
  if (clients.size > 0) {
    broadcastSseEvent(data);
  }
  const streamsOk = await redisStreamPublishEvent(data)
    .then((r) => r.ok)
    .catch(() => false);
  if (streamsOk) return;
  if (clients.size > 0) return;
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
