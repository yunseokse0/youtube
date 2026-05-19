/**
 * `/api/events` 브로드캐스트. 동시에 수십~수백 번 호출되면 브라우저가
 * `net::ERR_INSUFFICIENT_RESOURCES` 로 막을 수 있어, POST는 직렬화하고
 * 대기 중 호출은 최신 페이로드 하나로 합친다.
 */
type SsePostJob = {
  body: string;
  resolveAll: Array<() => void>;
};

let ssePostInFlight = false;
let ssePostPending: SsePostJob | null = null;

async function runSsePostQueue(): Promise<void> {
  if (ssePostInFlight || !ssePostPending) return;
  ssePostInFlight = true;
  const job = ssePostPending;
  ssePostPending = null;
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: job.body,
      credentials: "include",
    });
  } catch {
    // ignore network errors; polling will still update overlays
  } finally {
    for (const fn of job.resolveAll) fn();
    ssePostInFlight = false;
    if (ssePostPending) void runSsePostQueue();
  }
}

function enqueueSsePost(body: string): Promise<void> {
  return new Promise((resolve) => {
    if (!ssePostPending) {
      ssePostPending = { body, resolveAll: [resolve] };
    } else {
      ssePostPending.body = body;
      ssePostPending.resolveAll.push(resolve);
    }
    void runSsePostQueue();
  });
}

export async function sendSSEUpdate(data: unknown): Promise<void> {
  const body = JSON.stringify(data);
  await enqueueSsePost(body);
}

export type StateUpdatedSsePayload = {
  type: "state_updated";
  updatedAt: number;
  donorRankingsUpdatedAt?: number;
};

/** 저장·회전판 등 상태 변경 후 OBS 알림(전체 JSON은 보내지 않음) */
export async function broadcastStateUpdatedAt(
  updatedAt: number,
  extra?: { donorRankingsUpdatedAt?: number }
): Promise<void> {
  const ts = Number(updatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return;
  const payload: StateUpdatedSsePayload = { type: "state_updated", updatedAt: ts };
  const dr = Number(extra?.donorRankingsUpdatedAt);
  if (Number.isFinite(dr) && dr > 0) payload.donorRankingsUpdatedAt = dr;
  await sendSSEUpdate(payload);
}
