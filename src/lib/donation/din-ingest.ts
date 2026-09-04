import {
  broadcastPlayerDonationAlert,
  enrichDonationEventWithSigMatch,
} from "@/lib/donation/player-donation-alert";
import {
  enqueueUnmatchedToonationDonation,
  tryAutoApplyToonationDonationOnServer,
} from "@/lib/donation/server-apply-donation";
import type { DonationEvent } from "@/lib/donation/types";
import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { appendToonaHubDonationLog, readToonaHubSession } from "@/lib/toona-hub-session";
import { parseKstLocalTimestampToMs } from "@/lib/state";

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
  const bodyIdRaw = String(body.id || "").trim();
  const id =
    bodyIdRaw &&
    (bodyIdRaw.startsWith("toonation:") ||
      bodyIdRaw.startsWith("bank:") ||
      bodyIdRaw.startsWith("account:"))
      ? bodyIdRaw
      : bodyIdRaw
        ? `${provider}:${bodyIdRaw}`
        : `${provider}:din:${externalId}`;
  const atRaw = body.at;
  /**
   * KST local 점 구분 + 24시 표기(ex: "2026. 09. 02. 24:59:34") 를 안전하게 ISO Z 문자열로 변환.
   * 구버전 naive new Date(atRaw).toISOString() 은 Invalid Date 시 RangeError Throw
   * → 바로 /api/donations/ingest HTTP 500 을 뱉던 직접 원인 봉쇄.
   * 항상 절대 throw 하지 않고 파싱 불가시 현재 시각 폴백.
   */
  let atIso = "";
  try {
    const ms = parseKstLocalTimestampToMs(atRaw);
    const finalMs = Number.isFinite(ms) && ms > 0 ? ms : Date.now();
    atIso = new Date(finalMs).toISOString();
  } catch {
    atIso = new Date().toISOString();
  }
  const at = atIso;

  const target =
    body.target === "account" ? "account" : body.target === "toon" ? "toon" : provider === "toonation" ? "toon" : "account";

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

  const contributionPointsRaw = Math.round(Number(body.contributionPoints));
  const contributionPoints =
    Number.isFinite(contributionPointsRaw) && contributionPointsRaw >= 0
      ? contributionPointsRaw
      : undefined;

  const hasWeightFields =
    body.accountWeightPct !== undefined ||
    body.toonWeightPct !== undefined ||
    body.accountWeight !== undefined ||
    body.toonWeight !== undefined ||
    body.contributionFormula !== undefined;
  const contributionFormula = hasWeightFields
    ? normalizeContributionFormula(
        body.contributionFormula ?? {
          accountWeightPct: body.accountWeightPct ?? body.accountWeight,
          toonWeightPct: body.toonWeightPct ?? body.toonWeight,
        }
      )
    : undefined;

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
    ...(contributionPoints !== undefined ? { contributionPoints } : {}),
    ...(contributionFormula ? { contributionFormula } : {}),
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
