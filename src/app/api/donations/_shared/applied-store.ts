import { kvDel, kvSetNxEx } from "@/app/api/_shared/upstash";
import {
  donationApplyContentKey,
  donationApplyPrimaryKey,
  donationContentClaimTtlSec,
} from "@/lib/donation/donation-dedupe-keys";
import type { DonationEvent } from "@/lib/donation/types";

const APPLIED_TTL_SEC = 86_400;
const memoryApplied = new Map<string, number>();

function pruneMemoryApplied(now: number): void {
  if (memoryApplied.size <= 500) return;
  for (const [key, exp] of memoryApplied) {
    if (exp <= now) memoryApplied.delete(key);
  }
}

async function claimKey(key: string, ttlSec: number): Promise<boolean> {
  const now = Date.now();
  const claimed = await kvSetNxEx(key, ttlSec);
  if (claimed === true) return true;
  if (claimed === false) return false;

  pruneMemoryApplied(now);
  const exp = memoryApplied.get(key);
  if (typeof exp === "number" && exp > now) return false;
  memoryApplied.set(key, now + ttlSec * 1000);
  return true;
}

function releaseKey(key: string): void {
  memoryApplied.delete(key);
  void kvDel(key);
}

/** true = 이번 요청이 선점 성공(반영 진행), false = 이미 반영·처리 중 */
export async function tryClaimDonationApply(userId: string, event: DonationEvent): Promise<boolean> {
  const primary = donationApplyPrimaryKey(userId, event);
  if (!(await claimKey(primary, APPLIED_TTL_SEC))) return false;
  const content = donationApplyContentKey(userId, event);
  if (!content) return true;
  if (await claimKey(content, donationContentClaimTtlSec(event))) return true;
  releaseKey(primary);
  return false;
}

export async function releaseDonationApplyClaim(userId: string, event: DonationEvent): Promise<void> {
  releaseKey(donationApplyPrimaryKey(userId, event));
  const content = donationApplyContentKey(userId, event);
  if (content) releaseKey(content);
}
