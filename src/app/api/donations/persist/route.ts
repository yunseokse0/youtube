export const runtime = "nodejs";
export const revalidate = 0;

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import type { DonorsPersistMode } from "@/app/api/roulette/edge-state-store";
import { persistDonationStateToServer } from "@/lib/donation/persist-donation-like-toon";
import { repairMemberTotalsForDonorRoster } from "@/lib/donation/apply-donation-state";
import { markIntentionalDonationEmptySession } from "@/lib/intentional-donation-clear";
import {
  buildDonationRosterBackupPayload,
  clearDonationRosterBackup,
  saveDonationRosterBackup,
} from "@/lib/donation-roster-backup";
import { normalizeDonorsArray, totalCombined } from "@/lib/state";
import type { AppState } from "@/types";

type PersistBody = {
  state?: AppState;
  mode?: DonorsPersistMode;
};

/**
 * 삭제·단체짠·재배치 등 donorsReplace 저장 — 투네 apply 와 동일 Redis 파이프라인.
 */
export async function POST(req: Request) {
  const writeUid = resolveWriteUserId(req);
  if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
  const userId = writeUid.userId;

  const body = (await req.json().catch(() => null)) as PersistBody | null;
  if (!body?.state || typeof body.state !== "object") {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const mode: DonorsPersistMode = body.mode === "add" ? "add" : "replace";
  const persisted = await persistDonationStateToServer(userId, body.state, { mode });
  if (!persisted.ok) {
    return new Response(JSON.stringify({ error: "persist_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let repaired = repairMemberTotalsForDonorRoster(persisted.state, body.state);
  const donorsEmpty =
    normalizeDonorsArray(repaired.donors).length === 0 && totalCombined(repaired) <= 0;
  if (mode === "replace" && donorsEmpty) {
    /** 일일 로그·백업 자동 heal 이 의도적 삭제를 되돌리지 않게 */
    repaired = markIntentionalDonationEmptySession(repaired);
    /** 마지막 후원 삭제 후 구 백업이 GET에서 되살리지 않게 */
    void clearDonationRosterBackup(userId, repaired.settlementResetAt);
  } else if (buildDonationRosterBackupPayload(repaired)) {
    void saveDonationRosterBackup(userId, repaired);
  }

  return new Response(
    JSON.stringify({
      ok: true,
      updatedAt: repaired.updatedAt,
      donorRankingsUpdatedAt: repaired.donorRankingsUpdatedAt,
      donorsCount: normalizeDonorsArray(repaired.donors).length,
      state: repaired,
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
