import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";

const PROTECTED_PATHS = ["/admin", "/settlements"];

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
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
  matcher: ["/admin", "/admin/:path*", "/settlements", "/settlements/:path*", "/login"],
};
