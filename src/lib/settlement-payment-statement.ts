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
      <td class="num">${moneyCell(r.incomeTax)}</td>
      <td class="num">${moneyCell(r.localIncomeTax)}</td>
    </tr>`
          )
          .join("")
      : `<tr><td colspan="16">지급 대상 없음</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8" />
<style>
  @page { size: A4 landscape; margin: 8mm; }
  body { margin: 0; font-family: "Malgun Gothic","Apple SD Gothic Neo",sans-serif; color:#111; background:#fff; }
  .sheet { padding: 6mm; }
  .title { text-align:center; font-size:22px; font-weight:800; margin: 4px 0 10px; }
  .date { text-align:center; font-size:13px; margin-bottom: 12px; }
  table.main { width:100%; border-collapse:collapse; font-size:9px; table-layout:fixed; }
  table.main th, table.main td { border:1px solid #444; padding:4px 2px; text-align:center; vertical-align:middle; }
  table.main th { background:#f3f3f3; font-weight:700; }
  table.main tfoot td { font-size:8px; }
  table.main tfoot .lab { background:#f7f7f7; font-weight:700; }
  table.main tfoot .num { font-weight:700; font-variant-numeric: tabular-nums; }
  .num { font-variant-numeric: tabular-nums; }
  .foot { margin-top: 14px; display:grid; grid-template-columns: 1fr 1fr 1.1fr; gap: 16px; font-size:11px; align-items:start; }
  .foot table { width:100%; border-collapse:collapse; }
  .foot td { border:1px solid #555; padding:5px 6px; }
  .foot td.k { background:#f7f7f7; font-weight:700; width:48%; }
  .foot td.v { text-align:right; font-variant-numeric: tabular-nums; font-weight:700; }
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
        <th>정산금의 30%</th><th>소득세</th><th>지방소득세</th>
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
        <td colspan="2"></td>
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
        <td colspan="2"></td>
      </tr>
    </tfoot>
  </table>
  <div class="foot">
    <table>
      <tr><td class="k">총매출</td><td class="v">${moneyCell(s.totalGrossDonation)}</td></tr>
    </table>
    <table>
      <tr><td class="k">세금합계</td><td class="v">${moneyCell(s.taxGrandTotal)}</td></tr>
    </table>
    <table>
      <tr><td class="k">제작진</td><td class="v">${moneyCell(s.productionShare)}</td></tr>
      <tr><td class="k">국고 50%</td><td class="v">${s.treasuryShare ? moneyCell(s.treasuryShare) : ""}</td></tr>
      <tr><td class="k">합계</td><td class="v">${moneyCell(s.remittanceSubtotal)}</td></tr>
      <tr><td class="k">부가세 10%</td><td class="v">${moneyCell(s.productionVat)}</td></tr>
      <tr><td class="k">총 송금금액</td><td class="v">${moneyCell(s.productionTransfer)}</td></tr>
    </table>
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

/** 멤버 1명 지급 정산서 PDF */
export async function memberToPaymentStatementPdfBlob(
  record: SettlementRecord,
  member: SettlementMemberResult,
  options?: { issuerLine?: string; thankYouMessage?: string }
): Promise<Blob> {
  return htmlToPdfBlob(buildMemberPaymentStatementHtml(record, member, options), "p");
}

/** @deprecated 일괄 다운로드 대신 memberToPaymentStatementPdfBlob 사용 */
export async function recordToPaymentStatementPdfBlob(
  record: SettlementRecord,
  options?: { issuerLine?: string; thankYouMessage?: string }
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
      const canvas = await html2canvas(host.querySelector(".sheet") as HTMLElement, {
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
  options?: { issuerLine?: string; thankYouMessage?: string }
): string {
  const s = computeMemberPaymentStatement(record, member);
  const issuer = options?.issuerLine ?? PAYMENT_STATEMENT_DEFAULTS.issuerLine;
  const thanks = options?.thankYouMessage ?? PAYMENT_STATEMENT_DEFAULTS.thankYouMessage;
  const withholdPct = (s.withholdingRate * 100).toFixed(1).replace(/\.0$/, "");

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 14mm; }
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
    padding: 8mm 6mm;
  }
  .title {
    text-align: center;
    font-size: 28px;
    font-weight: 800;
    letter-spacing: 0.12em;
    margin: 8px 0 28px;
  }
  .meta {
    display: flex;
    justify-content: flex-end;
    margin-bottom: 28px;
  }
  .meta table { border-collapse: collapse; font-size: 13px; }
  .meta td { padding: 4px 8px; border: 1px solid #333; }
  .meta td.k { background: #f3f3f3; font-weight: 700; width: 88px; }
  .meta td.v { min-width: 120px; text-align: center; }
  .section {
    font-size: 15px;
    font-weight: 800;
    margin: 22px 0 10px;
    padding-bottom: 4px;
    border-bottom: 2px solid #222;
  }
  .grid {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 12px;
  }
  .grid col.c-gross { width: 20%; }
  .grid col.c-fee { width: 15%; }
  .grid col.c-vat { width: 15%; }
  .grid col.c-net { width: 20%; }
  .grid col.c-share { width: 30%; }
  .grid th, .grid td {
    border: 1px solid #444;
    padding: 8px 6px;
    text-align: center;
    vertical-align: middle;
  }
  .grid th { background: #f7f7f7; font-weight: 700; }
  .grid .num { font-variant-numeric: tabular-nums; font-weight: 600; }
  .total-box {
    margin-top: 28px;
    display: grid;
    grid-template-columns: 1fr 1.2fr;
    gap: 0;
    border: 1px solid #333;
  }
  .total-box .left {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    font-weight: 800;
    background: #fafafa;
    border-right: 1px solid #333;
    min-height: 64px;
  }
  .total-box .right { display: flex; flex-direction: column; }
  .total-box .right .cap {
    font-size: 12px;
    padding: 6px 10px;
    border-bottom: 1px solid #333;
    background: #f3f3f3;
    text-align: center;
  }
  .total-box .right .amt {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    padding: 10px;
  }
  .thanks {
    margin-top: 36px;
    text-align: center;
    font-size: 15px;
    font-weight: 700;
  }
  .issuer {
    margin-top: 28px;
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
    <div class="meta">
      <table>
        <tr><td class="k">방송일</td><td class="v">${escapeHtml(s.broadcastDateLabel)}</td></tr>
        <tr><td class="k">스트리머명</td><td class="v">${escapeHtml(s.streamerName)}</td></tr>
      </table>
    </div>

    <div class="section">계좌 후원 내역</div>
    <table class="grid">
      <colgroup>
        <col class="c-gross" /><col class="c-fee" /><col class="c-vat" /><col class="c-net" /><col class="c-share" />
      </colgroup>
      <thead>
        <tr>
          <th rowspan="2">계좌 후원금</th>
          <th colspan="2">기본 공제</th>
          <th rowspan="2">순매출</th>
          <th rowspan="2">A. 스트리머 정산금</th>
        </tr>
        <tr>
          <th>플랫폼 수수료</th>
          <th>부가세</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="num">${moneyCell(s.accountGross)}</td>
          <td class="num">${moneyCell(s.accountPlatformFee)}</td>
          <td class="num">${moneyCell(s.accountVat)}</td>
          <td class="num">${moneyCell(s.accountNet)}</td>
          <td class="num">${moneyCell(s.accountStreamerShare)}</td>
        </tr>
      </tbody>
    </table>

    <div class="section">투네이션 후원 내역</div>
    <table class="grid">
      <colgroup>
        <col class="c-gross" /><col class="c-fee" /><col class="c-vat" /><col class="c-net" /><col class="c-share" />
      </colgroup>
      <thead>
        <tr>
          <th rowspan="2">투네이션 후원금</th>
          <th colspan="2">기본 공제</th>
          <th rowspan="2">순매출</th>
          <th rowspan="2">B. 스트리머 정산금</th>
        </tr>
        <tr>
          <th>플랫폼 수수료</th>
          <th>부가세</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="num">${moneyCell(s.toonGross)}</td>
          <td class="num">${moneyCell(s.toonPlatformFee)}</td>
          <td class="num">${moneyCell(s.toonVat)}</td>
          <td class="num">${moneyCell(s.toonNet)}</td>
          <td class="num">${moneyCell(s.toonStreamerShare)}</td>
        </tr>
      </tbody>
    </table>

    <div class="total-box">
      <div class="left">총 정산 금액</div>
      <div class="right">
        <div class="cap">(A+B)-(원천세 ${escapeHtml(withholdPct)}%)</div>
        <div class="amt">${moneyCell(s.payout)}</div>
      </div>
    </div>

    <div class="thanks">${escapeHtml(thanks)}</div>
    <div class="issuer">${escapeHtml(issuer)}</div>
  </div>
</body>
</html>`;
}
