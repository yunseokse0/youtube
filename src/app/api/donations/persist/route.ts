export const runtime = "nodejs";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import type { DonorsPersistMode } from "@/app/api/roulette/edge-state-store";
import { persistDonationStateToServer } from "@/lib/donation/persist-donation-like-toon";
import { repairMemberTotalsForDonorRoster } from "@/lib/donation/apply-donation-state";
import { normalizeDonorsArray } from "@/lib/state";
import type { AppState } from "@/types";

type PersistBody = {
  state?: AppState;
  mode?: DonorsPersistMode;
};

/**
 * 삭제·단체짠·재배치 등 donorsReplace 저장 — 투네 apply 와 동일 Redis 파이프라인.
 */
export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

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

  const repaired = repairMemberTotalsForDonorRoster(persisted.state, body.state);

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
