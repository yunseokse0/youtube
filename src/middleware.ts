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

/** 수동 판매 OBS 전용 URL — 회전판 오버레이와 동일 페이지, mode=manual 주입 */
function rewriteSigSalesManualOverlay(req: NextRequest): NextResponse | null {
  const { pathname } = req.nextUrl;
  if (pathname !== "/overlay/sig-sales-manual" && !pathname.startsWith("/overlay/sig-sales-manual/")) {
    return null;
  }
  const url = req.nextUrl.clone();
  url.pathname = "/overlay/sig-sales";
  if (!url.searchParams.get("mode")?.trim()) url.searchParams.set("mode", "manual");
  if (!url.searchParams.has("hideSigBoard")) url.searchParams.set("hideSigBoard", "1");
  return NextResponse.rewrite(url);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const manualOverlayRewrite = rewriteSigSalesManualOverlay(req);
  if (manualOverlayRewrite) return manualOverlayRewrite;

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
    "/admin",
    "/admin/:path*",
    "/settlements",
    "/settlements/:path*",
    "/login",
    "/overlay/sig-sales-manual",
    "/overlay/sig-sales-manual/:path*",
    "/images/sigs/:path*",
    "/uploads/sigs/:path*",
    "/uploads/sig/:path*",
    "/uploads/images/:path*",
  ],
};
