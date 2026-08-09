import { describe, expect, it } from "vitest";
import type { SettlementMemberResult, SettlementRecord } from "@/types";
import {
  buildFullSettlementHtml,
  buildMemberPaymentStatementHtml,
  computeExcelWithholding,
  computeFullSettlementSummary,
  computeMemberPaymentStatement,
  formatBroadcastDateLabel,
  listPayableMembers,
} from "@/lib/settlement-payment-statement";

const member = (overrides: Partial<SettlementMemberResult> = {}): SettlementMemberResult => ({
  memberId: "m1",
  name: "테스트",
  realName: "홍길동",
  account: 1_000_000,
  toon: 1_000_000,
  accountRatio: 0.7,
  toonRatio: 0.7,
  accountApplied: 0,
  toonApplied: 0,
  gross: 0,
  fee: 0,
  net: 0,
  ...overrides,
});

const record = (overrides: Partial<SettlementRecord> = {}): SettlementRecord => ({
  id: "st_1",
  title: "2026.08.02. 매출 정산서",
  createdAt: new Date("2026-08-02T12:00:00+09:00").getTime(),
  accountRatio: 0.7,
  toonRatio: 0.7,
  feeRate: 0.033,
  members: [member()],
  totalGross: 0,
  totalFee: 0,
  totalNet: 0,
  ...overrides,
});

describe("computeMemberPaymentStatement (정산서.xlsx)", () => {
  it("matches sample: account 1M + toon 1M → payout 1,150,730", () => {
    const stmt = computeMemberPaymentStatement(record(), member());
    expect(stmt.accountGross).toBe(1_000_000);
    expect(stmt.accountPlatformFee).toBe(0);
    expect(stmt.accountVat).toBe(100_000);
    expect(stmt.accountNet).toBe(900_000);
    expect(stmt.accountStreamerShare).toBe(630_000);

    expect(stmt.toonGross).toBe(1_000_000);
    expect(stmt.toonPlatformFee).toBe(100_000);
    expect(stmt.toonVat).toBe(100_000);
    expect(stmt.toonNet).toBe(800_000);
    expect(stmt.toonStreamerShare).toBe(560_000);

    expect(stmt.pretaxTotal).toBe(1_190_000);
    expect(stmt.withholding).toBe(39_270);
    expect(stmt.payout).toBe(1_150_730);
  });

  it("uses accountSource/toonSource as gross when vat-included snapshot exists", () => {
    const stmt = computeMemberPaymentStatement(
      record(),
      member({
        account: 909_000,
        toon: 909_000,
        accountSource: 1_000_000,
        toonSource: 1_000_000,
      })
    );
    expect(stmt.accountGross).toBe(1_000_000);
    expect(stmt.toonGross).toBe(1_000_000);
    expect(stmt.payout).toBe(1_150_730);
  });

  it("formats broadcast date like 2026.08.02(일)", () => {
    expect(formatBroadcastDateLabel(new Date("2026-08-02T12:00:00+09:00").getTime())).toBe(
      "2026.08.02(일)"
    );
  });

  it("listPayableMembers skips empty rows", () => {
    const rec = record({
      members: [
        member({ memberId: "m1" }),
        member({
          memberId: "m2",
          name: "빈행",
          account: 0,
          toon: 0,
          accountApplied: 0,
          toonApplied: 0,
          gross: 0,
          fee: 0,
          net: 0,
        }),
      ],
    });
    expect(listPayableMembers(rec).map((m) => m.memberId)).toEqual(["m1"]);
  });
});

describe("computeFullSettlementSummary (정산서.xlsx 전체 정산서)", () => {
  it("matches Excel sample row and remittance footer", () => {
    const summary = computeFullSettlementSummary(record());
    expect(summary.rows).toHaveLength(1);
    const row = summary.rows[0]!;
    expect(row.accountVat).toBe(100_000);
    expect(row.accountNet).toBe(900_000);
    expect(row.toonPlatformFee).toBe(100_000);
    expect(row.toonVat).toBe(100_000);
    expect(row.toonNet).toBe(800_000);
    expect(row.settlementTotal).toBe(1_700_000);
    expect(row.streamerShare70).toBe(1_190_000);
    expect(row.studioShare30).toBe(357_000);
    expect(row.incomeTax).toBe(35_700);
    expect(row.localIncomeTax).toBe(3_570);
    expect(row.withholding).toBe(39_270);
    expect(row.payout).toBe(1_150_730);

    expect(summary.sumVatTotal).toBe(200_000);
    expect(summary.sumWithholding).toBe(39_270);
    expect(summary.sumPayout).toBe(1_150_730);
    expect(summary.sumStudioShare).toBe(357_000);
    expect(summary.totalGrossDonation).toBe(2_000_000);
    expect(summary.taxGrandTotal).toBe(239_270);
    expect(summary.productionShare).toBe(178_500);
    expect(summary.treasuryShare).toBe(0);
    expect(summary.remittanceSubtotal).toBe(178_500);
    expect(summary.productionVat).toBe(17_850);
    expect(summary.productionTransfer).toBe(196_350);
  });

  it("includes treasury 50% when includeTreasuryInFullStatement is set", () => {
    const summary = computeFullSettlementSummary(
      record({ includeTreasuryInFullStatement: true })
    );
    expect(summary.productionShare).toBe(178_500);
    expect(summary.treasuryShare).toBe(178_500);
    expect(summary.remittanceSubtotal).toBe(357_000);
    expect(summary.productionVat).toBe(35_700);
    expect(summary.productionTransfer).toBe(392_700);
  });

  it("omits treasury member rows when omitTreasuryFromSettlement", () => {
    const rec = record({
      omitTreasuryFromSettlement: true,
      members: [
        member({ memberId: "m1" }),
        member({ memberId: "tr", name: "국고", account: 500_000, toon: 0 }),
      ],
    });
    expect(computeFullSettlementSummary(rec).rows.map((r) => r.memberId)).toEqual(["m1"]);
  });

  it("computeExcelWithholding uses ROUNDDOWN to tens", () => {
    expect(computeExcelWithholding(1_190_000)).toEqual({
      incomeTax: 35_700,
      localIncomeTax: 3_570,
      withholding: 39_270,
    });
  });
});

describe("buildMemberPaymentStatementHtml layout", () => {
  it("uses bordered centered pay-table with Excel column ratios", () => {
    const html = buildMemberPaymentStatementHtml(record(), member());
    expect(html).toContain('class="pay-table"');
    expect(html).toContain('class="total-table"');
    expect(html).toContain('class="deduct-inner"');
    expect(html).not.toContain('class="pay-block"');
    expect(html).not.toContain('class="vbox"');
    expect(html).toContain('style="width:20%"');
    expect(html).toContain("기본 공제");
    expect(html).toContain("플랫폼 수수료");
    expect(html).toContain('colspan="2"');
    expect(html).toContain('rowspan="2"');
    expect(html).toContain("width: 680px");
    expect(html).toMatch(/table\.pay-table tbody td\.n\s*\{[^}]*line-height:\s*42px/s);
    expect(html).toMatch(/table\.pay-table thead th\.h\s*\{[^}]*line-height:\s*56px/s);
    expect(html).toMatch(/text-align:\s*left/);
    expect(html).toContain("1,150,730");
  });

  it("embeds uploaded logo in header when provided", () => {
    const html = buildMemberPaymentStatementHtml(record(), member(), {
      logoDataUrl: "data:image/png;base64,abc",
    });
    expect(html).toContain('class="logo-img"');
    expect(html).toContain("data:image/png;base64,abc");
    expect(html).toContain('class="header-row"');
  });
});

describe("buildFullSettlementHtml", () => {
  it("omits income/local tax columns and centers footer cells", () => {
    const html = buildFullSettlementHtml(record());
    expect(html).toContain("원천세");
    expect(html).toContain("정산금의 30%");
    expect(html).not.toContain(">소득세<");
    expect(html).not.toContain(">지방소득세<");
    expect(html).toContain('class="foot-row"');
    expect(html).toContain("line-height: 34px");
  });
});
