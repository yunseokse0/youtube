import { getRedisEnv, upstashGetJson, upstashSetJsonWithPipeline } from "@/app/api/_shared/upstash";
import type { DonationEvent } from "@/lib/donation/types";

const KEY_PREFIX = "excel-donation-unmatched-v1";
const memoryStore = new Map<string, DonationEvent[]>();

function unmatchedKey(userId: string): string {
  return `${KEY_PREFIX}:${userId}`;
}

export async function readUnmatchedDonations(userId: string): Promise<DonationEvent[]> {
  const key = unmatchedKey(userId);
  const { base, token } = getRedisEnv();
  if (base && token) {
    const saved = await upstashGetJson<DonationEvent[]>(key);
    return Array.isArray(saved) ? saved : [];
  }
  return memoryStore.get(key) || [];
}

export async function writeUnmatchedDonations(userId: string, list: DonationEvent[]): Promise<void> {
  const key = unmatchedKey(userId);
  const capped = list.slice(0, 200);
  const { base, token } = getRedisEnv();
  if (base && token) {
    await upstashSetJsonWithPipeline(key, capped);
    return;
  }
  memoryStore.set(key, capped);
}
