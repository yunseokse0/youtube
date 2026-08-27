export const runtime = "nodejs";
export const revalidate = 0;

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import {
  applyDonationRosterBackupToState,
  loadDonationRosterBackup,
  saveDonationRosterBackup,
  shouldRestoreDonationRosterFromBackup,
} from "@/lib/donation-roster-backup";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { shouldSuppressAutoRosterRestore } from "@/lib/intentional-donation-clear";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import {
  defaultState,
  isDefaultPlaceholderMemberList,
  normalizeDonorsArray,
  totalCombined,
} from "@/lib/state";
import type { AppState } from "@/types";

/**
 * 서버 후원 백업(MySQL/디스크)에서 강제 복구.
 * 플레이스홀더(멤버1·2…) 초기화·빈 후원일 때 사용.
 * 의도적 정산 리셋(intentionalDonationClearAt) 세션은 거부.
 */
export async function POST(req: Request) {
  const writeUid = resolveWriteUserId(req);
  if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
  const userId = writeUid.userId;

  const backup = await loadDonationRosterBackup(userId);
  if (!backup || (backup.donorsCount <= 0 && backup.total <= 0)) {
    return new Response(
      JSON.stringify({ error: "no_backup", message: "서버 후원 백업이 비어 있습니다." }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const current = (await loadAppStateForUserId(userId)) || defaultState();
  if (shouldSuppressAutoRosterRestore(current)) {
    return new Response(
      JSON.stringify({
        error: "intentional_clear",
        message:
          "의도적 정산 리셋(멤버 유지·초기화) 세션입니다. 자동 백업 복구를 하지 않습니다. 일일 로그에서 수동 복구하세요.",
        intentionalDonationClearAt: current.intentionalDonationClearAt,
      }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  const force =
    isDefaultPlaceholderMemberList(current.members) ||
    (normalizeDonorsArray(current.donors).length === 0 && totalCombined(current) === 0) ||
    shouldRestoreDonationRosterFromBackup(current, backup);

  if (!force) {
    return new Response(
      JSON.stringify({
        error: "not_empty",
        message: "현재 상태가 비어 있지 않습니다. 정산 리셋 후가 아니면 강제 복구하지 않습니다.",
        donorsCount: normalizeDonorsArray(current.donors).length,
        total: totalCombined(current),
      }),
      { status: 409, headers: { "Content-Type": "application/json" } }
    );
  }

  let restored: AppState = applyDonationRosterBackupToState(current, backup);
  if (normalizeDonorsArray(restored.donors).length === 0 && backup.donorsCount > 0) {
    restored = applyDonationRosterBackupToState(current, backup, {
      ignoreSettlementResetFilter: true,
    });
  }
  if (normalizeDonorsArray(restored.donors).length === 0 && totalCombined(restored) === 0) {
    return new Response(
      JSON.stringify({
        error: "restore_empty",
        message: "백업 적용 결과가 비어 있습니다(리셋 필터). 일일 로그 복구를 시도하세요.",
      }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  const savedResult = await saveAppStateForRoulette(userId, restored, { donorsMode: "replace" });
  if (!savedResult.ok) {
    return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const saved = savedResult.state;
  void saveDonationRosterBackup(userId, saved);
  await publishSseEvent({
    type: "state_updated",
    updatedAt: saved.updatedAt,
    donorRankingsUpdatedAt: saved.donorRankingsUpdatedAt,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      donorsCount: normalizeDonorsArray(saved.donors).length,
      total: totalCombined(saved),
      membersCount: (saved.members || []).length,
      updatedAt: saved.updatedAt,
      state: saved,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }
  );
}
