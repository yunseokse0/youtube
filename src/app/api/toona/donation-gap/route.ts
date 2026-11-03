import { NextRequest } from "next/server";
import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import { resolveScopedOverlayUserId } from "@/lib/overlay-params";
import { checkToonaDonationGap } from "@/lib/toona-donation-gap";
import { readToonaHubSession } from "@/lib/toona-hub-session";
import {
  describeDonationIntakeMode,
  isDonationIntakeModeB,
} from "@/policies/donation-intake-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store, max-age=0" },
  });
}

/**
 * GET /api/toona/donation-gap?hours=6&maxPages=5
 * toona 원장 ↔ 정산표 누락 대조(읽기 전용). EC2 모니터·cron 용.
 */
export async function GET(req: NextRequest) {
  const auth = resolveWriteUserId(req);
  if (!auth.ok) return writeUserIdErrorResponse(auth);

  if (!isDonationIntakeModeB()) {
    return json({
      ok: false,
      error: "intake_mode_not_B",
      mode: describeDonationIntakeMode(),
      reason: "투네 허브 원장 대조는 B모드에서만 가능합니다.",
    }, 503);
  }

  const sp = req.nextUrl.searchParams;
  const hoursRaw = Number(sp.get("hours") || sp.get("windowHours") || "6");
  const hours = Number.isFinite(hoursRaw) ? Math.max(0.25, Math.min(168, hoursRaw)) : 6;
  const maxPages = Math.max(1, Math.min(50, Math.floor(Number(sp.get("maxPages") || "5") || 5)));
  const sampleLimit = Math.max(
    1,
    Math.min(100, Math.floor(Number(sp.get("sampleLimit") || "20") || 20))
  );

  const hubUserId = auth.userId;
  const stateUserId = resolveScopedOverlayUserId(hubUserId, "finalent") || hubUserId;
  const [session, state] = await Promise.all([
    readToonaHubSession(hubUserId).catch(() => null),
    loadAppStateForUserId(stateUserId),
  ]);

  if (!state) {
    return json({ ok: false, error: "state_unavailable", linked: Boolean(session) }, 503);
  }

  const result = await checkToonaDonationGap({
    session,
    donors: state.donors || [],
    settlementResetAt: Number(state.settlementResetAt) || 0,
    intentionalDonationClearAt: Number(
      (state as { intentionalDonationClearAt?: number }).intentionalDonationClearAt
    ) || 0,
    windowMs: Math.round(hours * 60 * 60 * 1000),
    maxPages,
    sampleLimit,
  });

  if (!result.ok) {
    const status = result.error === "not_linked" ? 409 : 502;
    return json({ ...result, userId: hubUserId, stateUserId, hours, maxPages }, status);
  }

  return json({
    ...result,
    userId: hubUserId,
    stateUserId,
    hours,
    maxPages,
    verdict: result.missing > 0 ? "MISSING" : "OK",
  });
}
