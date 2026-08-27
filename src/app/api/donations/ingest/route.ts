export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { isValidUserId } from "@/app/api/_shared/user-id";
import { verifyToonaIngestAuth } from "@/app/api/donations/_shared/toona-ingest-auth";
import {
  handleDinDonationIngest,
  parseApplyExcelFromRequest,
  sanitizeDonationEventFromIngestBody,
} from "@/lib/donation/din-ingest";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * DIN(toona) 후원 ingest — DonationEvent JSON 수신
 * POST /api/donations/ingest?u={userId}&applyExcel=false|true
 * Authorization: Bearer {TOONA_INGEST_SECRET}
 */
export async function POST(req: Request) {
  const auth = verifyToonaIngestAuth(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let userId: string;
  try {
    const raw = new URL(req.url).searchParams.get("u")?.trim() || "";
    if (!raw || !isValidUserId(raw)) {
      return json({ error: "invalid_user_id" }, 400);
    }
    userId = raw;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  const body = await req.json().catch(() => null);
  const event = sanitizeDonationEventFromIngestBody(body);
  if (!event) {
    return json({ error: "invalid_donation_event" }, 400);
  }

  const applyExcel = parseApplyExcelFromRequest(req);

  try {
    const result = await handleDinDonationIngest(userId, event, applyExcel);
    return json({ userId, applyExcel, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest_failed";
    console.error("[donations/ingest]", userId, message);
    return json({ error: message }, 500);
  }
}
