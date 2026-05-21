import type { AppState } from "@/lib/state";
import { broadcastStateUpdatedAt } from "@/lib/sse-post";
import { getRedisEnv } from "../_shared/upstash";
import { forwardCookieHeader } from "../_shared/internal-state-headers";
import { loadAppStateForRoulette } from "./edge-state-store";

export function isRouletteSharedRedisConfigured(): boolean {
  const { base, token } = getRedisEnv();
  return Boolean(base && token);
}

/**
 * Upstash 사용 시 edge-state-store만. Redis 없을 때만 /api/state GET(로컬·메모리 분리 폴백).
 */
export async function loadAppStateForRouletteRequest(
  req: Request,
  userId: string
): Promise<AppState> {
  let s = await loadAppStateForRoulette(userId);
  if (isRouletteSharedRedisConfigured()) return s;
  try {
    const stateUrl = new URL(req.url);
    stateUrl.pathname = "/api/state";
    stateUrl.search = `?user=${encodeURIComponent(userId)}`;
    const stateRes = await fetch(stateUrl.toString(), {
      cache: "no-store",
      headers: forwardCookieHeader(req),
    });
    if (stateRes.ok) {
      const remote = (await stateRes.json()) as AppState;
      if (remote && Array.isArray(remote.members)) {
        s = remote;
      }
    }
  } catch {
    /* noop */
  }
  return s;
}

/**
 * 저장 후 OBS 알림(SSE). Redis 있으면 중복 POST /api/state 생략(대역폭·Upstash 이중 쓰기 방지).
 */
export async function publishRouletteStateAfterSave(
  req: Request,
  userId: string,
  patch: { rouletteState: AppState["rouletteState"]; updatedAt: number }
): Promise<void> {
  const rs = patch.rouletteState;
  void broadcastStateUpdatedAt(patch.updatedAt, {
    roulettePhase: rs?.phase,
    rouletteSessionId: rs?.sessionId,
  });
  if (isRouletteSharedRedisConfigured()) return;
  try {
    const url = new URL(req.url);
    url.pathname = "/api/state";
    url.search = `?user=${encodeURIComponent(userId)}`;
    await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...forwardCookieHeader(req) },
      body: JSON.stringify({
        rouletteState: patch.rouletteState,
        updatedAt: patch.updatedAt,
      }),
    });
  } catch {
    /* noop */
  }
}
