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

  const aggregatedCountRaw = Number(body.aggregatedCount);
  const aggregatedCount = Number.isFinite(aggregatedCountRaw) && aggregatedCountRaw > 1 ? Math.round(aggregatedCountRaw) : undefined;

  const aggregatedDonorsRaw = Array.isArray(body.aggregatedDonors)
    ? body.aggregatedDonors.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const aggregatedEventIdsRaw = Array.isArray(body.aggregatedEventIds)
    ? body.aggregatedEventIds.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const aggregatedMessagesRaw = Array.isArray(body.aggregatedMessages)
    ? body.aggregatedMessages.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const aggregatedPlayersRaw = Array.isArray(body.aggregatedPlayers)
    ? body.aggregatedPlayers.map((x) => String(x || "").trim()).filter(Boolean)
    : [];

  const isSameDonorOnlyBucket =
    aggregatedCount !== undefined && aggregatedDonorsRaw.length === 1;

  let donorName = String(body.donorName || "").trim();

  if (isSameDonorOnlyBucket && aggregatedCount !== undefined) {
    const singleDonor = aggregatedDonorsRaw[0] || donorName;
    const bucketSum = Math.round(Number(body.amount) || 0);
    donorName = `${singleDonor} 후원 ${aggregatedCount}회 (총 ${bucketSum.toLocaleString()}원)`;
  }

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
  let atIso = "";
  try {
    const ms = parseKstLocalTimestampToMs(atRaw);
    const finalMs = Number.isFinite(ms) && ms > 0 ? ms : Date.now();
    atIso = new Date(finalMs).toISOString();
  } catch {
    atIso = new Date().toISOString();
  }
  const at = atIso;

  let firstAt: string | undefined;
  const firstAtRaw = body.firstAt;
  try {
    const ms = parseKstLocalTimestampToMs(firstAtRaw);
    if (Number.isFinite(ms) && ms > 0) firstAt = new Date(ms).toISOString();
  } catch {}

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
    ...(aggregatedCount !== undefined ? { aggregatedCount } : {}),
    ...(aggregatedEventIdsRaw.length ? { aggregatedEventIds: aggregatedEventIdsRaw } : {}),
    ...(aggregatedDonorsRaw.length ? { aggregatedDonors: aggregatedDonorsRaw } : {}),
    ...(aggregatedMessagesRaw.length ? { aggregatedMessages: aggregatedMessagesRaw } : {}),
    ...(aggregatedPlayersRaw.length ? { aggregatedPlayers: aggregatedPlayersRaw } : {}),
    ...(firstAt ? { firstAt } : {}),
  };
}

export type DinIngestResult =
  | { ok: true; applied: false; alert: true; mode: "alert_only" }
  | { ok: true; applied: true; outcome: "applied" | "applied_needs_review"; mode: "excel" }
  | { ok: true; applied: false; queued: true; mode: "excel" };

async function logHubIngestIfLinked(
  userId: string,
  event: DonationEvent,
  result: DinIngestResult,
  opts?: { forceSource?: "ingest" | "toona"; idPrefix?: "ingest" | "toona" }
): Promise<void> {
  const session = await readToonaHubSession(userId);
  if (!session) return;
  const at = event.at ? new Date(event.at).getTime() : Date.now();
  if (Number.isFinite(at) && at < session.linkedAt - 5_000) return;
  const source: "ingest" | "toona" = opts?.forceSource || "ingest";
  const prefix = opts?.idPrefix || source;
  const idBase = source === "toona" && event.externalId ? event.externalId : event.id;
  await appendToonaHubDonationLog(userId, {
    id: `${prefix}:${idBase}`,
    at: Number.isFinite(at) ? at : Date.now(),
    donorName: event.donorName,
    amount: event.amount,
    playerName: event.playerName,
    target: event.target,
    mode: result.mode,
    applied: result.applied,
    source,
    message: event.message?.slice(0, 120),
  });
}

/** DIN ingest — applyExcel=false면 시그·player-alert만, true면 엑셀표 반영 */
export async function handleDinDonationIngest(
  userId: string,
  event: DonationEvent,
  applyExcel: boolean,
  opts?: { logSource?: "ingest" | "toona"; skipHubLog?: boolean }
): Promise<DinIngestResult> {
  const aggCount = event.aggregatedCount;
  const isBucketAggregated = aggCount !== undefined && aggCount > 1;

  let result: DinIngestResult;
  if (!applyExcel) {
    if (!isBucketAggregated) {
      const enriched = await enrichDonationEventWithSigMatch(userId, event);
      await broadcastPlayerDonationAlert(userId, enriched);
    }
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

  if (!opts?.skipHubLog) {
    await logHubIngestIfLinked(userId, event, result, { forceSource: opts?.logSource }).catch(() => {});
  }

  if (isBucketAggregated) {
    const count = aggCount as number;
    const totalAmt = Math.max(0, Math.round(Number(event.amount) || 0));
    const baseAtMs = event.firstAt
      ? new Date(event.firstAt).getTime()
      : new Date(event.at).getTime();
    const donors = event.aggregatedDonors || [event.donorName];
    const messages = event.aggregatedMessages || (event.message ? [event.message] : []);
    const ids = event.aggregatedEventIds || [];

    const perAlerts: Array<Promise<void>> = [];
    const avgAmt = Math.floor(totalAmt / count);
    const remainder = totalAmt - avgAmt * count;

    for (let idx = 0; idx < count; idx++) {
      const donorIdx = idx % Math.max(1, donors.length);
      const msgIdx = Math.min(idx, Math.max(0, messages.length - 1));
      const idFallback = ids[idx] || `${event.id}:evt-${idx}`;
      const isLast = idx === count - 1;
      const perAmount = isLast ? avgAmt + remainder : avgAmt;

      const perAtMs = Math.max(baseAtMs + idx * 33, Date.now() - count * 100 + idx * 33);
      const perAt = new Date(perAtMs).toISOString();

      const rawPerEvent: DonationEvent = {
        id: idFallback,
        provider: event.provider,
        externalId: ids[idx] || `${event.externalId}:${idx}`,
        donorName: donors[donorIdx] || event.donorName,
        amount: Math.max(1, perAmount),
        at: perAt,
        status: event.status,
        ...(event.playerName ? { playerName: event.playerName } : {}),
        ...(messages[msgIdx] ? { message: messages[msgIdx] } : {}),
        ...(event.target ? { target: event.target } : {}),
        ...(event.memberId ? { memberId: event.memberId } : {}),
      };

      perAlerts.push(
        enrichDonationEventWithSigMatch(userId, rawPerEvent)
          .then((enriched) => broadcastPlayerDonationAlert(userId, enriched))
          .catch(() => {})
      );
    }

    if (perAlerts.length) {
      await Promise.allSettled(perAlerts);
    }
  }

  return result;
}
