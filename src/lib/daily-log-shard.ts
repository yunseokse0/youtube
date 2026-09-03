import { broadcastDateKey, DAILY_LOG_KEY, type DailyLogEntry } from "@/lib/state";
import type { Donor, Member } from "@/types";

/** monolith: excel-broadcast-daily-log-v1:din — shard: excel-broadcast-daily-log-v1:din:YYYY-MM-DD */
export const DAILY_LOG_SHARD_DAYS_DEFAULT = 2;
export const DAILY_LOG_SHARD_DAYS_ADMIN = 2;
/** 관리자 hydrate 기본 — 날짜당 최근 N개만 (복구·표시용) */
export const DAILY_LOG_ADMIN_MAX_ENTRIES_PER_DAY = 5;
/**
 * 하루 스냅샷 상한(후원 건수 아님).
 * 후원 1만 건/일이어도 donors 본문은 state 에 두고, 로그는 스냅샷만 쌓는다.
 */
export const DAILY_LOG_MAX_ENTRIES_PER_DAY_STORE = 96;
/** 날짜당 전체 donors 를 남기는 최신 스냅샷 수 — 나머지는 summaryOnly */
export const DAILY_LOG_FULL_SNAPSHOTS_PER_DAY = 3;
/** 이 건수 이상이면 auto-append 간격을 늘림 */
export const DAILY_LOG_LARGE_DONOR_COUNT = 2_000;
export const DAILY_LOG_HUGE_DONOR_COUNT = 8_000;

export function dailyLogMonolithKvKey(userId: string): string {
  return `${DAILY_LOG_KEY}:${userId}`;
}

export function dailyLogShardKvKey(userId: string, dateKey: string): string {
  return `${DAILY_LOG_KEY}:${userId}:${dateKey}`;
}

export function dailyLogShardKeyPrefix(userId: string): string {
  return `${DAILY_LOG_KEY}:${userId}:`;
}

export function isDailyLogShardKvKey(key: string, userId: string): boolean {
  const prefix = dailyLogShardKeyPrefix(userId);
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(rest);
}

export function parseDailyLogShardDateFromKey(key: string, userId: string): string | null {
  const prefix = dailyLogShardKeyPrefix(userId);
  if (!key.startsWith(prefix)) return null;
  const rest = key.slice(prefix.length);
  return /^\d{4}-\d{2}-\d{2}$/.test(rest) ? rest : null;
}

/** KST 기준 최근 N일 dateKey (오늘 포함) */
export function recentDailyLogDateKeys(days: number, from = new Date()): string[] {
  const n = Math.max(1, Math.min(90, Math.floor(days)));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(from.getTime() - i * 86_400_000);
    out.push(broadcastDateKey(d));
  }
  return out;
}

export function mergeDailyLogShardMaps(
  ...parts: Array<Record<string, DailyLogEntry[]>>
): Record<string, DailyLogEntry[]> {
  const out: Record<string, DailyLogEntry[]> = {};
  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    for (const [dateKey, entries] of Object.entries(part)) {
      if (!Array.isArray(entries) || entries.length === 0) continue;
      const prev = out[dateKey];
      out[dateKey] = prev ? [...prev, ...entries] : [...entries];
    }
  }
  return out;
}

export function dailyLogFromMonolith(raw: unknown): Record<string, DailyLogEntry[]> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.__migrated === true) return null;
  const out: Record<string, DailyLogEntry[]> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !Array.isArray(v)) continue;
    out[k] = v as DailyLogEntry[];
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function dailyLogEntriesFromShardPayload(raw: unknown): DailyLogEntry[] | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw as DailyLogEntry[];
  if (typeof raw === "object") {
    const o = raw as Record<string, DailyLogEntry[]>;
    const keys = Object.keys(o).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k));
    if (keys.length === 1 && Array.isArray(o[keys[0]!])) return o[keys[0]!]!;
  }
  return null;
}

function entryAtMs(entry: DailyLogEntry): number {
  const t = Date.parse(String(entry?.at || ""));
  return Number.isFinite(t) ? t : 0;
}

/** 날짜별 최근 maxEntries 만 유지 (at 오름차순 저장 가정·미정렬도 대응) */
export function trimDailyLogEntries(
  entries: DailyLogEntry[],
  maxEntries: number
): DailyLogEntry[] {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  const cap = Math.max(1, Math.floor(maxEntries));
  if (entries.length <= cap) return entries;
  return [...entries].sort((a, b) => entryAtMs(a) - entryAtMs(b)).slice(-cap);
}

export function trimDailyLogMap(
  map: Record<string, DailyLogEntry[]>,
  maxEntriesPerDay: number
): Record<string, DailyLogEntry[]> {
  const out: Record<string, DailyLogEntry[]> = {};
  for (const [dateKey, entries] of Object.entries(map || {})) {
    if (!Array.isArray(entries) || entries.length === 0) continue;
    out[dateKey] = trimDailyLogEntries(entries, maxEntriesPerDay);
  }
  return out;
}

/** 스냅샷 저장·전송용 — donors/members 필수 필드만 */
export function slimDailyLogDonor(d: Donor): Donor {
  const message = String(d.message || "").trim();
  return {
    id: String(d.id || ""),
    name: String(d.name || "무명"),
    amount: Math.max(0, Math.round(Number(d.amount) || 0)),
    memberId: String(d.memberId || ""),
    at: typeof d.at === "number" && Number.isFinite(d.at) ? d.at : Date.now(),
    target: d.target === "toon" ? "toon" : "account",
    ...(message ? { message } : {}),
    ...(d.donationExcluded === true ? { donationExcluded: true } : {}),
    ...(d.groupSplit === true ? { groupSplit: true } : {}),
    ...(d.groupSplitSource === true ? { groupSplitSource: true } : {}),
  };
}

export function slimDailyLogMember(m: Member): Member {
  return {
    id: String(m.id || ""),
    name: String(m.name || ""),
    ...(m.realName ? { realName: String(m.realName) } : {}),
    account: Math.max(0, Math.round(Number(m.account) || 0)),
    toon: Math.max(0, Math.round(Number(m.toon) || 0)),
    ...(typeof m.contribution === "number" ? { contribution: m.contribution } : {}),
    ...(m.operating ? { operating: true } : {}),
  };
}

export function slimDailyLogEntry(entry: DailyLogEntry): DailyLogEntry {
  const donors = Array.isArray(entry.donors)
    ? entry.donors.map((d) => slimDailyLogDonor(d as Donor))
    : [];
  const donorCount =
    typeof entry.donorCount === "number" && entry.donorCount >= 0
      ? entry.donorCount
      : donors.length;
  return {
    at: String(entry.at || new Date().toISOString()),
    total: Math.max(0, Math.round(Number(entry.total) || 0)),
    members: Array.isArray(entry.members)
      ? entry.members.map((m) => slimDailyLogMember(m as Member))
      : [],
    donors,
    ...(donorCount > 0 ? { donorCount } : {}),
    ...(entry.summaryOnly === true ? { summaryOnly: true } : {}),
  };
}

/** 최신 N개만 전체 donors, 이전 스냅샷은 summaryOnly(복구는 최신 full 사용) */
export function compactDailyLogDayEntries(
  entries: DailyLogEntry[],
  opts?: { maxEntries?: number; fullSnapshots?: number }
): DailyLogEntry[] {
  const maxEntries = Math.max(1, opts?.maxEntries ?? DAILY_LOG_MAX_ENTRIES_PER_DAY_STORE);
  const fullKeep = Math.max(1, opts?.fullSnapshots ?? DAILY_LOG_FULL_SNAPSHOTS_PER_DAY);
  const trimmed = trimDailyLogEntries(entries, maxEntries).map((e) => slimDailyLogEntry(e));
  if (trimmed.length <= fullKeep) return trimmed;
  const cutoff = trimmed.length - fullKeep;
  return trimmed.map((e, i) => {
    if (i >= cutoff) return { ...e, summaryOnly: undefined };
    const donorCount =
      typeof e.donorCount === "number" && e.donorCount > 0
        ? e.donorCount
        : Array.isArray(e.donors)
          ? e.donors.length
          : 0;
    return {
      at: e.at,
      total: e.total,
      members: e.members,
      donors: [],
      donorCount,
      summaryOnly: true,
    };
  });
}
