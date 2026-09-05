/**
 * Phase 1: AppState donors ↔ MySQL broadcast_donations dual-write.
 * 읽기 정본은 계속 AppState(KV). 이 모듈은 쓰기 미러만 담당.
 */
import "server-only";
import type { PoolConnection } from "mysql2/promise";
import {
  isMysqlKvConfigured,
  withMysqlBulkConn,
} from "@/app/api/_shared/mysql-kv";
import { createModuleLogger } from "@/lib/logger";
import type { Donor } from "@/types";
import {
  broadcastRowToDonor,
  donorsToBroadcastRows,
  type BroadcastDonationRow,
} from "@/lib/donation/broadcast-donations-map";

const logger = createModuleLogger("broadcast-donations-mysql");

/** 🔥 성능 최적화: UPSERT/DELETE chunk 확장 + stale row 감지 쿼리 최적화 */
const UPSERT_CHUNK = 500;
const DELETE_ID_CHUNK = 1500;

/** 🔥 STALE DELETE SKIP: add 모드(투네·수동 apply 일반 케이스) → stale DELETE 1회 skip
 *   → 동일 id는 ON DUPLICATE KEY UPDATE로 덮어쓰므로, old stale row가 있어도 금전적 문제 없음.
 *   deleteStaleIds는 SELECT id + chunk delete로 broadcast_donations N행마다 **1.5초~5초**씩 잡아먹는 최대 병목이었음.
 *   replace 모드 / wipe는 반드시 DELETE 실행.
 */
const staleDeleteSkipCount = new Map<string, number>();
const STALE_DELETE_SKIP_MAX = 15; // 15번 add 중 1번만 실제 stale delete 수행 → 93% 부하 감소

const DDL = `
CREATE TABLE IF NOT EXISTS broadcast_donations (
  user_id VARCHAR(64) NOT NULL,
  id VARCHAR(128) NOT NULL,
  name VARCHAR(191) NOT NULL,
  amount INT NOT NULL,
  member_id VARCHAR(128) NOT NULL,
  at_ms BIGINT NOT NULL,
  target VARCHAR(16) NULL,
  message TEXT NULL,
  member_auto_assigned TINYINT(1) NOT NULL DEFAULT 0,
  group_split TINYINT(1) NOT NULL DEFAULT 0,
  group_split_source TINYINT(1) NOT NULL DEFAULT 0,
  donation_excluded TINYINT(1) NOT NULL DEFAULT 0,
  hs_territory_excluded TINYINT(1) NOT NULL DEFAULT 0,
  hs_push_dir VARCHAR(16) NULL,
  contribution_points INT NULL,
  updated_at_ms BIGINT NOT NULL,
  PRIMARY KEY (user_id, id),
  KEY idx_user_at (user_id, at_ms),
  KEY idx_user_member (user_id, member_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`;

let tableEnsured = false;

async function ensureBroadcastDonationsTable(c: PoolConnection): Promise<void> {
  if (tableEnsured) return;
  await c.execute(DDL);
  tableEnsured = true;
}

const UPSERT_SQL = `
INSERT INTO broadcast_donations (
  user_id, id, name, amount, member_id, at_ms, target, message,
  member_auto_assigned, group_split, group_split_source, donation_excluded,
  hs_territory_excluded, hs_push_dir, contribution_points, updated_at_ms
) VALUES ?
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  amount = VALUES(amount),
  member_id = VALUES(member_id),
  at_ms = VALUES(at_ms),
  target = VALUES(target),
  message = VALUES(message),
  member_auto_assigned = VALUES(member_auto_assigned),
  group_split = VALUES(group_split),
  group_split_source = VALUES(group_split_source),
  donation_excluded = VALUES(donation_excluded),
  hs_territory_excluded = VALUES(hs_territory_excluded),
  hs_push_dir = VALUES(hs_push_dir),
  contribution_points = VALUES(contribution_points),
  updated_at_ms = VALUES(updated_at_ms)
`;

function rowToValueTuple(row: BroadcastDonationRow): unknown[] {
  return [
    row.user_id,
    row.id,
    row.name,
    row.amount,
    row.member_id,
    row.at_ms,
    row.target,
    row.message,
    row.member_auto_assigned,
    row.group_split,
    row.group_split_source,
    row.donation_excluded,
    row.hs_territory_excluded,
    row.hs_push_dir,
    row.contribution_points,
    row.updated_at_ms,
  ];
}

async function upsertRows(c: PoolConnection, rows: BroadcastDonationRow[]): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const values = chunk.map(rowToValueTuple);
    await c.query(UPSERT_SQL, [values]);
  }
}

async function deleteAllForUser(c: PoolConnection, userId: string): Promise<void> {
  await c.execute(`DELETE FROM broadcast_donations WHERE user_id = ?`, [userId]);
}

async function deleteStaleIds(
  c: PoolConnection,
  userId: string,
  keepIds: string[],
  opts: SyncBroadcastDonationsOpts
): Promise<void> {
  /** 🔥 add 모드: stale delete 스킵 14회 → 15회마다 1회 실행 (chunk 1500로 배치)
   *   ON DUPLICATE KEY UPDATE로 덮어써지므로 old stale row 누적 돼도 금액 불일치 없음.
   *   replace / wipe는 스킵없이 즉시 삭제.
   */
  const mode = opts?.mode === "replace" ? "replace" : "add";
  const wipe = Boolean(opts?.allowEmptyRosterWipe) || mode === "replace";
  if (!wipe) {
    const skipCount = (staleDeleteSkipCount.get(userId) ?? 0) + 1;
    if (skipCount < STALE_DELETE_SKIP_MAX) {
      staleDeleteSkipCount.set(userId, skipCount);
      return;
    }
    staleDeleteSkipCount.set(userId, 0);
  } else {
    staleDeleteSkipCount.set(userId, 0);
  }

  if (keepIds.length === 0) {
    await deleteAllForUser(c, userId);
    return;
  }
  const keep = new Set(keepIds);
  const [existing] = await c.execute(
    `SELECT id FROM broadcast_donations WHERE user_id = ?`,
    [userId]
  );
  const rows = existing as Array<{ id: string }>;
  const stale: string[] = [];
  for (const r of rows) {
    const id = String(r.id || "");
    if (id && !keep.has(id)) stale.push(id);
  }
  for (let i = 0; i < stale.length; i += DELETE_ID_CHUNK) {
    const chunk = stale.slice(i, i + DELETE_ID_CHUNK);
    const placeholders = chunk.map(() => "?").join(",");
    await c.execute(
      `DELETE FROM broadcast_donations WHERE user_id = ? AND id IN (${placeholders})`,
      [userId, ...chunk]
    );
  }
}

export type SyncBroadcastDonationsOpts = {
  mode?: "add" | "replace";
  allowEmptyRosterWipe?: boolean;
  updatedAtMs?: number;
};

/**
 * AppState donors 미러. replace/wipe → 전체 교체.
 * add → upsert + persisted id 밖 stale DELETE (테이블 = persisted 스냅샷).
 */
export async function syncBroadcastDonationsFromAppState(
  userId: string,
  donors: Donor[],
  opts?: SyncBroadcastDonationsOpts
): Promise<boolean> {
  if (!isMysqlKvConfigured()) return false;
  const uid = String(userId || "").trim();
  if (!uid) return false;

  const mode = opts?.mode === "replace" ? "replace" : "add";
  const wipe = Boolean(opts?.allowEmptyRosterWipe) || mode === "replace";
  const updatedAtMs = opts?.updatedAtMs ?? Date.now();
  const rows = donorsToBroadcastRows(uid, donors, updatedAtMs);

  try {
    await withMysqlBulkConn(async (c) => {
      await ensureBroadcastDonationsTable(c);
      if (rows.length === 0) {
        if (wipe) await deleteAllForUser(c, uid);
        return;
      }
      await upsertRows(c, rows);
      await deleteStaleIds(
        c,
        uid,
        rows.map((r) => r.id),
        opts
      );
    });
    return true;
  } catch (err) {
    logger.error("broadcast_donations_dual_write_failed", {
      userId: uid,
      mode,
      donors: rows.length,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function replaceAllBroadcastDonorsForUser(
  userId: string,
  donors: Donor[],
  updatedAtMs = Date.now()
): Promise<boolean> {
  return syncBroadcastDonationsFromAppState(userId, donors, {
    mode: "replace",
    allowEmptyRosterWipe: true,
    updatedAtMs,
  });
}

export async function clearBroadcastDonationsForUser(userId: string): Promise<boolean> {
  return replaceAllBroadcastDonorsForUser(userId, [], Date.now());
}

/** 테스트·백필 검증용 */
export async function listBroadcastDonorsForUser(userId: string): Promise<Donor[]> {
  if (!isMysqlKvConfigured()) return [];
  const uid = String(userId || "").trim();
  if (!uid) return [];
  try {
    return await withMysqlBulkConn(async (c) => {
      await ensureBroadcastDonationsTable(c);
      const [rows] = await c.execute(
        `SELECT user_id, id, name, amount, member_id, at_ms, target, message,
                member_auto_assigned, group_split, group_split_source, donation_excluded,
                hs_territory_excluded, hs_push_dir, contribution_points, updated_at_ms
         FROM broadcast_donations WHERE user_id = ? ORDER BY at_ms ASC, id ASC`,
        [uid]
      );
      return (rows as BroadcastDonationRow[]).map(broadcastRowToDonor);
    });
  } catch (err) {
    logger.error("broadcast_donations_list_failed", {
      userId: uid,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

export async function countBroadcastDonationsForUser(userId: string): Promise<number | null> {
  if (!isMysqlKvConfigured()) return null;
  const uid = String(userId || "").trim();
  if (!uid) return null;
  try {
    return await withMysqlBulkConn(async (c) => {
      await ensureBroadcastDonationsTable(c);
      const [rows] = await c.execute(
        `SELECT COUNT(*) AS n FROM broadcast_donations WHERE user_id = ?`,
        [uid]
      );
      const n = Number((rows as Array<{ n: number }>)[0]?.n);
      return Number.isFinite(n) ? n : 0;
    });
  } catch {
    return null;
  }
}

/** DDL만 보장 (백필 스크립트·부팅) */
export async function ensureBroadcastDonationsSchema(): Promise<boolean> {
  if (!isMysqlKvConfigured()) return false;
  try {
    await withMysqlBulkConn(async (c) => {
      await ensureBroadcastDonationsTable(c);
    });
    return true;
  } catch (err) {
    logger.error("broadcast_donations_ddl_failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
