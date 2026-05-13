import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";

function decodeRepeated(value: string, maxDepth = 4): string {
  let out = value;
  for (let i = 0; i < maxDepth; i += 1) {
    try {
      const next = decodeURIComponent(out);
      if (next === out) break;
      out = next;
    } catch {
      break;
    }
  }
  return out;
}

function isValidUserId(value: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}

/** 로그인 쿠키(`encodeURIComponent(JSON.stringify({ id, … }))`) 및 평문 id 하위 호환 */
function parseAuthCookieValue(raw: string): string | null {
  const trimmed = String(raw || "").trim().replace(/^"|"$/g, "");
  if (!trimmed) return null;
  const deeplyDecoded = decodeRepeated(trimmed);
  const candidates = [trimmed, decodeURIComponent(trimmed), deeplyDecoded];
  for (const cand of candidates) {
    const t = String(cand).trim().replace(/^"|"$/g, "");
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as { id?: unknown };
      const uid = typeof parsed?.id === "string" ? parsed.id.trim() : "";
      if (uid) return uid;
    } catch {}
    try {
      const parsed = JSON.parse(decodeRepeated(t)) as { id?: unknown };
      const uid = typeof parsed?.id === "string" ? parsed.id.trim() : "";
      if (uid) return uid;
    } catch {}
    if (!t.startsWith("{") && !t.startsWith("[") && isValidUserId(t)) {
      return t;
    }
    const d = decodeRepeated(t);
    if (!d.startsWith("{") && !d.startsWith("[") && isValidUserId(d)) {
      return d;
    }
  }
  return null;
}

export function getUserIdFromRequest(req: Request): string | null {
  const url = new URL(req.url);
  /** 오버레이 URL과 동일하게 `u=`만 붙은 폴링도 인식 (OBS·복사 붙여넣기 호환) */
  const fromUrl =
    url.searchParams.get("user")?.trim() ||
    url.searchParams.get("u")?.trim() ||
    "";
  if (fromUrl) return fromUrl;
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(new RegExp(`${AUTH_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`));
  if (match?.[1]) {
    const uid = parseAuthCookieValue(match[1]);
    if (uid) return uid;
  }
  if (isDevAuthBypassRequest(req)) return "finalent";
  return null;
}
