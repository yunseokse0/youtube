import { NextResponse } from "next/server";
import { AUTH_COOKIE } from "@/lib/auth";
import { getUserById } from "@/lib/auth";
import { loadAccounts, getRemainingDays } from "@/lib/accounts-storage";
import { cookies } from "next/headers";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(AUTH_COOKIE)?.value;
    if (!raw) return NextResponse.json({ user: null }, { status: 200 });
    const parsed = JSON.parse(decodeURIComponent(raw)) as { id: string; companyName: string };
    const uid = parsed?.id || "";
    let user = getUserById(uid);
    if (!user) {
      const accounts = await loadAccounts();
      const acc = accounts.find((a) => a.id === uid);
      if (!acc) return NextResponse.json({ user: null }, { status: 200 });
      const remaining = getRemainingDays(acc);
      if (remaining === 0) return NextResponse.json({ user: null }, { status: 200 });
      user = { id: acc.id, companyName: acc.companyName };
      return NextResponse.json({
        user: {
          ...user,
          name: acc.name,
          remainingDays: remaining === -1 ? null : remaining,
          unlimited: remaining === -1,
        },
      });
    }
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ user: null }, { status: 200 });
  }
}
