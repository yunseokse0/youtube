export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { getRouletteUserId, saveAppStateForRoulette } from "../edge-state-store";
import { clearRouletteLock } from "../roulette-lock";
import {
  loadAppStateForRouletteRequest,
  publishRouletteStateAfterSave,
} from "../roulette-state-sync";

/** 회전판만 IDLE로 되돌림(메뉴 수·히스토리 로그 등은 유지). 방송 전 오버레이 유령 결과 제거용 */
export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }

    let clearWonPool = false;
    try {
      const j = (await req.json()) as { clearWonPool?: boolean };
      clearWonPool = Boolean(j?.clearWonPool);
    } catch {
      /* body 없음 → 당첨 제외 목록 유지(자동 초기화 후 다음 회전) */
    }

    const s = await loadAppStateForRouletteRequest(req, userId);

    const cur = normalizeRouletteState(s.rouletteState);
    const idle = normalizeRouletteState(null);
    const nextRs = {
      ...idle,
      menuCount: cur.menuCount,
      sigResultScalePct: cur.sigResultScalePct,
      menuFillFromAllActive: cur.menuFillFromAllActive,
      overlayOpacity: cur.overlayOpacity,
      historyLogs: cur.historyLogs,
      sessionExcludedSigIds: clearWonPool ? [] : cur.sessionExcludedSigIds,
    };

    const next: AppState = {
      ...s,
      rouletteState: nextRs,
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, next);
    clearRouletteLock(userId);
    await publishRouletteStateAfterSave(req, userId, {
      rouletteState: next.rouletteState,
      updatedAt: next.updatedAt,
    });

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
