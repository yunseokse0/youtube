import * as XLSX from "xlsx";
import type { Donor, DonorTarget, SettlementRecord } from "@/types";
import {
  repairDonorTimestamps,
  type RepairDonorTimestampsOptions,
} from "@/lib/donation/repair-donor-timestamps";
import { getMembersForExport } from "@/lib/settlement";
import { donorAtEpochMs, formatKstDateTime } from "@/lib/state";
import type { DonorTotalsByNameRow } from "@/lib/donor-rankings-aggregate";

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
      const ms = donorAtEpochMs(d);
      return {
        ...d,
        id,
        name: String(d.name || "무명").replace(/\s+/g, "") || "무명",
        amount: Math.max(0, Math.round(Number(d.amount) || 0)),
        memberId: String(d.memberId || "").trim(),
        at: ms > 0 ? ms : record.createdAt,
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

/**
 * 후원 순위(랭킹) — 후원자별 합계 금액 높은 순 내림차순
 * 스크린샷 UI 기준: 자키 1,333,900원 > 1,106,600원 순 정렬 · 1위부터 순위 부여
 */

function buildPerMemberRanking(record: SettlementRecord, donors: Donor[]) {
  const members = getMembersForExport(record);
  const byMember = aggregateMemberDonors(record, donors);
  const perMember = new Map<string, Array<MemberDonorAggregateRow & { rank: number }>>();
  const memberTotals = new Map<string, number>();
  for (const m of members) {
    const rows = byMember
      .filter((r) => r.memberId === m.memberId)
      .sort((a, b) => b.totalAmount - a.totalAmount || b.count - a.count);
    const ranked = rows.map((r, i) => ({ ...r, rank: i + 1 }));
    perMember.set(m.memberId, ranked);
    memberTotals.set(m.memberId, rows.reduce((s, r) => s + r.totalAmount, 0));
  }
  return { members, perMember, memberTotals };
}

function donorRankingsGlobalSorted(record: SettlementRecord, donors: Donor[]): MemberDonorAggregateRow[] {
  return aggregateMemberDonors(record, donors).sort(
    (a, b) => b.totalAmount - a.totalAmount || b.count - a.count
  );
}

/** 스크린샷 UI 기준: [자키] 후원자 46명 · 총 6,963,404원 형식 CSV */
export function recordToDonorRankingsCsv(record: SettlementRecord, donors: Donor[]): string {
  const { members, perMember, memberTotals } = buildPerMemberRanking(record, donors);
  const lines: string[] = ["\uFEFF=== 후원 순위 (멤버별) ==="];
  for (const m of members) {
    const rows = perMember.get(m.memberId) || [];
    if (rows.length === 0) continue;
    const total = memberTotals.get(m.memberId) || 0;
    lines.push("");
    lines.push(`== [${m.name}] 후원자 ${rows.length}명 · 총 ${total.toLocaleString()}원 ==`);
    lines.push(["순위", "후원자", "합계금액", "후원횟수", "계좌합", "투네합"].join(","));
    for (const row of rows) {
      lines.push(
        [row.rank, row.donorName, row.totalAmount, row.count, row.accountAmount, row.toonAmount]
          .map(csvEscape)
          .join(",")
      );
    }
  }
  lines.push("");
  lines.push("=== 전체 후원 순위 (멤버 통합 · 금액 높은 순) ===");
  const globalList = donorRankingsGlobalSorted(record, donors);
  lines.push(["순위", "멤버", "후원자", "합계금액", "후원횟수", "계좌합", "투네합"].join(","));
  for (let i = 0; i < globalList.length; i++) {
    const row = globalList[i];
    lines.push(
      [i + 1, row.memberName, row.donorName, row.totalAmount, row.count, row.accountAmount, row.toonAmount]
        .map(csvEscape)
        .join(",")
    );
  }
  return lines.join("\r\n");
}

/** 스크린샷 UI 기준 후원 순위 엑셀 — (1) 전체후원순위 (2) 멤버별후원순위 (3~N) 멤버별 개별 시트 */
export function recordToDonorRankingsXlsxBlob(record: SettlementRecord, donors: Donor[]): Blob {
  const { members, perMember, memberTotals } = buildPerMemberRanking(record, donors);
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  const globalRows = donorRankingsGlobalSorted(record, donors);
  const globalAoA: (string | number)[][] = [
    ["순위", "멤버", "후원자", "합계금액", "후원횟수", "계좌합", "투네합"],
    ...globalRows.map((r, i) => [i + 1, r.memberName, r.donorName, r.totalAmount, r.count, r.accountAmount, r.toonAmount]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(globalAoA), "전체후원순위");
  usedSheetNames.add("전체후원순위");

  const perSheetAoA: (string | number)[][] = [
    ["멤버", "멤버실명", "후원자수", "멤버총합", "순위", "후원자", "합계금액", "후원횟수", "계좌합", "투네합"],
  ];
  for (const m of members) {
    const rows = perMember.get(m.memberId) || [];
    if (rows.length === 0) continue;
    const memberTotal = memberTotals.get(m.memberId) || 0;
    for (const r of rows) {
      perSheetAoA.push([
        m.name,
        m.realName || "",
        rows.length,
        memberTotal,
        r.rank,
        r.donorName,
        r.totalAmount,
        r.count,
        r.accountAmount,
        r.toonAmount,
      ]);
    }
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(perSheetAoA), "멤버별후원순위");
  usedSheetNames.add("멤버별후원순위");

  for (const m of members) {
    const rows = perMember.get(m.memberId) || [];
    if (rows.length === 0) continue;
    const memberTotal = memberTotals.get(m.memberId) || 0;
    const sheetAoA: (string | number)[][] = [
      [`${m.name} 후원자 ${rows.length}명 · 총 ${memberTotal.toLocaleString()}원`],
      ["순위", "후원자", "합계금액", "후원횟수", "계좌합", "투네합"],
      ...rows.map((r) => [r.rank, r.donorName, r.totalAmount, r.count, r.accountAmount, r.toonAmount]),
      [],
      ["멤버 실명", m.realName || ""],
    ];
    const sheetName = sanitizeSheetName(`${m.name} 후원순위`, usedSheetNames);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheetAoA), sheetName);
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/**
 * Admin 메인 「후원자별 누적 합계」= 전체 후원 순위 CSV/XLSX 내보내기
 * buildDonorTotalsByNameFromDonors 결과를 그대로 사용 · 순위(rank) 열 포함 + 계좌/투네/총계/건수 컬럼
 */
export function globalDonorTotalsByNameToCsv(rows: DonorTotalsByNameRow[]): string {
  const header = ["순위", "후원자", "계좌 누적", "투네 누적", "총 누적", "건수"].join(",");
  const body = rows
    .filter((r) => r.total > 0 || r.count > 0)
    .map((r, i) =>
      [i + 1, r.name, r.account, r.toon, r.total, r.count]
        .map((v) => csvEscape(String(v)))
        .join(",")
    );
  return `\uFEFF${[header, ...body].join("\r\n")}`;
}

export function globalDonorTotalsByNameToXlsxBlob(rows: DonorTotalsByNameRow[]): Blob {
  const valid = rows.filter((r) => r.total > 0 || r.count > 0);
  const wb = XLSX.utils.book_new();

  const unifiedAoA: (string | number)[][] = [
    ["순위", "후원자", "계좌 누적", "투네 누적", "총 누적", "건수"],
    ...valid.map((r, i) => [i + 1, r.name, r.account, r.toon, r.total, r.count]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(unifiedAoA), "전체후원순위");

  const accountSorted = [...valid].sort((a, b) => b.account - a.account || a.name.localeCompare(b.name, "ko"));
  const accountAoA: (string | number)[][] = [
    ["순위", "후원자", "계좌 누적", "투네 누적", "총 누적", "건수"],
    ...accountSorted.map((r, i) => [i + 1, r.name, r.account, r.toon, r.total, r.count]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(accountAoA), "계좌후원순위");

  const toonSorted = [...valid].sort((a, b) => b.toon - a.toon || a.name.localeCompare(b.name, "ko"));
  const toonAoA: (string | number)[][] = [
    ["순위", "후원자", "계좌 누적", "투네 누적", "총 누적", "건수"],
    ...toonSorted.map((r, i) => [i + 1, r.name, r.account, r.toon, r.total, r.count]),
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(toonAoA), "투네후원순위");

  const summaryAoA: (string | number)[][] = [
    ["통계", "값"],
    ["총 후원자 수", valid.length],
    ["총 계좌 후원 합계", valid.reduce((s, r) => s + r.account, 0)],
    ["총 투네 후원 합계", valid.reduce((s, r) => s + r.toon, 0)],
    ["총 누적 합계", valid.reduce((s, r) => s + r.total, 0)],
    ["총 후원 건수", valid.reduce((s, r) => s + r.count, 0)],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryAoA), "집계요약");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
