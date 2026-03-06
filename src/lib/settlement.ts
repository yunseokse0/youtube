import { Member, Donor, formatManThousand } from "@/lib/state";

export const SETTLEMENT_RECORDS_KEY = "excel-broadcast-settlement-records-v1";
export const SETTLEMENT_DELETE_LOGS_KEY = "excel-broadcast-settlement-delete-logs-v1";

export function settlementRecordsKey(userId?: string | null): string {
  return userId ? `${SETTLEMENT_RECORDS_KEY}:${userId}` : SETTLEMENT_RECORDS_KEY;
}
export function settlementDeleteLogsKey(userId?: string | null): string {
  return userId ? `${SETTLEMENT_DELETE_LOGS_KEY}:${userId}` : SETTLEMENT_DELETE_LOGS_KEY;
}

export type SettlementMemberResult = {
  memberId: string;
  name: string;
  realName?: string;
  bankName?: string;
  bankAccount?: string;
  accountHolder?: string;
  account: number;
  toon: number;
  accountRatio: number;
  toonRatio: number;
  accountApplied: number;
  toonApplied: number;
  gross: number;
  fee: number;
  net: number;
};

export type SettlementRecord = {
  id: string;
  title: string;
  createdAt: number;
  accountRatio: number;
  toonRatio: number;
  feeRate: number; // kept for backward compatibility, used as tax rate
  members: SettlementMemberResult[];
  totalGross: number;
  totalFee: number;
  totalNet: number;
  donors?: Donor[];
};

export type SettlementDeleteLog = {
  recordId: string;
  title: string;
  createdAt: number;
  deletedAt: number;
  totalNet: number;
  reason?: string;
};

export type SettlementMemberRatioOverrides = Record<
  string,
  {
    accountRatio?: number;
    toonRatio?: number;
  }
>;

function toSafeRate(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

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

function mergeSettlementRecords(local: SettlementRecord[], remote: SettlementRecord[]): SettlementRecord[] {
  const byId = new Map<string, SettlementRecord>();
  for (const r of local || []) byId.set(r.id, r);
  for (const r of remote || []) {
    const prev = byId.get(r.id);
    if (!prev) {
      byId.set(r.id, r);
      continue;
    }
    // Prefer the one with newer createdAt if duplicated IDs ever happen.
    byId.set(r.id, (r.createdAt || 0) >= (prev.createdAt || 0) ? r : prev);
  }
  return normalizeSettlementRecords(Array.from(byId.values()));
}

export function computeSettlement(
  members: Member[],
  accountRatioRaw: number,
  toonRatioRaw: number,
  feeRateRaw = 0.033,
  memberRatioOverrides?: SettlementMemberRatioOverrides
): Omit<SettlementRecord, "id" | "title" | "createdAt"> {
  const accountRatio = toSafeRate(accountRatioRaw, 0.7);
  const toonRatio = toSafeRate(toonRatioRaw, 0.6);
  const feeRate = Math.max(0, feeRateRaw || 0);

  const rows: SettlementMemberResult[] = (members || []).map((m) => {
    const account = Math.max(0, m.account || 0);
    const toon = Math.max(0, m.toon || 0);
    const isOperating =
      Boolean(m.operating) ||
      /운영비/i.test(m.name || "") ||
      /운영비/i.test(m.role || "");
    const perMember = memberRatioOverrides?.[m.id];
    const effectiveAccountRatio = toSafeRate(
      isOperating
        ? 1
        : typeof perMember?.accountRatio === "number"
          ? perMember.accountRatio
          : accountRatio,
      accountRatio
    );
    const effectiveToonRatio = toSafeRate(
      isOperating
        ? 1
        : typeof perMember?.toonRatio === "number"
          ? perMember.toonRatio
          : toonRatio,
      toonRatio
    );
    const accountApplied = Math.round(account * effectiveAccountRatio);
    const toonApplied = Math.round(toon * effectiveToonRatio);
    const gross = accountApplied + toonApplied;
    const fee = isOperating ? 0 : Math.round(gross * feeRate);
    const net = Math.max(0, gross - fee);
    return {
      memberId: m.id,
      name: m.name,
      realName: m.realName || "",
      bankName: "",
      bankAccount: "",
      accountHolder: "",
      account,
      toon,
      accountRatio: effectiveAccountRatio,
      toonRatio: effectiveToonRatio,
      accountApplied,
      toonApplied,
      gross,
      fee,
      net,
    };
  });

  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalFee = rows.reduce((s, r) => s + r.fee, 0);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);

  return {
    accountRatio,
    toonRatio,
    feeRate,
    members: rows,
    totalGross,
    totalFee,
    totalNet,
  };
}

export function loadSettlementRecords(userId?: string | null): SettlementRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(settlementRecordsKey(userId));
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
    const raw = window.localStorage.getItem(settlementDeleteLogsKey(userId));
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

export async function loadSettlementRecordsFromApi(): Promise<SettlementRecord[] | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`/api/settlements?_t=${Date.now()}`, { cache: "no-store", credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return normalizeSettlementRecords(data as SettlementRecord[]);
  } catch {
    return null;
  }
}

export async function saveSettlementRecordsToApi(records: SettlementRecord[]): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const normalized = normalizeSettlementRecords(records);
    const res = await fetch("/api/settlements", {
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
  const local = loadSettlementRecords(userId);
  const fromApi = await loadSettlementRecordsFromApi();
  if (fromApi) {
    const merged = mergeSettlementRecords(local, fromApi);
    saveSettlementRecords(merged, userId);
    // Heal stale API snapshots when local has newer/missing records.
    if (merged.length !== fromApi.length) {
      saveSettlementRecordsToApi(merged).catch(() => {});
    }
    return merged;
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
  await saveSettlementRecordsToApi(local);
  return rec;
}

export async function deleteSettlementRecordAndSync(recordId: string, reason = "manual", userId?: string | null): Promise<{ ok: boolean; deleted?: SettlementRecord }> {
  const local = loadSettlementRecords(userId);
  const target = local.find((r) => r.id === recordId);
  if (!target) return { ok: false };
  const next = local.filter((r) => r.id !== recordId);
  saveSettlementRecords(next, userId);
  appendSettlementDeleteLog(target, reason, userId);
  const ok = await saveSettlementRecordsToApi(next);
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
  return `\uFEFF${[header, ...rows].join("\r\n")}`;
}

export function recordToTxt(record: SettlementRecord): string {
  const lines: string[] = [];
  lines.push(`[정산] ${record.title}`);
  lines.push(`생성시각: ${new Date(record.createdAt).toLocaleString()}`);
  lines.push(`비율: 계좌 ${record.accountRatio} / 투네 ${record.toonRatio} / 세금 ${Math.round(record.feeRate * 1000) / 10}%`);
  lines.push("");
  for (const m of getMembersForExport(record)) {
    lines.push(
      `${m.name}${m.realName ? `(${m.realName})` : ""} | 계좌 ${m.accountApplied.toLocaleString()} + 투네 ${m.toonApplied.toLocaleString()} = ${m.gross.toLocaleString()} - 세금 ${m.fee.toLocaleString()} => 정산 ${m.net.toLocaleString()}`
    );
    if (m.bankName || m.bankAccount || m.accountHolder) {
      lines.push(`  계좌정보: ${m.bankName || "-"} / ${m.bankAccount || "-"} / ${m.accountHolder || "-"}`);
    }
    lines.push(`  계산식: ${toSettlementFormulaLine(record, m)}`);
  }
  lines.push("");
  lines.push(`총합: ${record.totalGross.toLocaleString()} / 세금: ${record.totalFee.toLocaleString()} / 정산: ${record.totalNet.toLocaleString()}`);
  return lines.join("\n");
}

