import * as XLSX from "xlsx";
import type { Donor, DonorTarget, SettlementRecord } from "@/types";
import { getMembersForExport } from "@/lib/settlement";

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

function csvEscape(v: string | number): string {
  return `"${String(v).replace(/"/g, '""')}"`;
}

/** 엑셀/CSV용 시각 — 로컬 시각, Z(UTC 표시) 없음 */
export function formatExportDateTime(at: number | string | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
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

/** 정산 기록에 스냅샷이 없으면 해당 날짜 daily log에서 복원 */
export function resolveSettlementDonors(
  record: SettlementRecord,
  dailyLog?: Record<string, DailyLogEntry[]>
): Donor[] {
  const fromRecord = record.donors && record.donors.length > 0 ? record.donors : [];
  if (fromRecord.length > 0) return fromRecord;
  if (!dailyLog) return [];
  const ymd = new Date(record.createdAt).toISOString().slice(0, 10);
  const entries = dailyLog[ymd] || [];
  if (entries.length === 0) return [];
  const recAt = record.createdAt;
  const beforeOrAt = entries
    .filter((e) => new Date(e.at).getTime() <= recAt)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const best = beforeOrAt[0] ?? entries[entries.length - 1];
  return best?.donors || [];
}

export function aggregateMemberDonors(
  record: SettlementRecord,
  donors: Donor[]
): MemberDonorAggregateRow[] {
  const { nameById, realById } = memberMaps(record);
  const agg = new Map<string, MemberDonorAggregateRow>();
  for (const d of donors) {
    const donorName = (d.name || "무명").trim() || "무명";
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
