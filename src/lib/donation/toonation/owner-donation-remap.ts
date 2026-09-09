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
  const norm = normalizeOwnerNameForCompare(trimmed);
  if (!norm) return;
  /**
   * ✅ 2026-09-09 Hotfix ㉒-2 계좌 뻥튀기 Bug: 너무 흔한 단어는 채널 주인 후보에서 블랙리스트
   *  - "후원" 이라는 닉네임의 일반 투네 후원자가 채널 주인 이름 "후원" 과 충돌하여 계좌로 오판되는 현상 원천 봉쇄
   *  - 채널 주인 이름이 이 블랙리스트 단어와 정확히 일치하는 경우는 세상에 없으므로 안전
   */
  const BLACKLIST = new Set([
    "후원",
    "테스트",
    "익명",
    "관리자",
    "방송",
    "스트리머",
    "투네",
    "시청자",
    "동료",
    "친구",
    "개인",
    "일반",
    "유튜브",
    "youtube",
    "계좌",
    "은행",
    "입금",
  ]);
  if (BLACKLIST.has(norm)) return;
  if (norm.length <= 1) return;
  names.add(norm);
  const stripped = stripHonorificSuffix(trimmed);
  if (stripped && stripped !== trimmed) {
    const s = normalizeOwnerNameForCompare(stripped);
    if (s && !BLACKLIST.has(s) && s.length > 1) names.add(s);
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
 * - ✅ 2026-09-09 Hotfix ㉓-1: accountIdx = -1 (메시지에 계좌 키워드 없음) 이면 절대 donorName 추출하지 않음
 *   → "후원 테스트 입니다" 같은 일반 메시지가 idx=0 부터 잘못 추출되어 계좌 후원으로 오판되는 구조적 결함 봉쇄
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
  if (accountIdx < 0) {
    /** 계좌 접두가 전혀 없으면 → 파싱 결과를 전부 비워서 상위 호출자가 계좌 리맵핑을 취소하도록 유도 */
    return { donorName: "", playerName: "", restMessage: String(message || "").trim() };
  }
  let idx = accountIdx + 1;
  const donorName = tokens[idx] || "";
  const playerName = tokens[idx + 1] || "";
  const restMessage = tokens.slice(idx + 2).join(" ").trim();
  return { donorName, playerName, restMessage };
}

/** 알림 닉=채널 주인 → 계좌 처리 + 메시지에서 후원자·멤버 분리 */
export function remapOwnerSelfDonationAsAccount(source: DonationEvent): DonationEvent {
  /**
   * ✅ 2026-09-09 Hotfix ㉓-2: remap 호출 진입시 1차 방어
   *  - 채널 주인 자기 후원은 메시지에 "계좌" 라는 명시적 키워드가 있거나, 진짜 계좌 후원 포맷(메시지 비어있음) 일때만 target=account 허용
   *  - 일반 투네 후원 메시지("후원 테스트 입니다")가 우연히 owner 이름과 같아서 들어온 경우는 그대로 이벤트 리턴 (target=account로 강제 변경 안함)
   */
  const msg = String(source.message || "").trim();
  const msgTokens = msg.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const hasAccountKeyword =
    msgTokens.length === 0 ||
    msgTokens.some((t) => isAccountFormatToken(t)) ||
    /(은행|입금|예금주|계좌이체|무통장|계좌|통장|기업|계정|계정후원)/.test(msg);
  if (!hasAccountKeyword) {
    /** 명시적 계좌 키워드 없으면 절대 계좌로 리맵핑 하지 않음 */
    return source;
  }

  if (!msg) {
    return { ...source, target: "account" };
  }
  const parsed = parseOwnerAccountMessageBody(msg);
  const parsedResult: DonationEvent = {
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

  /**
   * ✅ 2026-09-09 Hotfix ㉓-2: 계좌 리맵핑 직후 2차 검증
   *  - 위 hasAccountKeyword 를 통과했음에도, 최종적으로 donorName 이 블랙리스트("후원" 등 너무 흔한 단어) 이면
   *    진짜 채널 주인의 계좌 자기 후원일 확률은 0 → 리턴 직전 target=toon 으로 강제 롤백
   */
  const donorNorm = normalizeOwnerNameForCompare(parsedResult.donorName || "");
  const BLACKLIST_ROLLBACK = new Set([
    "후원",
    "테스트",
    "익명",
    "관리자",
    "방송",
    "스트리머",
    "투네",
    "시청자",
  ]);
  if (BLACKLIST_ROLLBACK.has(donorNorm)) {
    return { ...parsedResult, target: "toon" };
  }
  return parsedResult;
}

/**
 * 투네 자동 반영 규칙:
 * - 알림 후원자 닉 ≠ 채널 주인 → 투네. 후원자명=알림 닉 그대로 엑셀 저장
 * - 알림 후원자 닉 = 채널 주인 → [2026-09-09 2중 검사] 메시지 포맷이 진짜 계좌 후원(계좌 키워드 있거나 비어있음) 일때만 계좌 처리
 *   → 닉네임만 일치하는 일반 투네 후원자가 계좌로 오판되는 버그 차단
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

  /** ✅ 2026-09-09 Hotfix ㉒-1: owner 이름과 일치해도 진짜 계좌 후원 포맷일때만 리맵핑 허용 */
  const msg = String(event.message || "").trim();
  const msgTokens = msg.split(/\s+/).map((t) => t.trim()).filter(Boolean);
  const hasAccountKeyword =
    msgTokens.length === 0 ||
    msgTokens.some((t) => isAccountFormatToken(t)) ||
    /(은행|입금|예금주|계좌이체|무통장|계좌|통장|기업|계정|계정후원)/.test(msg);
  if (!hasAccountKeyword) {
    /** 계좌 키워드가 없는 일반 메시지("후원 테스트 입니다" 등)는 100% 투네 후원 → 리맵핑 취소 */
    return event;
  }
  const remapped = remapOwnerSelfDonationAsAccount(event);

  /**
   * ✅ 2026-09-09 Hotfix ㉓-3: apply 단계 최종 방어망 (WS listener 등 어떤 경로에서 호출해도 적용)
   *  - 위 1,2,3 단계 필터를 전부 우회해서 계좌로 리맵된 경우라도, 최종 return 직전에
   *    ① donorName 이 블랙리스트("후원" 등 너무 흔한 단어) 이거나
   *    ② provider=toonation 인데 donorName 에 숫자/특수기호 섞인 일반 닉네임 패턴이면
   *    진짜 채널 주인 계좌 후원일 확률 0 → target=toon 으로 강제 롤백
   */
  const donorNorm = normalizeOwnerNameForCompare(remapped.donorName || "");
  const BLACKLIST_ROLLBACK = new Set([
    "후원", "테스트", "익명", "관리자", "방송", "스트리머", "투네", "시청자",
    "일반", "개인", "유튜브", "계좌", "은행", "입금", "기부", "서포터",
  ]);
  if (
    remapped.target === "account" &&
    remapped.provider === "toonation" &&
    (BLACKLIST_ROLLBACK.has(donorNorm) || /[0-9!@#$%^&*()_+=\[\]{}|;:'",.<>?`~-]/.test(remapped.donorName || ""))
  ) {
    return { ...remapped, target: "toon" };
  }
  return remapped;
}

export async function resolveToonationDonationWithOwnerRemap(
  userId: string,
  event: DonationEvent,
  ownerName?: string
): Promise<DonationEvent> {
  if (event.provider !== "toonation") return event;
  const ownerNames = await getOwnerNameCandidates(userId, ownerName);
  const remapped = applyOwnerDonationRemapIfNeeded(event, ownerNames);

  /**
   * ✅ 2026-09-09 Hotfix ㉒-3 최종 안전망:
   *  - 위 1,2 단계 필터를 우회해서 계좌로 리맵된 경우라도, donorName 이 블랙리스트("후원" 등 너무 흔한 단어) 이면
   *    진짜 채널 주인이 이 닉네임을 쓸 확률은 0 이므로 → 무조건 toon 으로 롤백
   *  - provider=toonation 인 경우는 실제 계좌 후원이 절대 없으므로 안전
   */
  const donorNorm = normalizeOwnerNameForCompare(remapped.donorName || "");
  const BLACKLIST_ROLLBACK = new Set([
    "후원",
    "테스트",
    "익명",
    "관리자",
    "방송",
    "스트리머",
    "투네",
    "시청자",
  ]);
  if (remapped.target === "account" && event.provider === "toonation" && BLACKLIST_ROLLBACK.has(donorNorm)) {
    return { ...remapped, target: "toon" };
  }
  return remapped;
}
