import { getRedisEnv, upstashGetJson, upstashSetJsonWithPipeline } from "@/app/api/_shared/upstash";
import type { DonorAlias } from "@/lib/donation/types";

const KEY_PREFIX = "excel-donation-aliases-v1";
const memoryStore = new Map<string, DonorAlias[]>();

function aliasKey(userId: string): string {
  return `${KEY_PREFIX}:${userId}`;
}

export async function readDonationAliases(userId: string): Promise<DonorAlias[]> {
  const key = aliasKey(userId);
  const { base, token } = getRedisEnv();
  if (base && token) {
    const saved = await upstashGetJson<DonorAlias[]>(key);
    return Array.isArray(saved) ? saved : [];
  }
  return memoryStore.get(key) || [];
}

export async function writeDonationAliases(userId: string, list: DonorAlias[]): Promise<void> {
  const key = aliasKey(userId);
  const capped = list.slice(0, 500);
  const { base, token } = getRedisEnv();
  if (base && token) {
    await upstashSetJsonWithPipeline(key, capped);
    return;
  }
  memoryStore.set(key, capped);
}
