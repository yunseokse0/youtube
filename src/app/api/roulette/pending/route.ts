export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { getRouletteUserId, loadAppStateForRoulette, saveAppStateForRoulette } from "../edge-state-store";
import { forwardCookieHeader } from "../../_shared/internal-state-headers";

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

    const rs = normalizeRouletteState(s.rouletteState);
    const srvSession = String(rs.sessionId || "").trim();
    if (srvSession !== sessionId) {
      return Response.json({ error: "session_mismatch" }, { status: 409, headers: { "Content-Type": "application/json" } });
    }
    if (rs.phase === "CONFIRM_PENDING") {
      return Response.json({ ok: true, idempotent: true }, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    if (rs.phase === "CONFIRMED") {
      return Response.json({ error: "already_confirmed" }, { status: 409, headers: { "Content-Type": "application/json" } });
    }
    if (rs.phase !== "LANDED" && rs.phase !== "SPINNING") {
      return Response.json({ error: "bad_phase", phase: rs.phase }, { status: 409, headers: { "Content-Type": "application/json" } });
    }

    const nextRs = {
      ...rs,
      phase: "CONFIRM_PENDING" as const,
      isRolling: false,
    };

    const next: AppState = {
      ...s,
      rouletteState: nextRs,
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, next);
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

    return Response.json({ ok: true }, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
