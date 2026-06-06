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
  );
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

/** 투네 ws.toon.at JSON (code 101 = 후원) */
export function parseToonationWebSocketMessage(raw: string): DonationEvent | null {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    const code = Number(data.code);
    if (code !== 101) return null;
    return parseToonationDonationPayload(data.content ?? data);
  } catch {
    return null;
  }
}

export function parseToonationDonationPayload(data: unknown): DonationEvent | null {
  const amount = extractToonationAmount(data);
  if (amount <= 0) return null;

  const externalId = extractToonationExternalId(data) || `${Date.now()}-${amount}`;
  return {
    id: `toonation:${externalId}`,
    provider: "toonation",
    externalId,
    donorName: extractToonationDonorName(data),
    amount,
    message: extractToonationMessage(data),
    at: new Date().toISOString(),
    target: "toon",
    status: "queued",
  };
}

export function extractAlertboxKeyFromUrl(alertboxUrl: string): string {
  const key = new URL(alertboxUrl).pathname.split("/").filter(Boolean).pop();
  if (!key) throw new Error("invalid_toonation_alertbox_url");
  return key;
}
