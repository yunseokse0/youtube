import type { SettlementMemberResult, SettlementRecord } from "@/types";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import {
  computeExcelWithholding,
  computePaymentChannelBreakdown,
  PAYMENT_FEE_DEFAULTS,
  roundWon,
  type PaymentFeeRates,
} from "@/lib/settlement-payment-math";

export { computeExcelWithholding } from "@/lib/settlement-payment-math";

/** 정산서.xlsx「지급 정산서」와 동일한 공제율 */
export const PAYMENT_STATEMENT_DEFAULTS = {
  ...PAYMENT_FEE_DEFAULTS,
  thankYouMessage: "파이팅 넘치는 스트리머의 노고에 감사드립니다",
  issuerLine: "BT STUDIO 대장 BT태호 이동환",
} as const;

export type PaymentStatementRates = PaymentFeeRates;

export type MemberPaymentStatement = {
  memberId: string;
  streamerName: string;
  broadcastDateLabel: string;
  accountGross: number;
  accountPlatformFee: number;
  accountVat: number;
  accountNet: number;
  accountStreamerShare: number;
  toonGross: number;
  toonPlatformFee: number;
  toonVat: number;
  toonNet: number;
  toonStreamerShare: number;
  pretaxTotal: number;
  withholdingRate: number;
  withholding: number;
  payout: number;
  accountRatio: number;
  toonRatio: number;
};

function rate01(n: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

/** 후원 원금 — 부가세 포함 스냅샷이 있으면 그 값을 후원금으로 사용 */
export function settlementGrossAmount(
  m: SettlementMemberResult,
  channel: "account" | "toon"
): number {
  if (channel === "account") {
    return roundWon(m.accountSource ?? m.account);
  }
  return roundWon(m.toonSource ?? m.toon);
}

/**
 * 정산서.xlsx 지급 정산 방식:
 * - 계좌: 후원금 − 플랫폼수수료(기본 0) − 부가세(10%) = 순매출 → × 계좌비율 = A
 * - 투네: 후원금 − 플랫폼수수료(10%) − 부가세(10%) = 순매출 → × 투네비율 = B
 * - 입금액 = (A+B) − 원천세(feeRate, 기본 3.3%)
 */
export function computeMemberPaymentStatement(
  record: SettlementRecord,
  member: SettlementMemberResult,
  rates: Partial<PaymentStatementRates> = {}
): MemberPaymentStatement {
  const accountGross = settlementGrossAmount(member, "account");
  const toonGross = settlementGrossAmount(member, "toon");
  const accountRatio = rate01(member.accountRatio, record.accountRatio);
  const toonRatio = rate01(member.toonRatio, record.toonRatio);
  const withholdingRate = Math.max(0, Number(record.feeRate) || 0);
  const b = computePaymentChannelBreakdown({
    accountGross,
    toonGross,
    accountRatio,
    toonRatio,
    feeRate: withholdingRate,
    skipWithholding: Boolean(member.operating),
    rates,
  });

  return {
    memberId: member.memberId,
    streamerName: (member.realName || member.name || "").trim() || member.name,
    broadcastDateLabel: formatBroadcastDateLabel(record.createdAt),
    accountGross: b.accountGross,
    accountPlatformFee: b.accountPlatformFee,
    accountVat: b.accountVat,
    accountNet: b.accountNet,
    accountStreamerShare: b.accountStreamerShare,
    toonGross: b.toonGross,
    toonPlatformFee: b.toonPlatformFee,
    toonVat: b.toonVat,
    toonNet: b.toonNet,
    toonStreamerShare: b.toonStreamerShare,
    pretaxTotal: b.pretaxTotal,
    withholdingRate,
    withholding: b.withholding,
    payout: b.payout,
    accountRatio,
    toonRatio,
  };
}

export function formatBroadcastDateLabel(createdAt: number): string {
  const d = new Date(createdAt);
  if (!Number.isFinite(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const week = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()] || "";
  return `${y}.${m}.${day}(${week})`;
}

export function formatWonOrDash(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "-";
  return Math.round(n).toLocaleString("ko-KR");
}

export function formatWonAmount(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("ko-KR");
}

function sortMembersForStatement(record: SettlementRecord): SettlementMemberResult[] {
  const members = record.members || [];
  const pos = record.memberPositionsAtSettlement;
  const isOp = (m: SettlementMemberResult) =>
    isOperatingSettlementMember(
      { id: m.memberId, name: m.name, operating: m.operating, realName: m.realName },
      pos
    );
  const operating = members.filter(isOp);
  const nonOperating = members.filter((m) => !isOp(m));
  const byNet = (a: SettlementMemberResult, b: SettlementMemberResult) => (b.net || 0) - (a.net || 0);
  return [...nonOperating.sort(byNet), ...operating.sort(byNet)];
}

export function listPayableMembers(record: SettlementRecord): SettlementMemberResult[] {
  return sortMembersForStatement(record).filter((m) => {
    const stmt = computeMemberPaymentStatement(record, m);
    return stmt.accountGross > 0 || stmt.toonGross > 0 || stmt.payout > 0;
  });
}

/** 전체 정산서 한 행 — 엑셀「전체 정산서」컬럼과 동일 */
export type FullSettlementRow = MemberPaymentStatement & {
  name: string;
  settlementTotal: number;
  streamerShare70: number;
  studioShare30: number;
  incomeTax: number;
  localIncomeTax: number;
};

export type FullSettlementSummary = {
  title: string;
  dateLabel: string;
  rows: FullSettlementRow[];
  sumAccountVat: number;
  sumToonFee: number;
  sumToonVat: number;
  sumVatTotal: number;
  sumWithholding: number;
  sumPayout: number;
  /** 엑셀 N21 — 정산금의 30% 합계(= 매출) */
  sumStudioShare: number;
  totalGrossDonation: number;
  taxGrandTotal: number;
  /** 엑셀 N23 제작진 = 매출×50% */
  productionShare: number;
  /** 엑셀 N24 국고 50% (양식상 수동/비움, 기본 0) */
  treasuryShare: number;
  /** 엑셀 N25 합계 = 제작진 + 국고 */
  remittanceSubtotal: number;
  /** 엑셀 N26 부가세 10% */
  productionVat: number;
  /** 엑셀 N27 총 송금금액 */
  productionTransfer: number;
};

/**
 * 전체 정산서 집계 — 정산서.xlsx「전체 정산서」수식과 동일.
 * - 정산금 총액 J = 계좌정산금 + 투네정산금
 * - 정산금의 70% K = 멤버 배분 합(A+B) (비율 70%면 J×70%와 동일)
 * - 정산금의 30% N = K×30%
 * - 소득세 O = ROUNDDOWN(K×3%, -1), 지방소득세 P = ROUNDDOWN(O×10%, -1)
 * - 원천세 L = O+P, 입금액 M = K−L
 * - 제작진 = N합×50%, 국고 50%는 양식상 비움, 부가세 10%·총 송금은 합계 기준
 */
export function computeFullSettlementSummary(
  record: SettlementRecord,
  rates: Partial<PaymentStatementRates> = {}
): FullSettlementSummary {
  const members = listPayableMembers(record);
  const rows: FullSettlementRow[] = members.map((m) => {
    const s = computeMemberPaymentStatement(record, m, rates);
    const settlementTotal = s.accountNet + s.toonNet;
    const streamerShare70 = s.pretaxTotal;
    const studioShare30 = roundWon(streamerShare70 * 0.3);
    const { incomeTax, localIncomeTax, withholding } = m.operating
      ? { incomeTax: 0, localIncomeTax: 0, withholding: 0 }
      : computeExcelWithholding(streamerShare70);
    const payout = Math.max(0, streamerShare70 - withholding);
    return {
      ...s,
      name: m.name,
      settlementTotal,
      streamerShare70,
      studioShare30,
      incomeTax,
      localIncomeTax,
      withholding,
      payout,
    };
  });

  const sumAccountVat = rows.reduce((a, r) => a + r.accountVat, 0);
  const sumToonFee = rows.reduce((a, r) => a + r.toonPlatformFee, 0);
  const sumToonVat = rows.reduce((a, r) => a + r.toonVat, 0);
  const sumVatTotal = sumAccountVat + sumToonVat;
  const sumWithholding = rows.reduce((a, r) => a + r.withholding, 0);
  const sumPayout = rows.reduce((a, r) => a + r.payout, 0);
  const sumStudioShare = rows.reduce((a, r) => a + r.studioShare30, 0);
  const totalGrossDonation = rows.reduce((a, r) => a + r.accountGross + r.toonGross, 0);
  const taxGrandTotal = sumVatTotal + sumWithholding;
  const productionShare = roundWon(sumStudioShare * 0.5);
  const treasuryShare = 0;
  const remittanceSubtotal = productionShare + treasuryShare;
  const productionVat = roundWon(remittanceSubtotal * 0.1);
  const productionTransfer = remittanceSubtotal + productionVat;

  const d = new Date(record.createdAt);
  const dateLabel = Number.isFinite(d.getTime())
    ? `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"][d.getDay()] || ""}`
    : "";

  return {
    title: record.title || `${formatBroadcastDateLabel(record.createdAt)} 매출 정산서`,
    dateLabel: ` ${dateLabel} `,
    rows,
    sumAccountVat,
    sumToonFee,
    sumToonVat,
    sumVatTotal,
    sumWithholding,
    sumPayout,
    sumStudioShare,
    totalGrossDonation,
    taxGrandTotal,
    productionShare,
    treasuryShare,
    remittanceSubtotal,
    productionVat,
    productionTransfer,
  };
}

function moneyCell(n: number): string {
  return formatWonAmount(n);
}

function escapeHtml(raw: string): string {
  return String(raw || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildFullSettlementHtml(record: SettlementRecord): string {
  const s = computeFullSettlementSummary(record);
  const bodyRows =
    s.rows.length > 0
      ? s.rows
          .map(
            (r, i) => `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.name)}</td>
      <td class="num">${moneyCell(r.accountGross)}</td>
      <td class="num">${moneyCell(r.toonGross)}</td>
      <td class="num">${moneyCell(r.accountVat)}</td>
      <td class="num">${moneyCell(r.accountNet)}</td>
      <td class="num">${moneyCell(r.toonPlatformFee)}</td>
      <td class="num">${moneyCell(r.toonVat)}</td>
      <td class="num">${moneyCell(r.toonNet)}</td>
      <td class="num">${moneyCell(r.settlementTotal)}</td>
      <td class="num">${moneyCell(r.streamerShare70)}</td>
      <td class="num">${moneyCell(r.withholding)}</td>
      <td class="num">${moneyCell(r.payout)}</td>
      <td class="num">${moneyCell(r.studioShare30)}</td>
    </tr>`
          )
          .join("")
      : `<tr><td colspan="14">지급 대상 없음</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8" />
<style>
  @page { size: A4 landscape; margin: 8mm; }
  body { margin: 0; font-family: "Malgun Gothic","Apple SD Gothic Neo",sans-serif; color:#111; background:#fff; }
  .sheet { padding: 6mm; }
  .title { text-align:center; font-size:22px; font-weight:800; margin: 4px 0 10px; line-height: 1.2; }
  .date { text-align:center; font-size:13px; margin-bottom: 12px; line-height: 1.2; }
  table.main { width:100%; border-collapse:collapse; font-size:9px; table-layout:fixed; }
  table.main th, table.main td {
    border:1px solid #444;
    padding: 0 2px;
    text-align:center;
    vertical-align: middle;
    height: 34px;
    line-height: 34px;
  }
  table.main th {
    background:#f3f3f3;
    font-weight:700;
    height: 42px;
    line-height: 14px;
    white-space: normal;
    padding: 4px 2px;
    vertical-align: middle;
  }
  table.main tfoot td {
    font-size:8px;
    height: 28px;
    line-height: 28px;
    padding: 0 2px;
  }
  table.main tfoot .lab { background:#f7f7f7; font-weight:700; }
  table.main tfoot .num { font-weight:700; font-variant-numeric: tabular-nums; }
  .num { font-variant-numeric: tabular-nums; }
  .foot {
    margin-top: 14px;
    display: flex;
    gap: 16px;
    align-items: flex-start;
    font-size: 12px;
  }
  .foot-col { flex: 1; min-width: 0; }
  .foot-col.wide { flex: 1.15; }
  .foot-row {
    position: relative;
    height: 34px;
    border: 1px solid #555;
    margin-top: -1px;
    background: #fff;
  }
  .foot-col > .foot-row:first-child { margin-top: 0; }
  .foot-k, .foot-v {
    position: absolute;
    top: 0;
    height: 34px;
    line-height: 34px;
    text-align: center;
    overflow: hidden;
    white-space: nowrap;
  }
  .foot-k {
    left: 0;
    width: 48%;
    background: #f7f7f7;
    font-weight: 700;
    border-right: 1px solid #555;
  }
  .foot-v {
    left: 48%;
    width: 52%;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style></head><body>
<div class="sheet">
  <div class="title">${escapeHtml(s.title)}</div>
  <div class="date">${escapeHtml(s.dateLabel.trim())}</div>
  <table class="main">
    <thead>
      <tr>
        <th>#</th><th>이름</th><th>계좌후원</th><th>투네이션</th>
        <th>계좌 부가세</th><th>계좌정산금</th><th>투네수수료</th><th>투네부가세</th><th>투네정산금</th>
        <th>정산금 총액</th><th>정산금의 70%</th><th>원천세</th><th>입금액</th>
        <th>정산금의 30%</th>
      </tr>
    </thead>
    <tbody>${bodyRows}</tbody>
    <tfoot>
      <tr>
        <td colspan="4"></td>
        <td class="lab">계좌 부가세 합계</td>
        <td></td>
        <td class="lab">투네수수료 합계</td>
        <td class="lab">투네 부가세 합계</td>
        <td colspan="2"></td>
        <td class="lab">부가세 총 합계</td>
        <td class="lab">원천세 총 합계</td>
        <td class="lab">총 지급액</td>
        <td class="lab">매출</td>
      </tr>
      <tr>
        <td colspan="4"></td>
        <td class="num">${moneyCell(s.sumAccountVat)}</td>
        <td></td>
        <td class="num">${moneyCell(s.sumToonFee)}</td>
        <td class="num">${moneyCell(s.sumToonVat)}</td>
        <td colspan="2"></td>
        <td class="num">${moneyCell(s.sumVatTotal)}</td>
        <td class="num">${moneyCell(s.sumWithholding)}</td>
        <td class="num">${moneyCell(s.sumPayout)}</td>
        <td class="num">${moneyCell(s.sumStudioShare)}</td>
      </tr>
    </tfoot>
  </table>
  <div class="foot">
    <div class="foot-col">
      <div class="foot-row"><div class="foot-k">총매출</div><div class="foot-v">${moneyCell(s.totalGrossDonation)}</div></div>
    </div>
    <div class="foot-col">
      <div class="foot-row"><div class="foot-k">세금합계</div><div class="foot-v">${moneyCell(s.taxGrandTotal)}</div></div>
    </div>
    <div class="foot-col wide">
      <div class="foot-row"><div class="foot-k">제작진</div><div class="foot-v">${moneyCell(s.productionShare)}</div></div>
      <div class="foot-row"><div class="foot-k">국고 50%</div><div class="foot-v">${s.treasuryShare ? moneyCell(s.treasuryShare) : ""}</div></div>
      <div class="foot-row"><div class="foot-k">합계</div><div class="foot-v">${moneyCell(s.remittanceSubtotal)}</div></div>
      <div class="foot-row"><div class="foot-k">부가세 10%</div><div class="foot-v">${moneyCell(s.productionVat)}</div></div>
      <div class="foot-row"><div class="foot-k">총 송금금액</div><div class="foot-v">${moneyCell(s.productionTransfer)}</div></div>
    </div>
  </div>
</div>
</body></html>`;
}

async function htmlToPdfBlob(html: string, orientation: "p" | "l" = "p"): Promise<Blob> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const host = document.createElement("div");
  host.style.position = "fixed";
  host.style.left = "-10000px";
  host.style.top = "0";
  host.style.width = orientation === "l" ? "1123px" : "794px";
  host.style.background = "#fff";
  host.innerHTML = html;
  document.body.appendChild(host);
  try {
    const target = (host.querySelector(".sheet") as HTMLElement) || host;
    const imgs = Array.from(target.querySelectorAll("img"));
    await Promise.all(
      imgs.map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise<void>((resolve) => {
                img.onload = () => resolve();
                img.onerror = () => resolve();
              })
      )
    );
    const canvas = await html2canvas(target, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 6;
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;
    const y = Math.max(margin, (pageH - Math.min(imgH, pageH - margin * 2)) / 2);
    pdf.addImage(
      canvas.toDataURL("image/png"),
      "PNG",
      margin,
      y,
      imgW,
      Math.min(imgH, pageH - margin * 2),
      undefined,
      "FAST"
    );
    const out = pdf.output("blob");
    return out instanceof Blob ? out : new Blob([out], { type: "application/pdf" });
  } finally {
    document.body.removeChild(host);
  }
}

/** 전체 정산서 PDF (가로 A4) */
export async function recordToFullSettlementPdfBlob(record: SettlementRecord): Promise<Blob> {
  return htmlToPdfBlob(buildFullSettlementHtml(record), "l");
}

export type PaymentStatementPdfOptions = {
  issuerLine?: string;
  thankYouMessage?: string;
  logoDataUrl?: string | null;
};

/** 멤버 1명 지급 정산서 PDF */
export async function memberToPaymentStatementPdfBlob(
  record: SettlementRecord,
  member: SettlementMemberResult,
  options?: PaymentStatementPdfOptions
): Promise<Blob> {
  return htmlToPdfBlob(buildMemberPaymentStatementHtml(record, member, options), "p");
}

/** @deprecated 일괄 다운로드 대신 memberToPaymentStatementPdfBlob 사용 */
export async function recordToPaymentStatementPdfBlob(
  record: SettlementRecord,
  options?: PaymentStatementPdfOptions
): Promise<Blob> {
  const members = listPayableMembers(record);
  if (members.length === 0) throw new Error("지급 대상 멤버가 없습니다.");
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
  ]);
  const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  for (let i = 0; i < members.length; i += 1) {
    const html = buildMemberPaymentStatementHtml(record, members[i]!, options);
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-10000px";
    host.style.top = "0";
    host.style.width = "794px";
    host.style.background = "#fff";
    host.innerHTML = html;
    document.body.appendChild(host);
    try {
      const target = host.querySelector(".sheet") as HTMLElement;
      const imgs = Array.from(target.querySelectorAll("img"));
      await Promise.all(
        imgs.map(
          (img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                })
        )
      );
      const canvas = await html2canvas(target, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const img = canvas.toDataURL("image/png");
      const margin = 8;
      const imgW = pageW - margin * 2;
      const imgH = (canvas.height * imgW) / canvas.width;
      if (i > 0) pdf.addPage();
      const y = Math.max(margin, (pageH - Math.min(imgH, pageH - margin * 2)) / 2);
      pdf.addImage(img, "PNG", margin, y, imgW, Math.min(imgH, pageH - margin * 2), undefined, "FAST");
    } finally {
      document.body.removeChild(host);
    }
  }
  const out = pdf.output("blob");
  return out instanceof Blob ? out : new Blob([out], { type: "application/pdf" });
}


/** 인쇄/PDF용 단페이지 HTML (지급 정산서 시트와 동일 구조) */
export function buildMemberPaymentStatementHtml(
  record: SettlementRecord,
  member: SettlementMemberResult,
  options?: PaymentStatementPdfOptions
): string {
  const s = computeMemberPaymentStatement(record, member);
  const issuer = options?.issuerLine ?? PAYMENT_STATEMENT_DEFAULTS.issuerLine;
  const thanks = options?.thankYouMessage ?? PAYMENT_STATEMENT_DEFAULTS.thankYouMessage;
  const withholdPct = (s.withholdingRate * 100).toFixed(1).replace(/\.0$/, "");
  const logo = String(options?.logoDataUrl || "").trim();
  const logoHtml = logo
    ? `<img class="logo-img" src="${escapeHtml(logo)}" alt="로고" />`
    : `<div class="logo-placeholder"></div>`;

  /**
   * 엑셀 5열(각 20%) 비율:
   * 후원금 | 수수료 | 부가세 | 순매출 | 정산금
   * html2canvas 호환: flex 대신 table + line-height/vertical-align 으로 셀 정중앙
   */
  const channelBlock = (
    sectionTitle: string,
    grossLabel: string,
    shareLabel: string,
    gross: number,
    fee: number,
    vat: number,
    net: number,
    share: number
  ) => `
    <div class="section-bar">${escapeHtml(sectionTitle)}</div>
    <table class="pay-table">
      <colgroup>
        <col style="width:20%" />
        <col style="width:20%" />
        <col style="width:20%" />
        <col style="width:20%" />
        <col style="width:20%" />
      </colgroup>
      <thead>
        <tr>
          <th class="h">${escapeHtml(grossLabel)}</th>
          <th colspan="2" class="deduct">
            <table class="deduct-inner">
              <tr><td class="d-top" colspan="2">기본 공제</td></tr>
              <tr>
                <td class="d-bot">플랫폼 수수료</td>
                <td class="d-bot">부가세</td>
              </tr>
            </table>
          </th>
          <th class="h">순매출</th>
          <th class="h">${escapeHtml(shareLabel)}</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="n">${moneyCell(gross)}</td>
          <td class="n">${moneyCell(fee)}</td>
          <td class="n">${moneyCell(vat)}</td>
          <td class="n">${moneyCell(net)}</td>
          <td class="n">${moneyCell(share)}</td>
        </tr>
      </tbody>
    </table>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
    color: #111;
    background: #fff;
  }
  .sheet {
    width: 180mm;
    min-height: 250mm;
    margin: 0 auto;
    padding: 6mm 4mm;
  }
  .title {
    text-align: center;
    font-size: 28px;
    font-weight: 800;
    letter-spacing: 0.12em;
    margin: 4px 0 14px;
    text-decoration: underline;
    text-underline-offset: 6px;
  }
  .header-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 18px;
    min-height: 88px;
  }
  .logo-wrap {
    width: 96px;
    height: 96px;
    flex: 0 0 96px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .logo-img {
    max-width: 96px;
    max-height: 96px;
    width: auto;
    height: auto;
    object-fit: contain;
    display: block;
  }
  .logo-placeholder {
    width: 96px;
    height: 96px;
  }
  .meta table { border-collapse: collapse; font-size: 13px; }
  .meta td {
    border: 1px solid #333;
    height: 30px;
    line-height: 30px;
    padding: 0 10px;
    text-align: center;
    vertical-align: middle;
  }
  .meta td.k { background: #efefef; font-weight: 700; width: 88px; }
  .meta td.v { min-width: 140px; }
  .section-bar {
    margin: 18px 0 0;
    padding: 0 10px;
    height: 34px;
    line-height: 34px;
    font-size: 14px;
    font-weight: 800;
    text-align: left;
    background: #e8e8e8;
    border: 1px solid #333;
    border-bottom: none;
  }
  table.pay-table,
  table.total-table,
  table.deduct-inner {
    width: 100%;
    border-collapse: collapse;
    border-spacing: 0;
    table-layout: fixed;
    background: #fff;
    margin: 0;
  }
  table.pay-table,
  table.total-table {
    border: 1px solid #333;
  }
  table.pay-table th,
  table.pay-table td,
  table.total-table td,
  table.deduct-inner td {
    border: 1px solid #333;
    text-align: center;
    vertical-align: middle;
    word-break: keep-all;
    padding: 0 4px;
  }
  table.pay-table thead th.h {
    background: #f3f3f3;
    font-weight: 700;
    font-size: 11px;
    height: 56px;
    line-height: 1.3;
    vertical-align: middle;
  }
  table.pay-table thead th.deduct {
    background: #f3f3f3;
    padding: 0;
    height: 56px;
    border: 1px solid #333;
  }
  table.deduct-inner { height: 56px; border: none; }
  table.deduct-inner td {
    background: #f3f3f3;
    font-weight: 700;
    font-size: 11px;
    border: none;
    border-bottom: 1px solid #333;
  }
  table.deduct-inner td.d-top {
    height: 28px;
    line-height: 28px;
  }
  table.deduct-inner td.d-bot {
    height: 28px;
    line-height: 28px;
    border-bottom: none;
    border-right: 1px solid #333;
    width: 50%;
  }
  table.deduct-inner tr:last-child td.d-bot:last-child {
    border-right: none;
  }
  table.pay-table tbody td.n {
    font-variant-numeric: tabular-nums;
    font-weight: 700;
    font-size: 13px;
    background: #fff;
    height: 42px;
    line-height: normal;
    vertical-align: middle;
  }
  table.total-table {
    margin-top: 28px;
  }
  table.total-table td.left {
    width: 60%;
    height: 72px;
    line-height: normal;
    font-size: 18px;
    font-weight: 800;
    background: #efefef;
    vertical-align: middle;
  }
  table.total-table td.cap {
    width: 40%;
    height: 28px;
    line-height: normal;
    font-size: 12px;
    font-weight: 700;
    background: #f7f7f7;
    vertical-align: middle;
  }
  table.total-table td.amt {
    height: 44px;
    line-height: normal;
    font-size: 22px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    vertical-align: middle;
  }
  .thanks {
    margin-top: 40px;
    text-align: center;
    font-size: 15px;
    font-weight: 700;
  }
  .issuer {
    margin-top: 24px;
    text-align: center;
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <div class="sheet">
    <div class="title">지급 정산서</div>
    <div class="header-row">
      <div class="logo-wrap">${logoHtml}</div>
      <div class="meta">
        <table>
          <tr>
            <td class="k">방송일</td>
            <td class="v">${escapeHtml(s.broadcastDateLabel)}</td>
          </tr>
          <tr>
            <td class="k">스트리머명</td>
            <td class="v">${escapeHtml(s.streamerName)}</td>
          </tr>
        </table>
      </div>
    </div>

    ${channelBlock(
      "계좌 후원 내역",
      "계좌 후원금",
      "A. 스트리머 정산금",
      s.accountGross,
      s.accountPlatformFee,
      s.accountVat,
      s.accountNet,
      s.accountStreamerShare
    )}

    ${channelBlock(
      "투네이션 후원 내역",
      "투네이션 후원금",
      "B. 스트리머 정산금",
      s.toonGross,
      s.toonPlatformFee,
      s.toonVat,
      s.toonNet,
      s.toonStreamerShare
    )}

    <table class="total-table">
      <tr>
        <td class="left" rowspan="2">총 정산 금액</td>
        <td class="cap">(A+B)-(원천세 ${escapeHtml(withholdPct)}%)</td>
      </tr>
      <tr>
        <td class="amt">${moneyCell(s.payout)}</td>
      </tr>
    </table>

    <div class="thanks">${escapeHtml(thanks)}</div>
    <div class="issuer">${escapeHtml(issuer)}</div>
  </div>
</body>
</html>`;
}
