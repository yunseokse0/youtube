export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { getRouletteUserId, loadAppStateForRoulette, saveAppStateForRoulette } from "../edge-state-store";
import { clearRouletteLock } from "../roulette-lock";
import { forwardCookieHeader } from "../../_shared/internal-state-headers";

/** 회전판만 IDLE로 되돌림(메뉴 수·히스토리 로그 등은 유지). 방송 전 오버레이 유령 결과 제거용 */
export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }

    let s = await loadAppStateForRoulette(userId);
    try {
      const stateUrl = new URL(req.url);
      stateUrl.pathname = "/api/state";
      stateUrl.search = `?user=${encodeURIComponent(userId)}`;
      const stateRes = await fetch(stateUrl.toString(), { cache: "no-store", headers: forwardCookieHeader(req) });
      if (stateRes.ok) {
        const remote = (await stateRes.json()) as AppState;
        if (remote && Array.isArray(remote.members)) {
          s = remote;
        }
      }
    } catch {}

    const cur = normalizeRouletteState(s.rouletteState);
    const idle = normalizeRouletteState(null);
    const nextRs = {
      ...idle,
      menuCount: cur.menuCount,
      menuFillFromAllActive: cur.menuFillFromAllActive,
      menuFillFromDemo: cur.menuFillFromDemo,
      overlayOpacity: cur.overlayOpacity,
      historyLogs: cur.historyLogs,
    };

    const next: AppState = {
      ...s,
      rouletteState: nextRs,
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, next);
    clearRouletteLock(userId);
    try {
      const url = new URL(req.url);
      url.pathname = "/api/state";
      url.search = `?user=${encodeURIComponent(userId)}`;
      await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...forwardCookieHeader(req) },
        body: JSON.stringify({
          rouletteState: next.rouletteState,
          updatedAt: next.updatedAt,
        }),
      });
    } catch {}

    return Response.json(
      { ok: true, phase: nextRs.phase },
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
