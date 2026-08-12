import { NextResponse } from "next/server";
import { AUTH_COOKIE, isDevAuthBypassRequest } from "@/lib/auth";
import { getUserById } from "@/lib/auth";
import { APP_BRAND_NAME } from "@/lib/app-branding";
import { loadAccounts, getRemainingDays } from "@/lib/accounts-storage";
import { cookies } from "next/headers";

export async function GET(req: Request) {
  try {
    if (isDevAuthBypassRequest(req)) {
      return NextResponse.json({ user: { id: "finalent", companyName: APP_BRAND_NAME } });
    }
    const cookieStore = await cookies();
    const raw = cookieStore.get(AUTH_COOKIE)?.value;
    if (!raw) return NextResponse.json({ user: null }, { status: 200 });
    let parsed: { id: string; companyName: string };
    try {
      parsed = JSON.parse(decodeURIComponent(raw)) as { id: string; companyName: string };
    } catch {
      return NextResponse.json({ user: null }, { status: 200 });
    }
    const uid = String(parsed?.id || "").trim();
    if (!uid) return NextResponse.json({ user: null }, { status: 200 });
    if (uid === "finalent" && isDevAuthBypassRequest(req)) {
      return NextResponse.json({ user: { id: "finalent", companyName: APP_BRAND_NAME } });
    }
    let user = getUserById(uid);
    if (user) {
      return NextResponse.json({ user });
    }
    try {
      const accounts = await loadAccounts();
      const acc = accounts.find((a) => a.id === uid);
      if (!acc) {
        /** 쿠키에 id 가 있으면 미리보기 u= 용으로라도 반환 (계정 파일 일시 실패·디스크 이슈 대비) */
        return NextResponse.json({
          user: {
            id: uid,
            companyName: String(parsed.companyName || uid),
          },
        });
      }
      const remaining = getRemainingDays(acc);
      if (remaining === 0) return NextResponse.json({ user: null }, { status: 200 });
      return NextResponse.json({
        user: {
          id: acc.id,
          companyName: acc.companyName,
          name: acc.name,
          remainingDays: remaining === -1 ? null : remaining,
          unlimited: remaining === -1,
        },
      });
    } catch {
      /** accounts 로드 실패 시에도 쿠키 id 로 관리자·미리보기 유지 */
      return NextResponse.json({
        user: {
          id: uid,
          companyName: String(parsed.companyName || uid),
        },
      });
    }
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
