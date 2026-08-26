import { loadAccounts, saveAccounts } from "@/lib/accounts-storage";
import { USERS } from "@/lib/auth";

export type ChangePasswordErrorCode =
  | "invalid_body"
  | "wrong_password"
  | "same_password"
  | "account_not_found"
  | "not_supported"
  | "persist_failed";

export type ChangePasswordResult =
  | { ok: true }
  | { ok: false; status: 400 | 401 | 403 | 404 | 503; error: ChangePasswordErrorCode; message: string };

function normalizePassword(value: unknown): string {
  return String(value ?? "");
}

export function validateChangePasswordInput(
  currentPassword: unknown,
  newPassword: unknown
): { ok: true; currentPassword: string; newPassword: string } | { ok: false; message: string } {
  const current = normalizePassword(currentPassword);
  const next = normalizePassword(newPassword).trim();
  if (!current) {
    return { ok: false, message: "현재 비밀번호를 입력해 주세요." };
  }
  if (!next) {
    return { ok: false, message: "새 비밀번호를 입력해 주세요." };
  }
  if (current === next) {
    return { ok: false, message: "새 비밀번호는 현재 비밀번호와 달라야 합니다." };
  }
  return { ok: true, currentPassword: current, newPassword: next };
}

/** 로그인 사용자 본인 비밀번호 변경 — 서버 계정 목록(accounts)만 지원 */
export async function changeAccountPassword(
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<ChangePasswordResult> {
  const uid = String(userId || "").trim().toLowerCase();
  if (!uid || uid === "admin") {
    return {
      ok: false,
      status: 403,
      error: "not_supported",
      message: "이 계정은 비밀번호 변경을 지원하지 않습니다.",
    };
  }

  const accounts = await loadAccounts();
  const idx = accounts.findIndex((a) => a.id === uid);
  if (idx >= 0) {
    if (accounts[idx].password !== currentPassword) {
      return {
        ok: false,
        status: 401,
        error: "wrong_password",
        message: "현재 비밀번호가 올바르지 않습니다.",
      };
    }
    accounts[idx] = { ...accounts[idx], password: newPassword };
    const saved = await saveAccounts(accounts);
    if (!saved.ok) {
      return {
        ok: false,
        status: 503,
        error: "persist_failed",
        message: saved.error || "비밀번호 저장에 실패했습니다.",
      };
    }
    return { ok: true };
  }

  if (USERS[uid]) {
    if (USERS[uid].password !== currentPassword) {
      return {
        ok: false,
        status: 401,
        error: "wrong_password",
        message: "현재 비밀번호가 올바르지 않습니다.",
      };
    }
    return {
      ok: false,
      status: 403,
      error: "not_supported",
      message: "내장 계정은 비밀번호 변경을 지원하지 않습니다. 관리자에게 문의해 주세요.",
    };
  }

  return {
    ok: false,
    status: 404,
    error: "account_not_found",
    message: "계정을 찾을 수 없습니다.",
  };
}
