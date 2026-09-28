import * as XLSX from "xlsx";
import { donorAtEpochMs } from "@/domain/dedupe/donation-dedupe.rules";
import { normalizeComparableName } from "@/lib/donation/name-similarity";
import type { Donor, Member } from "@/types";

const SKIP_LABEL = /합계|소득세|지방소득세|수수료|부가세|원천세|실지급|정산금|^name$|^time$/i;
const TOON_TOTAL_LABEL = /투네이션\s*합계/;
const ACCOUNT_TOTAL_LABEL = /계좌\s*합계/;
const MATCH_THRESHOLD = 70;
const MINUTE = 60_000;

export type MemberExcelSection = "toon" | "account";

export type MemberExcelDonationRow = {
  at: number;
  name: string;
  amount: number;
  message: string;
  section: MemberExcelSection;
};

export type MemberExcelParseResult = {
  rows: MemberExcelDonationRow[];
  toonTotal: number | null;
  accountTotal: number | null;
  fileLabel: string;
};

export type MemberExcelMatchHit = {
  row: MemberExcelDonationRow;
  donorId: string;
  score: number;
};

export type MemberExcelMissingRow = MemberExcelDonationRow & {
  memberId: string;
  memberName: string;
  fileLabel: string;
};

export type MemberExcelReconcileResult = {
  parsed: MemberExcelParseResult[];
  unresolvedLabels: string[];
  matched: MemberExcelMatchHit[];
  missingAccount: MemberExcelMissingRow[];
  missingDonors: Donor[];
};

export type MemberExcelMemberRef = Pick<Member, "id" | "name"> & {
  realName?: string;
};

function compactName(raw: string): string {
  return normalizeComparableName(raw);
}

function parseExcelSerialToMs(n: number): number {
  if (!Number.isFinite(n) || n < 40000 || n > 60000) return 0;
  return Math.round((n - 25569) * 86400 * 1000);
}

export function parseMemberExcelTime(value: unknown): number {
  if (typeof value === "number") return parseExcelSerialToMs(value);
  const s = String(value || "").trim();
  if (!s) return 0;
  const m = s.match(
    /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/
  );
  if (m) {
    const iso = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}T${m[4]!.padStart(2, "0")}:${m[5]}:${(m[6] || "00").padStart(2, "0")}+09:00`;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
  }
  const parsed = Date.parse(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowLabel(row: unknown[]): string {
  return [row[0], row[1], row[2], row[3]].map((c) => String(c ?? "").trim()).join(" ");
}

function isSkipRow(row: unknown[]): boolean {
  const blob = rowLabel(row);
  if (TOON_TOTAL_LABEL.test(blob) || ACCOUNT_TOTAL_LABEL.test(blob)) return true;
  return SKIP_LABEL.test(blob);
}

function extraAmount(row: unknown[]): number | null {
  for (const cell of row) {
    if (typeof cell === "number" && Number.isFinite(cell) && cell > 0) return Math.round(cell);
    const n = Number(String(cell ?? "").replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0 && String(cell ?? "").replace(/[,\s]/g, "").length > 0) {
      return Math.round(n);
    }
  }
  return null;
}

export function parseMemberToonationExcelAoA(
  aoa: unknown[][],
  fileLabel = ""
): MemberExcelParseResult {
  const rows: MemberExcelDonationRow[] = [];
  let section: MemberExcelSection = "toon";
  let toonTotal: number | null = null;
  let accountTotal: number | null = null;
  const list = Array.isArray(aoa) ? aoa : [];
  for (let i = 0; i < list.length; i += 1) {
    const row = Array.isArray(list[i]) ? (list[i] as unknown[]) : [];
    const blob = rowLabel(row);
    if (TOON_TOTAL_LABEL.test(blob)) {
      toonTotal = extraAmount(row);
      section = "account";
      continue;
    }
    if (ACCOUNT_TOTAL_LABEL.test(blob)) {
      accountTotal = extraAmount(row);
      if (toonTotal == null) {
        for (const donation of rows) {
          if (!donation.message) donation.section = "account";
        }
      }
      break;
    }
    if (i === 0 && /time/i.test(String(row[0] ?? "")) && /name/i.test(String(row[1] ?? ""))) {
      continue;
    }
    if (isSkipRow(row)) continue;
    const name = String(row[1] ?? "").trim();
    const amtRaw = row[2];
    const amount =
      typeof amtRaw === "number"
        ? Math.round(amtRaw)
        : Math.round(Number(String(amtRaw ?? "").replace(/,/g, "")));
    if (!name || !Number.isFinite(amount) || amount <= 0) continue;
    rows.push({
      at: parseMemberExcelTime(row[0]),
      name,
      amount,
      message: String(row[3] ?? "").trim(),
      section,
    });
  }
  if (toonTotal == null && accountTotal == null) {
    for (const donation of rows) {
      if (!donation.message) donation.section = "account";
    }
  }
  return { rows, toonTotal, accountTotal, fileLabel };
}

export function parseMemberToonationExcelBuffer(
  data: ArrayBuffer | Uint8Array,
  fileLabel = ""
): MemberExcelParseResult {
  const wb = XLSX.read(data, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0] || ""];
  if (!sheet) return { rows: [], toonTotal: null, accountTotal: null, fileLabel };
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
  }) as unknown[][];
  return parseMemberToonationExcelAoA(aoa, fileLabel);
}

export function fileLabelFromName(fileName: string): string {
  return String(fileName || "")
    .replace(/\.[^.]+$/, "")
    .trim();
}

export function resolveMemberFromExcelLabel(
  label: string,
  members: MemberExcelMemberRef[]
): MemberExcelMemberRef | null {
  const needle = compactName(label);
  if (!needle || !Array.isArray(members) || members.length === 0) return null;
  let best: { member: MemberExcelMemberRef; score: number } | null = null;
  for (const member of members) {
    const names = [member.name, member.realName].map((v) => compactName(String(v || ""))).filter(Boolean);
    for (const name of names) {
      let score = 0;
      if (needle === name) score = 100 + name.length;
      else if (needle.includes(name)) score = 80 + name.length;
      else if (name.includes(needle)) score = 60 + needle.length;
      if (score > 0 && (!best || score > best.score)) best = { member, score };
    }
  }
  return best?.member ?? null;
}

function donorBlob(donor: Donor): string {
  return compactName(`${donor.name || donor.donorName || ""} ${donor.message || ""}`);
}

function rowBlob(row: MemberExcelDonationRow): string {
  return compactName(`${row.name} ${row.message}`);
}

function timeBonus(rowAt: number, donorAt: number, donorTarget?: string): number {
  if (!rowAt || !donorAt) return 0;
  const dt = Math.abs(rowAt - donorAt);
  if (dt <= MINUTE) return 40;
  if (dt <= 20 * MINUTE) return 30;
  if (donorTarget === "toon") return 0;
  if (dt <= 60 * MINUTE) return 10;
  return 0;
}

export function scoreMemberExcelRowAgainstDonor(row: MemberExcelDonationRow, donor: Donor): number {
  if ((Number(donor.amount) || 0) !== row.amount) return 0;
  const excel = rowBlob(row);
  const blob = donorBlob(donor);
  if (!excel || excel.length < 2) return 0;
  let score = 0;
  if (excel === blob) score += 80;
  else if (blob.includes(excel) || excel.includes(blob)) score += 40;
  else {
    const donorName = compactName(String(donor.name || donor.donorName || ""));
    if (donorName && (excel.includes(donorName) || donorName.includes(excel))) score += 25;
  }
  if (score <= 0) return 0;
  score += timeBonus(row.at, donorAtEpochMs(donor), donor.target);
  return score;
}

function greedyMatch(
  rows: MemberExcelDonationRow[],
  donors: Donor[]
): { matched: MemberExcelMatchHit[]; unmatched: MemberExcelDonationRow[] } {
  const pairs: Array<{ rowIdx: number; donorIdx: number; score: number; donorId: string }> = [];
  for (let r = 0; r < rows.length; r += 1) {
    const row = rows[r]!;
    for (let d = 0; d < donors.length; d += 1) {
      const donor = donors[d]!;
      const score = scoreMemberExcelRowAgainstDonor(row, donor);
      if (score < MATCH_THRESHOLD) continue;
      pairs.push({ rowIdx: r, donorIdx: d, score, donorId: String(donor.id || `idx_${d}`) });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.rowIdx - b.rowIdx);
  const usedRows = new Set<number>();
  const usedDonors = new Set<number>();
  const matched: MemberExcelMatchHit[] = [];
  for (const pair of pairs) {
    if (usedRows.has(pair.rowIdx) || usedDonors.has(pair.donorIdx)) continue;
    usedRows.add(pair.rowIdx);
    usedDonors.add(pair.donorIdx);
    matched.push({ row: rows[pair.rowIdx]!, donorId: pair.donorId, score: pair.score });
  }
  const unmatched = rows.filter((_, idx) => !usedRows.has(idx));
  return { matched, unmatched };
}

export function missingAccountRowsToDonors(missing: MemberExcelMissingRow[]): Donor[] {
  return missing.map((row, idx) => ({
    id: `d_xlsx_${row.at || Date.now()}_${row.amount}_${idx}_${row.memberId}`,
    name: row.name.replace(/\s+/g, "") || "무명",
    amount: row.amount,
    memberId: row.memberId,
    at: row.at || Date.now(),
    target: "account" as const,
    ...(row.message ? { message: row.message } : {}),
    provider: "member-excel",
  }));
}

export function reconcileMemberToonationExcels(
  parsed: MemberExcelParseResult[],
  members: MemberExcelMemberRef[],
  donors: Donor[]
): MemberExcelReconcileResult {
  const pool = Array.isArray(donors) ? donors : [];
  const matched: MemberExcelMatchHit[] = [];
  const missingAccount: MemberExcelMissingRow[] = [];
  const unresolvedLabels: string[] = [];
  const usedDonorIds = new Set<string>();

  for (const file of parsed) {
    const member = resolveMemberFromExcelLabel(file.fileLabel, members);
    if (!member) {
      unresolvedLabels.push(file.fileLabel || "(이름 없음)");
      continue;
    }
    const remaining = pool.filter((d) => !usedDonorIds.has(String(d.id || "")));
    const { matched: hits, unmatched } = greedyMatch(file.rows, remaining);
    for (const hit of hits) {
      usedDonorIds.add(hit.donorId);
      matched.push(hit);
    }
    for (const row of unmatched) {
      if (row.section !== "account") continue;
      missingAccount.push({
        ...row,
        memberId: member.id,
        memberName: member.name,
        fileLabel: file.fileLabel,
      });
    }
  }

  return {
    parsed,
    unresolvedLabels,
    matched,
    missingAccount,
    missingDonors: missingAccountRowsToDonors(missingAccount),
  };
}

export function mergeDonorsWithMissingAccount(existing: Donor[], missing: Donor[]): Donor[] {
  const base = Array.isArray(existing) ? existing : [];
  if (!missing.length) return base;
  const seen = new Set(base.map((d) => String(d.id || "")));
  const extra = missing.filter((d) => !seen.has(String(d.id || "")));
  return extra.length ? [...base, ...extra] : base;
}
