import "server-only";
import type { PoolConnection } from "mysql2/promise";
import {
  isMysqlKvConfigured,
  withMysqlBulkConn,
} from "@/app/api/_shared/mysql-kv";
import type { ZubZubQueueItem } from "@/types";

const DDL = `
CREATE TABLE IF NOT EXISTS zubzub_queue (
  id VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NOT NULL,
  trigger_donation_id VARCHAR(128) NOT NULL,
  sig_name VARCHAR(128) NOT NULL,
  sig_image_url VARCHAR(512) NULL,
  bonus_amount INT NOT NULL,
  status ENUM('WAITING', 'CLAIMED', 'CANCELED') NOT NULL DEFAULT 'WAITING',
  claimed_by_member_id VARCHAR(128) NULL,
  claimed_donation_id VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  claimed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_user_status_created (user_id, status, created_at),
  KEY idx_trigger_donation (trigger_donation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

let tableEnsured = false;

export async function ensureZubzubQueueTable(c: PoolConnection): Promise<void> {
  if (tableEnsured) return;
  await c.execute(DDL);
  tableEnsured = true;
}

// In-memory fallback for local dev or tests when MySQL is not configured
const inMemoryZubZubQueue: Map<string, ZubZubQueueItem[]> = new Map();

export function getInMemoryZubZubQueueForTests(userId: string): ZubZubQueueItem[] {
  return inMemoryZubZubQueue.get(userId) || [];
}

export function resetInMemoryZubZubQueueForTests(userId?: string): void {
  if (userId) {
    inMemoryZubZubQueue.delete(userId);
  } else {
    inMemoryZubZubQueue.clear();
  }
}

/** 줍줍 대기열 등록 (WAITING) */
export async function insertZubzubQueueItem(
  userId: string,
  item: {
    id: string;
    triggerDonationId: string;
    sigName: string;
    sigImageUrl?: string;
    bonusAmount: number;
  }
): Promise<ZubZubQueueItem> {
  const queueItem: ZubZubQueueItem = {
    id: item.id,
    userId,
    triggerDonationId: item.triggerDonationId,
    sigName: item.sigName,
    sigImageUrl: item.sigImageUrl,
    bonusAmount: item.bonusAmount,
    status: "WAITING",
    createdAt: Date.now(),
  };

  if (!isMysqlKvConfigured()) {
    const list = inMemoryZubZubQueue.get(userId) || [];
    list.push(queueItem);
    inMemoryZubZubQueue.set(userId, list);
    return queueItem;
  }

  await withMysqlBulkConn(async (c) => {
    await ensureZubzubQueueTable(c);
    await c.execute(
      `INSERT INTO zubzub_queue 
       (id, user_id, trigger_donation_id, sig_name, sig_image_url, bonus_amount, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'WAITING', NOW())`,
      [
        queueItem.id,
        userId,
        queueItem.triggerDonationId,
        queueItem.sigName,
        queueItem.sigImageUrl || null,
        queueItem.bonusAmount,
      ]
    );
  });

  return queueItem;
}

/** 대기 중인 가장 오래된 줍줍 1건 선착순 획득 (SELECT ... FOR UPDATE) */
export async function claimEarliestWaitingZubzub(
  userId: string,
  claimingMemberId: string,
  claimingDonationId: string
): Promise<ZubZubQueueItem | null> {
  if (!isMysqlKvConfigured()) {
    const list = inMemoryZubZubQueue.get(userId) || [];
    const idx = list.findIndex((x) => x.status === "WAITING");
    if (idx === -1) return null;
    const target = list[idx]!;
    target.status = "CLAIMED";
    target.claimedByMemberId = claimingMemberId;
    target.claimedDonationId = claimingDonationId;
    target.claimedAt = Date.now();
    return target;
  }

  return withMysqlBulkConn(async (c) => {
    await ensureZubzubQueueTable(c);
    await c.beginTransaction();
    try {
      const [rows] = await c.query<any[]>(
        `SELECT id, user_id, trigger_donation_id, sig_name, sig_image_url, bonus_amount, status, UNIX_TIMESTAMP(created_at) * 1000 AS created_at
         FROM zubzub_queue 
         WHERE user_id = ? AND status = 'WAITING' 
         ORDER BY created_at ASC 
         LIMIT 1 
         FOR UPDATE`,
        [userId]
      );

      if (!rows || rows.length === 0) {
        await c.rollback();
        return null;
      }

      const target = rows[0];
      const now = Date.now();

      await c.execute(
        `UPDATE zubzub_queue 
         SET status = 'CLAIMED', 
             claimed_by_member_id = ?, 
             claimed_donation_id = ?, 
             claimed_at = NOW() 
         WHERE id = ?`,
        [claimingMemberId, claimingDonationId, target.id]
      );

      await c.commit();

      return {
        id: target.id,
        userId: target.user_id,
        triggerDonationId: target.trigger_donation_id,
        sigName: target.sig_name,
        sigImageUrl: target.sig_image_url || undefined,
        bonusAmount: Number(target.bonus_amount) || 0,
        status: "CLAIMED",
        claimedByMemberId: claimingMemberId,
        claimedDonationId: claimingDonationId,
        createdAt: Number(target.created_at) || now,
        claimedAt: now,
      } as ZubZubQueueItem;
    } catch (err) {
      await c.rollback();
      throw err;
    }
  });
}

/** 대기 중(WAITING)인 줍줍 목록 조회 */
export async function listWaitingZubzubQueues(userId: string): Promise<ZubZubQueueItem[]> {
  if (!isMysqlKvConfigured()) {
    const list = inMemoryZubZubQueue.get(userId) || [];
    return list.filter((x) => x.status === "WAITING");
  }

  return withMysqlBulkConn(async (c) => {
    await ensureZubzubQueueTable(c);
    const [rows] = await c.query<any[]>(
      `SELECT id, user_id, trigger_donation_id, sig_name, sig_image_url, bonus_amount, status, UNIX_TIMESTAMP(created_at) * 1000 AS created_at
       FROM zubzub_queue 
       WHERE user_id = ? AND status = 'WAITING' 
       ORDER BY created_at ASC`,
      [userId]
    );

    return (rows || []).map((r) => ({
      id: r.id,
      userId: r.user_id,
      triggerDonationId: r.trigger_donation_id,
      sigName: r.sig_name,
      sigImageUrl: r.sig_image_url || undefined,
      bonusAmount: Number(r.bonus_amount) || 0,
      status: r.status,
      createdAt: Number(r.created_at) || Date.now(),
    }));
  });
}

/** 특정 줍줍 건 취소 (CANCELED) */
export async function cancelZubzubQueueItem(
  userId: string,
  queueId: string
): Promise<boolean> {
  if (!isMysqlKvConfigured()) {
    const list = inMemoryZubZubQueue.get(userId) || [];
    const item = list.find((x) => x.id === queueId);
    if (!item) return false;
    item.status = "CANCELED";
    return true;
  }

  return withMysqlBulkConn(async (c) => {
    await ensureZubzubQueueTable(c);
    const [result] = await c.execute<any>(
      `UPDATE zubzub_queue SET status = 'CANCELED' WHERE user_id = ? AND id = ?`,
      [userId, queueId]
    );
    return Boolean(result && result.affectedRows > 0);
  });
}

/** 정산 리셋 시 대기 중인 모든 줍줍 건 취소 (CANCELED) */
export async function cancelAllWaitingZubzub(userId: string): Promise<number> {
  if (!isMysqlKvConfigured()) {
    const list = inMemoryZubZubQueue.get(userId) || [];
    let count = 0;
    for (const item of list) {
      if (item.status === "WAITING") {
        item.status = "CANCELED";
        count++;
      }
    }
    return count;
  }

  return withMysqlBulkConn(async (c) => {
    await ensureZubzubQueueTable(c);
    const [result] = await c.execute<any>(
      `UPDATE zubzub_queue SET status = 'CANCELED' WHERE user_id = ? AND status = 'WAITING'`,
      [userId]
    );
    return Number(result?.affectedRows || 0);
  });
}
