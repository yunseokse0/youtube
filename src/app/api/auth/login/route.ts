import { NextResponse } from "next/server";
import { validateUser } from "@/lib/auth";

const COOKIE_NAME = "sb_user";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, password } = body as { id?: string; password?: string };
    const user = validateUser(id || "", password || "");
    if (!user) {
      return NextResponse.json({ ok: false, error: "아이디 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }
    const cookieValue = encodeURIComponent(JSON.stringify(user));
    const res = NextResponse.json({ ok: true, user });
    res.cookies.set(COOKIE_NAME, cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json({ ok: false, error: "로그인 처리 중 오류가 발생했습니다." }, { status: 500 });
  }
}
