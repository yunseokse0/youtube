/**
 * DATABASE_URL(mysql://…) 기반 키-값 JSON 저장 — Upstash Redis 대체
 * 테이블: app_kv (k PK, v LONGTEXT, expires_at ms, updated_at ms)
 * 서버 전용 — 클라이언트 번들 금지
 */
import "server-only";
import fs from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

let pool: Pool | null = null;
let tableReady: Promise<void> | null = null;
let lastMysqlError: string | null = null;
let poolResetPromise: Promise<void> | null = null;
let poolTransport: "socket" | "tcp" | null = null;

/** hang 시 Node 전체 HTTP 무응답 방지 — 초과 시 connection destroy */
const MYSQL_QUERY_TIMEOUT_MS = 10_000;
/** 연속 실패 시 MySQL 접속 중단 — ETIMEDOUT 폭주·event loop hang 방지 */
const CIRCUIT_FAIL_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

/** 동시 GET(멀티탭·멀티PC) — 동일 키 1회 MySQL 쿼리로 합침 */
const getInflight = new Map<string, Promise<string | null>>();

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
      `[mysql-kv] circuit open ${CIRCUIT_COOLDOWN_MS}ms (${consecutiveFailures} failures, transport=${poolTransport ?? "?"})`
    );
    void resetMysqlKvPool();
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
    e?.errno === 1159 ||
    msg.includes("Pool is closed") ||
    msg.includes("pool is closed") ||
    msg.includes("packets out of order") ||
    msg.includes("reading communication packets")
  );
}

async function resetMysqlKvPool(): Promise<void> {
  if (poolResetPromise) {
    await poolResetPromise;
    return;
  }
  poolResetPromise = (async () => {
    const old = pool;
    pool = null;
    tableReady = null;
    if (old) {
      await old.end().catch(() => {});
    }
  })().finally(() => {
    poolResetPromise = null;
  });
  await poolResetPromise;
}

function attachPoolGuards(_p: Pool): void {
  /* connection error 시 즉시 pool.end() 하면 진행 중 쿼리가 "Pool is closed" 로 연쇄 실패 — withMysqlPool 재시도만 사용 */
}

async function withMysqlPool<T>(fn: (p: Pool) => Promise<T>): Promise<T> {
  if (isMysqlCircuitOpen()) {
    throw new Error("MySQL circuit open (cooldown)");
  }
  const p = getPool();
  if (!p) throw new Error("MySQL pool unavailable");
  try {
    const out = await fn(p);
    noteMysqlSuccess();
    return out;
  } catch (err) {
    noteMysqlFailure(err);
    throw err;
  }
}

async function poolExecuteWithTimeout(
  p: Pool,
  sql: string,
  params?: unknown[]
): Promise<RowDataPacket[]> {
  const conn = await p.getConnection();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    conn.destroy();
  }, MYSQL_QUERY_TIMEOUT_MS);
  try {
    const [rows] = await conn.execute(sql, (params ?? []) as (string | number | null)[]);
    return rows as RowDataPacket[];
  } catch (err) {
    if (timedOut) {
      throw new Error(`MySQL query timeout after ${MYSQL_QUERY_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (!timedOut) {
      conn.release();
    }
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
const MYSQL_SOCKET_PATH = "/var/run/mysqld/mysqld.sock";

function localMysqlSocketAvailable(): boolean {
  try {
    return fs.existsSync(MYSQL_SOCKET_PATH);
  } catch {
    return false;
  }
}

/** Linux EC2 localhost — existsSync 없이 socket 우선 (TCP ETIMEDOUT 회피) */
function shouldUseMysqlSocket(hostname: string): boolean {
  if (process.env.MYSQL_USE_SOCKET === "0") return false;
  if (process.env.MYSQL_USE_SOCKET === "1") return true;
  const h = (hostname || "127.0.0.1").toLowerCase();
  if (h !== "127.0.0.1" && h !== "localhost") return false;
  if (process.platform === "linux") return true;
  return localMysqlSocketAvailable();
}

/** mysql://user:pass@host:port/db — 비밀번호 특수문자 안전하게 파싱 */
function mysqlPoolOptionsFromUrl(raw: string): mysql.PoolOptions | null {
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
      waitForConnections: true,
      /** 멀티탭·멀티PC — EC2 단일 Node 기준 (max_connections 40 내) */
      connectionLimit: 10,
      /** 무한 대기 금지 — queueLimit 0 은 hang 유발 */
      queueLimit: 24,
      connectTimeout: 2_000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000,
      idleTimeout: 15_000,
    };
    const useSocket = shouldUseMysqlSocket(hostname);
    if (useSocket) {
      poolTransport = "socket";
      return { ...shared, socketPath: MYSQL_SOCKET_PATH };
    }
    poolTransport = "tcp";
    return {
      ...shared,
      host: u.hostname || "127.0.0.1",
      port: u.port ? Number(u.port) : 3306,
    };
  } catch {
    return null;
  }
}

function getPool(): Pool | null {
  if (!isMysqlKvConfigured()) return null;
  if (pool) return pool;
  try {
    const opts = mysqlPoolOptionsFromUrl(getMysqlDatabaseUrl());
    if (!opts) return null;
    pool = mysql.createPool(opts);
    attachPoolGuards(pool);
    if (poolTransport) {
      console.info(`[mysql-kv] pool created (${poolTransport})`);
    }
  } catch {
    return null;
  }
  return pool;
}

async function ensureTable(p: Pool): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await poolExecuteWithTimeout(
        p,
        `CREATE TABLE IF NOT EXISTS app_kv (
          \`k\` VARCHAR(512) NOT NULL,
          \`v\` LONGTEXT NOT NULL,
          \`expires_at\` BIGINT NULL,
          \`updated_at\` BIGINT NOT NULL,
          PRIMARY KEY (\`k\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

async function mysqlKvGetOnce(key: string): Promise<string | null> {
  if (isMysqlCircuitOpen()) {
    lastMysqlError = "MySQL circuit open (cooldown)";
    return null;
  }
  if (!getPool()) return null;
  try {
    return await withMysqlPool(async (p) => {
      await ensureTable(p);
      const now = Date.now();
      const rows = await poolExecuteWithTimeout(
        p,
        `SELECT \`v\`, \`expires_at\` FROM app_kv WHERE \`k\` = ? LIMIT 1`,
        [key]
      );
      const row = rows[0];
      lastMysqlError = null;
      if (!row) return null;
      const exp = row.expires_at == null ? null : Number(row.expires_at);
      if (exp != null && Number.isFinite(exp) && exp > 0 && exp < now) {
        await p.execute(`DELETE FROM app_kv WHERE \`k\` = ?`, [key]).catch(() => {});
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

export async function mysqlKvSet(key: string, value: string, ttlSec?: number): Promise<boolean> {
  if (isMysqlCircuitOpen()) {
    lastMysqlError = "MySQL circuit open (cooldown)";
    return false;
  }
  if (!getPool()) {
    lastMysqlError = "MySQL pool unavailable (DATABASE_URL parse/config)";
    return false;
  }
  try {
    await withMysqlPool(async (p) => {
      await ensureTable(p);
      const now = Date.now();
      const expires =
        typeof ttlSec === "number" && ttlSec > 0 ? now + Math.floor(ttlSec) * 1000 : null;
      await poolExecuteWithTimeout(
        p,
        `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE \`v\` = VALUES(\`v\`), \`expires_at\` = VALUES(\`expires_at\`), \`updated_at\` = VALUES(\`updated_at\`)`,
        [key, value, expires, now]
      );
    });
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
  if (!getPool()) return null;
  try {
    return await withMysqlPool(async (p) => {
      await ensureTable(p);
      const now = Date.now();
      await p.execute(
        `DELETE FROM app_kv WHERE \`k\` = ? AND \`expires_at\` IS NOT NULL AND \`expires_at\` < ?`,
        [key, now]
      );
      const expires = now + Math.max(1, Math.floor(ttlSec)) * 1000;
      try {
        await p.execute(
          `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`) VALUES (?, '1', ?, ?)`,
          [key, expires, now]
        );
        return true;
      } catch (err: unknown) {
        const code = (err as { code?: string })?.code;
        if (code === "ER_DUP_ENTRY") return false;
        throw err;
      }
    });
  } catch {
    return null;
  }
}

export async function mysqlKvDel(key: string): Promise<void> {
  if (!getPool()) return;
  try {
    await withMysqlPool(async (p) => {
      await ensureTable(p);
      await p.execute(`DELETE FROM app_kv WHERE \`k\` = ?`, [key]);
    });
  } catch {
    /* ignore */
  }
}

export async function mysqlKvGetJson<T = unknown>(key: string): Promise<T | null> {
  const raw = await mysqlKvGet(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function mysqlKvSetJson(key: string, value: unknown): Promise<boolean> {
  try {
    return mysqlKvSet(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/** 테스트·프로세스 종료용 */
export async function mysqlKvClosePool(): Promise<void> {
  await resetMysqlKvPool();
}

/** health?deep=1 — 실제 SELECT 1 (pool 등록만으로 mysqlOk true 금지) */
export async function mysqlKvPing(): Promise<boolean> {
  if (!isMysqlKvConfigured() || isMysqlCircuitOpen()) return false;
  if (!getPool()) return false;
  try {
    await withMysqlPool(async (p) => {
      await ensureTable(p);
      await poolExecuteWithTimeout(p, "SELECT 1 AS ok");
    });
    lastMysqlError = null;
    return true;
  } catch (err) {
    setLastMysqlError(err);
    return false;
  }
}
