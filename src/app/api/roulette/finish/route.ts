export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import type { SigItem } from "@/types";
import { z } from "zod";
import { listRouletteLogs, saveRouletteLog } from "@/lib/sig-roulette";
import { getRouletteUserId, loadAppStateForRoulette, saveAppStateForRoulette } from "../edge-state-store";
import { clearRouletteLock } from "../roulette-lock";
import { forwardCookieHeader } from "../../_shared/internal-state-headers";

/** 회전판 애니메이션 종료 후 isRolling=false (당첨 result는 유지) */
const finishSchema = z.object({
  mode: z.enum(["default", "cinematic5"]).optional(),
  sessionId: z.string().trim().optional(),
  selectedSigs: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        price: z.number(),
        imageUrl: z.string().optional().default(""),
        memberId: z.string().optional(),
        maxCount: z.number().optional().default(1),
        soldCount: z.number().optional().default(0),
        isRolling: z.boolean().optional().default(true),
        isActive: z.boolean().optional().default(true),
      })
    )
    .optional(),
  oneShotResult: z
    .object({
      id: z.string().optional(),
      name: z.string().optional(),
      price: z.number().optional(),
    })
    .nullable()
    .optional(),
  finalPhase: z.enum(["CONFIRMED", "CANCELLED"]).optional(),
  reason: z.string().trim().max(200).optional(),
});

export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let body: z.infer<typeof finishSchema> = {};
    let mode: "default" | "cinematic5" = "default";
    try {
      const parsed = finishSchema.safeParse(await req.json());
      if (!parsed.success) {
        return Response.json(
          { ok: false, error: "invalid_body", details: parsed.error.flatten() },
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      body = parsed.data;
      if (body?.mode === "cinematic5") mode = "cinematic5";
    } catch {}
    let s = await loadAppStateForRoulette(userId);
    // Redis 미설정 시 Edge isolate 간 메모리가 분리될 수 있어 /api/state 최신본을 우선 조회
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
    const sessionId = String(body.sessionId || rs.sessionId || "").trim();
    const selectedSigs = Array.isArray(body.selectedSigs) && body.selectedSigs.length > 0
      ? body.selectedSigs
      : (rs.selectedSigs || rs.results || []);
    const oneShotPrice = Math.max(0, Math.floor(Number(body.oneShotResult?.price ?? rs.oneShotResult?.price ?? 0)));
    const finalPhase = body.finalPhase === "CANCELLED" ? "CANCELLED" : "CONFIRMED";

    // 로그 저장 우선 수행(실패 시 상태 확정 중단) → 사실상 원자적 처리
    const logResult = await saveRouletteLog({
      userId,
      sessionId: sessionId || `session_${Date.now()}`,
      phase: finalPhase,
      selectedSigs,
      oneShotPrice,
      adminId: userId,
      reason: body.reason,
    });

    const next: AppState = {
      ...s,
      rouletteState: {
        ...rs,
        isRolling: false,
        phase: mode === "cinematic5" ? "CONFIRMED" : rs.phase,
        selectedSigs,
        oneShotResult: {
          id: String(body.oneShotResult?.id || rs.oneShotResult?.id || "sig_one_shot"),
          name: String(body.oneShotResult?.name || rs.oneShotResult?.name || "한방 시그"),
          price: oneShotPrice,
        },
        sessionId: sessionId || rs.sessionId,
        lastFinishedAt: Date.now(),
        historyLogs: logResult.logs.slice(0, 50),
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
        headers: { "Content-Type": "application/json", ...forwardCookieHeader(req) },
        body: JSON.stringify({
          rouletteState: next.rouletteState,
          updatedAt: next.updatedAt,
        }),
      });
    } catch {}
    clearRouletteLock(userId);
    if (typeof console !== "undefined" && console.info) {
      const names = selectedSigs.map((s) => s.name).join(", ");
      console.info(
        `[roulette/finish] user=${userId} session=${sessionId || rs.sessionId} phase=${finalPhase} 시그=[${names}] 한방=${oneShotPrice.toLocaleString("ko-KR")}원 log=${logResult.logId}`,
      );
    }
    return Response.json(
      {
        ok: true,
        mode,
        logId: logResult.logId,
        duplicate: logResult.duplicate,
        history: logResult.logs.slice(0, 5),
      },
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
