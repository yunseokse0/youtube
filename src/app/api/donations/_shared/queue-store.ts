import { getRedisEnv, upstashGetJson, upstashSetJsonWithPipeline } from "@/app/api/_shared/upstash";
import type { DonationEvent } from "@/lib/donation/types";

const KEY_PREFIX = "excel-donation-queue-v1";
const memoryStore = new Map<string, DonationEvent[]>();

function queueKey(userId: string): string {
  return `${KEY_PREFIX}:${userId}`;
}

export async function readDonationQueue(userId: string): Promise<DonationEvent[]> {
  const key = queueKey(userId);
  const { base, token } = getRedisEnv();
  if (base && token) {
    const saved = await upstashGetJson<DonationEvent[]>(key);
    return Array.isArray(saved) ? saved : [];
  }
  return memoryStore.get(key) || [];
}

export async function writeDonationQueue(userId: string, list: DonationEvent[]): Promise<void> {
  const key = queueKey(userId);
  const capped = list.slice(0, 300);
  const { base, token } = getRedisEnv();
  if (base && token) {
    await upstashSetJsonWithPipeline(key, capped);
    return;
  }
  memoryStore.set(key, capped);
}
