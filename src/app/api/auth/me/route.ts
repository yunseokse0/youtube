import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";
import { getUserById } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(AUTH_COOKIE)?.value;
    if (!raw) return NextResponse.json({ user: null }, { status: 200 });
    const parsed = JSON.parse(decodeURIComponent(raw)) as { id: string; companyName: string };
    const user = getUserById(parsed?.id || "");
    if (!user) return NextResponse.json({ user: null }, { status: 200 });
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
