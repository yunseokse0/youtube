export const runtime = "nodejs";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { readDonationAliases } from "@/app/api/donations/_shared/alias-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import {
  applyDonationToAppState,
  isDuplicateDonationEvent,
  repairMemberTotalsForDonorRoster,
} from "@/lib/donation/apply-donation-state";
import { persistDonationApplyLikeToonation } from "@/lib/donation/persist-donation-like-toon";
import type { DonationEvent } from "@/lib/donation/types";
import { normalizeDonorsArray } from "@/lib/state";

type ApplyBody = {
  donorName?: string;
  amount?: number;
  memberId?: string;
  target?: "account" | "toon";
  message?: string;
  id?: string;
  hsPushDir?: "left" | "right" | "split";
  /** 여러 건 일괄 (붙여넣기) */
  items?: Array<{
    donorName?: string;
    amount?: number;
    memberId?: string;
    target?: "account" | "toon";
    message?: string;
    id?: string;
    hsPushDir?: "left" | "right" | "split";
  }>;
};

function buildBankEvent(
  row: NonNullable<ApplyBody["items"]>[number] | ApplyBody,
  fallbackTarget: "account" | "toon"
): DonationEvent | null {
  const memberId = String(row.memberId || "").trim();
  const donorName = String(row.donorName || "무명").replace(/\s+/g, "") || "무명";
  const amount = Math.max(0, Math.round(Number(row.amount) || 0));
  if (!memberId || amount <= 0) return null;
  const target = row.target === "toon" ? "toon" : fallbackTarget;
  const id =
    String(row.id || "").trim() ||
    `bank:${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${amount}`;
  const hsPushDir =
    row.hsPushDir === "left" || row.hsPushDir === "right" || row.hsPushDir === "split"
      ? row.hsPushDir
      : undefined;
  return {
    id,
    provider: "bank",
    externalId: id,
    donorName,
    amount,
    at: new Date().toISOString(),
    target,
    status: "queued",
    memberId,
    manualAssignMemberId: memberId,
    ...(String(row.message || "").trim() ? { message: String(row.message).trim() } : {}),
    ...(hsPushDir ? { hsPushDir } : {}),
  };
}

/**
 * 수동 계좌·합산 후원 — 투네 서버 반영과 동일 파이프라인으로 Redis 저장.
 * (applyDonationToAppState → union → saveAppStateForRoulette → SSE)
 */
export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => null)) as ApplyBody | null;
  if (!body || typeof body !== "object") {
    return new Response(JSON.stringify({ error: "invalid_body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const defaultTarget = body.target === "toon" ? "toon" : "account";
  const rows =
    Array.isArray(body.items) && body.items.length > 0
      ? body.items
      : [body];

  const aliases = await readDonationAliases(userId);
  let state = await loadAppStateForUserId(userId);
  const appliedEvents: DonationEvent[] = [];
  let lastEvent: DonationEvent | null = null;

  for (const row of rows) {
    const event = buildBankEvent(row, defaultTarget);
    if (!event) continue;
    if (isDuplicateDonationEvent(state, event)) {
      appliedEvents.push({ ...event, status: "processed" });
      lastEvent = event;
      continue;
    }
    const result = applyDonationToAppState(state, event, aliases);
    if (!result.ok) {
      return new Response(
        JSON.stringify({
          error: result.reason || "apply_failed",
          applied: appliedEvents.length,
        }),
        { status: 422, headers: { "Content-Type": "application/json" } }
      );
    }
    state = result.state;
    lastEvent = result.event;
    appliedEvents.push({ ...result.event, status: "processed" });
  }

  if (appliedEvents.length === 0 || !lastEvent) {
    return new Response(JSON.stringify({ error: "no_valid_items" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  /** 투네와 동일: apply 후 Redis·SSE 한 번에 (일괄은 메모리 합산 후 1회 저장) */
  const persisted = await persistDonationApplyLikeToonation(userId, state, lastEvent);
  if (!persisted.ok) {
    return new Response(JSON.stringify({ error: "persist_failed", applied: 0 }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const repaired = repairMemberTotalsForDonorRoster(persisted.state, state);

  return new Response(
    JSON.stringify({
      ok: true,
      updatedAt: repaired.updatedAt,
      donorRankingsUpdatedAt: repaired.donorRankingsUpdatedAt,
      donorsCount: normalizeDonorsArray(repaired.donors).length,
      applied: appliedEvents,
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
