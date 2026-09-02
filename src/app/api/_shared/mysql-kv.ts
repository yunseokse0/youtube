/**
 * DATABASE_URL(mysql://…) 기반 키-값 JSON 저장 — Upstash Redis 대체
 * 테이블: app_kv (k PK, v LONGTEXT, expires_at ms, updated_at ms)
 * 서버 전용 — 클라이언트 번들 금지
 *
 * EC2 MySQL-only: Pool(동시 N연결) 대신 단일 Connection + 직렬 큐 — ETIMEDOUT·연결 폭주 방지
 */
import "server-only";
import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";

let conn: Connection | null = null;
let connOpenPromise: Promise<Connection> | null = null;
let tableReady: Promise<void> | null = null;
let lastMysqlError: string | null = null;
let connResetPromise: Promise<void> | null = null;
let connTransport: "socket" | "tcp" | null = null;

/** hang 시 Node 전체 HTTP 무응답 방지 — 초과 시 connection destroy */
const MYSQL_QUERY_TIMEOUT_MS = 10_000;
/** 연속 실패 시 MySQL 접속 중단 — ETIMEDOUT 폭주·event loop hang 방지 */
const CIRCUIT_FAIL_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 30_000;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;

/** 동시 GET(멀티탭·멀티PC) — 동일 키 1회 MySQL 쿼리로 합침 */
const getInflight = new Map<string, Promise<string | null>>();

/** 프로세스당 MySQL 작업 1개씩 — Pool connectionLimit 폭주 제거 */
let mysqlOpChain: Promise<unknown> = Promise.resolve();

function runSerializedMysql<T>(fn: () => Promise<T>): Promise<T> {
  const next = mysqlOpChain.then(() => fn());
  mysqlOpChain = next.then(
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
    void resetMysqlConnection();
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

async function resetMysqlConnection(): Promise<void> {
  if (connResetPromise) {
    await connResetPromise;
    return;
  }
  connResetPromise = (async () => {
    const old = conn;
    conn = null;
    connOpenPromise = null;
    tableReady = null;
    if (old) {
      await old.end().catch(() => {});
    }
  })().finally(() => {
    connResetPromise = null;
  });
  await connResetPromise;
}

async function withMysqlConn<T>(fn: (c: Connection) => Promise<T>): Promise<T> {
  if (isMysqlCircuitOpen()) {
    throw new Error("MySQL circuit open (cooldown)");
  }
  const c = await openConnection();
  if (!c) throw new Error("MySQL connection unavailable");
  try {
    const out = await fn(c);
    noteMysqlSuccess();
    return out;
  } catch (err) {
    noteMysqlFailure(err);
    if (isTransientMysqlError(err)) {
      await resetMysqlConnection();
    }
    throw err;
  }
}

async function connExecuteWithTimeout(
  c: Connection,
  sql: string,
  params?: unknown[]
): Promise<RowDataPacket[]> {
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    c.destroy();
    conn = null;
    connOpenPromise = null;
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

/** Linux EC2 localhost — socket 우선 (TCP ETIMEDOUT 회피). Windows/mac 로컬 dev는 TCP */
function shouldUseMysqlSocket(hostname: string): boolean {
  if (process.env.MYSQL_USE_SOCKET === "0") return false;
  if (process.env.MYSQL_USE_SOCKET === "1") return true;
  const h = (hostname || "127.0.0.1").toLowerCase();
  if (h !== "127.0.0.1" && h !== "localhost") return false;
  return process.platform === "linux";
}

function resolveSocketPath(): string {
  const fromEnv = String(process.env.MYSQL_SOCKET_PATH || "").trim();
  if (fromEnv) return fromEnv;
  return MYSQL_SOCKET_CANDIDATES[0]!;
}

/** mysql://user:pass@host:port/db — 비밀번호 특수문자 안전하게 파싱 */
function mysqlConnOptionsFromUrl(raw: string): mysql.ConnectionOptions | null {
  try {
    const u = new URL(raw);
    if (!/^mysql:$/i.test(u.protocol)) return null;
    const database = decodeURIComponent(u.pathname.replace(/^\//, "").split("/")[0] || "");
    if (!database) return null;
    const hostname = (u.hostname || "127.0.0.1").toLowerCase();
    const shared: mysql.ConnectionOptions = {
      user: decodeURIComponent(u.username || ""),
      password: decodeURIComponent(u.password || ""),
      database,
      connectTimeout: 5_000,
    };
    const useSocket = shouldUseMysqlSocket(hostname);
    if (useSocket) {
      connTransport = "socket";
      return { ...shared, socketPath: resolveSocketPath() };
    }
    connTransport = "tcp";
    return {
      ...shared,
      host: u.hostname || "127.0.0.1",
      port: u.port ? Number(u.port) : 3306,
    };
  } catch {
    return null;
  }
}

async function openConnection(): Promise<Connection | null> {
  if (!isMysqlKvConfigured()) return null;
  if (conn) return conn;
  if (connOpenPromise) return connOpenPromise;
  connOpenPromise = (async () => {
    const opts = mysqlConnOptionsFromUrl(getMysqlDatabaseUrl());
    if (!opts) throw new Error("MySQL config parse failed");
    const c = await mysql.createConnection(opts);
    c.on("error", (err) => {
      console.warn("[mysql-kv] connection error", err);
      conn = null;
      connOpenPromise = null;
      tableReady = null;
    });
    conn = c;
    if (connTransport) {
      console.info(`[mysql-kv] connection open (${connTransport})`);
    }
    return c;
  })().catch((err) => {
    connOpenPromise = null;
    throw err;
  });
  return connOpenPromise;
}

async function ensureTable(c: Connection): Promise<void> {
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
    return await runSerializedMysql(async () =>
      withMysqlConn(async (c) => {
        await ensureTable(c);
        const now = Date.now();
        const rows = await connExecuteWithTimeout(
          c,
          `SELECT \`v\`, \`expires_at\` FROM app_kv WHERE \`k\` = ? LIMIT 1`,
          [key]
        );
        const row = rows[0];
        lastMysqlError = null;
        if (!row) return null;
        const exp = row.expires_at == null ? null : Number(row.expires_at);
        if (exp != null && Number.isFinite(exp) && exp > 0 && exp < now) {
          await c.execute(`DELETE FROM app_kv WHERE \`k\` = ?`, [key]).catch(() => {});
          return null;
        }
        return typeof row.v === "string" ? row.v : String(row.v ?? "");
      })
    );
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
  try {
    await runSerializedMysql(async () =>
      withMysqlConn(async (c) => {
        await ensureTable(c);
        const now = Date.now();
        const expires =
          typeof ttlSec === "number" && ttlSec > 0 ? now + Math.floor(ttlSec) * 1000 : null;
        await connExecuteWithTimeout(
          c,
          `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE \`v\` = VALUES(\`v\`), \`expires_at\` = VALUES(\`expires_at\`), \`updated_at\` = VALUES(\`updated_at\`)`,
          [key, value, expires, now]
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
    return await runSerializedMysql(async () =>
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
    await runSerializedMysql(async () =>
      withMysqlConn(async (c) => {
        await ensureTable(c);
        await c.execute(`DELETE FROM app_kv WHERE \`k\` = ?`, [key]);
      })
    );
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
  await resetMysqlConnection();
}

/** health?deep=1 — 실제 SELECT 1 */
export async function mysqlKvPing(): Promise<boolean> {
  if (!isMysqlKvConfigured() || isMysqlCircuitOpen()) return false;
  try {
    await runSerializedMysql(async () =>
      withMysqlConn(async (c) => {
        await ensureTable(c);
        await connExecuteWithTimeout(c, "SELECT 1 AS ok");
      })
    );
    lastMysqlError = null;
    return true;
  } catch (err) {
    setLastMysqlError(err);
    return false;
  }
}
