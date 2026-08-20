import { computeSettlement } from "@/lib/settlement-utils";
import type { DailyLogEntry } from "@/lib/state";
import { normalizeDonorsArray } from "@/lib/state";
import type { Donor, Member, SettlementRecord } from "@/types";
import {
  isDailyLogEntryBlockedByDeleteLog,
  isSettlementRecordRevivedFromDeleteLog,
} from "@/lib/settlement-delete-tombstone";
import { mergeSettlementRecords, normalizeSettlementRecords } from "@/lib/settlement";
import type { SettlementDeleteLog } from "@/types";

const DEFAULT_ACCOUNT_RATIO = 0.7;
const DEFAULT_TOON_RATIO = 0.6;
const DEFAULT_FEE_RATE = 0.033;
/** 정산 직후 daily log at 과 createdAt 차이 허용 */
const SETTLEMENT_DAILY_LOG_MATCH_MS = 15 * 60 * 1000;

export function dailyLogEntryAtMs(entry: DailyLogEntry): number {
  const ts = Date.parse(String(entry.at || ""));
  return Number.isFinite(ts) ? ts : 0;
}

function donorIdSignature(donors: Donor[] | undefined): string {
  return normalizeDonorsArray(donors)
    .map((d) => String(d.id || "").trim())
    .filter(Boolean)
    .sort()
    .join("\u001e");
}

function donorCount(entry: DailyLogEntry): number {
  return normalizeDonorsArray(entry.donors).length;
}

function entryTotal(entry: DailyLogEntry): number {
  const fromField = Math.max(0, Math.round(Number(entry.total) || 0));
  if (fromField > 0) return fromField;
  const members = Array.isArray(entry.members) ? entry.members : [];
  return members.reduce(
    (sum, m) =>
      sum +
      Math.max(0, Math.round(Number(m.account || 0))) +
      Math.max(0, Math.round(Number(m.toon || 0))),
    0
  );
}

/** 정산 기록과 일일 로그가 동일 방송인지 — donors 보강용(느슨) */
export function settlementRecordMatchesDailyLogEntry(
  record: SettlementRecord,
  entry: DailyLogEntry
): boolean {
  if (settlementRecordStronglyMatchesDailyLogEntry(record, entry)) return true;

  const entryAt = dailyLogEntryAtMs(entry);
  if (!entryAt) return false;
  const recordAt = Number(record.createdAt || 0);
  if (Math.abs(recordAt - entryAt) > SETTLEMENT_DAILY_LOG_MATCH_MS) return false;

  const recordDonors = normalizeDonorsArray(record.donors);
  const entryDonors = normalizeDonorsArray(entry.donors);
  if (recordDonors.length > 0 && entryDonors.length > 0) {
    const recSig = donorIdSignature(recordDonors);
    const entSig = donorIdSignature(entryDonors);
    if (recSig && entSig && recSig === entSig) return true;
    if (Math.abs(recordDonors.length - entryDonors.length) <= 1) return true;
  }

  const recTotal = Math.max(0, Math.round(Number(record.totalGross || record.totalNet || 0)));
  const entTotal = entryTotal(entry);
  if (recTotal > 0 && entTotal > 0) {
    const ratio = Math.min(recTotal, entTotal) / Math.max(recTotal, entTotal);
    if (ratio >= 0.95) return true;
  }

  return false;
}

/** 고아 판별·복구용 — donor id 집합 일치(우선) 또는 donors 없을 때만 합계·시간 일치 */
export function settlementRecordStronglyMatchesDailyLogEntry(
  record: SettlementRecord,
  entry: DailyLogEntry
): boolean {
  const entryAt = dailyLogEntryAtMs(entry);
  if (!entryAt) return false;
  const recordAt = Number(record.createdAt || 0);
  if (Math.abs(recordAt - entryAt) > SETTLEMENT_DAILY_LOG_MATCH_MS) return false;

  const recordDonors = normalizeDonorsArray(record.donors);
  const entryDonors = normalizeDonorsArray(entry.donors);
  if (recordDonors.length > 0 && entryDonors.length > 0) {
    const recSig = donorIdSignature(recordDonors);
    const entSig = donorIdSignature(entryDonors);
    return Boolean(recSig && entSig && recSig === entSig);
  }

  const recTotal = Math.max(0, Math.round(Number(record.totalGross || record.totalNet || 0)));
  const entTotal = entryTotal(entry);
  if (recTotal > 0 && entTotal > 0 && recTotal === entTotal) {
    return Math.abs(recordAt - entryAt) <= 2 * 60 * 1000;
  }

  return false;
}

export function collectAllDailyLogEntries(
  dailyLog: Record<string, DailyLogEntry[] | unknown[]> | null | undefined
): DailyLogEntry[] {
  if (!dailyLog || typeof dailyLog !== "object") return [];
  const out: DailyLogEntry[] = [];
  for (const entries of Object.values(dailyLog)) {
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") continue;
      out.push(raw as DailyLogEntry);
    }
  }
  return out;
}

function titleIncludesHint(title: string, hint: string): boolean {
  const h = hint.trim().toLowerCase();
  if (!h) return false;
  return title.trim().toLowerCase().includes(h);
}

function dailyLogEntryScore(entry: DailyLogEntry): number {
  return donorCount(entry) * 1_000_000 + entryTotal(entry) + dailyLogEntryAtMs(entry) / 1000;
}

/** 제목 힌트(예: 깡깡)로 일일 로그 고아 후보 중 가장 그럴듯한 1건 선택 */
export function pickDailyLogOrphanForTitleHint(
  orphans: DailyLogEntry[],
  titleHint: string
): DailyLogEntry | null {
  const needle = titleHint.trim().toLowerCase();
  if (!needle || orphans.length === 0) return null;
  if (orphans.length === 1) return orphans[0]!;
  /** 후원·합계가 큰 스냅샷 우선(대전 방송) */
  return [...orphans].sort((a, b) => dailyLogEntryScore(b) - dailyLogEntryScore(a))[0]!;
}

/** 강매칭으로 어떤 정산에도 묶이지 않은 일일 로그 스냅샷 */
export function findDailyLogEntriesNotStronglyCovered(
  dailyLog: Record<string, DailyLogEntry[] | unknown[]> | null | undefined,
  records: SettlementRecord[]
): DailyLogEntry[] {
  return collectAllDailyLogEntries(dailyLog)
    .filter((entry) => {
      if (donorCount(entry) === 0 && entryTotal(entry) <= 0) return false;
      return !records.some((r) => settlementRecordStronglyMatchesDailyLogEntry(r, entry));
    })
    .sort((a, b) => dailyLogEntryAtMs(b) - dailyLogEntryAtMs(a));
}

/** titleHint(깡깡대전 등)가 목록에 없을 때 일일 로그에서 1건 강제 복구·제목 보정 */
export function recoverMissingSettlementByTitleHint(
  dailyLog: Record<string, DailyLogEntry[] | unknown[]> | null | undefined,
  records: SettlementRecord[],
  titleHint: string
): SettlementRecord[] {
  const hint = titleHint.trim();
  if (!hint || records.some((r) => titleIncludesHint(r.title, hint))) return records;

  const uncovered = findDailyLogEntriesNotStronglyCovered(dailyLog, records);
  const candidate =
    pickDailyLogOrphanForTitleHint(uncovered, hint) ??
    pickDailyLogOrphanForTitleHint(
      collectAllDailyLogEntries(dailyLog).filter(
        (e) => donorCount(e) > 0 || entryTotal(e) > 0
      ),
      hint
    );
  if (!candidate) return records;

  const renameTarget = records.find((r) =>
    settlementRecordStronglyMatchesDailyLogEntry(r, candidate)
  );
  if (renameTarget && !titleIncludesHint(renameTarget.title, hint)) {
    return records.map((r) =>
      r.id === renameTarget.id ? { ...r, title: hint } : r
    );
  }

  const rec = reconstructSettlementFromDailyLogEntry(candidate, hint);
  if (!rec) return records;
  if (records.some((r) => r.id === rec.id)) return records;
  return mergeSettlementRecords(records, [rec]);
}

export function stableRecoveredSettlementId(entry: DailyLogEntry): string {
  const atMs = dailyLogEntryAtMs(entry);
  const donors = normalizeDonorsArray(entry.donors);
  const total = entryTotal(entry);
  return `st_recovered_${atMs}_${donors.length}_${total}`;
}

export function formatRecoveryTitleFromEntry(entry: DailyLogEntry, hint?: string): string {
  const trimmed = String(hint || "").trim();
  if (trimmed) return trimmed;
  const atMs = dailyLogEntryAtMs(entry);
  if (!atMs) return "일일로그 복구 정산";
  const d = new Date(atMs);
  const ymd = d.toISOString().slice(0, 10);
  const hm = d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${ymd} ${hm} 복구`;
}

/** 일일 로그 스냅샷 → 정산 기록(기본 비율). donors·멤버 스냅샷 포함 */
export function reconstructSettlementFromDailyLogEntry(
  entry: DailyLogEntry,
  title: string
): SettlementRecord | null {
  const members = (Array.isArray(entry.members) ? entry.members : []) as Member[];
  const donors = normalizeDonorsArray(entry.donors);
  if (members.length === 0 && donors.length === 0) return null;
  if (entryTotal(entry) <= 0 && donors.length === 0) return null;

  const body = computeSettlement(members, DEFAULT_ACCOUNT_RATIO, DEFAULT_TOON_RATIO, DEFAULT_FEE_RATE);
  const atMs = dailyLogEntryAtMs(entry) || Date.now();
  return normalizeSettlementRecords([
    {
      id: stableRecoveredSettlementId(entry),
      title: title.trim() || formatRecoveryTitleFromEntry(entry),
      createdAt: atMs,
      ...body,
      accountRatio: DEFAULT_ACCOUNT_RATIO,
      toonRatio: DEFAULT_TOON_RATIO,
      feeRate: DEFAULT_FEE_RATE,
      memberPositionsAtSettlement: {},
      ...(donors.length > 0 ? { donors } : {}),
    },
  ])[0]!;
}

export function findOrphanDailyLogEntries(
  dailyLog: Record<string, DailyLogEntry[] | unknown[]> | null | undefined,
  records: SettlementRecord[]
): DailyLogEntry[] {
  if (!dailyLog || typeof dailyLog !== "object") return [];
  const orphans: DailyLogEntry[] = [];
  for (const entries of Object.values(dailyLog)) {
    if (!Array.isArray(entries)) continue;
    for (const raw of entries) {
      if (!raw || typeof raw !== "object") continue;
      const entry = raw as DailyLogEntry;
      if (donorCount(entry) === 0 && entryTotal(entry) <= 0) continue;
      const matched = records.some((r) => settlementRecordStronglyMatchesDailyLogEntry(r, entry));
      if (!matched) orphans.push(entry);
    }
  }
  orphans.sort((a, b) => dailyLogEntryAtMs(b) - dailyLogEntryAtMs(a));
  return orphans;
}

export function recoverSettlementRecordsFromDailyLog(
  dailyLog: Record<string, DailyLogEntry[] | unknown[]> | null | undefined,
  existing: SettlementRecord[],
  opts?: { titleHint?: string; deletedLogs?: SettlementDeleteLog[] }
): SettlementRecord[] {
  const hint = String(opts?.titleHint || "").trim();
  const deletedLogs = opts?.deletedLogs;
  const orphans = findOrphanDailyLogEntries(dailyLog, existing);
  const reconstructed: SettlementRecord[] = [];
  for (const entry of orphans) {
    if (isDailyLogEntryBlockedByDeleteLog(entry, deletedLogs)) continue;
    const title =
      hint && orphans.length === 1
        ? hint
        : hint
          ? `${hint} (${formatRecoveryTitleFromEntry(entry)})`
          : formatRecoveryTitleFromEntry(entry);
    const rec = reconstructSettlementFromDailyLogEntry(entry, title);
    if (!rec || isSettlementRecordRevivedFromDeleteLog(rec, deletedLogs)) continue;
    reconstructed.push(rec);
  }
  let merged = mergeSettlementRecords(existing, reconstructed);
  if (hint) {
    merged = recoverMissingSettlementByTitleHint(dailyLog, merged, hint);
    merged = merged.filter((r) => !isSettlementRecordRevivedFromDeleteLog(r, deletedLogs));
  }
  return merged;
}

export type SettlementServerRecoveryCounts = {
  userKey: number;
  legacyKey: number;
  dailyLogOrphans: number;
  merged: number;
};

export function mergeSettlementRecordArrays(
  ...sources: Array<SettlementRecord[] | null | undefined>
): SettlementRecord[] {
  let merged: SettlementRecord[] = [];
  for (const src of sources) {
    if (!src?.length) continue;
    merged = mergeSettlementRecords(merged, src);
  }
  return merged;
}

/** donors 스냅샷이 비어 있는 기존 정산에 일일 로그 donors 를 보강 */
export function enrichSettlementRecordsDonorsFromDailyLog(
  records: SettlementRecord[],
  dailyLog: Record<string, DailyLogEntry[] | unknown[]> | null | undefined
): SettlementRecord[] {
  if (!dailyLog || typeof dailyLog !== "object") return records;
  return records.map((record) => {
    if (normalizeDonorsArray(record.donors).length > 0) return record;
    for (const entries of Object.values(dailyLog)) {
      if (!Array.isArray(entries)) continue;
      for (const raw of entries) {
        if (!raw || typeof raw !== "object") continue;
        const entry = raw as DailyLogEntry;
        if (!settlementRecordMatchesDailyLogEntry(record, entry)) continue;
        const donors = normalizeDonorsArray(entry.donors);
        if (donors.length > 0) return { ...record, donors };
      }
    }
    return record;
  });
}
