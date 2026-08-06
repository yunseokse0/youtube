import type { Member } from "@/types";
import type { DonorTarget } from "@/types";
import { suggestMemberForDonationEvent } from "@/lib/donation/mapper";
import type { DonationEvent, DonorAlias } from "@/lib/donation/types";

export type ParsedBulkDonationLine = {
  lineNo: number;
  raw: string;
  donorName: string;
  memberHint: string;
  amount: number;
};

export type BulkDonationTargetHeader = DonorTarget | null;

const HEADER_RE = /^(계좌|투네|account|toon)$/i;

/** `계좌` / `투네` 헤더 줄 — 이후 행의 기본 target */
export function parseBulkDonationTargetHeader(line: string): BulkDonationTargetHeader {
  const t = String(line || "").trim();
  if (!t) return null;
  if (/^(계좌|account)$/i.test(t)) return "account";
  if (/^(투네|toon|toonation)$/i.test(t)) return "toon";
  return null;
}

/**
 * `후원자 멤버 금액` (멤버명은 공백 포함 가능, 마지막 토큰이 금액)
 * 예: `안녕 태호 300000`, `익명 심건오(이분) 10000`
 */
export function parseBulkDonationLine(
  line: string,
  lineNo: number
): ParsedBulkDonationLine | null {
  const raw = String(line || "").trim();
  if (!raw) return null;
  if (HEADER_RE.test(raw)) return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;
  const amountToken = parts[parts.length - 1]!.replace(/,/g, "");
  if (!/^\d+$/.test(amountToken)) return null;
  const amount = Math.floor(Number(amountToken));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const donorName = parts[0]!;
  const memberHint = parts.slice(1, -1).join(" ").trim();
  if (!donorName || !memberHint) return null;
  return { lineNo, raw, donorName, memberHint, amount };
}

export function parseBulkDonationText(text: string): {
  defaultTarget: DonorTarget;
  rows: ParsedBulkDonationLine[];
  skipped: { lineNo: number; raw: string; reason: string }[];
} {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  let defaultTarget: DonorTarget = "account";
  const rows: ParsedBulkDonationLine[] = [];
  const skipped: { lineNo: number; raw: string; reason: string }[] = [];

  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    const header = parseBulkDonationTargetHeader(trimmed);
    if (header) {
      defaultTarget = header;
      return;
    }
    const parsed = parseBulkDonationLine(trimmed, lineNo);
    if (!parsed) {
      skipped.push({ lineNo, raw: trimmed, reason: "형식이 아님 (후원자 멤버 금액)" });
      return;
    }
    rows.push(parsed);
  });

  return { defaultTarget, rows, skipped };
}

export type ResolvedBulkDonationRow = ParsedBulkDonationLine & {
  memberId: string | null;
  memberName: string | null;
  matched: boolean;
};

export function resolveBulkDonationRows(
  rows: ParsedBulkDonationLine[],
  members: Member[],
  aliases: DonorAlias[] = [],
  memberPositions?: Record<string, string> | null
): ResolvedBulkDonationRow[] {
  return rows.map((row) => {
    const fakeEvent: DonationEvent = {
      id: `bulk:${row.lineNo}`,
      provider: "bank",
      externalId: `bulk:${row.lineNo}`,
      donorName: row.donorName,
      amount: row.amount,
      message: row.memberHint,
      playerName: row.memberHint,
      at: new Date().toISOString(),
      status: "queued",
    };
    const member = suggestMemberForDonationEvent(
      fakeEvent,
      members,
      aliases,
      memberPositions
    );
    const byHintOnly =
      member ||
      suggestMemberForDonationEvent(
        { ...fakeEvent, donorName: "익명" },
        members,
        aliases,
        memberPositions
      );
    if (!byHintOnly) {
      return { ...row, memberId: null, memberName: null, matched: false };
    }
    return {
      ...row,
      memberId: byHintOnly.id,
      memberName: byHintOnly.name,
      matched: true,
    };
  });
}
