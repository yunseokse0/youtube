import * as XLSX from "xlsx";
import type { Donor, DonorTarget, SettlementRecord } from "@/types";
import {
  repairDonorTimestamps,
  type RepairDonorTimestampsOptions,
} from "@/lib/donation/repair-donor-timestamps";
import { getMembersForExport } from "@/lib/settlement";
import { formatKstDateTime, parseKstLocalTimestampToMs } from "@/lib/state";

export { buildDailyLogMinAtByDonorId } from "@/lib/donation/repair-donor-timestamps";

export type DailyLogEntry = {
  at: string;
  total: number;
  members: unknown[];
  donors: Donor[];
};

export type MemberDonorAggregateRow = {
  memberId: string;
  memberName: string;
  memberRealName: string;
  donorName: string;
  totalAmount: number;
  count: number;
  accountAmount: number;
  toonAmount: number;
};

function donorTargetLabel(target?: DonorTarget): string {
  return target === "toon" ? "투네" : "계좌";
}

function donorTargetField(target?: DonorTarget): "account" | "toon" {
  return target === "toon" ? "toon" : "account";
}

function normalizeSettlementDonorName(raw: string): string {
  return (raw || "무명").trim() || "무명";
}

/**
 * 이번 정산(자키 생일 정산 등 특정 건)에만 임시 적용하는 후원자명 alias.
 * 전체 정산에 영구 적용하지 않고 특정 제목 키워드가 감지될 때만 치환.
 * 추후 다른 정산에 적용하려면 아래 조건(title 키워드)만 수정하면 됨.
 */
function applyTemporarySettlementDonorAlias(
  record: SettlementRecord | null | undefined,
  donorName: string
): string {
  const name = normalizeSettlementDonorName(donorName);
  if (!record) return name;
  const title = String(record.title || "").toLowerCase();
  /** 임시 적용 대상: 정산 제목에 "자키" 또는 "생일" 키워드 포함 시 */
  const isThisSettlement = title.includes("자키") || title.includes("생일");
  if (!isThisSettlement) return name;
  if (name === "옆에분" || name === "하정") return "요하정";
  return name;
}

function csvEscape(v: string | number): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

/** 엑셀/CSV용 시각 — **한국 시각(KST) 고정**, Z(UTC 표시) 없음, EC2 TZ=UTC 에서도 KST 출력 보장 */
export function formatExportDateTime(at: number | string | Date): string {
  return formatKstDateTime(at);
}

function memberMaps(record: SettlementRecord) {
  const nameById = new Map<string, string>();
  const realById = new Map<string, string>();
  for (const m of record.members || []) {
    nameById.set(m.memberId, m.name || m.memberId);
    realById.set(m.memberId, m.realName || "");
  }
  return { nameById, realById };
}

function donorAtEpochMs(donor: { at?: number | string }): number {
  const raw = donor.at;
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.floor(raw);
  if (Number.isFinite(Number(raw)) && Number(raw) > 1_000_000_000_000) return Math.floor(Number(raw));
  const parsedIso = Date.parse(String(raw || ""));
  if (Number.isFinite(parsedIso) && parsedIso > 1_000_000_000_000) return parsedIso;
  const parsedKst = parseKstLocalTimestampToMs(raw);
  return Number.isFinite(parsedKst) && parsedKst > 1_000_000_000_000 ? parsedKst : 0;
}

export type RepairSettlementDonorTimestampsOptions = RepairDonorTimestampsOptions;

/** 정산 스냅샷·일괄 반영으로 틀어진 후원 시각 — id·daily log·후원자 리스트 복구 */
export function repairSettlementDonorTimestamps(
  donors: Donor[],
  opts?: RepairSettlementDonorTimestampsOptions
): Donor[] {
  return repairDonorTimestamps(donors, opts);
}

/** 엑셀/CSV 내보내기 직전 — 최신 daily log·후원 목록으로 시각 재보정 */
export function donorsForSettlementExport(
  record: SettlementRecord,
  donors: Donor[],
  dailyLog?: Record<string, DailyLogEntry[]>,
  referenceDonors?: Donor[]
): Donor[] {
  const repaired = repairSettlementDonorTimestamps(donors, {
    dailyLog,
    referenceDonors,
    settlementCreatedAt: record.createdAt,
  });
  return repaired.map((d) => ({
    ...d,
    name: applyTemporarySettlementDonorAlias(record, d.name || "무명"),
  }));
}

/** 정산 시점 후원 스냅샷 기준 · 없으면 해당 날짜 daily log에서 복원 */
export function resolveSettlementDonors(
  record: SettlementRecord,
  dailyLog?: Record<string, DailyLogEntry[]>,
  referenceDonors?: Donor[]
): Donor[] {
  const fromRecord = record.donors && record.donors.length > 0 ? record.donors : [];
  let donors: Donor[];
  if (fromRecord.length > 0) {
    donors = fromRecord;
  } else if (!dailyLog) {
    donors = [];
  } else {
    const ymd = new Date(record.createdAt).toISOString().slice(0, 10);
    const entries = dailyLog[ymd] || [];
    if (entries.length === 0) {
      donors = [];
    } else {
      const recAt = record.createdAt;
      const beforeOrAt = entries
        .filter((e) => new Date(e.at).getTime() <= recAt)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      const best = beforeOrAt[0] ?? entries[entries.length - 1];
      donors = best?.donors || [];
    }
  }
  return repairSettlementDonorTimestamps(donors, {
    dailyLog,
    referenceDonors,
    settlementCreatedAt: record.createdAt,
  });
}

/**
 * 편집용 후원 목록. 스냅샷·일일로그가 비어 있으면 멤버 원금으로 시드해
 * 재계산 시 다른 멤버 금액이 0으로 날아가지 않게 한다.
 */
export function seedSettlementDonorsForEdit(
  record: SettlementRecord,
  dailyLog?: Record<string, DailyLogEntry[]>,
  referenceDonors?: Donor[]
): Donor[] {
  const existing = resolveSettlementDonors(record, dailyLog, referenceDonors);
  const messageById = new Map<string, string>();
  for (const d of referenceDonors || []) {
    const id = String(d.id || "").trim();
    const msg = String(d.message || "").trim();
    if (id && msg) messageById.set(id, msg);
  }
  if (dailyLog) {
    for (const entries of Object.values(dailyLog)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        for (const d of entry.donors || []) {
          const id = String(d.id || "").trim();
          const msg = String(d.message || "").trim();
          if (id && msg && !messageById.has(id)) messageById.set(id, msg);
        }
      }
    }
  }
  if (existing.length > 0) {
    return existing.map((d) => {
      const id = String(d.id || "").trim() || `d_seed_${d.memberId}_${d.at}`;
      const message = String(d.message || "").trim() || messageById.get(id) || "";
      return {
        ...d,
        id,
        name: String(d.name || "무명").replace(/\s+/g, "") || "무명",
        amount: Math.max(0, Math.round(Number(d.amount) || 0)),
        memberId: String(d.memberId || "").trim(),
        at:
          typeof d.at === "number" && Number.isFinite(d.at)
            ? d.at
            : record.createdAt,
        target: d.target === "toon" ? "toon" : "account",
        ...(message ? { message } : {}),
      };
    });
  }
  const out: Donor[] = [];
  for (const m of record.members || []) {
    const account = Math.max(
      0,
      Math.round(Number(typeof m.accountSource === "number" ? m.accountSource : m.account) || 0)
    );
    const toon = Math.max(
      0,
      Math.round(Number(typeof m.toonSource === "number" ? m.toonSource : m.toon) || 0)
    );
    if (account > 0) {
      out.push({
        id: `seed_acc_${m.memberId}`,
        name: "(정산원금)",
        amount: account,
        memberId: m.memberId,
        at: record.createdAt,
        target: "account",
      });
    }
    if (toon > 0) {
      out.push({
        id: `seed_toon_${m.memberId}`,
        name: "(정산원금)",
        amount: toon,
        memberId: m.memberId,
        at: record.createdAt,
        target: "toon",
      });
    }
  }
  return out;
}

export function aggregateMemberDonors(
  record: SettlementRecord,
  donors: Donor[]
): MemberDonorAggregateRow[] {
  const { nameById, realById } = memberMaps(record);
  const agg = new Map<string, MemberDonorAggregateRow>();
  for (const d of donors) {
    const donorName = applyTemporarySettlementDonorAlias(record, d.name || "무명");
    const key = `${d.memberId}\0${donorName}`;
    const prev =
      agg.get(key) ||
      ({
        memberId: d.memberId,
        memberName: nameById.get(d.memberId) || d.memberId,
        memberRealName: realById.get(d.memberId) || "",
        donorName,
        totalAmount: 0,
        count: 0,
        accountAmount: 0,
        toonAmount: 0,
      } satisfies MemberDonorAggregateRow);
    const amount = Math.max(0, Number(d.amount) || 0);
    prev.totalAmount += amount;
    prev.count += 1;
    if (donorTargetField(d.target) === "toon") prev.toonAmount += amount;
    else prev.accountAmount += amount;
    agg.set(key, prev);
  }
  return [...agg.values()].sort((a, b) => {
    const byMember = a.memberName.localeCompare(b.memberName, "ko");
    if (byMember !== 0) return byMember;
    return b.totalAmount - a.totalAmount;
  });
}

export function recordToMemberDonorsCsv(record: SettlementRecord, donors: Donor[]): string {
  const { nameById, realById } = memberMaps(record);
  const createdAt = formatExportDateTime(record.createdAt);
  const detailHeader = ["정산제목", "정산시각", "멤버", "멤버실명", "후원자", "금액", "채널", "후원시각", "메시지"].join(",");
  const detailRows = [...donors]
    .sort((a, b) => {
      const ma = nameById.get(a.memberId) || a.memberId;
      const mb = nameById.get(b.memberId) || b.memberId;
      if (ma !== mb) return ma.localeCompare(mb, "ko");
      return b.at - a.at;
    })
    .map((d) =>
      [
        record.title,
        createdAt,
        nameById.get(d.memberId) || d.memberId,
        realById.get(d.memberId) || "",
        (d.name || "무명").trim() || "무명",
        String(Math.max(0, Number(d.amount) || 0)),
        donorTargetLabel(d.target),
        formatExportDateTime(d.at),
        String(d.message || "").trim(),
      ]
        .map(csvEscape)
        .join(",")
    );

  const summaryHeader = ["멤버", "멤버실명", "후원자", "합계금액", "후원횟수", "계좌합", "투네합"].join(",");
  const summaryRows = aggregateMemberDonors(record, donors).map((row) =>
    [
      row.memberName,
      row.memberRealName,
      row.donorName,
      String(row.totalAmount),
      String(row.count),
      String(row.accountAmount),
      String(row.toonAmount),
    ]
      .map(csvEscape)
      .join(",")
  );

  return `\uFEFF${[
    "=== 후원 내역(건별) ===",
    detailHeader,
    ...detailRows,
    "",
    "=== 멤버별·후원자별 합계 ===",
    summaryHeader,
    ...summaryRows,
  ].join("\r\n")}`;
}

function sanitizeSheetName(raw: string, used: Set<string>): string {
  let base = (raw || "멤버").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "멤버";
  let name = base;
  let n = 2;
  while (used.has(name)) {
    const suffix = `(${n})`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(name);
  return name;
}

export function recordToMemberDonorsXlsxBlob(record: SettlementRecord, donors: Donor[]): Blob {
  const { nameById, realById } = memberMaps(record);
  const wb = XLSX.utils.book_new();
  const createdAt = formatExportDateTime(record.createdAt);

  const detailAoA: (string | number)[][] = [
    ["정산제목", "정산시각", "멤버", "멤버실명", "후원자", "금액", "채널", "후원시각", "메시지"],
    ...[...donors]
      .sort((a, b) => {
        const ma = nameById.get(a.memberId) || a.memberId;
        const mb = nameById.get(b.memberId) || b.memberId;
        if (ma !== mb) return ma.localeCompare(mb, "ko");
        return b.at - a.at;
      })
      .map((d) => [
        record.title,
        createdAt,
        nameById.get(d.memberId) || d.memberId,
        realById.get(d.memberId) || "",
        (d.name || "무명").trim() || "무명",
        Math.max(0, Number(d.amount) || 0),
        donorTargetLabel(d.target),
        formatExportDateTime(d.at),
        String(d.message || "").trim(),
      ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailAoA), "건별내역");

  const summaryAoA: (string | number)[][] = [
    ["멤버", "멤버실명", "후원자", "합계금액", "후원횟수", "계좌합", "투네합"],
    ...aggregateMemberDonors(record, donors).map((row) => [
      row.memberName,
      row.memberRealName,
      row.donorName,
      row.totalAmount,
      row.count,
      row.accountAmount,
      row.toonAmount,
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoA), "멤버별후원자합계");

  const usedSheetNames = new Set<string>(["건별내역", "멤버별후원자합계"]);
  for (const m of getMembersForExport(record)) {
    const memberDonors = donors.filter((d) => d.memberId === m.memberId);
    if (memberDonors.length === 0) continue;
    const byDonor = aggregateMemberDonors(record, memberDonors);
    const sheetAoA: (string | number)[][] = [
      ["후원자", "합계금액", "후원횟수", "계좌합", "투네합"],
      ...byDonor.map((row) => [
        row.donorName,
        row.totalAmount,
        row.count,
        row.accountAmount,
        row.toonAmount,
      ]),
      [],
      ["후원자", "금액", "채널", "후원시각", "메시지"],
      ...memberDonors
        .sort((a, b) => b.at - a.at)
        .map((d) => [
          (d.name || "무명").trim() || "무명",
          Math.max(0, Number(d.amount) || 0),
          donorTargetLabel(d.target),
          formatExportDateTime(d.at),
          String(d.message || "").trim(),
        ]),
    ];
    const sheetName = sanitizeSheetName(m.name || m.memberId, usedSheetNames);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetAoA), sheetName);
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
