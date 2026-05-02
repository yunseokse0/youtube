export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { normalizeSigInventory } from "@/lib/constants";
import type { SigItem } from "@/types";
import { getRouletteUserId, loadAppStateForRoulette, saveAppStateForRoulette } from "../edge-state-store";
import { forwardCookieHeader } from "../../_shared/internal-state-headers";

const ONE_SHOT_SIG_ID = "sig_one_shot";

/** 오버레이 휠 착지 직후 서버를 SPINNING → LANDED로 동기화 (폴링이 로컬 단계를 덮어쓰지 않도록) */
export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let body: {
      sessionId?: string;
      startedAt?: number;
      selectedSigs?: SigItem[];
      oneShotResult?: { id: string; name: string; price: number } | null;
    };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return Response.json({ error: "invalid_body" }, { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) {
      return Response.json({ error: "session_required" }, { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const selectedRaw = Array.isArray(body.selectedSigs) ? body.selectedSigs : [];
    const selectedSigs = normalizeSigInventory(selectedRaw.filter((x) => x && typeof x === "object") as unknown[]);
    if (selectedSigs.length === 0) {
      return Response.json({ error: "selected_required" }, { status: 400, headers: { "Content-Type": "application/json" } });
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
    if (rs.phase === "CONFIRMED") {
      return Response.json({ error: "already_confirmed" }, { status: 409, headers: { "Content-Type": "application/json" } });
    }
    if (rs.phase === "LANDED" || rs.phase === "CONFIRM_PENDING") {
      return Response.json({ ok: true, idempotent: true }, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    if (rs.phase !== "SPINNING") {
      return Response.json({ error: "bad_phase", phase: rs.phase }, { status: 409, headers: { "Content-Type": "application/json" } });
    }
    const bodyStartedAt = Number(body.startedAt || 0);
    const srvStartedAt = Number(rs.startedAt || 0);
    if (bodyStartedAt > 0 && srvStartedAt > 0 && bodyStartedAt !== srvStartedAt) {
      return Response.json({ error: "startedAt_mismatch" }, { status: 409, headers: { "Content-Type": "application/json" } });
    }

    const result = selectedSigs[selectedSigs.length - 1] || rs.result || null;
    let oneShotResult =
      body.oneShotResult && typeof body.oneShotResult === "object"
        ? {
            id: String(body.oneShotResult.id || ONE_SHOT_SIG_ID),
            name: String(body.oneShotResult.name || "한방 시그"),
            price: Math.max(0, Math.floor(Number(body.oneShotResult.price || 0))),
          }
        : rs.oneShotResult;
    if (!oneShotResult && selectedSigs.length >= 2) {
      oneShotResult = {
        id: ONE_SHOT_SIG_ID,
        name: "한방 시그",
        price: selectedSigs.reduce((sum, x) => sum + Math.max(0, Math.floor(Number(x.price || 0))), 0),
      };
    }

    const nextRs = {
      ...rs,
      phase: "LANDED" as const,
      isRolling: false,
      selectedSigs,
      results: selectedSigs,
      result,
      oneShotResult,
      spinCount: selectedSigs.length,
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
