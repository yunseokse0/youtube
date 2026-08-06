import { describe, expect, it } from "vitest";
import {
  parseBulkDonationLine,
  parseBulkDonationText,
  resolveBulkDonationRows,
} from "@/lib/donation/parse-bulk-account-donations";
import type { Member } from "@/types";

const members: Member[] = [
  { id: "m1", name: "BT태호", account: 0, toon: 0, contribution: 0 },
  { id: "m2", name: "홍쓰", account: 0, toon: 0, contribution: 0 },
  { id: "m3", name: "이자하", account: 0, toon: 0, contribution: 0 },
  { id: "m4", name: "심건오", account: 0, toon: 0, contribution: 0 },
  { id: "m5", name: "연비서", account: 0, toon: 0, contribution: 0 },
];

describe("parseBulkDonationLine", () => {
  it("parses donor member amount", () => {
    expect(parseBulkDonationLine("안녕 태호 300000", 1)).toEqual({
      lineNo: 1,
      raw: "안녕 태호 300000",
      donorName: "안녕",
      memberHint: "태호",
      amount: 300000,
    });
  });

  it("parses member hint with parentheses", () => {
    expect(parseBulkDonationLine("익명 심건오(이분) 10000", 2)?.memberHint).toBe("심건오(이분)");
  });

  it("ignores header lines", () => {
    expect(parseBulkDonationLine("계좌", 1)).toBeNull();
  });
});

describe("parseBulkDonationText", () => {
  it("reads account header and multiple rows", () => {
    const text = `계좌
안녕 태호 300000
연이 홍쓰 50000
`;
    const parsed = parseBulkDonationText(text);
    expect(parsed.defaultTarget).toBe("account");
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]?.amount).toBe(300000);
  });
});

describe("resolveBulkDonationRows", () => {
  it("matches short member names", () => {
    const { rows } = parseBulkDonationText(`계좌
안녕 태호 10000
안녕 자하 10000
연이 비서 10000
익명 심건오 20000
`);
    const resolved = resolveBulkDonationRows(rows, members);
    expect(resolved.map((r) => r.memberName)).toEqual(["BT태호", "이자하", "연비서", "심건오"]);
    expect(resolved.every((r) => r.matched)).toBe(true);
  });

  it("marks unknown member unmatched", () => {
    const { rows } = parseBulkDonationText("안녕 단체짠 50000");
    const resolved = resolveBulkDonationRows(rows, members);
    expect(resolved[0]?.matched).toBe(false);
  });
});
