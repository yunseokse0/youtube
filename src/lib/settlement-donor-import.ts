import * as XLSX from "xlsx";
import { computeSettlement } from "@/lib/settlement-utils";
import { normalizeSettlementRecords } from "@/lib/settlement";
import type { Donor, DonorTarget, Member, SettlementRecord } from "@/types";

export type ImportDonorExportXlsxOptions = {
  accountRatio?: number;
  toonRatio?: number;
  feeRate?: number;
  /** 멤버 닉네임 → 앱 member.id (있으면 후원·정산 연동에 유리) */
  memberIdByName?: Record<string, string>;
  /** 정산 id 고정(재가져오기 시 id union 병합) */
  recordId?: string;
};

function parseExportDateTime(raw: string): number {
  const s = String(raw || "").trim();
  if (!s) return 0;
  const normalized = s.includes("T") ? s : s.replace(" ", "T");
  const ts = Date.parse(normalized);
  return Number.isFinite(ts) ? ts : 0;
}

function channelToTarget(channel: string): DonorTarget {
  return String(channel || "").includes("투네") ? "toon" : "account";
}

export function importMemberIdFromExportName(
  memberName: string,
  memberIdByName?: Record<string, string>
): string {
  const name = String(memberName || "").trim();
  if (!name) return "imp_unknown";
  const mapped = memberIdByName?.[name];
  if (mapped) return mapped;
  return `imp_${name.replace(/\s+/g, "_")}`;
}

type DetailRow = {
  title: string;
  settlementAt: number;
  memberName: string;
  memberRealName: string;
  donorName: string;
  amount: number;
  target: DonorTarget;
  at: number;
  message: string;
};

function parseDetailRows(aoa: unknown[][]): DetailRow[] {
  if (!Array.isArray(aoa) || aoa.length < 2) return [];
  const out: DetailRow[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const r = aoa[i];
    if (!Array.isArray(r) || r.length < 8) continue;
    const memberName = String(r[2] || "").trim();
    const amount = Math.max(0, Math.round(Number(r[5]) || 0));
    if (!memberName || amount <= 0) continue;
    out.push({
      title: String(r[0] || "").trim() || "복구 정산",
      settlementAt: parseExportDateTime(String(r[1] || "")),
      memberName,
      memberRealName: String(r[3] || "").trim(),
      donorName: String(r[4] || "").trim() || "무명",
      amount,
      target: channelToTarget(String(r[6] || "")),
      at: parseExportDateTime(String(r[7] || "")) || parseExportDateTime(String(r[1] || "")),
      message: String(r[8] || "").trim(),
    });
  }
  return out;
}

/** 멤버별후원자 xlsx(건별내역 시트) → SettlementRecord 1건 */
export function buildSettlementRecordFromDonorExportXlsx(
  data: ArrayBuffer | Uint8Array,
  opts?: ImportDonorExportXlsxOptions
): SettlementRecord | null {
  const wb = XLSX.read(data, { type: "array" });
  const sheetName =
    wb.SheetNames.find((n) => n === "건별내역") ?? wb.SheetNames[0];
  if (!sheetName) return null;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, {
    header: 1,
    defval: "",
  }) as unknown[][];
  const details = parseDetailRows(aoa);
  if (details.length === 0) return null;

  const title = details[0]!.title;
  const createdAt =
    details.reduce((max, d) => Math.max(max, d.settlementAt || 0), 0) || Date.now();

  const memberTotals = new Map<
    string,
    { id: string; name: string; realName: string; account: number; toon: number }
  >();

  for (const row of details) {
    const id = importMemberIdFromExportName(row.memberName, opts?.memberIdByName);
    const prev = memberTotals.get(id) ?? {
      id,
      name: row.memberName,
      realName: row.memberRealName,
      account: 0,
      toon: 0,
    };
    if (row.target === "toon") prev.toon += row.amount;
    else prev.account += row.amount;
    memberTotals.set(id, prev);
  }

  const members: Member[] = [...memberTotals.values()].map((m) => ({
    id: m.id,
    name: m.name,
    realName: m.realName || undefined,
    account: m.account,
    toon: m.toon,
  }));

  const accountRatio = opts?.accountRatio ?? 0.7;
  const toonRatio = opts?.toonRatio ?? 0.6;
  const feeRate = opts?.feeRate ?? 0.033;

  const body = computeSettlement(members, accountRatio, toonRatio, feeRate);

  const donors: Donor[] = details.map((row, idx) => {
    const memberId = importMemberIdFromExportName(row.memberName, opts?.memberIdByName);
    const at = row.at || createdAt;
    return {
      id: `imp_d_${at}_${idx}_${memberId}`,
      name: row.donorName,
      amount: row.amount,
      memberId,
      at,
      target: row.target,
      ...(row.message ? { message: row.message } : {}),
    };
  });

  const stableId =
    opts?.recordId ||
    `st_import_${createdAt}_${title.replace(/\s+/g, "_").slice(0, 40)}`;

  return normalizeSettlementRecords([
    {
      id: stableId,
      title,
      createdAt,
      ...body,
      accountRatio,
      toonRatio,
      feeRate,
      memberPositionsAtSettlement: {},
      donors,
    },
  ])[0]!;
}

export async function buildSettlementRecordFromDonorExportFile(
  file: File,
  opts?: ImportDonorExportXlsxOptions
): Promise<SettlementRecord | null> {
  const buf = await file.arrayBuffer();
  return buildSettlementRecordFromDonorExportXlsx(buf, opts);
}
