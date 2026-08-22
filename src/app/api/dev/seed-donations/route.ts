export const runtime = "nodejs";
export const revalidate = 0;

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { isDevAuthBypassRequest } from "@/lib/auth";
import { applyDonationDummySeed, applyOverlaySplitPreviewSeed } from "@/lib/dev/seed-donation-dummy";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import { normalizeDonorsArray } from "@/lib/state";

function assertLocalDev(req: Request): boolean {
  try {
    const host = new URL(req.url).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  } catch {}
  return isDevAuthBypassRequest(req) && process.env.NODE_ENV !== "production";
}

/**
 * 로컬 개발 전용 — 더미 후원으로 삭제·단체짠 나누기 테스트.
 * POST { mode?: "replace"|"append" }
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
    mode?: "replace" | "append";
    includeGroupSplitCandidate?: boolean;
    preview?: "split10";
    count?: number;
  };

  const current = await loadAppStateForUserId(userId);
  if (!current) {
    return new Response(JSON.stringify({ error: "state_unavailable" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const seededPreview = body.preview === "split10";
  const applied = seededPreview
    ? applyOverlaySplitPreviewSeed(current, { count: body.count })
    : applyDonationDummySeed(current, {
        mode: body.mode === "append" ? "append" : "replace",
        includeGroupSplitCandidate: body.includeGroupSplitCandidate !== false,
      });
  const state = applied.state;
  const added = applied.added;
  const mode = "mode" in applied ? applied.mode : "split10";

  if (added.length === 0) {
    return new Response(JSON.stringify({ error: "no_members" }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  const seeded = await saveAppStateForRoulette(userId, state);
  if (!seeded.ok) {
    return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  await publishSseEvent({
    type: "state_updated",
    updatedAt: state.updatedAt,
    donorRankingsUpdatedAt: state.donorRankingsUpdatedAt,
  });

  return new Response(
    JSON.stringify({
      ok: true,
      mode,
      added: added.length,
      donorsCount: normalizeDonorsArray(state.donors).length,
      updatedAt: state.updatedAt,
      hint: seededPreview
        ? "멤버 10명·후원자 10명. 엑셀표와 후원순위가 좌우 5+5로 나뉩니다."
        : "「단체짠더미」행에서 나누기, 소액 더미에서 삭제를 시험하세요.",
      membersCount: state.members.length,
      state,
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
      usage: "POST /api/dev/seed-donations { mode: replace|append } 또는 { preview: split10 }",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}
