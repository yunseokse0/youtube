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

export function isValidUserId(value: string): boolean {
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
      if (uid && isValidUserId(uid)) return uid;
    } catch {}
    try {
      const parsed = JSON.parse(decodeRepeated(t)) as { id?: unknown };
      const uid = typeof parsed?.id === "string" ? parsed.id.trim() : "";
      if (uid && isValidUserId(uid)) return uid;
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

export function getUrlUserIdFromRequest(req: Request): string | null {
  try {
    const url = new URL(req.url);
    const raw =
      url.searchParams.get("user")?.trim() || url.searchParams.get("u")?.trim() || "";
    if (!raw) return null;
    return isValidUserId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function getCookieUserIdFromRequest(req: Request): string | null {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.match(
    new RegExp(`${AUTH_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`)
  );
  if (!match?.[1]) return null;
  return parseAuthCookieValue(match[1]);
}

/**
 * 읽기(GET)·오버레이 폴링용 — `?u=` 우선(OBS 호환), 없으면 쿠키, 로컬은 finalent 우회.
 */
export function getUserIdFromRequest(req: Request): string | null {
  const fromUrl = getUrlUserIdFromRequest(req);
  if (fromUrl) return fromUrl;
  const fromCookie = getCookieUserIdFromRequest(req);
  if (fromCookie) return fromCookie;
  if (isDevAuthBypassRequest(req)) return "finalent";
  return null;
}

export type WriteUserIdOk = { ok: true; userId: string };
export type WriteUserIdFail = { ok: false; status: 401 | 403; error: string };
export type WriteUserIdResult = WriteUserIdOk | WriteUserIdFail;

export type ResolveWriteUserIdOptions = {
  /**
   * true: 쿠키 없이 `?u=` 만으로 쓰기 허용 (OBS 오버레이·투네 브라우저 릴레이·룰렛 등).
   * false(기본): 관리자성 쓰기 — 로그인 쿠키(또는 로컬 우회) 필수. `?u=` 단독 쓰기는 거부.
   */
  allowAnonymousUrlUser?: boolean;
};

/**
 * 쓰기(POST/PUT/PATCH/DELETE)용 userId.
 * - 쿠키와 `?u=`가 둘 다 있으면 반드시 일치
 * - 쿠키 있으면 쿠키 우선
 * - 관리자 API는 익명 `?u=` 쓰기 차단 (IDOR 완화)
 * - OBS/릴레이는 allowAnonymousUrlUser로 기존 `?u=` 동작 유지
 */
export function resolveWriteUserId(
  req: Request,
  opts?: ResolveWriteUserIdOptions
): WriteUserIdResult {
  const urlId = getUrlUserIdFromRequest(req);
  const cookieId = getCookieUserIdFromRequest(req);
  const bypass = isDevAuthBypassRequest(req);

  if (cookieId && urlId && cookieId !== urlId) {
    return { ok: false, status: 403, error: "user_mismatch" };
  }
  if (cookieId) return { ok: true, userId: cookieId };
  if (bypass) {
    return { ok: true, userId: urlId || "finalent" };
  }
  if (opts?.allowAnonymousUrlUser && urlId) {
    return { ok: true, userId: urlId };
  }
  if (urlId) {
    return { ok: false, status: 401, error: "login_required" };
  }
  return { ok: false, status: 401, error: "unauthorized" };
}

export function writeUserIdErrorResponse(result: WriteUserIdFail): Response {
  return new Response(JSON.stringify({ ok: false, error: result.error }), {
    status: result.status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
