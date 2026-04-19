import { formatManThousand } from "@/lib/state";
import { computeSettlement, type SigMatchRankingItem } from "@/lib/settlement-utils";
import type {
  Donor,
  Member,
  SettlementDeleteLog,
  SettlementMemberRatioOverrides,
  SettlementMemberResult,
  SettlementRecord,
} from "@/types";

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
export { computeSettlement };

function pruneOlderThan3Years(records: SettlementRecord[]): SettlementRecord[] {
  const now = Date.now();
  const threeYearsMs = 365 * 3 * 24 * 60 * 60 * 1000;
  const minAt = now - threeYearsMs;
  return records.filter((r) => (r.createdAt || 0) >= minAt);
}

function sortLatest(records: SettlementRecord[]): SettlementRecord[] {
  return [...records].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function normalizeOperatingMember(m: SettlementMemberResult): SettlementMemberResult {
  const isOperating = /운영비/i.test(m.name || "");
  if (!isOperating) return m;
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
  const members = (record.members || []).map(normalizeOperatingMember);
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

/** 서버를 source of truth로 병합. remote에 없는 로컬 기록은 다른 디바이스에서 삭제된 것으로 간주하고 제외. 단, 최근 30초 이내 생성된 로컬 전용 기록은 저장 중일 수 있으므로 보존. */
function mergeSettlementRecords(local: SettlementRecord[], remote: SettlementRecord[]): SettlementRecord[] {
  const remoteIds = new Set((remote || []).map((r) => r.id));
  const byId = new Map<string, SettlementRecord>();
  for (const r of remote || []) byId.set(r.id, r);
  const now = Date.now();
  const pendingThreshold = 30_000;
  for (const r of local || []) {
    if (remoteIds.has(r.id)) continue;
    if ((r.createdAt || 0) > now - pendingThreshold) byId.set(r.id, r);
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
  userId?: string | null
): SettlementRecord {
  const body = computeSettlement(members, accountRatio, toonRatio, feeRate, memberRatioOverrides);
  const rec: SettlementRecord = {
    id: `st_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: title.trim() || "정산",
    createdAt: Date.now(),
    ...body,
    ...(donors && donors.length > 0 ? { donors } : {}),
  };
  const prev = loadSettlementRecords(userId);
  saveSettlementRecords([rec, ...prev], userId);
  return rec;
}

export async function loadSettlementRecordsFromApi(userId?: string | null): Promise<SettlementRecord[] | null> {
  if (typeof window === "undefined") return null;
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

export async function saveSettlementRecordsToApi(records: SettlementRecord[], userId?: string | null): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const normalized = normalizeSettlementRecords(records);
    const q = new URLSearchParams();
    if (userId) q.set("user", userId);
    const url = q.toString() ? `/api/settlements?${q.toString()}` : "/api/settlements";
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalized),
      credentials: "include",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadSettlementRecordsPreferApi(userId?: string | null): Promise<SettlementRecord[]> {
  let local = loadSettlementRecords(userId);
  const fromApi = await loadSettlementRecordsFromApi(userId);
  if (fromApi) {
    // 서버가 빈 배열을 반환해도 로컬에 기록이 있으면 보존 (서버 재시작 시)
    const merged = fromApi.length === 0 && local.length > 0
      ? local
      : mergeSettlementRecords(local, fromApi);
    saveSettlementRecords(merged, userId);
    if (merged.length !== fromApi.length || (fromApi.length === 0 && merged.length > 0)) {
      saveSettlementRecordsToApi(merged, userId).catch(() => {});
    }
    return merged;
  }
  if (local.length === 0 && userId) {
    local = loadSettlementRecords(null);
    if (local.length > 0) {
      saveSettlementRecords(local, userId);
      saveSettlementRecordsToApi(local, userId).catch(() => {});
      return local;
    }
  }
  return local;
}

export async function appendSettlementRecordAndSync(
  title: string,
  members: Member[],
  accountRatio: number,
  toonRatio: number,
  feeRate = 0.033,
  memberRatioOverrides?: SettlementMemberRatioOverrides,
  donors?: Donor[],
  userId?: string | null
): Promise<SettlementRecord> {
  const rec = appendSettlementRecord(title, members, accountRatio, toonRatio, feeRate, memberRatioOverrides, donors, userId);
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

export async function deleteSettlementRecordAndSync(recordId: string, reason = "manual", userId?: string | null): Promise<{ ok: boolean; deleted?: SettlementRecord }> {
  const local = loadSettlementRecords(userId);
  const target = local.find((r) => r.id === recordId);
  if (!target) return { ok: false };
  const next = local.filter((r) => r.id !== recordId);
  saveSettlementRecords(next, userId);
  appendSettlementDeleteLog(target, reason, userId);
  const ok = await saveSettlementRecordsToApi(next, userId);
  return { ok, deleted: target };
}

export function toSettlementFormulaLine(record: SettlementRecord, m: SettlementMemberResult): string {
  const accSrc = formatManThousand(m.account);
  const toonSrc = formatManThousand(m.toon);
  const isOperating = /운영비/i.test(m.name || "");
  if (isOperating) {
    return `${m.name} 운영비 예외: 계좌${accSrc} + 투네${toonSrc} = ${m.gross.toLocaleString()} (비율/세금 미적용)`;
  }
  const accRatio = Number((m.accountRatio ?? record.accountRatio).toFixed(3));
  const toonRatio = Number((m.toonRatio ?? record.toonRatio).toFixed(3));
  return `${m.name} 계좌${accSrc}x${accRatio}=${m.accountApplied.toLocaleString()} 투네${toonSrc}x${toonRatio}=${m.toonApplied.toLocaleString()} /=${m.gross.toLocaleString()}-${m.fee.toLocaleString()}=${m.net.toLocaleString()}`;
}

/** 정산 export/표시용 멤버 순서: 정산금액(net) 내림차순, 운영비는 맨 아래 */
export function getMembersForExport(record: SettlementRecord): SettlementMemberResult[] {
  const members = record.members || [];
  const operating = members.filter((m) => /운영비/i.test(m.name || ""));
  const nonOperating = members.filter((m) => !/운영비/i.test(m.name || ""));
  const sortByNet = (a: SettlementMemberResult, b: SettlementMemberResult) => (b.net || 0) - (a.net || 0);
  return [...nonOperating.sort(sortByNet), ...operating.sort(sortByNet)];
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
  const members: ReadableSettlementMember[] = getMembersForExport(record).map((m) => {
    const isOperating = /운영비/i.test(m.name || "");
    if (isOperating) {
      return {
        name: `${m.name}${m.realName ? ` (${m.realName})` : ""}`,
        sources: [
          { label: "계좌", rawAmount: m.account, shareRate: 1 },
          { label: "투네", rawAmount: m.toon, shareRate: 1 },
        ],
        taxRate: 0,
      };
    }
    return {
      name: `${m.name}${m.realName ? ` (${m.realName})` : ""}`,
      sources: [
        { label: "계좌", rawAmount: m.account, shareRate: m.accountRatio },
        { label: "투네", rawAmount: m.toon, shareRate: m.toonRatio },
      ],
      taxRate,
    };
  });
  return { title: record.title, defaultTaxRate: taxRate, members };
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
      const ap = Math.round(raw * rate);
      applied += ap;
      lines.push(`${s.label}: ${fmtWon(raw)} × ${fmtPct(rate)}(수익배분) ➔ ${fmtWon(ap)}`);
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
    "",
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
