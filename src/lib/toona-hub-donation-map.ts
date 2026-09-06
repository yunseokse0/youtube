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
  linkedAt: number,
  opts?: { intentionalClearAtMs?: number }
): DonationEvent | null {
  let atMs = parseKstLocalTimestampToMs(row.createdAt);
  if (!Number.isFinite(atMs) || atMs <= 0) atMs = Date.now();
  /**
   * ✅ 2026-09-07 Hotfix ⑥-2 재조정: 사용자 요청에 따라 "이후 신규 후원만 정상 적재" 용도로
   *  연동 시점(linkedAt) 과거 후원은 1시간 이내 시간 불일치 보정 범위만 허용. 그보다 오래된 과거 후원은 자동 skip.
   *  (실시간 유입 후원은 서버 시간차 최대 5분 내외 이므로 1시간이면 충분. 30일 허용시 폴링마다 수천건 과거 행 순회 부하)
   *  미래 시간 (현재+1일 이상) 조작 데이터 차단은 유지.
   *
   *  ✅ 2026-09-07 Hotfix ⑥-7 옵션2 구현: "리셋 눌렀는데 기존 데이터 왜이렇게 살아남?"
   *   · 정산 리셋 / 후원 일괄 삭제 intentional clear 발생 시 AppState.settlementResetAt · intentionalDonationClearAt 에 타임스탬프 기록됨.
   *   · opts.intentionalClearAtMs 로 이 시간을 전달받으면 → **clear 발생 시점 - 500ms 보다 과거에 발생한 후원은 전부 skip**
   *   · 결과: 리셋 누른 그 시점 이후의 신규 후원만 자동으로 가져오고, 리셋 이전 과거 후원은 절대 다시 살아나지 않음.
   *   · 의도: 과거 데이터를 새로 불러오고 싶을땐 관리자 수동 「일일 로그에서 후원 복구」 버튼 (ignoreMinInterval 경로) 를 통해서만 가능.
   */
  const PAST_IMPORT_ALLOW_MS = 60 * 60 * 1000;
  const FUTURE_BLOCK_MS = 1 * 24 * 60 * 60 * 1000;
  const INTENTIONAL_CLEAR_BUFFER_MS = 500;
  if (atMs < linkedAt - PAST_IMPORT_ALLOW_MS) return null;
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
