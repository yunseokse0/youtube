import { normalizeContributionFormula } from "@/lib/contribution-formula";
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
  const atMs = row.createdAt ? new Date(row.createdAt).getTime() : Date.now();
  if (!Number.isFinite(atMs) || atMs < linkedAt - 5_000) return null;
  const externalId = String(row.id || "").trim();
  if (!externalId) return null;
  const donorName =
    String(row.displayNickname || row.nickname || "무명").replace(/\s+/g, "") || "무명";
  const amount = Math.max(0, Math.round(Number(row.amount) || 0));
  if (amount <= 0) return null;
  const channel = String(row.channel || "").trim();
  const source = String(row.source || "").trim().toLowerCase();
  const chLower = channel.toLowerCase();
  const isToonationChannel =
    chLower === "toonation" ||
    chLower === "toon" ||
    channel === "투네이션" ||
    channel.includes("투네");
  const isAccountChannel =
    chLower === "account" ||
    chLower === "bank" ||
    channel === "계좌" ||
    channel.includes("계좌") ||
    ["sms", "push", "webhook"].includes(source);
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
