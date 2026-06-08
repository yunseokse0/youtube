import type { DonationEvent } from "../types";

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

export function extractToonationAmount(data: unknown): number {
  const root = unwrapToonationPayload(data);
  const candidates = [
    safeRead(root, "amount"),
    safeRead(root, "price"),
    safeRead(root, "donationAmount"),
    safeRead(root, "value"),
    safeRead(data, "amount"),
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return 0;
}

/** 투네 알림 상단 후원자 닉 */
export function extractToonationDonorName(data: unknown): string {
  const root = unwrapToonationPayload(data);
  const candidates = [
    safeRead(root, "nickname"),
    safeRead(root, "nickName"),
    safeRead(root, "sender"),
    safeRead(root, "userName"),
    safeRead(root, "name"),
    safeRead(data, "nickname"),
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (s) return s;
  }
  return "Unknown";
}

export function extractToonationMessage(data: unknown): string {
  const root = unwrapToonationPayload(data);
  return String(
    safeRead(root, "message") ||
      safeRead(root, "comment") ||
      safeRead(root, "text") ||
      safeRead(data, "comment") ||
      ""
  ).trim();
}

function cleanDonorToken(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/[,.:;!?~]+$/g, "")
    .trim();
}

/**
 * 투네 후원 메시지 포맷:
 * - 계좌: `계좌 후원자이름 플레이어이름 …` (이후 문구 무시)
 * - 투네: 후원자 = 알림 상단 닉(`alertDonorName`). 메시지 첫 토큰 = 플레이어(선택). 이후 무시.
 */
export function parseToonationMessageBody(
  message: string,
  alertDonorName = ""
): {
  donorName: string;
  playerName: string;
  target: "account" | "toon";
} {
  const tokens = String(message || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length > 0 && tokens[0] === "계좌") {
    return {
      target: "account",
      donorName: cleanDonorToken(tokens[1] || ""),
      playerName: cleanDonorToken(tokens[2] || ""),
    };
  }

  const playerName = cleanDonorToken(tokens[0] || "");
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

export function isDonationLikeSocketEventName(eventName: string): boolean {
  const n = eventName.toLowerCase();
  return n.includes("donation") || n.includes("donate") || n.includes("alert");
}

/** 투네 WebPushCode.AlertDonation — 투네이션 직접 후원만 엑셀표 반영 */
export const TOONATION_WS_CODE_DONATION = 101;
/** 투네 WebPushCode.AlertYoutubeSuperChat — OBS 알림만, 엑셀표·큐 제외 */
export const TOONATION_WS_CODE_YOUTUBE_SUPERCHAT = 109;
/** AlertType.YoutubeSuperChat (일부 페이로드의 code_ex) */
export const TOONATION_ALERT_TYPE_YOUTUBE_SUPERCHAT = 1120;

/** 유튜브 슈퍼챗 알림 여부 — 투네이션 위젯 연동 알림(직접 후원 아님) */
export function isToonationYoutubeSuperChatWsMessage(data: Record<string, unknown>): boolean {
  const code = Number(data.code);
  if (code === TOONATION_WS_CODE_YOUTUBE_SUPERCHAT) return true;
  const codeEx = Number(data.code_ex);
  if (codeEx === TOONATION_ALERT_TYPE_YOUTUBE_SUPERCHAT) return true;
  return false;
}

/** 엑셀표·후원 큐에 넣을 투네 WS 메시지인지 (code 101 직접 후원만) */
export function isToonationExcelDonationWsMessage(data: Record<string, unknown>): boolean {
  if (isToonationYoutubeSuperChatWsMessage(data)) return false;
  return Number(data.code) === TOONATION_WS_CODE_DONATION;
}

/** 투네 ws.toon.at JSON (code 101 = 후원, 109 슈퍼챗 등은 무시) */
export function parseToonationWebSocketMessage(raw: string): DonationEvent | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!isToonationExcelDonationWsMessage(data)) return null;
    return parseToonationDonationPayload(data.content ?? data);
  } catch {
    return null;
  }
}

export function parseToonationDonationPayload(data: unknown): DonationEvent | null {
  const amount = extractToonationAmount(data);
  if (amount <= 0) return null;

  const externalId = extractToonationExternalId(data) || `${Date.now()}-${amount}`;
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
