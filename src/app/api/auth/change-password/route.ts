import { NextResponse } from "next/server";
import { resolveWriteUserId, writeUserIdErrorResponse } from "../../_shared/user-id";
import { registerMysqlKvBackend } from "../../_shared/upstash";
import {
  changeAccountPassword,
  validateChangePasswordInput,
} from "@/lib/account-password-change";

export const runtime = "nodejs";
export const revalidate = 0;
async function ensureMysqlKvBackend(): Promise<void> {
  const url = String(process.env.DATABASE_URL || "").trim();
  if (!url || !/^mysql:\/\//i.test(url)) return;
  try {
    const mysqlKv = await import("../../_shared/mysql-kv");
    registerMysqlKvBackend(mysqlKv);
  } catch (err) {
    console.error("[api/auth/change-password] mysql-kv register failed", err);
  }
}

export async function POST(req: Request) {
  try {
    const writeUid = resolveWriteUserId(req);
    if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);

    const body = (await req.json()) as {
      currentPassword?: unknown;
      newPassword?: unknown;
    };
    const validated = validateChangePasswordInput(body.currentPassword, body.newPassword);
    if (!validated.ok) {
      return NextResponse.json(
        { ok: false, error: "invalid_body", message: validated.message },
        { status: 400 }
      );
    }

    await ensureMysqlKvBackend();
    const result = await changeAccountPassword(
      writeUid.userId,
      validated.currentPassword,
      validated.newPassword
    );
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error, message: result.message },
        { status: result.status }
      );
    }
    return NextResponse.json({ ok: true, message: "비밀번호가 변경되었습니다." });
  } catch {
    return NextResponse.json(
      { ok: false, error: "change_failed", message: "비밀번호 변경 중 오류가 발생했습니다." },
      { status: 500 }
    );
  }
}
