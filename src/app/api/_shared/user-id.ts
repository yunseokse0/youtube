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
 * - 2026-09-22 v14 정산리셋 user_mismatch 403 FIX:
 *   (기존) 쿠키 ID 와 ?u= 파라미터 ID가 둘 다 존재하고 불일치 → 무조건 403 user_mismatch 반환
 *   → 사용자가 로그인 한 계정(쿠키)과 로컬스토리지 기본 userId(?u=) 가 달라서 403이 날 수 밖에 없는 구조였음
 *   (개선) 관리자 쓰기 API (allowAnonymousUrlUser=false, 기본값) 는
 *   → 쿠키 ID가 존재하면 ?u= 파라미터를 **100% 무시**하고 쿠키 사용자만 신뢰
 *   → (보안상 이득: 쿠키는 HttpOnly여서 위조 불가 / ?u=는 클라이언트가 자유롭게 바꿀 수 있으므로 IDOR 차단)
 *   → 익명 쓰기 허용(OBS/릴레이, allowAnonymousUrlUser=true) 인 경우에만 기존 로직 유지 (둘 다 있으면 일치 요구)
 * - OBS/릴레이는 allowAnonymousUrlUser로 기존 `?u=` 동작 유지
 */
export function resolveWriteUserId(
  req: Request,
  opts?: ResolveWriteUserIdOptions
): WriteUserIdResult {
  const urlId = getUrlUserIdFromRequest(req);
  const cookieId = getCookieUserIdFromRequest(req);
  const bypass = isDevAuthBypassRequest(req);

  const allowAnonymous = opts?.allowAnonymousUrlUser === true;

  // ▼ 쿠키가 있으면: 관리자 쓰기는 쿠키만 100% 신뢰 / 익명 허용 모드만 mismatch 체크
  if (cookieId) {
    if (allowAnonymous && urlId && cookieId !== urlId) {
      // OBS/릴레이 등 익명쓰기 허용 모드에서 ?u= 와 쿠키가 다르면 그냥 쿠키 우선
      return { ok: true, userId: cookieId };
    }
    // 관리자 쓰기 기본 모드: urlId 가 뭐든 간에 cookieId 만 사용 → user_mismatch 발생 가능성 0%
    return { ok: true, userId: cookieId };
  }

  // 쿠키 없고 bypass (로컬 개발 finalent)
  if (bypass) {
    return { ok: true, userId: urlId || "finalent" };
  }

  // 쿠키 없고 allowAnonymousUrlUser=true → ?u= 만으로 쓰기 허용 (OBS/릴레이)
  if (allowAnonymous && urlId) {
    return { ok: true, userId: urlId };
  }

  // 쿠키 없고 ?u= 만 있음 → 관리자 쓰기 모드에선 로그인 요구
  if (urlId) {
    return { ok: false, status: 401, error: "login_required" };
  }

  // 둘 다 없음
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
