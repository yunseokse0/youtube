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
import { isSettlementResetExplicitlyConfirmed } from "@/lib/settlement-reset-confirm";
import { normalizeDonorsArray, totalCombined } from "@/lib/state";
import { createModuleLogger } from "@/lib/logger";

const logger = createModuleLogger("api.settlement.reset");

type ResetBody = {
  mode?: SettlementResetMode;
  memberSlotCount?: number;
  userConfirmed?: boolean;
  confirmPhrase?: string;
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
  if (!isSettlementResetExplicitlyConfirmed(body)) {
    logger.warn("settlement reset rejected — missing explicit user confirmation", {
      userId,
    });
    return new Response(
      JSON.stringify({ ok: false, error: "confirm_required" }),
      {
        status: 403,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      }
    );
  }
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

  /** dual-write 미러 강제 비움: save 호출 전 선행 DELETE 하여 save 내 bypass flush 가 가장 늦게 적히도록 순서 고정 */
  try {
    const { clearBroadcastDonationsForUser } = await import(
      "@/lib/donation/broadcast-donations-mysql"
    );
    await clearBroadcastDonationsForUser(userId);
  } catch (err) {
    logger.warn("broadcast_donations clear before reset persist failed", {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }

  const saved = await saveAppStateForRoulette(userId, next, {
    donorsMode: "replace",
    allowEmptyRosterWipe: true,
  });
  if (!saved.ok) {
    logger.error("settlement reset persist failed", { userId, mode });
    const rawSaved = saved as unknown as { error?: string };
    return new Response(JSON.stringify({
      ok: false,
      error: "persist_failed",
      detail: rawSaved.error ?? "saveAppStateForRoulette refused empty roster wipe or mysql/redis write failed — kv backend unavailable",
    }), {
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
        detail: `save 후 donors=${donorsCount}건 total=${total}원. mergeStatePreservingDonorsUntilSettlementReset 에서 과거 후원이 다시 복구됐을 확률 높음. (f6bb3c6 패치 배포 확인 필요)`,
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
