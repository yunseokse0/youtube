export const runtime = "nodejs";
export const revalidate = 0;

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { assertLocalDev } from "@/lib/dev/assert-local-dev";
import { applySettlementTestSeed } from "@/lib/dev/seed-settlement-test";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import { normalizeDonorsArray, totalCombined } from "@/lib/state";

/**
 * 로컬 개발 전용 — 더미 후원 + (선택) 정산 레코드 생성.
 * POST { createSettlement?: boolean, title?: string, taxInvoiceIssued?: boolean }
 */
export async function POST(req: Request) {
  if (!assertLocalDev(req)) {
    return new Response(JSON.stringify({ error: "dev_only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const writeUid = resolveWriteUserId(req);
  if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
  const userId = writeUid.userId;

  const body = (await req.json().catch(() => ({}))) as {
    createSettlement?: boolean;
    title?: string;
    taxInvoiceIssued?: boolean;
    accountRatio?: number;
    toonRatio?: number;
  };

  const current = await loadAppStateForUserId(userId);
  if (!current) {
    return new Response(JSON.stringify({ error: "state_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  const applied = applySettlementTestSeed(current, {
    title: body.title,
    taxInvoiceIssued: body.taxInvoiceIssued,
    accountRatio: body.accountRatio,
    toonRatio: body.toonRatio,
    createSettlement: body.createSettlement !== false,
  });

  if (applied.donorsAdded === 0) {
    return new Response(JSON.stringify({ error: "no_members" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const seeded = await saveAppStateForRoulette(userId, applied.state);
  if (!seeded.ok) {
    return new Response(JSON.stringify({ ok: false, error: "state_persist_failed" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  let settlementSaved = false;
  let settlementId: string | null = null;
  if (applied.settlement) {
    const origin = new URL(req.url).origin;
    try {
      const settlementRes = await fetch(`${origin}/api/settlements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: req.headers.get("cookie") || "",
        },
        body: JSON.stringify([applied.settlement]),
      });
      const settlementBody = (await settlementRes.json().catch(() => ({}))) as { ok?: boolean };
      settlementSaved = settlementRes.ok && settlementBody.ok !== false;
    } catch {
      settlementSaved = false;
    }
    settlementId = applied.settlement.id;
  }

  await publishSseEvent({
    type: "state_updated",
    updatedAt: applied.state.updatedAt,
    donorRankingsUpdatedAt: applied.state.donorRankingsUpdatedAt,
  });

  const origin = new URL(req.url).origin;
  const settlementUrl = settlementId ? `${origin}/settlements/${settlementId}` : null;

  return new Response(
    JSON.stringify({
      ok: true,
      userId,
      donorsAdded: applied.donorsAdded,
      donorsCount: normalizeDonorsArray(applied.state.donors).length,
      membersCount: applied.state.members.length,
      totalCombined: totalCombined(applied.state),
      settlementId,
      settlementSaved,
      settlement: applied.settlement,
      settlementTitle: applied.settlement?.title ?? null,
      totalNet: applied.settlement?.totalNet ?? null,
      links: {
        admin: `${origin}/admin#settlement-finalize`,
        settlements: `${origin}/settlements`,
        settlementDetail: settlementUrl,
        devSeed: `${origin}/dev/seed`,
      },
      hint:
        "관리자를 새로고침한 뒤 정산 상세에서 「비율 적용 · 재계산」으로 총액 변경을 테스트하세요.",
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }
  );
}

export async function GET(req: Request) {
  if (!assertLocalDev(req)) {
    return new Response(JSON.stringify({ error: "dev_only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(
    JSON.stringify({
      ok: true,
      usage:
        "POST /api/dev/seed-settlement-test — 더미 후원 + 정산 레코드. createSettlement:false 로 후원만 넣을 수 있음.",
      ui: "/dev/seed",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
