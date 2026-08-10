/**
 * DATABASE_URL(mysql://…) 기반 키-값 JSON 저장 — Upstash Redis 대체
 * 테이블: app_kv (k PK, v LONGTEXT, expires_at ms, updated_at ms)
 */
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

let pool: Pool | null = null;
let tableReady: Promise<void> | null = null;

export function getMysqlDatabaseUrl(): string {
  return String(process.env.DATABASE_URL || "").trim();
}

export function isMysqlKvConfigured(): boolean {
  const url = getMysqlDatabaseUrl();
  return Boolean(url && /^mysql:\/\//i.test(url));
}

function getPool(): Pool | null {
  if (!isMysqlKvConfigured()) return null;
  if (pool) return pool;
  try {
    pool = mysql.createPool(getMysqlDatabaseUrl());
  } catch {
    return null;
  }
  return pool;
}

async function ensureTable(p: Pool): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await p.execute(`
        CREATE TABLE IF NOT EXISTS app_kv (
          \`k\` VARCHAR(512) NOT NULL,
          \`v\` LONGTEXT NOT NULL,
          \`expires_at\` BIGINT NULL,
          \`updated_at\` BIGINT NOT NULL,
          PRIMARY KEY (\`k\`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

export async function mysqlKvGet(key: string): Promise<string | null> {
  const p = getPool();
  if (!p) return null;
  try {
    await ensureTable(p);
    const now = Date.now();
    const [rows] = await p.execute<RowDataPacket[]>(
      `SELECT \`v\`, \`expires_at\` FROM app_kv WHERE \`k\` = ? LIMIT 1`,
      [key]
    );
    const row = rows[0];
    if (!row) return null;
    const exp = row.expires_at == null ? null : Number(row.expires_at);
    if (exp != null && Number.isFinite(exp) && exp > 0 && exp < now) {
      await p.execute(`DELETE FROM app_kv WHERE \`k\` = ?`, [key]).catch(() => {});
      return null;
    }
    return typeof row.v === "string" ? row.v : String(row.v ?? "");
  } catch {
    return null;
  }
}

export async function mysqlKvSet(key: string, value: string, ttlSec?: number): Promise<boolean> {
  const p = getPool();
  if (!p) return false;
  try {
    await ensureTable(p);
    const now = Date.now();
    const expires =
      typeof ttlSec === "number" && ttlSec > 0 ? now + Math.floor(ttlSec) * 1000 : null;
    await p.execute(
      `INSERT INTO app_kv (\`k\`, \`v\`, \`expires_at\`, \`updated_at\`)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE \`v\` = VALUES(\`v\`), \`expires_at\` = VALUES(\`expires_at\`), \`updated_at\` = VALUES(\`updated_at\`)`,
      [key, value, expires, now]
    );
    return true;
  } catch {
    return false;
  }
}

/** Redis SET NX EX 대응 — true=선점, false=이미 있음, null=스토어 불가 */
export async function mysqlKvSetNxEx(key: string, ttlSec: number): Promise<boolean | null> {
  const p = getPool();
  if (!p) return null;
  try {
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
      return null;
    }
  } catch {
    return null;
  }
}

export async function mysqlKvDel(key: string): Promise<void> {
  const p = getPool();
  if (!p) return;
  try {
    await ensureTable(p);
    await p.execute(`DELETE FROM app_kv WHERE \`k\` = ?`, [key]);
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
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
    tableReady = null;
  }
}
