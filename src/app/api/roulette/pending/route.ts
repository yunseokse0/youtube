export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { getRouletteUserId, saveAppStateForRoulette } from "../edge-state-store";
import {
  loadAppStateForRouletteRequest,
  publishRouletteStateAfterSave,
} from "../roulette-state-sync";

/** 판매 확정 버튼 직후 서버 phase를 CONFIRM_PENDING으로 올려 오버레이 폴링과 동기화 */
export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let body: { sessionId?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid_body" }, { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) {
      return Response.json({ error: "session_required" }, { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const s = await loadAppStateForRouletteRequest(req, userId);

    const rs = normalizeRouletteState(s.rouletteState);
    const srvSession = String(rs.sessionId || "").trim();
    const hasSelection =
      (Array.isArray(rs.selectedSigs) && rs.selectedSigs.length > 0) ||
      (Array.isArray(rs.results) && rs.results.length > 0);

    if (rs.phase === "CONFIRM_PENDING") {
      return Response.json({ ok: true, idempotent: true }, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    if (rs.phase === "CONFIRMED") {
      return Response.json({ ok: true, idempotent: true, alreadyConfirmed: true }, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }

    let adoptSessionId = sessionId;
    if (srvSession && srvSession !== sessionId) {
      /** 수동 회차: 클라이언트 sessionId가 최신이고 서버에 당첨 목록이 있으면 서버 sessionId 동기화 */
      if (hasSelection && (rs.phase === "LANDED" || rs.phase === "SPINNING")) {
        adoptSessionId = sessionId;
      } else {
        return Response.json(
          { error: "session_mismatch", serverSessionId: srvSession, phase: rs.phase },
          { status: 409, headers: { "Content-Type": "application/json" } }
        );
      }
    } else if (!srvSession && sessionId) {
      adoptSessionId = sessionId;
    }

    if (rs.phase !== "LANDED" && rs.phase !== "SPINNING") {
      /** 당첨 데이터가 있으면 LANDED로 올린 뒤 확정 대기(수동 적용 직후 서버 phase 지연) */
      if (!hasSelection) {
        return Response.json({ error: "bad_phase", phase: rs.phase }, { status: 409, headers: { "Content-Type": "application/json" } });
      }
    }

    const nextRs = {
      ...rs,
      sessionId: adoptSessionId,
      phase: "CONFIRM_PENDING" as const,
      isRolling: false,
    };

    const next: AppState = {
      ...s,
      rouletteState: nextRs,
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, next);
    await publishRouletteStateAfterSave(req, userId, {
      rouletteState: next.rouletteState,
      updatedAt: next.updatedAt,
    });

    return Response.json({ ok: true }, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
