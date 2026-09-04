import { normalizeComparableName, stripHonorificSuffix } from "../name-similarity";
import type { DonationEvent } from "../types";
import { isAccountFormatToken } from "./parse-event";

type OwnerAccountRow = { id: string; name: string; companyName: string };

function accountsApiUrl(): string {
  if (typeof window !== "undefined") return "/api/accounts";
  const port = String(process.env.PORT || "3000").trim();
  const host = String(process.env.HOSTNAME || "127.0.0.1").trim();
  return `http://${host}:${port}/api/accounts`;
}

async function loadAccountForUserId(userId: string): Promise<OwnerAccountRow | null> {
  if (typeof window !== "undefined") return null;
  try {
    const res = await fetch(accountsApiUrl(), { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { accounts?: OwnerAccountRow[] } | OwnerAccountRow[];
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data.accounts)
        ? data.accounts
        : [];
    return list.find((a) => String(a.id || "").trim() === userId) ?? null;
  } catch {
    return null;
  }
}

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

/**
 * 계좌 자동반영에 쓸 채널 주인명 후보.
 * - 관리자 「채널 주인명」이 1순위
 * - 계정 표시명·회사명은 별칭으로만 추가
 * - 로그인 userId 는 넣지 않음(아이디=닉 오탐으로 일반 투네가 계좌로 가는 것 방지)
 */
export async function getOwnerNameCandidates(userId: string, ownerName?: string): Promise<Set<string>> {
  const now = Date.now();
  const cacheKey = `${userId}:${normalizeOwnerNameForCompare(ownerName || "")}`;
  const cached = ownerNameCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.names;

  const names = new Set<string>();
  pushOwnerCandidate(names, ownerName);
  try {
    const account = await loadAccountForUserId(userId);
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
  const accountIdx = tokens.findIndex((t) => isAccountFormatToken(t));
  let idx = accountIdx >= 0 ? accountIdx + 1 : 0;
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
    /**
     * 계좌도 투네 comment로 들어오므로 원문을 그대로 남긴다.
     * (후원자·멤버 토큰만 남기고 rest만 쓰면 `익명 현세서`처럼 메시지가 비게 됨)
     */
    message: msg,
  };
}

/**
 * 투네 자동 반영 규칙:
 * - 알림 후원자 닉 ≠ 채널 주인 → 투네. 후원자명=알림 닉 그대로 엑셀 저장
 * - 알림 후원자 닉 = 채널 주인 → 계좌. 메시지「실제후원자 멤버 …」파싱
 * (메시지에 명시적「계좌」포맷이면 parse 단계에서 이미 account)
 */
export function applyOwnerDonationRemapIfNeeded(
  event: DonationEvent,
  ownerNames: Set<string>
): DonationEvent {
  if (event.target === "account") return event;
  if (event.provider !== "toonation") return event;
  if (!ownerNames.size) return event;
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
