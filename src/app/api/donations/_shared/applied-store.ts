import { getRedisEnv } from "@/app/api/_shared/upstash";
import { donationApplyPrimaryKey } from "@/lib/donation/donation-dedupe-keys";
import type { DonationEvent } from "@/lib/donation/types";

const APPLIED_TTL_SEC = 86_400;
const memoryApplied = new Map<string, number>();

function pruneMemoryApplied(now: number): void {
  if (memoryApplied.size <= 500) return;
  for (const [key, exp] of memoryApplied) {
    if (exp <= now) memoryApplied.delete(key);
  }
}

async function upstashSetNxEx(key: string, ttlSec: number): Promise<boolean | null> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return null;
  const url = `${base.replace(/\/$/, "")}/set/${encodeURIComponent(key)}/${encodeURIComponent("1")}?NX=true&EX=${ttlSec}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as { result?: string | null } | null;
  return data?.result === "OK";
}

/** true = 이번 요청이 선점 성공(반영 진행), false = 이미 반영·처리 중 */
export async function tryClaimDonationApply(userId: string, event: DonationEvent): Promise<boolean> {
  const key = donationApplyPrimaryKey(userId, event);
  const now = Date.now();
  const redis = await upstashSetNxEx(key, APPLIED_TTL_SEC);
  if (redis === true) return true;
  if (redis === false) return false;

  pruneMemoryApplied(now);
  const exp = memoryApplied.get(key);
  if (typeof exp === "number" && exp > now) return false;
  memoryApplied.set(key, now + APPLIED_TTL_SEC * 1000);
  return true;
}

export async function releaseDonationApplyClaim(userId: string, event: DonationEvent): Promise<void> {
  const key = donationApplyPrimaryKey(userId, event);
  memoryApplied.delete(key);
  const { base, token } = getRedisEnv();
  if (!base || !token) return;
  const url = `${base.replace(/\/$/, "")}/del/${encodeURIComponent(key)}`;
  await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  }).catch(() => {});
}
