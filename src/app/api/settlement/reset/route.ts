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
// ==================== FixB_settlement_reset_clear_bmode_logs (2026-09-08 hotfix-6-10-4) ====================
// 정산 리셋 직후 B모드(DIN 허브) 로그·마지막 ingest 시각이 남아있어
// 리셋 이전 과거 후원(쓰레기값 31.7 / 17건)이 다시 살아나는 Bug 원천 봉쇄.
// 세션(email/token) 자체는 유지하고 lastIngest 3필드만 reset 시각으로 갱신 + donationLogs 완전 삭제.
import {
  readToonaHubSession,
  writeToonaHubSession,
  clearToonaHubDonationLogs,
} from "@/lib/toona-hub-session";
// ==================== End FixB imports ====================

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

  // ==================== FixB_settlement_reset_clear_bmode_logs (L77-1) ====================
  // 🔥 정산 리셋 직후 B모드 로그·lastIngest 초기화 실행 —
  //    만약 이 부분을 빼먹으면 lastIngestAt=리셋이전 시각 으로 박혀있어서,
  //    B모드 폴링이 "리셋 이전 과거 후원" 을 계속 가져와 totals 에 재누적 (쓰레기값 부활)
  //    - clearToonaHubDonationLogs: B모드가 들고있던 후원 로그 80건 통째 삭제 (과거 후원 원본 제거)
  //    - lastIngestAt=resetAt (or 미래 1초): "나 리셋 시각 이후 후원만 새로 가져올거야" 기준점 재설정
  //    - lastIngestError=null + lastIngestOk=true: 구 에러 메시지 stale 제거
  try {
    await clearToonaHubDonationLogs(userId);
    const session = await readToonaHubSession(userId);
    if (session) {
      const FORWARD_RESET_MS = 1000; // 리셋 시각보다 1초 미래로 박아서 리셋 직후 들어온 후원(at=resetAt 정확히 같음)도 "리셋 이후" 로 안정적으로 필터
      const nextSession = {
        ...session,
        lastIngestAt: new Date(resetAt + FORWARD_RESET_MS).toISOString(),
        lastIngestOk: true,
        lastIngestError: null,
      } as const;
      await writeToonaHubSession(nextSession);
      logger.info("settlement reset → toona hub session lastIngestAt advanced", {
        userId,
        resetAt,
        newLastIngestAt: nextSession.lastIngestAt,
      });
    }
  } catch (err) {
    logger.warn("settlement reset → toona hub logs/lastIngest clear failed (non-fatal, B모드 아닐시 스킵)", {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
  }
  // ==================== End FixB runtime ====================

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
