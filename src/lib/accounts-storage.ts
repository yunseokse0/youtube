/**
 * 서비스 계정 목록 — Redis 또는 MySQL(DATABASE_URL) 단일 소스
 * 로그인/me·/api/accounts 공통
 */

import {
  isPersistentKvConfigured,
  upstashGetJson,
  upstashSetJsonWithSetPath,
} from "@/app/api/_shared/upstash";

export const ACCOUNTS_REDIS_KEY = "excel-broadcast-accounts-v1";

export type StoredAccount = {
  id: string;
  name: string;
  companyName: string;
  password: string;
  startDate: number | null;
  endDate: number | null;
  createdAt: number;
};

export function isAccountsRedisConfigured(): boolean {
  return isPersistentKvConfigured();
}

export async function loadAccounts(): Promise<StoredAccount[]> {
  if (!isAccountsRedisConfigured()) return [];
  const list = await upstashGetJson<StoredAccount[]>(ACCOUNTS_REDIS_KEY);
  return Array.isArray(list) ? list : [];
}

export async function saveAccounts(
  accounts: StoredAccount[]
): Promise<{ ok: boolean; error?: string }> {
  if (!isAccountsRedisConfigured()) {
    return {
      ok: false,
      error:
        "영속 저장소 미설정 — UPSTASH_REDIS_* 또는 DATABASE_URL(MySQL)을 설정하세요.",
    };
  }
  const ok = await upstashSetJsonWithSetPath(ACCOUNTS_REDIS_KEY, accounts);
  if (!ok) return { ok: false, error: "계정 저장 실패" };
  return { ok: true };
}

export function getRemainingDays(account: StoredAccount): number | null {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (account.startDate && now < account.startDate) return null;
  if (account.endDate == null) return -1;
  if (now > account.endDate) return 0;
  return Math.ceil((account.endDate - now) / dayMs);
}
