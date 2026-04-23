export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { getRouletteUserId, loadAppStateForRoulette, saveAppStateForRoulette } from "../edge-state-store";
import { clearRouletteLock } from "../roulette-lock";

/** 룰렛 애니메이션 종료 후 isRolling=false (당첨 result는 유지) */
export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let s = await loadAppStateForRoulette(userId);
    // Redis 미설정 시 Edge isolate 간 메모리가 분리될 수 있어 /api/state 최신본을 우선 조회
    try {
      const stateUrl = new URL(req.url);
      stateUrl.pathname = "/api/state";
      stateUrl.search = `?user=${encodeURIComponent(userId)}`;
      const stateRes = await fetch(stateUrl.toString(), { cache: "no-store" });
      if (stateRes.ok) {
        const remote = (await stateRes.json()) as AppState;
        if (remote && Array.isArray(remote.members)) {
          s = remote;
        }
      }
    } catch {}
    const rs = normalizeRouletteState(s.rouletteState);
    const next: AppState = {
      ...s,
      rouletteState: {
        ...rs,
        isRolling: false,
      },
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, next);
    // Redis 미설정 환경(Edge 인메모리 분리)에서도 /api/state 응답을 맞춰준다.
    try {
      const url = new URL(req.url);
      url.pathname = "/api/state";
      url.search = `?user=${encodeURIComponent(userId)}`;
      await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rouletteState: next.rouletteState,
          updatedAt: next.updatedAt,
        }),
      });
    } catch {}
    clearRouletteLock(userId);
    return Response.json({ ok: true }, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
