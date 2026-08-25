import { formatManThousand } from "@/lib/state";
import { computeSettlement, isOperatingSettlementMember, isTreasurySettlementMember, type SigMatchRankingItem } from "@/lib/settlement-utils";
import { computeMemberPaymentStatement } from "@/lib/settlement-payment-statement";
import { resolveMemberTaxInvoiceIssued } from "@/lib/settlement-payment-math";
import {
  enrichSettlementRecordsDonorsFromDailyLog,
  recoverSettlementRecordsFromDailyLog,
} from "@/lib/settlement-recovery";
import {
  filterSettlementRecordsByDeleteLogs,
} from "@/lib/settlement-delete-tombstone";
import type { Donor, Member, SettlementDeleteLog, SettlementMemberRatioOverrides, SettlementMemberResult, SettlementRecord } from "@/types";

export const SETTLEMENT_RECORDS_KEY = "excel-broadcast-settlement-records-v1";
export const SETTLEMENT_DELETE_LOGS_KEY = "excel-broadcast-settlement-delete-logs-v1";

export function settlementRecordsKey(userId?: string | null): string {
  return userId ? `${SETTLEMENT_RECORDS_KEY}:${userId}` : SETTLEMENT_RECORDS_KEY;
}
export function settlementDeleteLogsKey(userId?: string | null): string {
  return userId ? `${SETTLEMENT_DELETE_LOGS_KEY}:${userId}` : SETTLEMENT_DELETE_LOGS_KEY;
}

export type {
  SettlementDeleteLog,
  SettlementMemberRatioOverrides,
  SettlementMemberResult,
  SettlementRecord,
};
export { computeSettlement, isOperatingSettlementMember, isTreasurySettlementMember };

export type SettlementCreateOptions = {
  vatIncluded?: boolean;
  vatRate?: number;
  omitTreasuryFromSettlement?: boolean;
  includeTreasuryInFullStatement?: boolean;
  taxInvoiceIssued?: boolean;
  taxInvoiceVatRate?: number;
};

function pruneOlderThan3Years(records: SettlementRecord[]): SettlementRecord[] {
  const now = Date.now();
  const threeYearsMs = 365 * 3 * 24 * 60 * 60 * 1000;
  const minAt = now - threeYearsMs;
  return records.filter((r) => (r.createdAt || 0) >= minAt);
}

function sortLatest(records: SettlementRecord[]): SettlementRecord[] {
  return [...records].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function settlementRowIsOperating(
  m: Pick<SettlementMemberResult, "name" | "operating" | "memberId" | "realName">,
  positions?: Record<string, string> | null
): boolean {
  return isOperatingSettlementMember(
    { id: m.memberId, name: m.name, operating: m.operating, realName: m.realName },
    positions
  );
}

function normalizeOperatingMember(
  m: SettlementMemberResult,
  positions?: Record<string, string> | null
): SettlementMemberResult {
  if (!settlementRowIsOperating(m, positions)) return m;
  const account = Math.max(0, m.account || 0);
  const toon = Math.max(0, m.toon || 0);
  const gross = account + toon;
  return {
    ...m,
    accountRatio: 1,
    toonRatio: 1,
    accountApplied: account,
    toonApplied: toon,
    gross,
    fee: 0,
    net: gross,
  };
}

function migrateSettlementRecord(record: SettlementRecord): SettlementRecord {
  const positions = record.memberPositionsAtSettlement;
  const members = (record.members || []).map((m) =>
    normalizeOperatingMember(
      {
        ...m,
        operating: isOperatingSettlementMember(
          { id: m.memberId, name: m.name, operating: m.operating, realName: m.realName },
          positions
        ),
      },
      positions
    )
  );
  const totalGross = members.reduce((s, r) => s + (r.gross || 0), 0);
  const totalFee = members.reduce((s, r) => s + (r.fee || 0), 0);
  const totalNet = members.reduce((s, r) => s + (r.net || 0), 0);
  return {
    ...record,
    members,
    totalGross,
    totalFee,
    totalNet,
  };
}

export function normalizeSettlementRecords(records: SettlementRecord[]): SettlementRecord[] {
  const base = Array.isArray(records) ? records : [];
  const migrated = base.map(migrateSettlementRecord);
  return sortLatest(pruneOlderThan3Years(migrated));
}

function normalizeDeleteLogs(logs: SettlementDeleteLog[]): SettlementDeleteLog[] {
  const now = Date.now();
  const threeYearsMs = 365 * 3 * 24 * 60 * 60 * 1000;
  const minAt = now - threeYearsMs;
  return (Array.isArray(logs) ? logs : [])
    .filter((x) => (x.deletedAt || 0) >= minAt)
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

/** 서버·로컬·다중 탭 저장을 id 기준 union — 한쪽에만 있는 기록은 보존 */
export function mergeSettlementRecords(local: SettlementRecord[], remote: SettlementRecord[]): SettlementRecord[] {
  const byId = new Map<string, SettlementRecord>();
  for (const r of [...(remote || []), ...(local || [])]) {
    const id = String(r?.id || "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, r);
      continue;
    }
    const prevAt = Number(prev.createdAt || 0);
    const nextAt = Number(r.createdAt || 0);
    if (nextAt >= prevAt) byId.set(id, r);
  }
  return normalizeSettlementRecords(Array.from(byId.values()));
}

export function loadSettlementRecords(userId?: string | null): SettlementRecord[] {
  if (typeof window === "undefined") return [];
  try {
    let raw = window.localStorage.getItem(settlementRecordsKey(userId));
    if (!raw && userId) {
      const legacyRaw = window.localStorage.getItem(SETTLEMENT_RECORDS_KEY);
      if (legacyRaw) {
        const arr = JSON.parse(legacyRaw) as SettlementRecord[];
        if (Array.isArray(arr) && arr.length > 0) {
          const normalized = normalizeSettlementRecords(arr);
          saveSettlementRecords(normalized, userId);
          return normalized;
        }
      }
    }
    if (!raw) return [];
    const arr = JSON.parse(raw) as SettlementRecord[];
    return normalizeSettlementRecords(arr);
  } catch {
    return [];
  }
}

export function saveSettlementRecords(records: SettlementRecord[], userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    const next = normalizeSettlementRecords(records || []);
    window.localStorage.setItem(settlementRecordsKey(userId), JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function loadSettlementDeleteLogs(userId?: string | null): SettlementDeleteLog[] {
  if (typeof window === "undefined") return [];
  try {
    let raw = window.localStorage.getItem(settlementDeleteLogsKey(userId));
    if (!raw && userId) {
      raw = window.localStorage.getItem(SETTLEMENT_DELETE_LOGS_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as SettlementDeleteLog[];
        if (Array.isArray(arr) && arr.length > 0) {
          const normalized = normalizeDeleteLogs(arr);
          saveSettlementDeleteLogs(normalized, userId);
          return normalized;
        }
      }
    }
    if (!raw) return [];
    return normalizeDeleteLogs(JSON.parse(raw) as SettlementDeleteLog[]);
  } catch {
    return [];
  }
}

export function saveSettlementDeleteLogs(logs: SettlementDeleteLog[], userId?: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(settlementDeleteLogsKey(userId), JSON.stringify(normalizeDeleteLogs(logs)));
  } catch {
    // ignore
  }
}

function mergeSettlementDeleteLogs(
  local: SettlementDeleteLog[],
  remote: SettlementDeleteLog[]
): SettlementDeleteLog[] {
  const byId = new Map<string, SettlementDeleteLog>();
  for (const log of [...remote, ...local]) {
    const id = String(log.recordId || "").trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev || (log.deletedAt || 0) >= (prev.deletedAt || 0)) byId.set(id, log);
  }
  return normalizeDeleteLogs(Array.from(byId.values()));
}

export async function loadSettlementDeleteLogsFromApi(
  userId?: string | null
): Promise<SettlementDeleteLog[] | null> {
  if (typeof window === "undefined") return null;
  try {
    const q = new URLSearchParams({ _t: String(Date.now()) });
    if (userId) q.set("user", userId);
    const res = await fetch(`/api/settlements/delete-logs?${q.toString()}`, {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return normalizeDeleteLogs(Array.isArray(data) ? data : []);
  } catch {
    return null;
  }
}

export async function saveSettlementDeleteLogsToApi(
  logs: SettlementDeleteLog[],
  userId?: string | null
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const url = q.toString() ? `/api/settlements/delete-logs?${q.toString()}` : "/api/settlements/delete-logs";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizeDeleteLogs(logs)),
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadSettlementDeleteLogsPreferApi(
  userId?: string | null
): Promise<SettlementDeleteLog[]> {
  const local = loadSettlementDeleteLogs(userId);
  const fromApi = await loadSettlementDeleteLogsFromApi(userId);
  if (!fromApi) return local;
  const merged = mergeSettlementDeleteLogs(local, fromApi);
  saveSettlementDeleteLogs(merged, userId);
  return merged;
}

export function applySettlementDeleteTombstones(
  records: SettlementRecord[],
  deleteLogs: SettlementDeleteLog[] | null | undefined
): SettlementRecord[] {
  return filterSettlementRecordsByDeleteLogs(normalizeSettlementRecords(records), deleteLogs);
}

export function appendSettlementDeleteLog(record: SettlementRecord, reason = "manual", userId?: string | null): SettlementDeleteLog {
  const log: SettlementDeleteLog = {
    recordId: record.id,
    title: record.title,
    createdAt: record.createdAt,
    deletedAt: Date.now(),
    totalNet: record.totalNet,
    reason,
  };
  const prev = loadSettlementDeleteLogs(userId);
  saveSettlementDeleteLogs([log, ...prev], userId);
  return log;
}

export function appendSettlementRecord(
  title: string,
  members: Member[],
  accountRatio: number,
  toonRatio: number,
  feeRate = 0.033,
  memberRatioOverrides?: SettlementMemberRatioOverrides,
  donors?: Donor[],
  userId?: string | null,
  memberPositions?: Record<string, string> | null,
  settlementOptions?: SettlementCreateOptions
): SettlementRecord {
  const body = computeSettlement(
    members,
    accountRatio,
    toonRatio,
    feeRate,
    memberRatioOverrides,
    memberPositions,
    settlementOptions
  );
  const membersWithTax = body.members.map((m) => {
    const tax = memberRatioOverrides?.[m.memberId]?.taxInvoiceIssued;
    if (typeof tax !== "boolean") return m;
    return { ...m, taxInvoiceIssued: tax };
  });
  const rec: SettlementRecord = {
    id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim() || "정산",
    createdAt: Date.now(),
    ...body,
    members: membersWithTax,
    memberPositionsAtSettlement: memberPositions && typeof memberPositions === "object" ? { ...memberPositions } : {},
    ...(donors && donors.length > 0 ? { donors } : {}),
    ...(settlementOptions?.omitTreasuryFromSettlement ? { omitTreasuryFromSettlement: true } : {}),
    ...(settlementOptions?.includeTreasuryInFullStatement ? { includeTreasuryInFullStatement: true } : {}),
    ...(settlementOptions?.taxInvoiceIssued ? { taxInvoiceIssued: true } : {}),
    ...(settlementOptions?.taxInvoiceVatRate != null
      ? { taxInvoiceVatRate: settlementOptions.taxInvoiceVatRate }
      : {}),
  };
  const prev = loadSettlementRecords(userId);
  saveSettlementRecords([rec, ...prev], userId);
  return rec;
}

const settlementLoadInflight = new Map<string, Promise<SettlementRecord[] | null>>();

export async function loadSettlementRecordsFromApi(userId?: string | null): Promise<SettlementRecord[] | null> {
  if (typeof window === "undefined") return null;
  const dedupeKey = userId ?? "__cookie__";
  const existing = settlementLoadInflight.get(dedupeKey);
  if (existing) return existing;
  const created = doLoadSettlementRecordsFromApi(userId);
  settlementLoadInflight.set(dedupeKey, created);
  created.finally(() => {
    if (settlementLoadInflight.get(dedupeKey) === created) settlementLoadInflight.delete(dedupeKey);
  });
  return created;
}

async function doLoadSettlementRecordsFromApi(userId?: string | null): Promise<SettlementRecord[] | null> {
  try {
    const q = new URLSearchParams({ _t: String(Date.now()) });
    if (userId) q.set("user", userId);
    const res = await fetch(`/api/settlements?${q.toString()}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return normalizeSettlementRecords(data as SettlementRecord[]);
  } catch {
    return null;
  }
}

type SettlementSaveJob = {
  records: SettlementRecord[];
  userId: string | null | undefined;
  replace?: boolean;
  resolveAll: Array<(ok: boolean) => void>;
};

let settlementSaveInFlight = false;
let settlementSavePending: SettlementSaveJob | null = null;

async function runSettlementSaveQueue(): Promise<void> {
  if (settlementSaveInFlight || !settlementSavePending) return;
  settlementSaveInFlight = true;
  const job = settlementSavePending;
  settlementSavePending = null;
  try {
    const normalized = normalizeSettlementRecords(job.records);
    const q = new URLSearchParams();
    if (job.userId) q.set("user", job.userId);
    if (job.replace) q.set("mode", "replace");
    const url = q.toString() ? `/api/settlements?${q.toString()}` : "/api/settlements";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized),
      credentials: "include",
    });
    const ok = res.ok;
    for (const fn of job.resolveAll) fn(ok);
  } catch {
    for (const fn of job.resolveAll) fn(false);
  } finally {
    settlementSaveInFlight = false;
    if (settlementSavePending) void runSettlementSaveQueue();
  }
}

export async function saveSettlementRecordsToApi(
  records: SettlementRecord[],
  userId?: string | null,
  opts?: { replace?: boolean }
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const replace = Boolean(opts?.replace);
  return new Promise((resolve) => {
    if (!settlementSavePending) {
      settlementSavePending = { records, userId, replace, resolveAll: [resolve] };
    } else {
      if (replace) {
        settlementSavePending.records = records;
        settlementSavePending.replace = true;
      } else if (!settlementSavePending.replace) {
        settlementSavePending.records = mergeSettlementRecords(settlementSavePending.records, records);
      }
      settlementSavePending.userId = userId ?? settlementSavePending.userId;
      settlementSavePending.resolveAll.push(resolve);
    }
    void runSettlementSaveQueue();
  });
}

export async function loadSettlementRecordsPreferApi(userId?: string | null): Promise<SettlementRecord[]> {
  const deleteLogs = await loadSettlementDeleteLogsPreferApi(userId);
  const legacyLocal = loadSettlementRecords(null);
  let local = applySettlementDeleteTombstones(
    mergeSettlementRecords(legacyLocal, loadSettlementRecords(userId)),
    deleteLogs
  );
  const fromApi = await loadSettlementRecordsFromApi(userId);
  if (fromApi) {
    const mergedRaw =
      fromApi.length === 0 && local.length > 0
        ? local
        : mergeSettlementRecords(local, fromApi);
    const merged = applySettlementDeleteTombstones(mergedRaw, deleteLogs);
    saveSettlementRecords(merged, userId);
    if (merged.length !== fromApi.length || (fromApi.length === 0 && merged.length > 0)) {
      saveSettlementRecordsToApi(merged, userId, { replace: true }).catch(() => {});
    }
    return merged;
  }
  if (local.length === 0 && userId) {
    local = applySettlementDeleteTombstones(legacyLocal, deleteLogs);
    if (local.length > 0) {
      saveSettlementRecords(local, userId);
      saveSettlementRecordsToApi(local, userId).catch(() => {});
      return local;
    }
  }
  return local;
}

export type SettlementRecoveryReport = {
  merged: SettlementRecord[];
  counts: {
    legacy: number;
    userLocal: number;
    api: number;
    dailyLog: number;
    merged: number;
  };
  titles: string[];
  hasKkang?: boolean;
  dailyLogStats?: { totalEntries: number; uncoveredEntries: number };
};

/** 레거시 LS·사용자 LS·서버 API·일일로그 고아 스냅샷을 id union 병합 후 로컬·서버에 반영 */
export async function recoverSettlementRecordsFromAllSources(
  userId?: string | null,
  opts?: { titleHint?: string }
): Promise<SettlementRecoveryReport> {
  const deleteLogs = await loadSettlementDeleteLogsPreferApi(userId);
  const legacy = applySettlementDeleteTombstones(loadSettlementRecords(null), deleteLogs);
  const userLocal = userId
    ? applySettlementDeleteTombstones(loadSettlementRecords(userId), deleteLogs)
    : [];
  let merged = mergeSettlementRecords(legacy, userLocal);
  let apiCount = 0;
  let dailyLogAdded = 0;

  try {
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const res = await fetch(`/api/settlements/recover?${q.toString()}`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ titleHint: opts?.titleHint || "" }),
    });
    if (res.ok) {
      const data = (await res.json()) as {
        records?: SettlementRecord[];
        counts?: { merged?: number; dailyLogOrphans?: number };
        hasKkang?: boolean;
        titles?: string[];
        dailyLogStats?: { totalEntries: number; uncoveredEntries: number };
      };
      if (Array.isArray(data.records)) {
        merged = applySettlementDeleteTombstones(
          mergeSettlementRecords(merged, data.records),
          deleteLogs
        );
        apiCount = data.records.length;
        dailyLogAdded = Number(data.counts?.dailyLogOrphans || 0);
        saveSettlementRecords(merged, userId);
        await saveSettlementRecordsToApi(merged, userId, { replace: true }).catch(() => {});
        return {
          merged,
          counts: {
            legacy: legacy.length,
            userLocal: userLocal.length,
            api: apiCount,
            dailyLog: dailyLogAdded,
            merged: merged.length,
          },
          titles: merged.map((r) => r.title),
          hasKkang: Boolean(data.hasKkang) || merged.some((r) => r.title.includes("깡깡")),
          dailyLogStats: data.dailyLogStats,
        };
      }
    }
  } catch {
    /* fallback 아래 로컬 경로 */
  }

  const fromApi = await loadSettlementRecordsFromApi(userId);
  apiCount = fromApi?.length ?? 0;
  if (fromApi) merged = applySettlementDeleteTombstones(mergeSettlementRecords(merged, fromApi), deleteLogs);

  try {
    const { loadDailyLog, loadDailyLogFromApi } = await import("@/lib/state");
    const localLog = loadDailyLog(userId);
    const apiLog = await loadDailyLogFromApi(userId);
    const dailyLog = { ...localLog, ...apiLog };
    const before = merged.length;
    merged = recoverSettlementRecordsFromDailyLog(dailyLog, merged, {
      titleHint: opts?.titleHint,
      deletedLogs: deleteLogs,
    });
    merged = enrichSettlementRecordsDonorsFromDailyLog(merged, dailyLog);
    merged = applySettlementDeleteTombstones(merged, deleteLogs);
    dailyLogAdded = Math.max(0, merged.length - before);
  } catch {
    /* noop */
  }

  saveSettlementRecords(merged, userId);
  if (merged.length > 0) await saveSettlementRecordsToApi(merged, userId, { replace: true });
  return {
    merged,
    counts: {
      legacy: legacy.length,
      userLocal: userLocal.length,
      api: apiCount,
      dailyLog: dailyLogAdded,
      merged: merged.length,
    },
    titles: merged.map((r) => r.title),
    hasKkang: merged.some((r) => r.title.includes("깡깡")),
  };
}

export async function appendSettlementRecordAndSync(
  title: string,
  members: Member[],
  accountRatio: number,
  toonRatio: number,
  feeRate = 0.033,
  memberRatioOverrides?: SettlementMemberRatioOverrides,
  donors?: Donor[],
  userId?: string | null,
  memberPositions?: Record<string, string> | null,
  settlementOptions?: SettlementCreateOptions
): Promise<SettlementRecord> {
  const rec = appendSettlementRecord(
    title,
    members,
    accountRatio,
    toonRatio,
    feeRate,
    memberRatioOverrides,
    donors,
    userId,
    memberPositions,
    settlementOptions
  );
  const local = loadSettlementRecords(userId);
  await saveSettlementRecordsToApi(local, userId);
  return rec;
}

export async function appendSigMatchIncentiveSettlementAndSync(
  title: string,
  rankings: SigMatchRankingItem[],
  incentivePerPoint: number,
  userId?: string | null
): Promise<SettlementRecord | null> {
  const unit = Math.max(0, Math.floor(incentivePerPoint || 0));
  const rows = (rankings || [])
    .filter((x) => x.score > 0)
    .map<SettlementMemberResult>((x) => {
      const gross = unit > 0 ? x.score * unit : x.score;
      return {
        memberId: x.memberId,
        name: x.name,
        realName: "",
        bankName: "",
        bankAccount: "",
        accountHolder: "",
        account: gross,
        toon: 0,
        accountRatio: 1,
        toonRatio: 0,
        accountApplied: gross,
        toonApplied: 0,
        gross,
        fee: 0,
        net: gross,
      };
    });
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.net, 0);
  const rec: SettlementRecord = {
    id: `st_sig_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim() || "시그 인센티브 정산",
    createdAt: Date.now(),
    accountRatio: 1,
    toonRatio: 0,
    feeRate: 0,
    members: rows,
    memberPositionsAtSettlement: {},
    totalGross: total,
    totalFee: 0,
    totalNet: total,
  };
  const prev = loadSettlementRecords(userId);
  const next = normalizeSettlementRecords([rec, ...prev]);
  saveSettlementRecords(next, userId);
  await saveSettlementRecordsToApi(next, userId);
  return rec;
}

function donorAmountSums(donors: Donor[]): Map<string, { account: number; toon: number }> {
  const map = new Map<string, { account: number; toon: number }>();
  for (const d of donors || []) {
    const memberId = String(d.memberId || "").trim();
    if (!memberId) continue;
    const amount = Math.max(0, Math.round(Number(d.amount) || 0));
    if (amount <= 0) continue;
    const cur = map.get(memberId) || { account: 0, toon: 0 };
    if ((d.target || "account") === "toon") cur.toon += amount;
    else cur.account += amount;
    map.set(memberId, cur);
  }
  return map;
}

/**
 * 정산 기록의 후원 목록을 바꾼 뒤 computeSettlement 로 멤버·합계를 재계산.
 * 은행/예금주·비율·부가세 옵션은 유지한다.
 */
export function recomputeSettlementFromDonors(
  record: SettlementRecord,
  donors: Donor[]
): SettlementRecord {
  const positions = record.memberPositionsAtSettlement || {};
  const sums = donorAmountSums(donors);
  const membersInput: Member[] = (record.members || []).map((m) => {
    const s = sums.get(m.memberId) || { account: 0, toon: 0 };
    return {
      id: m.memberId,
      name: m.name,
      realName: m.realName || "",
      operating: m.operating,
      account: s.account,
      toon: s.toon,
      contribution: 0,
    };
  });

  const overrides: SettlementMemberRatioOverrides = {};
  for (const m of record.members || []) {
    const accDiff =
      typeof m.accountRatio === "number" &&
      Math.abs(m.accountRatio - record.accountRatio) > 1e-9;
    const toonDiff =
      typeof m.toonRatio === "number" && Math.abs(m.toonRatio - record.toonRatio) > 1e-9;
    const taxDiff = typeof m.taxInvoiceIssued === "boolean";
    if (accDiff || toonDiff || taxDiff || m.operating) {
      overrides[m.memberId] = {
        ...(accDiff ? { accountRatio: m.accountRatio } : {}),
        ...(toonDiff ? { toonRatio: m.toonRatio } : {}),
        ...(taxDiff ? { taxInvoiceIssued: m.taxInvoiceIssued } : {}),
      };
    }
  }

  const body = computeSettlement(
    membersInput,
    record.accountRatio,
    record.toonRatio,
    record.feeRate,
    Object.keys(overrides).length > 0 ? overrides : undefined,
    positions,
    { vatIncluded: record.vatIncluded, vatRate: record.vatRate }
  );

  const prevById = new Map((record.members || []).map((m) => [m.memberId, m]));
  const members = body.members.map((m) => {
    const prev = prevById.get(m.memberId);
    if (!prev) return m;
    return {
      ...m,
      bankName: prev.bankName || m.bankName,
      bankAccount: prev.bankAccount || m.bankAccount,
      accountHolder: prev.accountHolder || m.accountHolder,
      ...(typeof prev.taxInvoiceIssued === "boolean"
        ? { taxInvoiceIssued: prev.taxInvoiceIssued }
        : {}),
    };
  });

  return {
    ...record,
    ...body,
    members,
    memberPositionsAtSettlement: positions,
    donors: (donors || []).map((d) => ({
      ...d,
      id: String(d.id || "").trim() || `d_adj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: String(d.name || "무명").replace(/\s+/g, "") || "무명",
      amount: Math.max(0, Math.round(Number(d.amount) || 0)),
      memberId: String(d.memberId || "").trim(),
      at: typeof d.at === "number" && Number.isFinite(d.at) ? d.at : record.createdAt,
      target: d.target === "toon" ? "toon" : "account",
    })),
  };
}

/** records 배열에서 정산 옵션(국고·세금계산서 등) 패치 — 금액 재계산 포함 */
export type SettlementRecomputePatch = Partial<
  Pick<
    SettlementRecord,
    | "accountRatio"
    | "toonRatio"
    | "feeRate"
    | "vatIncluded"
    | "vatRate"
    | "taxInvoiceIssued"
    | "taxInvoiceVatRate"
    | "omitTreasuryFromSettlement"
    | "includeTreasuryInFullStatement"
  >
> & {
  memberRatioOverrides?: SettlementMemberRatioOverrides;
};

function memberRatioOverridesFromRecord(record: SettlementRecord): SettlementMemberRatioOverrides {
  const overrides: SettlementMemberRatioOverrides = {};
  for (const m of record.members || []) {
    const accDiff =
      typeof m.accountRatio === "number" &&
      Math.abs(m.accountRatio - record.accountRatio) > 1e-9;
    const toonDiff =
      typeof m.toonRatio === "number" && Math.abs(m.toonRatio - record.toonRatio) > 1e-9;
    const taxDiff = typeof m.taxInvoiceIssued === "boolean";
    if (accDiff || toonDiff || taxDiff || m.operating) {
      overrides[m.memberId] = {
        ...(accDiff ? { accountRatio: m.accountRatio } : {}),
        ...(toonDiff ? { toonRatio: m.toonRatio } : {}),
        ...(taxDiff ? { taxInvoiceIssued: m.taxInvoiceIssued } : {}),
      };
    }
  }
  return overrides;
}

function applyMemberRatioOverridesToRecord(
  record: SettlementRecord,
  overrides: SettlementMemberRatioOverrides | undefined,
  accountRatio: number,
  toonRatio: number
): SettlementRecord {
  if (!overrides || Object.keys(overrides).length === 0) return record;
  return {
    ...record,
    members: (record.members || []).map((m) => {
      const o = overrides[m.memberId];
      if (!o) return m;
      return {
        ...m,
        ...(typeof o.accountRatio === "number" ? { accountRatio: o.accountRatio } : {}),
        ...(typeof o.toonRatio === "number" ? { toonRatio: o.toonRatio } : {}),
        ...(typeof o.taxInvoiceIssued === "boolean"
          ? { taxInvoiceIssued: o.taxInvoiceIssued }
          : {}),
      };
    }),
    accountRatio,
    toonRatio,
  };
}

function clearMemberTaxInvoiceFlags(members: SettlementMemberResult[]): SettlementMemberResult[] {
  return (members || []).map((m) => {
    if (typeof m.taxInvoiceIssued !== "boolean") return m;
    const { taxInvoiceIssued: _omit, ...rest } = m;
    return rest;
  });
}

/** 후원 스냅샷 또는 멤버 원금 기준으로 비율·옵션 변경 후 재계산 */
export function recomputeSettlementRecord(
  record: SettlementRecord,
  patch: SettlementRecomputePatch = {}
): SettlementRecord {
  const accountRatio = patch.accountRatio ?? record.accountRatio;
  const toonRatio = patch.toonRatio ?? record.toonRatio;
  const feeRate = patch.feeRate ?? record.feeRate;
  const merged: SettlementRecord = {
    ...record,
    ...patch,
    accountRatio,
    toonRatio,
    feeRate,
  };
  let overrides =
    patch.memberRatioOverrides !== undefined
      ? patch.memberRatioOverrides
      : memberRatioOverridesFromRecord(merged);
  let withRatios = applyMemberRatioOverridesToRecord(
    merged,
    overrides,
    accountRatio,
    toonRatio
  );
  if (patch.memberRatioOverrides !== undefined && Object.keys(patch.memberRatioOverrides).length === 0) {
    withRatios = {
      ...withRatios,
      members: clearMemberTaxInvoiceFlags(
        (withRatios.members || []).map((m) => ({
          ...m,
          accountRatio,
          toonRatio,
        }))
      ),
    };
    overrides = {};
  } else if (
    patch.memberRatioOverrides === undefined &&
    (patch.accountRatio != null || patch.toonRatio != null)
  ) {
    withRatios = {
      ...withRatios,
      members: (withRatios.members || []).map((m) => ({
        ...m,
        accountRatio,
        toonRatio,
      })),
    };
    overrides = {};
  }

  const donors = withRatios.donors || [];
  if (donors.length > 0) {
    return recomputeSettlementFromDonors(withRatios, donors);
  }

  const positions = withRatios.memberPositionsAtSettlement || {};
  const membersInput: Member[] = (withRatios.members || []).map((m) => ({
    id: m.memberId,
    name: m.name,
    realName: m.realName || "",
    operating: m.operating,
    account: m.account,
    toon: m.toon,
    contribution: 0,
  }));
  const body = computeSettlement(
    membersInput,
    accountRatio,
    toonRatio,
    feeRate,
    Object.keys(overrides).length > 0 ? overrides : undefined,
    positions,
    { vatIncluded: withRatios.vatIncluded, vatRate: withRatios.vatRate }
  );
  const prevById = new Map((withRatios.members || []).map((m) => [m.memberId, m]));
  const members = body.members.map((m) => {
    const prev = prevById.get(m.memberId);
    if (!prev) return m;
    return {
      ...m,
      bankName: prev.bankName || m.bankName,
      bankAccount: prev.bankAccount || m.bankAccount,
      accountHolder: prev.accountHolder || m.accountHolder,
      ...(typeof prev.taxInvoiceIssued === "boolean"
        ? { taxInvoiceIssued: prev.taxInvoiceIssued }
        : {}),
    };
  });
  return {
    ...withRatios,
    ...body,
    members,
    memberPositionsAtSettlement: positions,
  };
}

export function updateSettlementRecordAndRecompute(
  records: SettlementRecord[],
  recordId: string,
  patch: SettlementRecomputePatch
): SettlementRecord[] {
  return (records || []).map((r) =>
    r.id === recordId ? recomputeSettlementRecord(r, patch) : r
  );
}

/** @deprecated updateSettlementRecordAndRecompute 사용 */
export function updateSettlementRecordOptions(
  records: SettlementRecord[],
  recordId: string,
  patch: Pick<
    SettlementRecord,
    "omitTreasuryFromSettlement" | "includeTreasuryInFullStatement" | "taxInvoiceIssued" | "taxInvoiceVatRate"
  >
): SettlementRecord[] {
  return updateSettlementRecordAndRecompute(records, recordId, patch);
}

/** records 배열에서 해당 정산의 donors 를 교체·재계산 */
export function updateSettlementRecordDonors(
  records: SettlementRecord[],
  recordId: string,
  donors: Donor[]
): SettlementRecord[] {
  return (records || []).map((r) => {
    if (r.id !== recordId) return r;
    return recomputeSettlementFromDonors(r, donors);
  });
}

export async function deleteSettlementRecordAndSync(recordId: string, reason = "manual", userId?: string | null): Promise<{ ok: boolean; deleted?: SettlementRecord }> {
  const deleteLogs = await loadSettlementDeleteLogsPreferApi(userId);
  const local = applySettlementDeleteTombstones(loadSettlementRecords(userId), deleteLogs);
  const target = local.find((r) => r.id === recordId);
  if (!target) return { ok: false };
  const next = local.filter((r) => r.id !== recordId);
  saveSettlementRecords(next, userId);
  const log = appendSettlementDeleteLog(target, reason, userId);
  const nextLogs = mergeSettlementDeleteLogs(deleteLogs, [log]);
  saveSettlementDeleteLogs(nextLogs, userId);
  await saveSettlementDeleteLogsToApi(nextLogs, userId);
  const ok = await saveSettlementRecordsToApi(next, userId, { replace: true });
  return { ok, deleted: target };
}

export function toSettlementFormulaLine(record: SettlementRecord, m: SettlementMemberResult): string {
  const stmt = computeMemberPaymentStatement(record, m);
  const taxInvoiceIssued = resolveMemberTaxInvoiceIssued(record, m);
  const accSrc = formatManThousand(stmt.accountGross);
  const toonSrc = formatManThousand(stmt.toonGross);
  if (settlementRowIsOperating(m, record.memberPositionsAtSettlement)) {
    return `${m.name} 운영비 예외: 계좌${accSrc} + 투네${toonSrc} = ${stmt.pretaxTotal.toLocaleString()} (원천세 미적용)`;
  }
  const accRatio = Number(stmt.accountRatio.toFixed(3));
  const toonRatio = Number(stmt.toonRatio.toFixed(3));
  return `${m.name} 계좌${accSrc}-공제→${stmt.accountNet.toLocaleString()}x${accRatio}=${stmt.accountStreamerShare.toLocaleString()} 투네${toonSrc}-공제→${stmt.toonNet.toLocaleString()}x${toonRatio}=${stmt.toonStreamerShare.toLocaleString()} A+B=${stmt.pretaxTotal.toLocaleString()}-원천세${stmt.withholding.toLocaleString()}=${stmt.payout.toLocaleString()}${
    taxInvoiceIssued && stmt.outputVat > 0
      ? `+부가세${stmt.outputVat.toLocaleString()}=${stmt.finalPayout.toLocaleString()}`
      : ""
  }`;
}

/** 지급정산서 공식으로 반영·세금·최종액을 맞춘 멤버 행 */
export function applyPaymentStatementAmounts(
  record: SettlementRecord,
  m: SettlementMemberResult
): SettlementMemberResult {
  const stmt = computeMemberPaymentStatement(record, m);
  const taxInvoiceIssued = resolveMemberTaxInvoiceIssued(record, m);
  return {
    ...m,
    accountApplied: stmt.accountStreamerShare,
    toonApplied: stmt.toonStreamerShare,
    gross: stmt.pretaxTotal,
    fee: stmt.withholding,
    net: taxInvoiceIssued ? stmt.finalPayout : stmt.payout,
  };
}

/** 정산 export/표시용 멤버 순서: 정산금액(net) 내림차순, 운영비는 맨 아래 — 금액은 지급정산서와 동일 */
export function getMembersForExport(record: SettlementRecord): SettlementMemberResult[] {
  const members = (record.members || []).map((m) => applyPaymentStatementAmounts(record, m));
  const pos = record.memberPositionsAtSettlement;
  const scoped = record.omitTreasuryFromSettlement
    ? members.filter((m) => !isTreasurySettlementMember(m, pos))
    : members;
  const operating = scoped.filter((m) => settlementRowIsOperating(m, pos));
  const nonOperating = scoped.filter((m) => !settlementRowIsOperating(m, pos));
  const sortByNet = (a: SettlementMemberResult, b: SettlementMemberResult) => (b.net || 0) - (a.net || 0);
  return [...nonOperating.sort(sortByNet), ...operating.sort(sortByNet)];
}

/** omitTreasury 시 정산에서 제외된 국고 멤버(참고용) */
export function getTreasuryMembersForExport(record: SettlementRecord): SettlementMemberResult[] {
  if (!record.omitTreasuryFromSettlement) return [];
  const pos = record.memberPositionsAtSettlement;
  return (record.members || [])
    .map((m) => applyPaymentStatementAmounts(record, m))
    .filter((m) => isTreasurySettlementMember(m, pos))
    .sort((a, b) => (b.net || 0) - (a.net || 0));
}

/** 화면·합계용: 멤버 금액을 지급정산서 기준으로 맞춘 레코드 뷰 */
export function toPaymentAlignedSettlement(record: SettlementRecord): SettlementRecord {
  const members = getMembersForExport(record);
  return {
    ...record,
    members,
    totalGross: members.reduce((s, m) => s + m.gross, 0),
    totalFee: members.reduce((s, m) => s + m.fee, 0),
    totalNet: members.reduce((s, m) => s + m.net, 0),
  };
}

export function recordToCsv(record: SettlementRecord): string {
  const summaryHeader = ["요약", "닉네임", "실명", "최종정산"].join(",");
  const summaryRows = getMembersForExport(record).map((m) => {
    const cells = ["최종 정산", m.name, m.realName || "", String(m.net)];
    return cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
  });
  const header = [
    "생성시각",
    "정산제목",
    "닉네임",
    "실명",
    "은행",
    "계좌번호",
    "예금주",
    "계좌원금",
    "투네원금",
    "계좌반영",
    "투네반영",
    "중간합",
    "세금",
    "최종정산",
    "계산식",
  ].join(",");
  const rows = getMembersForExport(record).map((m) => {
    const cells = [
      new Date(record.createdAt).toISOString(),
      record.title,
      m.name,
      m.realName || "",
      m.bankName || "",
      m.bankAccount || "",
      m.accountHolder || "",
      String(m.account),
      String(m.toon),
      String(m.accountApplied),
      String(m.toonApplied),
      String(m.gross),
      String(m.fee),
      String(m.net),
      toSettlementFormulaLine(record, m),
    ];
    return cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",");
  });
  return `\uFEFF${[summaryHeader, ...summaryRows, "", header, ...rows].join("\r\n")}`;
}

export function recordToTxt(record: SettlementRecord): string {
  const base = recordToReadableTxt(record);
  const createdAt = `생성시각: ${new Date(record.createdAt).toLocaleString()}`;
  const inserted = base.replace(/(\[정산\] .+)\n\n/, `$1\n${createdAt}\n\n`);
  return inserted;
}

export type ReadableSettlementSource = {
  label: string;
  rawAmount: number;
  shareRate: number;
  /** 부가세 포함 원금 → 공급가 환산 후 배분 기준액 */
  baseAmount?: number;
};

export type ReadableSettlementMember = {
  name: string;
  realName?: string;
  rawAmount?: number;
  shareRate?: number;
  taxRate?: number;
  sources?: ReadableSettlementSource[];
};

export type ReadableSettlementInput = {
  title: string;
  defaultTaxRate?: number;
  vatIncluded?: boolean;
  vatRate?: number;
  members: ReadableSettlementMember[];
};

function fmtWon(n: number): string {
  return `${Math.max(0, Math.round(n)).toLocaleString("ko-KR")}원`;
}

function fmtPct(r: number): string {
  const v = Math.round(Math.max(0, r) * 1000) / 10;
  return `${v}%`;
}

/**
 * SettlementRecord를 ReadableSettlementInput으로 변환.
 * rawAmount(원금), shareRate(배분율), taxRate(세율)을 명시적으로 구분.
 */
export function recordToReadableInput(record: SettlementRecord): ReadableSettlementInput {
  const taxRate = record.feeRate ?? 0.033;
  const pos = record.memberPositionsAtSettlement;
  const vatIncluded = Boolean(record.vatIncluded);
  const vatRate = record.vatRate ?? 0.1;
  const members: ReadableSettlementMember[] = getMembersForExport(record).map((m) => {
    if (settlementRowIsOperating(m, pos)) {
      return {
        name: `${m.name}${m.realName ? ` (${m.realName})` : ""}`,
        sources: [
          { label: "계좌", rawAmount: m.account, shareRate: 1 },
          { label: "투네", rawAmount: m.toon, shareRate: 1 },
        ],
        taxRate: 0,
      };
    }
    const accountRaw = typeof m.accountSource === "number" ? m.accountSource : m.account;
    const toonRaw = typeof m.toonSource === "number" ? m.toonSource : m.toon;
    return {
      name: `${m.name}${m.realName ? ` (${m.realName})` : ""}`,
      sources: [
        {
          label: vatIncluded && accountRaw !== m.account ? "계좌(부가세포함→공급가)" : "계좌",
          rawAmount: vatIncluded && accountRaw !== m.account ? accountRaw : m.account,
          shareRate: m.accountRatio,
          ...(vatIncluded && accountRaw !== m.account ? { baseAmount: m.account } : {}),
        },
        {
          label: vatIncluded && toonRaw !== m.toon ? "투네(부가세포함→공급가)" : "투네",
          rawAmount: vatIncluded && toonRaw !== m.toon ? toonRaw : m.toon,
          shareRate: m.toonRatio,
          ...(vatIncluded && toonRaw !== m.toon ? { baseAmount: m.toon } : {}),
        },
      ],
      taxRate,
    };
  });
  return { title: record.title, defaultTaxRate: taxRate, vatIncluded, vatRate, members };
}

/**
 * 구조화된 정산 텍스트 생성. 카카오톡 복사 시 줄바꿈 유지.
 * [1. 전체 요약] → [2. 개인별 상세 계산식] → [3. 총합 및 세금]
 */
export function generateReadableSettlement(data: ReadableSettlementInput): string {
  const title = data.title || "정산";
  const members = Array.isArray(data.members) ? data.members : [];
  const defaultTaxRate = typeof data.defaultTaxRate === "number" ? data.defaultTaxRate : 0.033;

  const blocks: string[] = [];
  const summary: { name: string; net: number }[] = [];
  let sumApplied = 0;
  let sumTax = 0;
  let sumNet = 0;

  for (const m of members) {
    const taxRate = typeof m.taxRate === "number" ? m.taxRate : defaultTaxRate;
    const sources: ReadableSettlementSource[] =
      Array.isArray(m.sources) && m.sources.length > 0
        ? m.sources
        : typeof m.rawAmount === "number" && typeof m.shareRate === "number"
          ? [{ label: "원금", rawAmount: m.rawAmount, shareRate: m.shareRate }]
          : [];

    const lines: string[] = [];
    let applied = 0;

    for (const s of sources) {
      const raw = Math.max(0, s.rawAmount || 0);
      const rate = Math.max(0, Math.min(1, s.shareRate || 0));
      const base = typeof s.baseAmount === "number" ? Math.max(0, s.baseAmount) : raw;
      const ap = Math.round(base * rate);
      applied += ap;
      if (typeof s.baseAmount === "number" && s.baseAmount !== raw) {
        lines.push(
          `${s.label}: ${fmtWon(raw)} → 공급가 ${fmtWon(base)} × ${fmtPct(rate)}(수익배분) ➔ ${fmtWon(ap)}`
        );
      } else {
        lines.push(`${s.label}: ${fmtWon(raw)} × ${fmtPct(rate)}(수익배분) ➔ ${fmtWon(ap)}`);
      }
    }

    const tax = Math.round(applied * Math.max(0, taxRate || 0));
    const net = Math.max(0, applied - tax);
    lines.push(`${fmtWon(applied)} - 세금 ${fmtWon(tax)}(${fmtPct(Math.max(0, taxRate || 0))}) = 최종 ${fmtWon(net)}`);

    blocks.push(`┌ ${m.name}\n${lines.map((l) => `│ ${l}`).join("\n")}\n└`);
    summary.push({ name: m.name, net });
    sumApplied += applied;
    sumTax += tax;
    sumNet += net;
  }

  const out = [
    `[정산] ${title}`,
    ...(data.vatIncluded
      ? [`※ 원금은 부가세 포함 금액 → 공급가(÷${1 + (data.vatRate ?? 0.1)}) 기준으로 수익배분`, ""]
      : []),
    "━━━ 1. 전체 요약 ━━━",
    ...summary.map((s) => `  • ${s.name}: ${fmtWon(s.net)}`),
    "",
    "━━━ 2. 개인별 상세 계산식 ━━━",
    ...blocks,
    "",
    "━━━ 3. 총합 및 세금 ━━━",
    `  수익배분 합계: ${fmtWon(sumApplied)}`,
    `  세금 합계: -${fmtWon(sumTax)}`,
    `  최종 정산 합계: ${fmtWon(sumNet)}`,
  ].join("\n");

  return `\uFEFF${out}`;
}

/** SettlementRecord → 구조화된 읽기 쉬운 텍스트 (카카오톡 복사용) */
export function recordToReadableTxt(record: SettlementRecord): string {
  return generateReadableSettlement(recordToReadableInput(record));
}
