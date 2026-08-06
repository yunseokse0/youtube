import { describe, expect, it } from "vitest";
import { isNationalTreasuryMember } from "@/lib/donation/mapper";
import { recomputeSettlementFromDonors } from "@/lib/settlement";
import type { Donor, SettlementRecord } from "@/types";

function baseRecord(): SettlementRecord {
  return {
    id: "st_1",
    title: "테스트 정산",
    createdAt: 1_700_000_000_000,
    accountRatio: 0.7,
    toonRatio: 0.6,
    feeRate: 0.033,
    members: [
      {
        memberId: "m_player",
        name: "플레이어",
        realName: "홍길동",
        account: 100_000,
        toon: 50_000,
        accountRatio: 0.7,
        toonRatio: 0.6,
        accountApplied: 0,
        toonApplied: 0,
        gross: 0,
        fee: 0,
        net: 0,
        bankName: "국민",
        bankAccount: "123",
        accountHolder: "홍길동",
      },
      {
        memberId: "m_treasury",
        name: "국고",
        realName: "",
        account: 200_000,
        toon: 0,
        accountRatio: 0.7,
        toonRatio: 0.6,
        accountApplied: 0,
        toonApplied: 0,
        gross: 0,
        fee: 0,
        net: 0,
      },
    ],
    totalGross: 0,
    totalFee: 0,
    totalNet: 0,
    memberPositionsAtSettlement: { m_treasury: "국고" },
    donors: [
      {
        id: "d1",
        name: "후원자A",
        amount: 100_000,
        memberId: "m_player",
        at: 1_700_000_000_000,
        target: "account",
      },
      {
        id: "d2",
        name: "후원자B",
        amount: 50_000,
        memberId: "m_player",
        at: 1_700_000_000_100,
        target: "toon",
      },
      {
        id: "d3",
        name: "후원자C",
        amount: 200_000,
        memberId: "m_treasury",
        at: 1_700_000_000_200,
        target: "account",
      },
    ],
  };
}

describe("isNationalTreasuryMember", () => {
  it("detects 국고 by name or position", () => {
    expect(isNationalTreasuryMember({ id: "a", name: "국고" }, null)).toBe(true);
    expect(
      isNationalTreasuryMember({ id: "b", name: "운영" }, { b: "국고" })
    ).toBe(true);
    expect(isNationalTreasuryMember({ id: "c", name: "태호" }, { c: "대표" })).toBe(false);
  });
});

describe("recomputeSettlementFromDonors", () => {
  it("reassigns 국고 donor to another member and preserves bank info", () => {
    const record = baseRecord();
    const donors: Donor[] = (record.donors || []).map((d) =>
      d.id === "d3" ? { ...d, memberId: "m_player", amount: 80_000 } : d
    );
    const next = recomputeSettlementFromDonors(record, donors);
    const player = next.members.find((m) => m.memberId === "m_player")!;
    const treasury = next.members.find((m) => m.memberId === "m_treasury")!;
    expect(player.account).toBe(180_000);
    expect(player.toon).toBe(50_000);
    expect(treasury.account).toBe(0);
    expect(treasury.toon).toBe(0);
    expect(player.bankName).toBe("국민");
    expect(player.bankAccount).toBe("123");
    expect(next.donors?.some((d) => d.id === "d3" && d.memberId === "m_player")).toBe(true);
    expect(next.totalNet).toBeGreaterThan(0);
  });

  it("allows adding a new 국고 donor row", () => {
    const record = baseRecord();
    const donors: Donor[] = [
      ...(record.donors || []),
      {
        id: "d_new",
        name: "추가후원",
        amount: 10_000,
        memberId: "m_treasury",
        at: record.createdAt,
        target: "toon",
      },
    ];
    const next = recomputeSettlementFromDonors(record, donors);
    const treasury = next.members.find((m) => m.memberId === "m_treasury")!;
    expect(treasury.account).toBe(200_000);
    expect(treasury.toon).toBe(10_000);
  });
});
