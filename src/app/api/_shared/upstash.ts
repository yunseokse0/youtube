import {
  isMysqlKvConfigured,
  mysqlKvDel,
  mysqlKvGetJson,
  mysqlKvSetJson,
  mysqlKvSetNxEx,
} from "./mysql-kv";

type RedisEnv = {
  base: string;
  token: string;
};

export function getRedisEnv(): RedisEnv {
  const base =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    "";
  return { base, token };
}

export function isRedisConfigured(): boolean {
  const { base, token } = getRedisEnv();
  return Boolean(base && token);
}

/** Upstash Redis 또는 DATABASE_URL(MySQL) — 영속 KV */
export function isPersistentKvConfigured(): boolean {
  return isRedisConfigured() || isMysqlKvConfigured();
}

async function redisGetJson<T = unknown>(key: string): Promise<T | null> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return null;
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { result?: string | null };
  if (!data || data.result == null) return null;
  try {
    return JSON.parse(data.result as string) as T;
  } catch {
    return null;
  }
}

async function redisSetJson(key: string, value: unknown, usePipeline: boolean): Promise<boolean> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return false;
  const json = JSON.stringify(value);
  if (usePipeline) {
    const url = `${base.replace(/\/$/, "")}/pipeline`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([["SET", key, json]]),
    });
    return response.ok;
  }
  const url = `${base.replace(/\/$/, "")}/set/${encodeURIComponent(key)}/${encodeURIComponent(json)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.ok;
}

/** Redis 우선, 없으면 MySQL DATABASE_URL */
export async function upstashGetJson<T = unknown>(key: string): Promise<T | null> {
  if (isRedisConfigured()) {
    const fromRedis = await redisGetJson<T>(key);
    if (fromRedis != null) return fromRedis;
  }
  if (isMysqlKvConfigured()) {
    return mysqlKvGetJson<T>(key);
  }
  return null;
}

export async function upstashSetJsonWithSetPath(
  key: string,
  value: unknown
): Promise<boolean> {
  if (isRedisConfigured()) {
    const ok = await redisSetJson(key, value, false);
    if (ok) return true;
  }
  if (isMysqlKvConfigured()) {
    return mysqlKvSetJson(key, value);
  }
  return false;
}

export async function upstashSetJsonWithPipeline(
  key: string,
  value: unknown
): Promise<boolean> {
  if (isRedisConfigured()) {
    const ok = await redisSetJson(key, value, true);
    if (ok) return true;
  }
  if (isMysqlKvConfigured()) {
    return mysqlKvSetJson(key, value);
  }
  return false;
}

/** Redis SET NX EX / MySQL INSERT NX — true 선점, false 충돌, null 스토어 없음 */
export async function kvSetNxEx(key: string, ttlSec: number): Promise<boolean | null> {
  if (isRedisConfigured()) {
    const { base, token } = getRedisEnv();
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
  if (isMysqlKvConfigured()) {
    return mysqlKvSetNxEx(key, ttlSec);
  }
  return null;
}

export async function kvDel(key: string): Promise<void> {
  if (isRedisConfigured()) {
    const { base, token } = getRedisEnv();
    const url = `${base.replace(/\/$/, "")}/del/${encodeURIComponent(key)}`;
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    }).catch(() => {});
  }
  if (isMysqlKvConfigured()) {
    await mysqlKvDel(key);
  }
}
