export const runtime = "nodejs";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import {
  applyDonationRosterBackupToState,
  loadDonationRosterBackup,
  saveDonationRosterBackup,
  shouldRestoreDonationRosterFromBackup,
} from "@/lib/donation-roster-backup";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
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
 */
export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const backup = await loadDonationRosterBackup(userId);
  if (!backup || (backup.donorsCount <= 0 && backup.total <= 0)) {
    return new Response(
      JSON.stringify({ error: "no_backup", message: "서버 후원 백업이 비어 있습니다." }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const current = (await loadAppStateForUserId(userId)) || defaultState();
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

  const restored: AppState = applyDonationRosterBackupToState(current, backup);
  if (normalizeDonorsArray(restored.donors).length === 0 && totalCombined(restored) === 0) {
    return new Response(
      JSON.stringify({
        error: "restore_empty",
        message: "백업 적용 결과가 비어 있습니다(리셋 필터). 일일 로그 복구를 시도하세요.",
      }),
      { status: 422, headers: { "Content-Type": "application/json" } }
    );
  }

  const saved = await saveAppStateForRoulette(userId, restored, { donorsMode: "replace" });
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
