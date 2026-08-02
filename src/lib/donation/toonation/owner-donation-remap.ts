import { loadAccounts } from "@/lib/accounts-storage";
import { normalizeComparableName, stripHonorificSuffix } from "../name-similarity";
import type { DonationEvent } from "../types";
import { isAccountFormatToken } from "./parse-event";

const OWNER_NAME_CACHE_TTL_MS = 60_000;
const ownerNameCache = new Map<string, { names: Set<string>; expiresAt: number }>();

function cleanMessageToken(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[,.:;!?~]+$/g, "")
    .trim();
}

/** 채널 주인·후원자명 비교 — 호칭(님)·기호 무시 */
export function normalizeOwnerNameForCompare(raw: string): string {
  const stripped = stripHonorificSuffix(String(raw || "").trim());
  return normalizeComparableName(stripped)
    .replace(/\s+/g, "")
    .replace(/[.,:;!?~'"`()\[\]{}<>_-]+/g, "");
}

function pushOwnerCandidate(names: Set<string>, raw?: string): void {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return;
  names.add(normalizeOwnerNameForCompare(trimmed));
  const stripped = stripHonorificSuffix(trimmed);
  if (stripped && stripped !== trimmed) {
    names.add(normalizeOwnerNameForCompare(stripped));
  }
}

/** 로그인 계정명·관리자 입력 채널 주인명 등 */
export async function getOwnerNameCandidates(userId: string, ownerName?: string): Promise<Set<string>> {
  const now = Date.now();
  const cacheKey = `${userId}:${normalizeOwnerNameForCompare(ownerName || "")}`;
  const cached = ownerNameCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.names;

  const names = new Set<string>();
  pushOwnerCandidate(names, userId);
  pushOwnerCandidate(names, ownerName);
  try {
    const accounts = await loadAccounts();
    const account = accounts.find((a) => String(a.id || "").trim() === userId);
    if (account) {
      pushOwnerCandidate(names, account.name);
      pushOwnerCandidate(names, account.companyName);
    }
  } catch {
    /* noop */
  }
  ownerNameCache.set(cacheKey, { names, expiresAt: now + OWNER_NAME_CACHE_TTL_MS });
  return names;
}

/**
 * 채널 주인 자기 후원(계좌) — 메시지 본문 파싱
 * - `계좌` 접두 있으면 건너뛴 뒤 동일 규칙
 * - 1번째 토큰 = 실제 후원자명 (익명)
 * - 2번째 토큰 = 멤버명
 * - 3번째~ = 메시지(선택)
 */
export function parseOwnerAccountMessageBody(message: string): {
  donorName: string;
  playerName: string;
  restMessage: string;
} {
  const tokens = String(message || "")
    .trim()
    .split(/\s+/)
    .map(cleanMessageToken)
    .filter(Boolean);
  let idx = 0;
  if (tokens.length > 0 && isAccountFormatToken(tokens[0])) idx = 1;
  const donorName = tokens[idx] || "";
  const playerName = tokens[idx + 1] || "";
  const restMessage = tokens.slice(idx + 2).join(" ").trim();
  return { donorName, playerName, restMessage };
}

/** 알림 닉=채널 주인 → 계좌 처리 + 메시지에서 후원자·멤버 분리 */
export function remapOwnerSelfDonationAsAccount(source: DonationEvent): DonationEvent {
  const msg = String(source.message || "").trim();
  if (!msg) {
    return { ...source, target: "account" };
  }
  const parsed = parseOwnerAccountMessageBody(msg);
  return {
    ...source,
    target: "account",
    ...(parsed.donorName ? { donorName: parsed.donorName } : {}),
    ...(parsed.playerName
      ? { playerName: parsed.playerName, recipientName: parsed.playerName }
      : {}),
    message: parsed.restMessage,
  };
}

/** 투네 후원 — 후원자 닉이 채널 주인과 같으면 계좌 열로 처리 */
export function applyOwnerDonationRemapIfNeeded(
  event: DonationEvent,
  ownerNames: Set<string>
): DonationEvent {
  if (event.target === "account") return event;
  if (event.provider !== "toonation") return event;
  const donorNormalized = normalizeOwnerNameForCompare(event.donorName || "");
  if (!donorNormalized || !ownerNames.has(donorNormalized)) return event;
  return remapOwnerSelfDonationAsAccount(event);
}

export async function resolveToonationDonationWithOwnerRemap(
  userId: string,
  event: DonationEvent,
  ownerName?: string
): Promise<DonationEvent> {
  if (event.provider !== "toonation") return event;
  const ownerNames = await getOwnerNameCandidates(userId, ownerName);
  return applyOwnerDonationRemapIfNeeded(event, ownerNames);
}
