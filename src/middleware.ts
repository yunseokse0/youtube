import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";
import { toGithubRawSigAssetUrl } from "@/lib/constants";
import { isDiskUploadFlatSigImagePath, shouldServeSigImagesFromDisk } from "@/lib/sig-image-mode";

const PROTECTED_PATHS = ["/admin", "/settlements"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

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

/** OBS에 잘못 붙인 텍스트 오버레이 경로 → `/overlay/obs-text` */
function redirectLegacyObsTextOverlayPath(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  const legacy =
    pathname === "/overlay/text-overlay" ||
    pathname.startsWith("/overlay/text-overlay/") ||
    pathname === "/overlay/text" ||
    pathname.startsWith("/overlay/text/");
  if (!legacy) return null;

  const target = new URL("/overlay/obs-text", req.url);
  const q = new URLSearchParams(req.nextUrl.searchParams);
  if (!q.get("u")?.trim() && !q.get("user")?.trim()) {
    q.set("u", "finalent");
  }
  if (!q.get("host")?.trim()) q.set("host", "obs");
  target.search = q.toString();
  return NextResponse.redirect(target, 307);
}

/** OBS 오타 `/overlay/sig-sales/manual` → `/overlay/sig-sales-manual` */
function redirectLegacySigSalesManualSlashPath(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  if (pathname !== "/overlay/sig-sales/manual" && !pathname.startsWith("/overlay/sig-sales/manual/")) {
    return null;
  }
  const target = new URL("/overlay/sig-sales-manual", req.url);
  const q = new URLSearchParams(req.nextUrl.searchParams);
  if (!q.get("u")?.trim() && !q.get("user")?.trim()) q.set("u", "finalent");
  if (!q.get("hideSigBoard")) q.set("hideSigBoard", "1");
  if (!q.get("host")?.trim()) q.set("host", "obs");
  const suffix = pathname.slice("/overlay/sig-sales/manual".length);
  if (suffix && suffix !== "/") {
    target.pathname = `/overlay/sig-sales-manual${suffix}`;
  }
  target.search = q.toString();
  return NextResponse.redirect(target, 307);
}

/** `/player_alert` 오타 → `/player-alert` */
function redirectPlayerAlertTypoPath(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  if (pathname !== "/player_alert" && !pathname.startsWith("/player_alert/")) return null;
  const target = new URL("/player-alert", req.url);
  const suffix = pathname.slice("/player_alert".length);
  if (suffix && suffix !== "/") {
    target.pathname = `/player-alert${suffix}`;
  }
  const q = new URLSearchParams(req.nextUrl.searchParams);
  if (!q.get("u")?.trim() && !q.get("user")?.trim()) {
    const fromA = String(q.get("a") || "").trim();
    if (fromA) q.set("u", fromA);
  }
  q.delete("a");
  target.search = q.toString();
  return NextResponse.redirect(target, 307);
}

/** 플레이어 후원 알림 — OBS 오버레이 대신 웹 팝업 페이지 */
function redirectPlayerOverlayToWebPopup(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  if (pathname !== "/overlay/player" && !pathname.startsWith("/overlay/player/")) return null;
  const target = new URL("/player-alert", req.url);
  const q = new URLSearchParams(req.nextUrl.searchParams);
  q.delete("host");
  target.search = q.toString();
  return NextResponse.redirect(target, 307);
}

/** OBS에 잘못 붙인 관리자 경로 → 공개 오버레이(인증 쿠키 없음) */
function redirectLegacyAdminSigOverlayPath(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  const isLegacyOverlay =
    pathname === "/admin/sig-sales/overlay" ||
    pathname.startsWith("/admin/sig-sales/overlay/");
  const isLegacyBoard = pathname === "/admin/sig-board" || pathname.startsWith("/admin/sig-board/");
  if (!isLegacyOverlay && !isLegacyBoard) return null;

  const target = new URL("/overlay/sig-sales-manual", req.url);
  const q = new URLSearchParams(req.nextUrl.searchParams);
  const legacyId = String(q.get("id") || "").trim();
  if (!q.get("u")?.trim() && !q.get("user")?.trim()) {
    q.set("u", legacyId && isValidUserId(legacyId) ? legacyId : "finalent");
  }
  q.delete("id");
  q.delete("mode");
  if (!q.has("hideSigBoard")) q.set("hideSigBoard", "1");
  q.delete("overlay");
  target.search = q.toString();
  return NextResponse.redirect(target, 307);
}

function redirectLegacySigUploadPath(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  const m = pathname.match(/^\/uploads\/(?:sig|images)\/([^/?#]+)$/i);
  if (!m?.[1]) return null;
  const uidRaw =
    req.nextUrl.searchParams.get("u") ||
    req.nextUrl.searchParams.get("user") ||
    "finalent";
  const uid = String(uidRaw || "").trim();
  if (!isValidUserId(uid)) return null;
  const nextUrl = req.nextUrl.clone();
  nextUrl.pathname = `/uploads/sigs/${uid}/${m[1]}`;
  return NextResponse.rewrite(nextUrl);
}

function extractUserIdFromBrokenSigSegment(seg: string): string | null {
  const raw = String(seg || "").trim();
  if (!raw) return null;
  const decoded = decodeRepeated(raw);
  try {
    if (decoded.startsWith("{")) {
      const parsed = JSON.parse(decoded) as { id?: unknown };
      const uid = typeof parsed?.id === "string" ? parsed.id.trim() : "";
      return isValidUserId(uid) ? uid : null;
    }
  } catch {}
  const m = raw.match(/_2522id_2522_253a_2522([a-zA-Z0-9_-]{1,64})_2522/i);
  if (m?.[1] && isValidUserId(m[1])) return m[1];
  return null;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const playerAlertTypoRedirect = redirectPlayerAlertTypoPath(req);
  if (playerAlertTypoRedirect) return playerAlertTypoRedirect;

  const playerWebPopupRedirect = redirectPlayerOverlayToWebPopup(req);
  if (playerWebPopupRedirect) return playerWebPopupRedirect;

  const legacyObsTextRedirect = redirectLegacyObsTextOverlayPath(req);
  if (legacyObsTextRedirect) return legacyObsTextRedirect;

  const legacyManualSlashRedirect = redirectLegacySigSalesManualSlashPath(req);
  if (legacyManualSlashRedirect) return legacyManualSlashRedirect;

  const legacyOverlayRedirect = redirectLegacyAdminSigOverlayPath(req);
  if (legacyOverlayRedirect) return legacyOverlayRedirect;

  const legacyUploadRewrite = redirectLegacySigUploadPath(req);
  if (legacyUploadRewrite) return legacyUploadRewrite;

  /** 시그 GIF/PNG — 디스크 업로드는 동일 오리진, 번들만 GitHub raw 307(Render 대역폭 절감) */
  if (pathname.startsWith("/uploads/sigs/")) {
    return NextResponse.next();
  }
  if (pathname.startsWith("/images/sigs/")) {
    /** EC2 디스크 업로드가 `/images/sigs/<file>` 로만 저장된 경우 GitHub 307 시 404 → 동일 오리진 정적·rewrite 유지 */
    if (shouldServeSigImagesFromDisk() && isDiskUploadFlatSigImagePath(pathname)) {
      return NextResponse.next();
    }
    const github = toGithubRawSigAssetUrl(pathname);
    if (github) return NextResponse.redirect(github, 307);
  }

  const brokenSigPath = pathname.match(/^\/uploads\/sigs\/([^/]+)\/([^/]+)$/i);
  if (brokenSigPath) {
    const [, uidSeg, fileName] = brokenSigPath;
    const uid = extractUserIdFromBrokenSigSegment(uidSeg);
    if (uid) {
      const fixedPath = `/uploads/sigs/${uid}/${fileName}`;
      const nextUrl = req.nextUrl.clone();
      nextUrl.pathname = fixedPath;
      return NextResponse.rewrite(nextUrl);
    }
  }
  const bypassAuth = isDevAuthBypassRequest(req);
  if (pathname === "/login") {
    // 로컬 개발에서는 로그인 없이 바로 관리자 진입 허용
    if (bypassAuth) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    const user = req.cookies.get(AUTH_COOKIE)?.value;
    if (user) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
    return NextResponse.next();
  }
  if (isProtected(pathname)) {
    // 로컬 개발에서는 보호 경로 인증 우회
    if (bypassAuth) return NextResponse.next();
    const user = req.cookies.get(AUTH_COOKIE)?.value;
    if (!user) {
      const login = new URL("/login", req.url);
      login.searchParams.set("from", pathname);
      return NextResponse.redirect(login);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/player_alert",
    "/player_alert/:path*",
    "/overlay/player",
    "/overlay/player/:path*",
    "/admin",
    "/admin/:path*",
    "/settlements",
    "/settlements/:path*",
    "/login",
    "/overlay/sig-sales-manual",
    "/overlay/sig-sales-manual/:path*",
    "/overlay/sig-sales/manual",
    "/overlay/sig-sales/manual/:path*",
    "/overlay/text-overlay",
    "/overlay/text-overlay/:path*",
    "/overlay/text",
    "/overlay/text/:path*",
    "/images/sigs/:path*",
    "/uploads/sigs/:path*",
    "/uploads/sig/:path*",
    "/uploads/images/:path*",
  ],
};
