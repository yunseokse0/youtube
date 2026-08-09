import type { DonationEvent, QueueSigItem } from "../types";

function safeRead(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  return (obj as Record<string, unknown>)[key];
}

/** Alertbox·웹소켓·구형 socket.io 등 중첩 페이로드 평탄화 */
export function unwrapToonationPayload(raw: unknown, depth = 0): unknown {
  if (!raw || typeof raw !== "object" || depth > 4) return raw;
  const o = raw as Record<string, unknown>;
  for (const key of ["content", "data", "payload", "donation", "body"]) {
    const nested = o[key];
    if (nested && typeof nested === "object") {
      return unwrapToonationPayload(nested, depth + 1);
    }
  }
  return raw;
}

function parseNumericAmount(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return Math.round(raw);
  if (typeof raw === "string") {
    const n = Number(raw.replace(/,/g, "").trim());
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

export function extractToonationAmount(data: unknown): number {
  const root = unwrapToonationPayload(data);
  const candidates = [
    safeRead(root, "amount"),
    safeRead(root, "price"),
    safeRead(root, "donationAmount"),
    safeRead(root, "donationCash"),
    safeRead(root, "cash"),
    safeRead(root, "money"),
    safeRead(root, "value"),
    safeRead(data, "amount"),
    safeRead(data, "cash"),
  ];
  for (const c of candidates) {
    const n = parseNumericAmount(c);
    if (n > 0) return n;
  }
  return 0;
}

/** 투네 알림 상단 후원자 닉 */
export function extractToonationDonorName(data: unknown): string {
  const root = unwrapToonationPayload(data);
  const anonymous =
    safeRead(root, "isAnonymous") === true ||
    safeRead(root, "anonymous") === true ||
    safeRead(root, "is_anonymous") === 1 ||
    safeRead(root, "is_anonymous") === "1";
  const candidates = [
    safeRead(root, "nickname"),
    safeRead(root, "nickName"),
    safeRead(root, "sender"),
    safeRead(root, "userName"),
    safeRead(root, "donorName"),
    safeRead(root, "donor"),
    safeRead(root, "name"),
    safeRead(data, "nickname"),
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  if (anonymous) {
    const msg = extractToonationMessage(data).trim();
    const first = msg.split(/\s+/).filter(Boolean)[0] || "";
    if (first) return first;
    return "익명";
  }
  return "Unknown";
}

export function extractToonationMessage(data: unknown): string {
  const root = unwrapToonationPayload(data);
  return String(
    safeRead(root, "message") ||
      safeRead(root, "comment") ||
      safeRead(root, "text") ||
      safeRead(root, "msg") ||
      safeRead(root, "donationMessage") ||
      safeRead(root, "donation_message") ||
      safeRead(root, "donationComment") ||
      safeRead(data, "comment") ||
      safeRead(data, "message") ||
      ""
  ).trim();
}

function cleanDonorToken(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[,.:;!?~]+$/g, "")
    .trim();
}

/** 메시지 토큰이 금액처럼만 보이면 플레이어명으로 쓰지 않음 */
function isAmountLikeToken(raw: string): boolean {
  const t = String(raw || "").trim().replace(/,/g, "");
  if (!t) return false;
  return /^\d+(\.\d+)?$/.test(t) || /^\d+원$/.test(t);
}

/** `[계좌]`, `계좌:`, `계좌후원` 등 계좌 포맷 키워드 */
export function isAccountFormatToken(raw: string): boolean {
  const t = String(raw || "")
    .trim()
    .replace(/^[\[\(\{【「『<#]+/, "")
    .replace(/[\]\)\}】」』>#]+$/, "")
    .replace(/[,.:;!?~]+$/g, "")
    .trim();
  return t === "계좌" || t === "계좌후원";
}

/** `익명 지히` — 첫 토큰이 익명 표기면 다음 토큰이 플레이어 */
export function isAnonymousMarkerToken(raw: string): boolean {
  const t = cleanDonorToken(raw).toLowerCase();
  return t === "익명" || t === "anonymous" || t === "anon";
}

/**
 * 투네 후원 메시지 포맷:
 * - 계좌(명시): `계좌 후원자이름 플레이어이름 …` (이후 문구 무시)
 * - 계좌(주인 후원): 알림 닉=채널 주인 → 메시지 `후원자 멤버 (메시지…)` (owner-donation-remap)
 * - 투네: 알림 닉=후원자(금액 앞 표시). 메시지 첫 토큰=플레이어(선택).
 *   `익명 지히`처럼 익명 마커가 앞에 오면 다음 토큰을 플레이어로 사용.
 * - 저장용 message 필드는 항상 통합알림창 하단 comment 원문(파싱과 무관).
 */
export function parseToonationMessageBody(
  message: string,
  alertDonorName = ""
): {
  donorName: string;
  playerName: string;
  target: "account" | "toon";
} {
  const parseAccountTokens = (tokens: string[]) => {
    const idx = tokens.findIndex((t) => isAccountFormatToken(t));
    if (idx < 0) return null;
    const donorName = cleanDonorToken(tokens[idx + 1] || "");
    const playerName = cleanDonorToken(tokens[idx + 2] || "");
    if (!donorName && !playerName) return null;
    return { donorName, playerName, target: "account" as const };
  };

  const msgTokens = String(message || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const fromMsg = parseAccountTokens(msgTokens);
  if (fromMsg) return fromMsg;

  /** 일부 테스트 UI는 메시지 대신 닉 필드에 `계좌 후원자 멤버`를 넣음 */
  const alertTokens = String(alertDonorName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const fromAlert = parseAccountTokens(alertTokens);
  if (fromAlert && !String(message || "").trim()) return fromAlert;

  let playerIdx = 0;
  if (msgTokens.length >= 2 && isAnonymousMarkerToken(msgTokens[0] || "")) {
    playerIdx = 1;
  }
  const rawPlayer = cleanDonorToken(msgTokens[playerIdx] || "");
  const playerName =
    rawPlayer &&
    !isAmountLikeToken(rawPlayer) &&
    !isAccountFormatToken(rawPlayer) &&
    !isAnonymousMarkerToken(rawPlayer)
      ? rawPlayer
      : "";
  return {
    target: "toon",
    donorName: String(alertDonorName || "").trim(),
    playerName,
  };
}

export function extractToonationExternalId(data: unknown): string {
  const root = unwrapToonationPayload(data);
  const id = String(
    safeRead(root, "id") ||
      safeRead(root, "donationId") ||
      safeRead(root, "externalId") ||
      safeRead(data, "id") ||
      ""
  ).trim();
  return id;
}

let toonationFallbackIdSeq = 0;

/** id 없음·0·테스트 재사용 id 등 — 레거시·테스트용(동일 페이로드는 createStableToonationFallbackId 사용) */
export function createUniqueToonationFallbackId(amount: number): string {
  toonationFallbackIdSeq = (toonationFallbackIdSeq + 1) % 1_000_000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}-${amount}-${toonationFallbackIdSeq}-${rand}`;
}

function hashDonationFingerprint(parts: string[]): string {
  const key = parts.join("\0");
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function extractToonationTimestamp(data: unknown): string {
  const root = unwrapToonationPayload(data);
  const candidates = [
    safeRead(root, "createdAt"),
    safeRead(root, "donatedAt"),
    safeRead(root, "timestamp"),
    safeRead(root, "regDate"),
    safeRead(root, "date"),
    safeRead(root, "time"),
    safeRead(data, "createdAt"),
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return "";
}

/**
 * WS 재전송·서버+큐 이중 반영 방지 — 동일 페이로드면 항상 같은 fallback id.
 * 계좌 포맷은 메시지 후원자명만으로는 충돌하기 쉬워 알림 상단 닉도 포함한다.
 */
export function buildToonationDonationFingerprint(data: unknown, amount: number): string {
  const alertDonor = extractToonationDonorName(data);
  const msg = extractToonationMessage(data);
  const parsed = parseToonationMessageBody(msg, alertDonor);
  const donorName =
    parsed.target === "account" ? parsed.donorName || alertDonor : parsed.donorName || alertDonor;
  return hashDonationFingerprint([
    alertDonor,
    donorName,
    String(amount),
    msg,
    parsed.target,
    parsed.playerName || "",
    extractToonationExternalId(data),
    extractToonationTimestamp(data),
  ]);
}

/** id/timestamp 없을 때: 건별 고유 ID — 동일 금액·문구 연속 후원 허용. WS 재전송은 RAW_WS_DEDUPE */
export function createStableToonationFallbackId(data: unknown, amount: number): string {
  const extracted = extractToonationExternalId(data);
  const fp = buildToonationDonationFingerprint(data, amount);
  const unique = createUniqueToonationFallbackId(amount);
  if (isToonationTestDonationPayload(data)) {
    if (isReliableToonationExternalId(extracted)) {
      /** 테스트가 같은 id를 재사용해도 연속 반영되도록 unique 접미사 */
      return `test-${extracted}-${unique}`;
    }
    return `test-${fp}-${unique}`;
  }
  const alertDonor = extractToonationDonorName(data);
  const msg = extractToonationMessage(data);
  const parsed = parseToonationMessageBody(msg, alertDonor);
  /**
   * 투네 직접 후원(toon)도 위젯/테스트에서 동일 id·원문을 반복 보내는 경우가 많다.
   * 실 id를 그대로 쓰면 EVENT/Redis dedupe에 막혀 2건째부터 누락된다.
   */
  if (parsed.target !== "account" && isReliableToonationExternalId(extracted)) {
    return `toon-${extracted}-${unique}`;
  }
  const ts = extractToonationTimestamp(data);
  return ts ? `fp-${ts}-${amount}-${fp}-${unique}` : `fp-${amount}-${fp}-${unique}`;
}

/** 투네가 부여한 실제 후원 id — 우리쪽 fp-/test-/타임스탬프 fallback은 제외 */
export function isReliableToonationExternalId(id: string): boolean {
  const s = String(id || "").trim();
  if (!s) return false;
  if (s === "0") return false;
  if (/^test$/i.test(s)) return false;
  if (/^(fp-|test-|toon-)/i.test(s)) return false;
  if (/^\d{10,13}-\d+(-\d+-[a-z0-9]+)?$/i.test(s)) return false;
  return true;
}

/** WS 원문(JSON)에서 후원 content 페이로드만 추출 */
export function peekToonationWsPayload(raw: string): unknown | null {
  try {
    const envelope = JSON.parse(raw) as Record<string, unknown>;
    return (envelope as { content?: unknown }).content ?? envelope;
  } catch {
    return null;
  }
}

/** 투네 관리자 후원 테스트 — 동일 id를 반복 보내는 경우가 많음 */
export function isToonationTestDonationPayload(data: unknown): boolean {
  const root = unwrapToonationPayload(data);
  const alertDonor = extractToonationDonorName(data);
  if (/테스트|test/i.test(alertDonor)) return true;
  const flag = safeRead(root, "isTest") ?? safeRead(root, "test") ?? safeRead(data, "isTest");
  if (flag === true || flag === 1 || flag === "1") return true;
  return false;
}

export function allocateToonationExternalId(data: unknown, amount: number): string {
  /**
   * 계좌·투네·테스트 공통: 건별 unique externalId.
   * 동일 id/WS 원문 연속 후원 허용, WS 재전송은 server-listener RAW dedupe(500ms).
   */
  return createStableToonationFallbackId(data, amount);
}

export function isDonationLikeSocketEventName(eventName: string): boolean {
  const n = eventName.toLowerCase();
  return n.includes("donation") || n.includes("donate") || n.includes("alert");
}

/** 투네 WebPushCode.AlertDonation — 투네이션 직접 후원 */
export const TOONATION_WS_CODE_DONATION = 101;
/** 투네 WebPushCode.AlertYoutubeSuperChat — 유튜브 슈퍼챗(투네 위젯 경유) */
export const TOONATION_WS_CODE_YOUTUBE_SUPERCHAT = 109;
/** AlertType.YoutubeSuperChat (일부 페이로드의 code_ex) */
export const TOONATION_ALERT_TYPE_YOUTUBE_SUPERCHAT = 1120;

/** 유튜브 슈퍼챗 알림 여부 — 투네이션 위젯 연동(유튜브) 후원 */
export function isToonationYoutubeSuperChatWsMessage(data: Record<string, unknown>): boolean {
  const code = Number(data.code);
  if (code === TOONATION_WS_CODE_YOUTUBE_SUPERCHAT) return true;
  const codeEx = Number(data.code_ex);
  if (codeEx === TOONATION_ALERT_TYPE_YOUTUBE_SUPERCHAT) return true;
  return false;
}

/**
 * 엑셀표·후원 큐에 넣을 투네 WS 메시지인지.
 * - code 101: 투네 직접 후원
 * - code 109 / code_ex 1120: 유튜브 슈퍼챗(알림만 뜨고 표 누락되던 경로 — 동일 파싱으로 반영)
 */
export function isToonationExcelDonationWsMessage(data: Record<string, unknown>): boolean {
  const code = Number(data.code);
  if (code === TOONATION_WS_CODE_DONATION) return true;
  if (code === TOONATION_WS_CODE_YOUTUBE_SUPERCHAT) return true;
  if (Number(data.code_ex) === TOONATION_ALERT_TYPE_YOUTUBE_SUPERCHAT) return true;
  return false;
}

/** 투네 ws.toon.at JSON (code 101·109 후원 반영) */
export function parseToonationWebSocketMessage(raw: string): DonationEvent | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const payload = (data as any).content ?? data;
    const evt = parseToonationDonationPayload(payload);
    if (!evt) return null;

    /** 기존엔 code=101(후원) / 109(유튜브 슈퍼챗)만 후원으로 인정했는데,
     * 실제로는 코드가 약간 다른 변형이 들어와 누락될 수 있었다.
     * 따라서 code로 1차 판별하되, amount가 있고 donor/message 힌트가 있으면 code가 달라도 허용한다.
     * (단, amount만 있는 비후원 이벤트는 그대로 버림)
     */
    if (isToonationExcelDonationWsMessage(data)) return evt;

    const root = unwrapToonationPayload(payload);
    const donorHint = [
      safeRead(root, "nickname"),
      safeRead(root, "nickName"),
      safeRead(root, "sender"),
      safeRead(root, "userName"),
      safeRead(root, "name"),
    ].some((x) => String(x ?? "").trim().length > 0);

    const messageHint = [
      safeRead(root, "message"),
      safeRead(root, "comment"),
      safeRead(root, "text"),
    ].some((x) => String(x ?? "").trim().length > 0);

    if (!donorHint && !messageHint) return null;
    return evt;
  } catch {
    return null;
  }
}

export function parseToonationDonationPayload(data: unknown): DonationEvent | null {
  const amount = extractToonationAmount(data);
  if (amount <= 0) return null;

  const externalId = allocateToonationExternalId(data, amount);
  const alertDonor = extractToonationDonorName(data);
  const rawMessage = extractToonationMessage(data);
  const parsed = parseToonationMessageBody(rawMessage, alertDonor);
  const donorName =
    parsed.target === "account"
      ? parsed.donorName || alertDonor
      : parsed.donorName || alertDonor;
  const playerName = parsed.playerName || undefined;

  return {
    id: `toonation:${externalId}`,
    provider: "toonation",
    externalId,
    donorName,
    playerName,
    recipientName: playerName,
    amount,
    /** 통합알림창에 보이는 후원 메시지(comment) 원문 — 멤버 파싱용 토큰과 별개로 그대로 저장 */
    message: rawMessage,
    at: new Date().toISOString(),
    target: parsed.target,
    status: "queued",
  };
}

export function extractAlertboxKeyFromUrl(alertboxUrl: string): string {
  const key = new URL(alertboxUrl).pathname.split("/").filter(Boolean).pop();
  if (!key) throw new Error("invalid_toonation_alertbox_url");
  return key;
}

/**
 * 후원 금액과 메시지를 기반으로 시그 스냅샷에서 가장 적절한 시그를 매칭합니다.
 * (할인 없음 전제 — 금액 일치가 1순위)
 */
export function matchSigByAmountAndMessage(
  amount: number,
  message: string,
  sigListSnapshot: QueueSigItem[]
): { sigName: string | undefined; isAutoMatched: boolean } {
  if (!sigListSnapshot?.length) {
    return { sigName: undefined, isAutoMatched: false };
  }

  const safeAmount = Math.max(0, Math.round(Number(amount) || 0));
  const text = String(message || "");

  const priceMatchedSigs = sigListSnapshot.filter(
    (sig) => Math.round(Number(sig.price || 0)) === safeAmount
  );

  if (priceMatchedSigs.length === 0) {
    return { sigName: undefined, isAutoMatched: false };
  }

  if (priceMatchedSigs.length === 1) {
    return { sigName: priceMatchedSigs[0]!.name, isAutoMatched: true };
  }

  const textMatchedSig = priceMatchedSigs.find((sig) => sig.name && text.includes(sig.name));
  if (textMatchedSig) {
    return { sigName: textMatchedSig.name, isAutoMatched: true };
  }

  return { sigName: priceMatchedSigs[0]!.name, isAutoMatched: false };
}
