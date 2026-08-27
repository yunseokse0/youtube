export const runtime = "nodejs";
export const revalidate = 0;

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { clearDonationRosterBackup } from "@/lib/donation-roster-backup";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import {
  applySettlementResetToState,
  type SettlementResetMode,
} from "@/lib/settlement-reset-apply";
import { normalizeDonorsArray, totalCombined } from "@/lib/state";
import { createModuleLogger } from "@/lib/logger";

const logger = createModuleLogger("api.settlement.reset");

type ResetBody = {
  mode?: SettlementResetMode;
  memberSlotCount?: number;
};

/**
 * 정산 리셋 전용 — /api/state 병합 큐·coalesce 우회.
 * keep: 멤버 유지 + 금액·후원 비움
 * init: 멤버 슬롯 초기화 + 금액·후원 비움
 */
export async function POST(req: Request) {
  const writeUid = resolveWriteUserId(req);
  if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
  const userId = writeUid.userId;

  const body = (await req.json().catch(() => null)) as ResetBody | null;
  const mode: SettlementResetMode = body?.mode === "init" ? "init" : "keep";
  const memberSlotCount = body?.memberSlotCount;

  const current = await loadAppStateForUserId(userId);
  if (!current) {
    return new Response(JSON.stringify({ ok: false, error: "state_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const resetAt = Date.now();
  const next = applySettlementResetToState(current, {
    mode,
    memberSlotCount,
    resetAt,
  });

  await clearDonationRosterBackup(userId, resetAt);

  const saved = await saveAppStateForRoulette(userId, next, {
    donorsMode: "replace",
    allowEmptyRosterWipe: true,
  });
  if (!saved.ok) {
    logger.error("settlement reset persist failed", { userId, mode });
    return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
      status: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  const persisted = saved.state;
  const donorsCount = normalizeDonorsArray(persisted.donors).length;
  const total = totalCombined(persisted);
  if (donorsCount > 0 || total > 0) {
    logger.error("settlement reset did not clear roster", {
      userId,
      mode,
      donorsCount,
      total,
    });
    return new Response(
      JSON.stringify({
        ok: false,
        error: "reset_not_cleared",
        donorsCount,
        total,
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      }
    );
  }

  await publishSseEvent({
    type: "state_updated" as const,
    updatedAt: persisted.updatedAt,
    donorRankingsUpdatedAt: persisted.donorRankingsUpdatedAt,
  });

  logger.info("settlement reset applied", {
    userId,
    mode,
    settlementResetAt: persisted.settlementResetAt,
    members: (persisted.members || []).length,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      mode,
      updatedAt: persisted.updatedAt,
      settlementResetAt: persisted.settlementResetAt,
      donorRankingsUpdatedAt: persisted.donorRankingsUpdatedAt,
      state: persisted,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    }
  );
}
