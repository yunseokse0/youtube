type RedisEnv = {
  base: string;
  token: string;
};

function hasMysqlDatabaseUrl(): boolean {
  const url = String(process.env.DATABASE_URL || "").trim();
  return Boolean(url && /^mysql:\/\//i.test(url));
}

let mysqlLoadError: string | null = null;

/** Edge에서는 MySQL 미사용. Node에서는 동적 import (mysql2는 next.config externals) */
async function loadMysqlKv() {
  if (!hasMysqlDatabaseUrl()) return null;
  if (process.env.NEXT_RUNTIME === "edge") return null;
  try {
    const mod = await import("./mysql-kv");
    mysqlLoadError = null;
    return mod;
  } catch (err) {
    mysqlLoadError = err instanceof Error ? err.message : String(err);
    console.error("[kv] mysql-kv import failed", err);
    return null;
  }
}

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
  return isRedisConfigured() || hasMysqlDatabaseUrl();
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

/** Redis 우선, 없으면 MySQL DATABASE_URL (nodejs만) */
export async function upstashGetJson<T = unknown>(key: string): Promise<T | null> {
  if (isRedisConfigured()) {
    const fromRedis = await redisGetJson<T>(key);
    if (fromRedis != null) return fromRedis;
  }
  const mysql = await loadMysqlKv();
  if (mysql) return mysql.mysqlKvGetJson<T>(key);
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
  if (hasMysqlDatabaseUrl()) {
    const mysql = await loadMysqlKv();
    if (!mysql) {
      console.error("[kv] DATABASE_URL set but mysql-kv unavailable (import/runtime)");
      return false;
    }
    const ok = await mysql.mysqlKvSetJson(key, value);
    if (!ok) console.error("[kv] mysqlKvSetJson failed for", key);
    return ok;
  }
  return false;
}

/** 최근 MySQL KV 오류 메시지 (진단용) */
export async function getPersistentKvLastError(): Promise<string | null> {
  if (mysqlLoadError) return mysqlLoadError;
  if (!hasMysqlDatabaseUrl()) return null;
  const mysql = await loadMysqlKv();
  return mysql?.getLastMysqlKvError?.() ?? null;
}

export async function upstashSetJsonWithPipeline(
  key: string,
  value: unknown
): Promise<boolean> {
  if (isRedisConfigured()) {
    const ok = await redisSetJson(key, value, true);
    if (ok) return true;
  }
  const mysql = await loadMysqlKv();
  if (mysql) return mysql.mysqlKvSetJson(key, value);
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
  const mysql = await loadMysqlKv();
  if (mysql) return mysql.mysqlKvSetNxEx(key, ttlSec);
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
  const mysql = await loadMysqlKv();
  if (mysql) await mysql.mysqlKvDel(key);
}
