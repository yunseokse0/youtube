import {
  broadcastPlayerDonationAlert,
  enrichDonationEventWithSigMatch,
} from "@/lib/donation/player-donation-alert";
import {
  enqueueUnmatchedToonationDonation,
  tryAutoApplyToonationDonationOnServer,
} from "@/lib/donation/server-apply-donation";
import type { DonationEvent } from "@/lib/donation/types";
import { appendToonaHubDonationLog, readToonaHubSession } from "@/lib/toona-hub-session";

export function parseApplyExcelFromRequest(req: Request): boolean {
  try {
    const raw = new URL(req.url).searchParams.get("applyExcel");
    if (raw === "false" || raw === "0") return false;
    return true;
  } catch {
    return true;
  }
}

export function sanitizeDonationEventFromIngestBody(raw: unknown): DonationEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as Record<string, unknown>;

  const donorName = String(body.donorName || "").trim();
  const externalId = String(body.externalId || "").trim();
  const amount = Math.round(Number(body.amount) || 0);
  if (!donorName || !externalId || amount <= 0) return null;

  const provider = body.provider === "toonation" ? "toonation" : "bank";
  const id = String(body.id || "").trim() || `${provider}:din:${externalId}`;
  const atRaw = body.at;
  const at =
    typeof atRaw === "string" && atRaw.trim()
      ? new Date(atRaw).toISOString()
      : new Date().toISOString();

  const target =
    body.target === "account" ? "account" : body.target === "toon" ? "toon" : undefined;

  const statusRaw = String(body.status || "queued");
  const status =
    statusRaw === "processed" ||
    statusRaw === "failed" ||
    statusRaw === "unmatched" ||
    statusRaw === "queued"
      ? statusRaw
      : "queued";

  const playerName = String(body.playerName || body.recipientName || "").trim();
  const message = String(body.message || "").trim();
  const memberId = String(body.memberId || "").trim();
  const manualAssignMemberId = String(body.manualAssignMemberId || "").trim();

  return {
    id,
    provider,
    externalId,
    donorName,
    amount,
    at,
    status,
    ...(playerName ? { playerName } : {}),
    ...(message ? { message } : {}),
    ...(target ? { target } : {}),
    ...(memberId ? { memberId } : {}),
    ...(manualAssignMemberId ? { manualAssignMemberId } : {}),
  };
}

export type DinIngestResult =
  | { ok: true; applied: false; alert: true; mode: "alert_only" }
  | { ok: true; applied: true; outcome: "applied" | "applied_needs_review"; mode: "excel" }
  | { ok: true; applied: false; queued: true; mode: "excel" };

async function logHubIngestIfLinked(
  userId: string,
  event: DonationEvent,
  result: DinIngestResult
): Promise<void> {
  const session = await readToonaHubSession(userId);
  if (!session) return;
  const at = event.at ? new Date(event.at).getTime() : Date.now();
  if (Number.isFinite(at) && at < session.linkedAt - 5_000) return;
  await appendToonaHubDonationLog(userId, {
    id: `ingest:${event.id}`,
    at: Number.isFinite(at) ? at : Date.now(),
    donorName: event.donorName,
    amount: event.amount,
    playerName: event.playerName,
    target: event.target,
    mode: result.mode,
    applied: result.applied,
    source: "ingest",
    message: event.message?.slice(0, 120),
  });
}

/** DIN ingest — applyExcel=false면 시그·player-alert만, true면 엑셀표 반영 */
export async function handleDinDonationIngest(
  userId: string,
  event: DonationEvent,
  applyExcel: boolean
): Promise<DinIngestResult> {
  let result: DinIngestResult;
  if (!applyExcel) {
    const enriched = await enrichDonationEventWithSigMatch(userId, event);
    await broadcastPlayerDonationAlert(userId, enriched);
    result = { ok: true, applied: false, alert: true, mode: "alert_only" };
  } else {
    const outcome = await tryAutoApplyToonationDonationOnServer(userId, event);
    if (outcome === "applied" || outcome === "applied_needs_review") {
      result = { ok: true, applied: true, outcome, mode: "excel" };
    } else {
      await enqueueUnmatchedToonationDonation(userId, event);
      result = { ok: true, applied: false, queued: true, mode: "excel" };
    }
  }

  await logHubIngestIfLinked(userId, event, result).catch(() => {});
  return result;
}
