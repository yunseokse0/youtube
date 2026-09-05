type RedisEnv = {
  base: string;
  token: string;
};

/** mysql-kv 모듈 표면 — upstash가 mysql-kv를 직접 import 하지 않기 위함(클라이언트 번들 차단) */
export type MysqlKvBackend = {
  mysqlKvGetJson: <T = unknown>(key: string) => Promise<T | null>;
  mysqlKvSetJson: (key: string, value: unknown) => Promise<boolean>;
  mysqlKvSetNxEx: (key: string, ttlSec: number) => Promise<boolean | null>;
  mysqlKvDel: (key: string) => Promise<void>;
  getLastMysqlKvError?: () => string | null;
};

function hasMysqlDatabaseUrl(): boolean {
  const url = String(process.env.DATABASE_URL || "").trim();
  return Boolean(url && /^mysql:\/\//i.test(url));
}

let mysqlLoadError: string | null = null;
let mysqlKvBackend: MysqlKvBackend | null = null;

/** Node instrumentation / 서버 라우트에서만 호출 — 클라이언트 import 체인에 mysql-kv가 안 타게 함 */
export function registerMysqlKvBackend(api: MysqlKvBackend): void {
  mysqlKvBackend = api;
  mysqlLoadError = null;
}

/**
 * instrumentation 전에 /api/state 등이 먼저 불리면 backend 미등록으로
 * kv_read_failed·persist_failed 가 난다 — 라우트·GET/SET 경로에서 보장.
 */
export async function ensureMysqlKvBackend(): Promise<boolean> {
  if (!hasMysqlDatabaseUrl()) return false;
  if (process.env.NEXT_RUNTIME === "edge") return false;
  if (mysqlKvBackend) return true;
  try {
    const mysqlKv = await import("./mysql-kv");
    registerMysqlKvBackend(mysqlKv);
    return Boolean(mysqlKvBackend);
  } catch (err) {
    mysqlLoadError =
      err instanceof Error
        ? `MySQL KV register failed: ${err.message}`
        : "MySQL KV backend register failed";
    return false;
  }
}

async function loadMysqlKv(): Promise<MysqlKvBackend | null> {
  if (!hasMysqlDatabaseUrl()) return null;
  if (process.env.NEXT_RUNTIME === "edge") return null;
  if (mysqlKvBackend) return mysqlKvBackend;
  await ensureMysqlKvBackend();
  if (mysqlKvBackend) return mysqlKvBackend;
  if (!mysqlLoadError) {
    mysqlLoadError =
      "MySQL KV backend not registered — instrumentation 또는 서버 부트스트랩을 확인하세요.";
  }
  return null;
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

/** MySQL only (Upstash Redis 세팅 전혀 없음) 이면 Redis GET 단계 전체 skip — 150s 블랙홀 timeout 방지 */
export function isMysqlOnlyPersistentKvConfigured(): boolean {
  return hasMysqlDatabaseUrl() && !isRedisConfigured();
}

/** Redis 200 + key 없음 → MySQL fallback 금지 (ETIMEDOUT 폭주 원인). 마이그레이션만 1 */
export function isMysqlKvFallbackOnRedisMissEnabled(): boolean {
  const v = String(process.env.MYSQL_KV_FALLBACK_ON_REDIS_MISS ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

type RedisGetOutcome<T> =
  | { kind: "hit"; value: T }
  | { kind: "miss" }
  | { kind: "error" };

async function redisGetJsonDetailed<T = unknown>(key: string): Promise<RedisGetOutcome<T>> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return { kind: "error" };
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  let response: Response;
  try {
    const fetchPromise = fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(3_500),
    });
    const hardTimeout = new Promise<Response>((_, rej) =>
      setTimeout(() => rej(new Error("redis_hard_timeout")), 4_000)
    );
    response = await (Promise.race([fetchPromise, hardTimeout]) as Promise<Response>);
  } catch {
    return { kind: "error" };
  }
  if (!response.ok) return { kind: "error" };
  const data = (await response.json().catch(() => null)) as { result?: string | null } | null;
  if (!data || data.result == null) return { kind: "miss" };
  try {
    return { kind: "hit", value: JSON.parse(data.result as string) as T };
  } catch {
    return { kind: "error" };
  }
}

async function redisGetJson<T = unknown>(key: string): Promise<T | null> {
  const out = await redisGetJsonDetailed<T>(key);
  return out.kind === "hit" ? out.value : null;
}

/** Upstash REST ping — deep health·워치독용 */
export async function redisKvPing(): Promise<boolean> {
  if (!isRedisConfigured()) return false;
  const { base, token } = getRedisEnv();
  const url = `${base.replace(/\/$/, "")}/ping`;
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return false;
    const data = (await response.json().catch(() => null)) as { result?: string } | null;
    return data?.result === "PONG";
  } catch {
    return false;
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

/** Redis 우선, 없으면 MySQL DATABASE_URL (nodejs만)
 *  Upstash Redis 미설정 MySQL ONLY 환경일 땐 Redis GET 단계 전체 SKIP → 150s 블랙홀 timeout 방지
 */
export async function upstashGetJson<T = unknown>(key: string): Promise<T | null> {
  if (isRedisConfigured()) {
    const out = await redisGetJsonDetailed<T>(key);
    if (out.kind === "hit") return out.value;
    if (out.kind === "miss" && !isMysqlKvFallbackOnRedisMissEnabled()) {
      return null;
    }
    if (out.kind === "miss" && isMysqlKvFallbackOnRedisMissEnabled()) {
      const mysql = await loadMysqlKv();
      if (mysql) return mysql.mysqlKvGetJson<T>(key);
      return null;
    }
    /* Redis HTTP/네트워크 오류 — MySQL fallback */
  } else if (isMysqlOnlyPersistentKvConfigured()) {
    const mysql = await loadMysqlKv();
    if (mysql) return mysql.mysqlKvGetJson<T>(key);
    return null;
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
    return;
  }
  const mysql = await loadMysqlKv();
  if (mysql) await mysql.mysqlKvDel(key);
}
