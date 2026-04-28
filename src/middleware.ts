import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";

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
  const brokenSigPath = pathname.match(/^\/uploads\/sigs\/([^/]+)\/([^/]+)$/i);
  if (brokenSigPath) {
    const [, uidSeg, fileName] = brokenSigPath;
    const uid = extractUserIdFromBrokenSigSegment(uidSeg);
    if (uid) {
      const nextUrl = req.nextUrl.clone();
      nextUrl.pathname = `/uploads/sigs/${uid}/${fileName}`;
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
  matcher: ["/admin", "/admin/:path*", "/settlements", "/settlements/:path*", "/login", "/uploads/sigs/:path*"],
};
