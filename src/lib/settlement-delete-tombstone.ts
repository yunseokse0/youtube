import type { DailyLogEntry } from "@/lib/state";
import { dailyLogEntryAtMs } from "@/lib/settlement-recovery";
import type { SettlementDeleteLog, SettlementRecord } from "@/types";

const REVIVE_MATCH_MS = 15 * 60 * 1000;

export function deletedSettlementIdSet(logs: SettlementDeleteLog[] | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const log of logs || []) {
    const id = String(log.recordId || "").trim();
    if (id) out.add(id);
  }
  return out;
}

/** 삭제 로그에 있는 id·생성시각·제목·금액으로 되살아난 정산 제거 */
export function filterSettlementRecordsByDeleteLogs(
  records: SettlementRecord[],
  logs: SettlementDeleteLog[] | null | undefined
): SettlementRecord[] {
  const deletedIds = deletedSettlementIdSet(logs);
  if (deletedIds.size === 0 && !(logs || []).length) return records;
  return (records || []).filter((r) => {
    const id = String(r.id || "").trim();
    if (id && deletedIds.has(id)) return false;
    return !isSettlementRecordRevivedFromDeleteLog(r, logs);
  });
}

export function isSettlementRecordRevivedFromDeleteLog(
  record: SettlementRecord,
  logs: SettlementDeleteLog[] | null | undefined
): boolean {
  const id = String(record.id || "").trim();
  if (id && deletedSettlementIdSet(logs).has(id)) return true;
  const recordAt = Number(record.createdAt || 0);
  const title = String(record.title || "").trim().toLowerCase();
  const totalNet = Math.max(0, Math.round(Number(record.totalNet || 0)));
  for (const log of logs || []) {
    const logId = String(log.recordId || "").trim();
    if (logId && logId === id) return true;
    const logAt = Number(log.createdAt || 0);
    if (!recordAt || !logAt || Math.abs(recordAt - logAt) > REVIVE_MATCH_MS) continue;
    const logTitle = String(log.title || "").trim().toLowerCase();
    const logNet = Math.max(0, Math.round(Number(log.totalNet || 0)));
    if (title && logTitle && title === logTitle) return true;
    if (totalNet > 0 && logNet > 0 && totalNet === logNet) return true;
  }
  return false;
}

/** 일일로그 고아 복구 시 — 삭제된 정산과 동일 스냅샷이면 스킵 */
export function isDailyLogEntryBlockedByDeleteLog(
  entry: DailyLogEntry,
  logs: SettlementDeleteLog[] | null | undefined
): boolean {
  const entryAt = dailyLogEntryAtMs(entry);
  if (!entryAt) return false;
  for (const log of logs || []) {
    const logAt = Number(log.createdAt || 0);
    if (!logAt || Math.abs(entryAt - logAt) > REVIVE_MATCH_MS) continue;
    const logNet = Math.max(0, Math.round(Number(log.totalNet || 0)));
    const entryTotal = Math.max(0, Math.round(Number(entry.total || 0)));
    if (logNet > 0 && entryTotal > 0 && logNet === entryTotal) return true;
    if (Math.abs(entryAt - logAt) <= 2 * 60 * 1000) return true;
  }
  return false;
}
