export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import type { SigItem } from "@/types";
import { z } from "zod";
import { listRouletteLogs, saveRouletteLog } from "@/lib/sig-roulette";
import { getRouletteUserId, saveAppStateForRoulette } from "../edge-state-store";
import { clearRouletteLock } from "../roulette-lock";
import {
  loadAppStateForRouletteRequest,
  publishRouletteStateAfterSave,
} from "../roulette-state-sync";
import {
  canonicalSigIdFromWheelSliceId,
  mergeSessionExcludedSigIds,
  ONE_SHOT_SIG_ID,
  slimRouletteHistoryLogsForState,
} from "@/lib/sig-roulette";
import { shouldPersistRouletteHistoryLog } from "@/lib/sig-sales-manual-round";
import { SIG_SALES_TRACK_INVENTORY_STOCK } from "@/lib/sig-sales-stock";

function normalizeSigNameKey(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
}

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
  /** 지정 시 해당 시그만 재고 soldCount +1 (미지정 시 selectedSigs 전체) */
  soldSigIds: z.array(z.string().trim().min(1)).optional(),
  oneShotInventorySold: z.boolean().optional(),
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
    const s = await loadAppStateForRouletteRequest(req, userId);
    const rs = normalizeRouletteState(s.rouletteState);
    const sessionId = String(body.sessionId || rs.sessionId || "").trim();
    // 확정 데이터는 서버가 보관한 당첨 목록을 우선 사용한다.
    // (클라이언트 로컬 표시 상태가 늦거나 어긋난 경우에도 당첨/확정 불일치 방지)
    const selectedSigs =
      (rs.selectedSigs && rs.selectedSigs.length > 0)
        ? rs.selectedSigs
        : (rs.results && rs.results.length > 0)
          ? rs.results
          : (Array.isArray(body.selectedSigs) && body.selectedSigs.length > 0 ? body.selectedSigs : []);
    const oneShotPrice = Math.max(0, Math.floor(Number(body.oneShotResult?.price ?? rs.oneShotResult?.price ?? 0)));
    const finalPhase = body.finalPhase === "CANCELLED" ? "CANCELLED" : "CONFIRMED";

    const persistHistory = shouldPersistRouletteHistoryLog(sessionId || rs.sessionId);
    let logResult: Awaited<ReturnType<typeof saveRouletteLog>>;
    if (persistHistory) {
      try {
        logResult = await saveRouletteLog({
          userId,
          sessionId: sessionId || `session_${Date.now()}`,
          phase: finalPhase,
          selectedSigs,
          oneShotPrice,
          adminId: userId,
          reason: body.reason,
        });
      } catch (logErr) {
        return Response.json(
          { ok: false, error: "log_save_failed", detail: String(logErr) },
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    } else {
      logResult = {
        ok: true,
        logId: "",
        duplicate: false,
        logs: rs.historyLogs || [],
      };
    }

    const hasExplicitSoldList =
      Array.isArray(body.soldSigIds) && body.soldSigIds.length > 0;
    const soldDeltaById: Record<string, number> = {};
    if (finalPhase === "CONFIRMED") {
      const explicitSoldIds = Array.isArray(body.soldSigIds)
        ? body.soldSigIds.map((id) => canonicalSigIdFromWheelSliceId(String(id || ""))).filter(Boolean)
        : [];
      if (explicitSoldIds.length > 0) {
        for (const key of explicitSoldIds) {
          soldDeltaById[key] = (soldDeltaById[key] || 0) + 1;
        }
      } else {
        for (const row of selectedSigs) {
          const key = canonicalSigIdFromWheelSliceId(String(row?.id || ""));
          if (!key) continue;
          soldDeltaById[key] = (soldDeltaById[key] || 0) + 1;
        }
      }
      if (body.oneShotInventorySold === true) {
        soldDeltaById[ONE_SHOT_SIG_ID] = Math.max(soldDeltaById[ONE_SHOT_SIG_ID] || 0, 1);
      } else if (!hasExplicitSoldList && selectedSigs.length >= 2) {
        soldDeltaById[ONE_SHOT_SIG_ID] = Math.max(soldDeltaById[ONE_SHOT_SIG_ID] || 0, 1);
      }
    }
    const selectedNamePriceSet = new Set(
      selectedSigs.map(
        (x) => `${normalizeSigNameKey(x.name)}::${Math.floor(Number(x.price || 0))}`
      )
    );
    const nextInventory =
      finalPhase === "CONFIRMED" && SIG_SALES_TRACK_INVENTORY_STOCK
        ? (s.sigInventory || []).map((row) => {
            const key = canonicalSigIdFromWheelSliceId(String(row.id || ""));
            let delta = soldDeltaById[key] || 0;
            if (
              !delta &&
              !hasExplicitSoldList &&
              row.id !== ONE_SHOT_SIG_ID &&
              selectedNamePriceSet.has(
                `${normalizeSigNameKey(row.name)}::${Math.floor(Number(row.price || 0))}`
              )
            ) {
              delta = 1;
            }
            if (!delta) return row;
            const maxCount = Math.max(1, Math.floor(Number(row.maxCount || 1)));
            const soldCount = Math.max(0, Math.floor(Number(row.soldCount || 0)));
            const nextSold = Math.min(maxCount, soldCount + delta);
            return {
              ...row,
              soldCount: nextSold,
              isActive: nextSold >= maxCount ? false : row.isActive,
            };
          })
        : s.sigInventory;

    const sessionExcludedSigIds =
      finalPhase === "CANCELLED"
        ? (() => {
            const drop = new Set(
              selectedSigs.map((row) => canonicalSigIdFromWheelSliceId(String(row?.id || ""))).filter(Boolean)
            );
            return (rs.sessionExcludedSigIds || []).filter((id) => !drop.has(id));
          })()
        : mergeSessionExcludedSigIds(rs.sessionExcludedSigIds, selectedSigs);

    const next: AppState = {
      ...s,
      sigInventory: nextInventory,
      rouletteState: {
        ...rs,
        isRolling: false,
        phase:
          finalPhase === "CANCELLED"
            ? "CANCELLED"
            : finalPhase === "CONFIRMED"
              ? "CONFIRMED"
              : rs.phase,
        selectedSigs,
        oneShotResult: {
          id: String(body.oneShotResult?.id || rs.oneShotResult?.id || "sig_one_shot"),
          name: String(body.oneShotResult?.name || rs.oneShotResult?.name || "한방 시그"),
          price: oneShotPrice,
        },
        sessionId: sessionId || rs.sessionId,
        lastFinishedAt: Date.now(),
        historyLogs: slimRouletteHistoryLogsForState(logResult.logs),
        sessionExcludedSigIds,
      },
      updatedAt: Date.now(),
    };
    try {
      await saveAppStateForRoulette(userId, next);
    } catch (saveErr) {
      return Response.json(
        { ok: false, error: "state_save_failed", detail: String(saveErr) },
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    await publishRouletteStateAfterSave(req, userId, {
      rouletteState: next.rouletteState,
      updatedAt: next.updatedAt,
      sigInventory: next.sigInventory,
    });
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
