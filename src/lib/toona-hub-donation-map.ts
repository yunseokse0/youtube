import { normalizeContributionFormula } from "@/lib/contribution-formula";
import { parseKstLocalTimestampToMs } from "@/lib/state";
import type { DonationEvent } from "@/lib/donation/types";

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
  linkedAt: number
): DonationEvent | null {
  let atMs = parseKstLocalTimestampToMs(row.createdAt);
  if (!Number.isFinite(atMs) || atMs <= 0) atMs = Date.now();
  /**
   * ✅ 2026-09-07 Hotfix ⑥ 완화: 연동 시점(linkedAt) 보다 과거 후원도 30일 이내면 전부 import 허용.
   * 기존 -5초 필터는 "연동 전에 보낸 후원"을 전부 버려서 사용자가 "패치 후 제대로 못가져옴"을 느끼는 직접적 원인이었음.
   * 실제 중복 반영은 downstream isDuplicateDonationEvent + primary key SETNX 가 100% 막아주므로 안심.
   * 미래 시간 (현재+1일 이상) 조작 데이터만 차단. */
  const PAST_IMPORT_ALLOW_MS = 30 * 24 * 60 * 60 * 1000;
  const FUTURE_BLOCK_MS = 1 * 24 * 60 * 60 * 1000;
  if (atMs < linkedAt - PAST_IMPORT_ALLOW_MS) return null;
  if (atMs > Date.now() + FUTURE_BLOCK_MS) return null;
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
