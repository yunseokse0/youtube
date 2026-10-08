import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { parseKstLocalTimestampToMs } from "@/lib/state";
import type { DonationEvent } from "@/lib/donation/types";
import { TOONA_DONATION_PULL_PAST_MS } from "@/lib/toona-hub-pull";

export type ToonaHubDonationApiRow = {
  id?: string;
  nickname?: string;
  displayNickname?: string;
  amount?: number;
  playerName?: string;
  channel?: string;
  source?: string;
  message?: string;
  createdAt?: string;
  contributionPoints?: number;
  accountWeightPct?: number;
  toonWeightPct?: number;
};

/** toona 후원 API 행 → youtube DonationEvent (시나리오 B ingest 와 동일 id 규칙) */
export function toonaHubDonationToEvent(
  row: ToonaHubDonationApiRow,
  linkedAt: number,
  opts?: { intentionalClearAtMs?: number; importFromMs?: number }
): DonationEvent | null {
  let atMs = parseKstLocalTimestampToMs(row.createdAt);
  if (!Number.isFinite(atMs) || atMs <= 0) atMs = Date.now();
  /**
   * importFromMs 가 있으면 그 시각 이후만 넣는다. 재연결로 linkedAt 이 앞으로 가도 이 바닥은 유지된다.
   * importFromMs 가 없으면 처음 연결의 linkedAt-1시간보다 오래된 후원은 넣지 않는다.
   * 정산 리셋·일괄 삭제 시각보다 이전 후원은 넣지 않는다.
   * 미래 1일 이상 시각은 막는다.
   */
  const PAST_IMPORT_ALLOW_MS = TOONA_DONATION_PULL_PAST_MS;
  const FUTURE_BLOCK_MS = 1 * 24 * 60 * 60 * 1000;
  const INTENTIONAL_CLEAR_BUFFER_MS = 500;
  const importFromMs = Math.max(0, Number(opts?.importFromMs) || 0);
  const pastFloor =
    importFromMs > 0 ? importFromMs : Math.max(0, linkedAt - PAST_IMPORT_ALLOW_MS);
  if (atMs < pastFloor) return null;
  if (atMs > Date.now() + FUTURE_BLOCK_MS) return null;
  if (
    typeof opts?.intentionalClearAtMs === "number" &&
    opts.intentionalClearAtMs > 0 &&
    atMs < opts.intentionalClearAtMs - INTENTIONAL_CLEAR_BUFFER_MS
  ) {
    return null;
  }
  const externalId = String(row.id || "").trim();
  if (!externalId) return null;
  const rawDisplayName = String(row.displayNickname || row.nickname || "무명");
  const donorName = rawDisplayName.replace(/\s+/g, "") || "무명";
  const amount = Math.max(0, Math.round(Number(row.amount) || 0));
  if (amount <= 0) return null;
  const channel = String(row.channel || "").trim();
  const source = String(row.source || "").trim().toLowerCase();
  const chLower = channel.toLowerCase();
  const nickLower = rawDisplayName.toLowerCase();
  const playerLower = String(row.playerName || "").toLowerCase();
  const isVoiceDonation =
    nickLower.includes("boomsakalaka") ||
    nickLower.includes("boom shakalaka") ||
    nickLower.includes("붐사카라카") ||
    nickLower.includes("붐 사카라카") ||
    nickLower.includes("보이스") ||
    playerLower.includes("boomsakalaka") ||
    playerLower.includes("boom shakalaka") ||
    playerLower.includes("붐사카라카") ||
    playerLower.includes("붐 사카라카") ||
    playerLower.includes("보이스");
  const isToonationChannel =
    isVoiceDonation ||
    chLower === "toonation" ||
    chLower === "toon" ||
    channel === "투네이션" ||
    channel.includes("투네") ||
    source.includes("toonation") ||
    source.includes("toon") ||
    source.includes("투네");
  const isAccountChannel =
    chLower === "account" ||
    chLower === "bank" ||
    channel === "계좌" ||
    channel.includes("계좌") ||
    (source === "sms" || source === "push");
  const isAccount = !isToonationChannel && isAccountChannel;
  const provider = isAccount ? "bank" : "toonation";
  const contributionPointsRaw = Math.round(Number(row.contributionPoints));
  const contributionPoints =
    Number.isFinite(contributionPointsRaw) && contributionPointsRaw >= 0
      ? contributionPointsRaw
      : undefined;
  const hasWeights = row.accountWeightPct !== undefined || row.toonWeightPct !== undefined;
  return {
    id: `${provider}:din:${externalId}`,
    provider,
    externalId,
    donorName,
    amount,
    at: new Date(atMs).toISOString(),
    status: "queued",
    target: isAccount ? "account" : "toon",
    ...(row.playerName ? { playerName: String(row.playerName) } : {}),
    ...(row.message ? { message: String(row.message).slice(0, 500) } : {}),
    ...(contributionPoints !== undefined ? { contributionPoints } : {}),
    ...(hasWeights
      ? {
          contributionFormula: normalizeContributionFormula({
            accountWeightPct: row.accountWeightPct,
            toonWeightPct: row.toonWeightPct,
          }),
        }
      : {}),
  };
}
