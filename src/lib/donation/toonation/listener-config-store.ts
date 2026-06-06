import { getRedisEnv, upstashGetJson, upstashSetJsonWithPipeline } from "@/app/api/_shared/upstash";

export type ToonationListenerConfig = {
  userId: string;
  alertboxUrl: string;
  enabled: boolean;
  updatedAt: number;
};

const KEY = "excel-toonation-listener-config-v1";
const memory = new Map<string, ToonationListenerConfig>();

export async function readToonationListenerConfig(userId: string): Promise<ToonationListenerConfig | null> {
  const { base, token } = getRedisEnv();
  if (base && token) {
    const all = await upstashGetJson<Record<string, ToonationListenerConfig>>(KEY);
    const row = all?.[userId];
    return row && typeof row === "object" ? row : null;
  }
  return memory.get(userId) || null;
}

export async function writeToonationListenerConfig(config: ToonationListenerConfig): Promise<void> {
  const { base, token } = getRedisEnv();
  if (base && token) {
    const all = (await upstashGetJson<Record<string, ToonationListenerConfig>>(KEY)) || {};
    all[config.userId] = config;
    await upstashSetJsonWithPipeline(KEY, all);
    return;
  }
  memory.set(config.userId, config);
}

export async function readAllEnabledToonationListenerConfigs(): Promise<ToonationListenerConfig[]> {
  const { base, token } = getRedisEnv();
  if (base && token) {
    const all = await upstashGetJson<Record<string, ToonationListenerConfig>>(KEY);
    if (!all || typeof all !== "object") return [];
    return Object.values(all).filter((c) => c && c.enabled && c.alertboxUrl);
  }
  return [...memory.values()].filter((c) => c.enabled && c.alertboxUrl);
}

export async function clearToonationListenerConfig(userId: string): Promise<void> {
  const { base, token } = getRedisEnv();
  if (base && token) {
    const all = (await upstashGetJson<Record<string, ToonationListenerConfig>>(KEY)) || {};
    delete all[userId];
    await upstashSetJsonWithPipeline(KEY, all);
    return;
  }
  memory.delete(userId);
}
