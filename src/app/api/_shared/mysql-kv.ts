/**
 * DATABASE_URL(mysql://…) 기반 키-값 JSON 저장 — Upstash Redis 대체
 * 테이블: app_kv (k PK, v LONGTEXT, expires_at ms, updated_at ms)
 * 서버 전용 — 클라이언트 번들 금지
 *
 * EC2 MySQL-only: 소규모 Pool(읽기 병렬) + SET 직렬 — 단일 Connection 큐 적체 방지
 */
import "server-only";
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";

let pool: Pool | null = null;
let bulkPool: Pool | null = null;
let poolInitPromise: Promise<Pool | null> | null = null;
let bulkPoolInitPromise: Promise<Pool | null> | null = null;
let tableReady: Promise<void> | null = null;
let lastMysqlError: string | null = null;
let poolResetPromise: Promise<void> | null = null;
let connTransport: "socket" | "tcp" | null = null;
let connLastOpenLogAt = 0;

/** MySQL wait_timeout(600s) 전에 ping — ER_CLIENT_INTERACTION(4031) 방지 */
const CONN_PING_IF_IDLE_MS = 45_000;
const connIdleAt = new WeakMap<PoolConnection, number>();

/** hang 시 Node 전체 HTTP 무응답 방지 — LONGTEXT 전체 읽기 여유 */
const MYSQL_QUERY_TIMEOUT_MS = 12_000;
/** 🔥 CRITICAL: withPoolConn 전체에 getConnection + query 합쳐서 제한시간 초과 시 풀 리셋 + 익셉션 → 0바이트 hang 방지 */
const POOL_ACQUIRE_AND_QUERY_TOTAL_TIMEOUT_MS = 15_000;
/** 연속 실패 시 MySQL 접속 중단 — ETIMEDOUT 폭주·event loop hang 방지 */
const CIRCUIT_FAIL_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

/** EC2 co-located MySQL — state/OBS/투네 ingest 전용 🔥 커넥션 풀 확장 (6→18, 소켓 누수시 버퍼) */
const POOL_CONNECTION_LIMIT = 18;
/** daily-log·settlement-records·storage-health bulk I/O 전용 */
const BULK_POOL_CONNECTION_LIMIT = 4;
/** Pool idle 재연결 빈도 ↓ — 4031·connect timeout 완화 */
const POOL_IDLE_TIMEOUT_MS = 300_000;

/** 🔥 JSON.parse/stringify 성능 최적화: 동일 state blob 반복 파싱 스킵
 *  - mysqlKvGetJson: app_kv.v + updated_at 조합으로 파싱결과 TTL 1.5초 LRU → 10회 polling 9회 parse skip
 *  - mysqlKvSetJson: object ref WeakMap identity로 직렬화 string 캐시 → verify + SSE broadcast + state 저장시 3중 중복 stringify 제거
 */
const JSON_PARSE_CACHE_TTL_MS = 1_500;
const JSON_PARSE_CACHE_MAX = 64;
type ParseCacheEntry = { parsed: unknown; expireAt: number };
const parseCacheKeys: string[] = [];
const parseCacheMap = new Map<string, ParseCacheEntry>();
function pruneParseCache(now: number): void {
  while (parseCacheKeys.length > JSON_PARSE_CACHE_MAX || (parseCacheKeys.length > 0 && (parseCacheMap.get(parseCacheKeys[0])?.expireAt || 0) <= now)) {
    const k = parseCacheKeys.shift();
    if (k) parseCacheMap.delete(k);
  }
}
const jsonStringifyCache = new WeakMap<object, { str: string; rev: number; hashKey: string }>();
const lastStateRevisionByKey = new Map<string, number>();

function revHashForStateLike(value: unknown): { hashKey: string; rev: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { hashKey: "", rev: 0 };
  }
  const o = value as Record<string, unknown>;
  const updatedAt = Number(o.updatedAt || 0);
  const donorsLen = Array.isArray(o.donors) ? (o.donors as unknown[]).length : 0;
  const membersLen = Array.isArray(o.members) ? (o.members as unknown[]).length : 0;
  const dr = Number(o.donorRankingsUpdatedAt || 0);
  const rev = updatedAt ^ dr ^ donorsLen ^ membersLen;
  return { hashKey: `${updatedAt}:${dr}:${donorsLen}:${membersLen}`, rev };
}

/** 동시 GET(멀티탭·멀티PC) — 동일 키 1회 MySQL 쿼리로 합침 */
const getInflight = new Map<string, Promise<string | null>>();

/** SET/PATCH 직렬 — 동시 쓰기 lost update 방지 */
let mysqlWriteChain: Promise<unknown> = Promise.resolve();

function runSerializedMysqlWrite<T>(fn: () => Promise<T>): Promise<T> {
  const next = mysqlWriteChain.then(() => fn());
  mysqlWriteChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

function isMysqlCircuitOpen(): boolean {
  return Date.now() < circuitOpenUntil;
}

function noteMysqlSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function noteMysqlFailure(err: unknown): void {
  if (!isTransientMysqlError(err)) return;
  consecutiveFailures += 1;
  if (consecutiveFailures >= CIRCUIT_FAIL_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.warn(
      `[mysql-kv] circuit open ${CIRCUIT_COOLDOWN_MS}ms (${consecutiveFailures} failures, transport=${connTransport ?? "?"})`
    );
    void resetMysqlPool();
  }
}

function isTransientMysqlError(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; message?: string };
  const code = String(e?.code ?? "");
  const msg = String(e?.message ?? "");
  return (
    code === "PROTOCOL_CONNECTION_LOST" ||
    code === "ER_NET_READ_INTERRUPTED" ||
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ECONNREFUSED" ||
    code === "POOL_CLOSED" ||
    code === "ER_CLIENT_INTERACTION_TIMEOUT" ||
    e?.errno === 4031 ||
    e?.errno === 1159 ||
    msg.includes("disconnected by the server because of inactivity") ||
    msg.includes("Client interaction timeout") ||
    msg.includes("Pool is closed") ||
    msg.includes("pool is closed") ||
    msg.includes("packets out of order") ||
    msg.includes("reading communication packets")
  );
}

function isBulkMysqlKvKey(key: string): boolean {
  const k = key.toLowerCase();
  return (
    k.includes("excel-broadcast-daily-log-v1:") ||
    k.includes("excel-broadcast-settlement-records-v1:") ||
    k.includes("excel-broadcast-settlement-records-index-v1:") ||
    k.includes("excel-broadcast-donation-roster-backup-v1:")
  );
}

async function resetMysqlPool(): Promise<void> {
  if (poolResetPromise) {
    await poolResetPromise;
    return;
  }
  poolResetPromise = (async () => {
    const old = pool;
    const oldBulk = bulkPool;
    pool = null;
    bulkPool = null;
    poolInitPromise = null;
    bulkPoolInitPromise = null;
    tableReady = null;
    if (old) {
      await old.end().catch(() => {});
    }
    if (oldBulk) {
      await oldBulk.end().catch(() => {});
    }
  })().finally(() => {
    poolResetPromise = null;
  });
  await poolResetPromise;
}

async function ensureConnAlive(c: PoolConnection): Promise<void> {
  const last = connIdleAt.get(c) ?? 0;
  const idleMs = Date.now() - last;
  if (last > 0 && idleMs < CONN_PING_IF_IDLE_MS) return;
  try {
    await c.ping();
    connIdleAt.set(c, Date.now());
  } catch (err) {
    c.destroy();
    throw err;
  }
}

async function withMysqlConn<T>(fn: (c: PoolConnection) => Promise<T>, attempt = 0): Promise<T> {
  return withPoolConn(getPool(), fn, attempt);
}

async function withBulkMysqlConn<T>(fn: (c: PoolConnection) => Promise<T>, attempt = 0): Promise<T> {
  return withPoolConn(getBulkPool(), fn, attempt);
}

/** daily-log·settlement·broadcast_donations 등 대용량 I/O */
export async function withMysqlBulkConn<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  return withBulkMysqlConn(fn);
}

async function withMysqlConnForKey<T>(
  key: string,
  fn: (c: PoolConnection) => Promise<T>,
  attempt = 0
): Promise<T> {
  if (isBulkMysqlKvKey(key)) {
    return withBulkMysqlConn(fn, attempt);
  }
  return withMysqlConn(fn, attempt);
}

async function withPoolConn<T>(
  poolPromise: Promise<Pool | null>,
  fn: (c: PoolConnection) => Promise<T>,
  attempt = 0
): Promise<T> {
  if (isMysqlCircuitOpen()) {
    throw new Error("MySQL circuit open (cooldown)");
  }
  /** 🔥 CRITICAL: getConnection + query 합쳐서 15초 넘어가면 영구 hang으로 간주하고 풀 리셋 → 0바이트 데드락 근본 차단 */
  let timedOut = false;
  let timerDestroy: ReturnType<typeof setTimeout> | null = null;
  const totalTimeout = new Promise<never>((_, reject) => {
    timerDestroy = setTimeout(() => {
      timedOut = true;
      void resetMysqlPool();
      reject(new Error(`MySQL withPoolConn total timeout after ${POOL_ACQUIRE_AND_QUERY_TOTAL_TIMEOUT_MS}ms — Pool forcibly reset (hang-prevention)`));
    }, POOL_ACQUIRE_AND_QUERY_TOTAL_TIMEOUT_MS);
  });
  const realWork = (async () => {
    try {
      const p = await poolPromise;
      if (!p) throw new Error("MySQL pool unavailable");
      const c = await p.getConnection();
      if (timedOut) { try { c.destroy(); } catch {} throw new Error("MySQL connection acquired but total timeout already fired — aborted"); }
      /** timeout 중복 소멸자 추적: destroy 호출 시 finally release 중복 방지 */
      let destroyedByFn = false;
      try {
        await ensureConnAlive(c);
        const out = await fn(c);
        connIdleAt.set(c, Date.now());
        noteMysqlSuccess();
        return out;
      } catch (err) {
        noteMysqlFailure(err);
        if (isTransientMysqlError(err) && attempt < 1) {
          destroyedByFn = true;
          try { c.destroy(); } catch {}
          return withPoolConn(poolPromise, fn, attempt + 1);
        }
        throw err;
      } finally {
        if (!destroyedByFn) { try { c.release(); } catch {} }
      }
    } catch (err) {
      noteMysqlFailure(err);
      throw err;
    } finally {
      if (timerDestroy) { clearTimeout(timerDestroy); timerDestroy = null; }
    }
  })();
  return Promise.race([realWork, totalTimeout]) as Promise<T>;
}

async function connExecuteWithTimeout(
  c: PoolConnection,
  sql: string,
  params?: unknown[]
): Promise<RowDataPacket[]> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    c.destroy();
  }, MYSQL_QUERY_TIMEOUT_MS);
  try {
    const [rows] = await c.execute(sql, (params ?? []) as (string | number | null)[]);
    return rows as RowDataPacket[];
  } catch (err) {
    if (timedOut) {
      throw new Error(`MySQL query timeout after ${MYSQL_QUERY_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function getLastMysqlKvError(): string | null {
  return lastMysqlError;
}

function setLastMysqlError(err: unknown): void {
  lastMysqlError = err instanceof Error ? err.message : String(err);
}

export function getMysqlDatabaseUrl(): string {
  return String(process.env.DATABASE_URL || "").trim();
}

export function isMysqlKvConfigured(): boolean {
  const url = getMysqlDatabaseUrl();
  return Boolean(url && /^mysql:\/\//i.test(url));
}

/** EC2 localhost — TCP(127.0.0.1) ETIMEDOUT 회피, mysql CLI 소켓과 동일 경로 */
const MYSQL_SOCKET_CANDIDATES = [
  "/var/run/mysqld/mysqld.sock",
  "/run/mysqld/mysqld.sock",
] as const;

/** Linux EC2 localhost / private IP — socket 우선 (TCP 127.0.0.1 ETIMEDOUT 회피) */
function shouldUseMysqlSocket(hostname: string): boolean {
  if (process.env.MYSQL_USE_SOCKET === "0") return false;
  if (process.env.MYSQL_USE_SOCKET === "1") return true;
  if (process.platform !== "linux") return false;
  const h = (hostname || "127.0.0.1").toLowerCase();
  if (h === "127.0.0.1" || h === "localhost" || h === "::1") return true;
  /** .env 가 EC2 private IP(172.31.x.x 등)를 host 로 둬도 동일 서버 MySQL → socket */
  if (/^172\.(1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function poolTransportFromOptions(opts: mysql.PoolOptions): "socket" | "tcp" {
  return opts.socketPath ? "socket" : "tcp";
}

function resolveSocketPath(): string {
  const fromEnv = String(process.env.MYSQL_SOCKET_PATH || "").trim();
  if (fromEnv) return fromEnv;
  return MYSQL_SOCKET_CANDIDATES[0]!;
}

function buildPoolOptions(raw: string, connectionLimit: number, queueLimit: number): mysql.PoolOptions | null {
  try {
    const u = new URL(raw);
    if (!/^mysql:$/i.test(u.protocol)) return null;
    const database = decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] || "");
    if (!database) return null;
    const hostname = (u.hostname || "127.0.0.1").toLowerCase();
    const shared: mysql.PoolOptions = {
      user: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
      database,
      connectTimeout: 8_000,
      /** 🔥 enableKeepAlive 끄기 → 소켓 half-open 상태 방지 */
      enableKeepAlive: false,
      /** waitForConnections=false → 풀 꽉 찼을 때 대기안하고 즉시 POOL_CONNECTION_LIMIT 에러 → 0바이트 hang 방지 (fail fast) */
      waitForConnections: false,
      maxIdle: connectionLimit,
      idleTimeout: POOL_IDLE_TIMEOUT_MS,
      /** queueLimit=0: 대기열 없음 → 풀 다차면 즉시 에러 → hang 대신 fast-fail */
      queueLimit: 0,
      connectionLimit,
    };
    if (shouldUseMysqlSocket(hostname)) {
      return { ...shared, socketPath: resolveSocketPath() };
    }
    return {
      ...shared,
      host: u.hostname || "127.0.0.1",
      port: u.port ? Number(u.port) : 3306,
    };
  } catch {
    return null;
  }
}

/** mysql://user:pass@host:port/db — 비밀번호 특수문자 안전하게 파싱 */
function mysqlConnOptionsFromUrl(raw: string): mysql.PoolOptions | null {
  return buildPoolOptions(raw, POOL_CONNECTION_LIMIT, 100);
}

function mysqlBulkConnOptionsFromUrl(raw: string): mysql.PoolOptions | null {
  return buildPoolOptions(raw, BULK_POOL_CONNECTION_LIMIT, 50);
}

/** 진단·테스트 — DATABASE_URL 기준 socket/TCP (side-effect 없음) */
export function mysqlKvConnModeFromDatabaseUrl(raw?: string): "socket" | "tcp" | null {
  const opts = mysqlConnOptionsFromUrl(String(raw ?? getMysqlDatabaseUrl()).trim());
  if (!opts) return null;
  return poolTransportFromOptions(opts);
}

async function getBulkPool(): Promise<Pool | null> {
  if (!isMysqlKvConfigured()) return null;
  if (bulkPool) return bulkPool;
  if (bulkPoolInitPromise) return bulkPoolInitPromise;
  bulkPoolInitPromise = (async () => {
    await getPool();
    const opts = mysqlBulkConnOptionsFromUrl(getMysqlDatabaseUrl());
    if (!opts) throw new Error("MySQL bulk config parse failed");
    const p = mysql.createPool(opts);
    bulkPool = p;
    console.info(
      `[mysql-kv] bulk pool open (${connTransport ?? "?"}, limit=${BULK_POOL_CONNECTION_LIMIT})`
    );
    return p;
  })().catch((err) => {
    bulkPoolInitPromise = null;
    throw err;
  });
  return bulkPoolInitPromise;
}

async function getPool(): Promise<Pool | null> {
  if (!isMysqlKvConfigured()) return null;
  if (pool) return pool;
  if (poolInitPromise) return poolInitPromise;
  poolInitPromise = (async () => {
    const opts = mysqlConnOptionsFromUrl(getMysqlDatabaseUrl());
    if (!opts) throw new Error("MySQL config parse failed");
    connTransport = poolTransportFromOptions(opts);
    const p = mysql.createPool(opts);
    pool = p;
    const now = Date.now();
    if (now - connLastOpenLogAt > 60_000) {
      connLastOpenLogAt = now;
      const detail =
        connTransport === "socket"
          ? `socketPath=${String(opts.socketPath || resolveSocketPath())}`
          : `host=${String(opts.host || "?")}:${String(opts.port ?? 3306)}`;
      console.info(`[mysql-kv] pool open (${connTransport}, limit=${POOL_CONNECTION_LIMIT}, ${detail})`);
    }
    return p;
  })().catch((err) => {
    poolInitPromise = null;
    const code = (err as { code?: string })?.code;
    if (code === "ETIMEDOUT") {
      console.error(
        `[mysql-kv] pool connect ETIMEDOUT (transport=${connTransport ?? "?"} — EC2에서는 MYSQL_USE_SOCKET=1·socketPath 확인)`
      );
    }
    throw err;
  });
  return poolInitPromise;
}

async function ensureTable(c: PoolConnection): Promise<void> {
  if (tableReady) {
    await tableReady;
    return;
  }
  const init = connExecuteWithTimeout(
    c,
    `CREATE TABLE IF NOT EXISTS app_kv (
          \`k\` VARCHAR(512) NOT NULL,
          \`v\` LONGTEXT NOT NULL,
          \`expires_at\` BIGINT NULL,
          \`updated_at\` BIGINT NOT NULL,
          PRIMARY KEY (\`k\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  )
    .then(() => undefined)
    .catch((err) => {
      tableReady = null;
      throw err;
    });
  tableReady = init;
  await tableReady;
}

async function mysqlKvGetOnce(key: string): Promise<string | null> {
  if (isMysqlCircuitOpen()) {
    lastMysqlError = "MySQL circuit open (cooldown)";
    return null;
  }
  try {
    return await withMysqlConnForKey(key, async (c) => {
      await ensureTable(c);
      const now = Date.now();
      /** 🔥 updated_at도 함께 SELECT → JSON.parse cache hit시 파싱 스킵 (state blob 800KB → parse 30~120ms 절약) */
      const rows = await connExecuteWithTimeout(
        c,
        `SELECT \`v\`, \`expires_at\`, \`updated_at\` FROM app_kv WHERE \`k\` = ? LIMIT 1`,
        [key]
      );
      const row = rows[0];
      lastMysqlError = null;
      if (!row) {
        lastStateRevisionByKey.delete(key);
        return null;
      }
      const exp = row.expires_at == null ? null : Number(row.expires_at);
      const updatedAt = Number(row.updated_at || 0);
      lastStateRevisionByKey.set(key, updatedAt);
      if (exp != null && Number.isFinite(exp) && exp > 0 && exp < now) {
        await c.execute(`DELETE FROM app_kv WHERE \`k\` = ?`, [key]).catch(() => {});
        parseCacheMap.delete(`${key}:${updatedAt}`);
        return null;
      }
      return typeof row.v === "string" ? row.v : String(row.v ?? "");
    });
  } catch (err) {
    setLastMysqlError(err);
    console.error("[mysql-kv] get failed", err);
    return null;
  }
}

export async function mysqlKvGet(key: string): Promise<string | null> {
  const existing = getInflight.get(key);
  if (existing) return existing;
  const p = mysqlKvGetOnce(key).finally(() => {
    if (getInflight.get(key) === p) getInflight.delete(key);
  });
  getInflight.set(key, p);
  return p;
}

/** 저장 시 app_kv.updated_at — GET since/304 경량 비교용 */
function storedRevisionMsFromValue(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Date.now();
  const o = value as Record<string, unknown>;
  let rev = Number(o.updatedAt || 0);
  rev = Math.max(rev, Number(o.membersRosterUpdatedAt || 0));
  rev = Math.max(rev, Number(o.donorRankingsUpdatedAt || 0));
  return rev > 0 ? rev : Date.now();
}

const peekInflight = new Map<string, Promise<number | null>>();

/** LONGTEXT 없이 revision만 — OBS since 폴링 MySQL 부하 절감 */
export async function mysqlKvPeekRevision(key: string): Promise<number | null> {
  if (isMysqlCircuitOpen() || !isMysqlKvConfigured()) return null;
  const existing = peekInflight.get(key);
  if (existing) return existing;
  const p = withMysqlConn(async (c) => {
    await ensureTable(c);
    const rows = await connExecuteWithTimeout(
      c,
      `SELECT \`updated_at\` FROM app_kv WHERE \`k\` = ? LIMIT 1`,
      [key]
    );
    const row = rows[0];
    if (!row) return null;
    const n = Number(row.updated_at);
    return Number.isFinite(n) && n > 0 ? n : null;
  })
    .catch(() => null)
    .finally(() => {
      if (peekInflight.get(key) === p) peekInflight.delete(key);
    });
  peekInflight.set(key, p);
  return p;
}

export async function mysqlKvSet(
  key: string,
  value: string,
  ttlSec?: number,
  revisionMs?: number
): Promise<boolean> {
  if (isMysqlCircuitOpen()) {
    lastMysqlError = "MySQL circuit open (cooldown)";
    return false;
  }
  try {
    await runSerializedMysqlWrite(async () =>
      withMysqlConnForKey(key, async (c) => {
        await ensureTable(c);
        const writeAt =
          typeof revisionMs === "number" && revisionMs > 0 ? Math.floor(revisionMs) : Date.now();
        const expires =
          typeof ttlSec === "number" && ttlSec > 0 ? writeAt + Math.floor(ttlSec) * 1000 : null;
        await connExecuteWithTimeout(
          c,
          `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE \`v\` = VALUES(\`v\`), \`expires_at\` = VALUES(\`expires_at\`), \`updated_at\` = VALUES(\`updated_at\`)`,
          [key, value, expires, writeAt]
        );
      })
    );
    lastMysqlError = null;
    return true;
  } catch (err) {
    setLastMysqlError(err);
    console.error("[mysql-kv] set failed", err);
    return false;
  }
}

/** Redis SET NX EX 대응 — true=선점, false=이미 있음, null=스토어 불가 */
export async function mysqlKvSetNxEx(key: string, ttlSec: number): Promise<boolean | null> {
  try {
    return await runSerializedMysqlWrite(async () =>
      withMysqlConn(async (c) => {
        await ensureTable(c);
        const now = Date.now();
        await c.execute(
          `DELETE FROM app_kv WHERE \`k\` = ? AND \`expires_at\` IS NOT NULL AND \`expires_at\` < ?`,
          [key, now]
        );
        const expires = now + Math.max(1, Math.floor(ttlSec)) * 1000;
        try {
          await c.execute(
            `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`) VALUES (?, '1', ?, ?)`,
            [key, expires, now]
          );
          return true;
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (code === "ER_DUP_ENTRY") return false;
          throw err;
        }
      })
    );
  } catch {
    return null;
  }
}

export async function mysqlKvDel(key: string): Promise<void> {
  try {
    await runSerializedMysqlWrite(async () =>
      withMysqlConnForKey(key, async (c) => {
        await ensureTable(c);
        await c.execute(`DELETE FROM app_kv WHERE \`k\` = ?`, [key]);
      })
    );
  } catch {
    /* ignore */
  }
}

/** daily-log shard 목록 — prefix LIKE (bulk pool) */
export async function mysqlKvListKeys(prefix: string, limit = 500): Promise<string[]> {
  if (isMysqlCircuitOpen() || !isMysqlKvConfigured()) return [];
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  try {
    return await withBulkMysqlConn(async (c) => {
      await ensureTable(c);
      const rows = await connExecuteWithTimeout(
        c,
        `SELECT \`k\` FROM app_kv WHERE \`k\` LIKE ? ORDER BY \`k\` ASC LIMIT ${safeLimit}`,
        [`${prefix}%`]
      );
      return rows.map((row) => String(row.k ?? ""));
    });
  } catch (err) {
    setLastMysqlError(err);
    console.error("[mysql-kv] list keys failed", err);
    return [];
  }
}

export async function mysqlKvGetJson<T = unknown>(key: string): Promise<T | null> {
  const raw = await mysqlKvGet(key);
  if (raw == null) return null;
  /** 🔥 JSON.parse cache hit → 같은 revision state blob은 재파싱 안함 (800KB blob 100ms씩 절약) */
  const now = Date.now();
  const lastRev = lastStateRevisionByKey.get(key) ?? 0;
  const cacheKey = lastRev > 0 ? `${key}:${lastRev}` : `${key}:${raw.length}:${now}`;
  if (lastRev > 0) {
    const cached = parseCacheMap.get(cacheKey);
    if (cached && cached.expireAt > now) {
      return cached.parsed as T;
    }
  }
  try {
    const parsed = JSON.parse(raw) as T;
    if (lastRev > 0) {
      pruneParseCache(now);
      parseCacheMap.set(cacheKey, { parsed, expireAt: now + JSON_PARSE_CACHE_TTL_MS });
      parseCacheKeys.push(cacheKey);
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function mysqlKvSetJson(key: string, value: unknown): Promise<boolean> {
  /** 🔥 Object identity WeakMap cache: 같은 state가 여러 레이어에서 중복 stringify 되는 현상 제거 (verify + persist + dailyLog + SSE broadcast) */
  let jsonStr: string | null = null;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as object;
    const { hashKey, rev } = revHashForStateLike(value);
    const cached = jsonStringifyCache.get(obj);
    if (cached && cached.hashKey === hashKey && cached.rev === rev) {
      jsonStr = cached.str;
    }
    if (jsonStr == null) {
      try {
        const s = JSON.stringify(value);
        jsonStr = s;
        if (hashKey) jsonStringifyCache.set(obj, { str: s, rev, hashKey });
      } catch {
        return false;
      }
    }
  }
  if (jsonStr == null) {
    try { jsonStr = JSON.stringify(value); } catch { return false; }
  }
  try {
    return mysqlKvSet(key, jsonStr, undefined, storedRevisionMsFromValue(value));
  } catch {
    return false;
  }
}

/** 테스트·프로세스 종료용 */
export async function mysqlKvClosePool(): Promise<void> {
  await resetMysqlPool();
}

/** health?deep=1 — 실제 SELECT 1 */
export async function mysqlKvPing(): Promise<boolean> {
  if (!isMysqlKvConfigured() || isMysqlCircuitOpen()) return false;
  try {
    await withMysqlConn(async (c) => {
      await ensureTable(c);
      await connExecuteWithTimeout(c, "SELECT 1 AS ok");
    });
    lastMysqlError = null;
    return true;
  } catch (err) {
    setLastMysqlError(err);
    return false;
  }
}
