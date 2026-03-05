/**
 * 계정 저장소 (Redis)
 * - 로그인/me API에서 동적 계정 검증에 사용
 */

export type StoredAccount = {
  id: string;
  name: string;
  companyName: string;
  password: string;
  startDate: number | null;
  endDate: number | null;
  createdAt: number;
};

const ACCOUNTS_KEY = "excel-broadcast-accounts-v1";

function getEnv() {
  const base = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  return { base, token };
}

async function upstashGet(key: string): Promise<StoredAccount[] | null> {
  const { base, token } = getEnv();
  if (!base || !token) return null;
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { result?: string | null };
  if (!data || data.result == null) return null;
  try {
    const parsed = JSON.parse(data.result as string);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function loadAccounts(): Promise<StoredAccount[]> {
  const list = await upstashGet(ACCOUNTS_KEY);
  return Array.isArray(list) ? list : [];
}

export function getRemainingDays(account: StoredAccount): number | null {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  if (account.startDate && now < account.startDate) return null;
  if (account.endDate == null) return -1;
  if (now > account.endDate) return 0;
  return Math.ceil((account.endDate - now) / dayMs);
}
