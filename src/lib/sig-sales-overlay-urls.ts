/** OBS 브라우저 소스용 시그 판매 오버레이 URL (회전판 / 수동 분리) */

export function buildSigSalesWheelOverlayUrl(
  origin: string,
  userId: string,
  opts?: {
    memberId?: string;
    menuCount?: number;
    sigResultScalePct?: number;
    wheelDemo?: boolean;
  }
): string {
  const q = new URLSearchParams();
  q.set("u", userId);
  if (opts?.memberId) q.set("memberId", opts.memberId);
  if (opts?.menuCount != null && Number.isFinite(opts.menuCount)) {
    q.set("menuCount", String(Math.floor(opts.menuCount)));
  }
  if (opts?.wheelDemo) q.set("wheelDemo", "1");
  if (opts?.sigResultScalePct != null && Number.isFinite(opts.sigResultScalePct)) {
    q.set("sigResultScalePct", String(Math.floor(opts.sigResultScalePct)));
  }
  q.set("hideSigBoard", "1");
  return `${origin.replace(/\/$/, "")}/overlay/sig-sales?${q.toString()}`;
}

export function buildSigSalesManualOverlayUrl(
  origin: string,
  userId: string,
  opts?: { memberId?: string; sigResultScalePct?: number }
): string {
  const q = new URLSearchParams();
  q.set("u", userId);
  if (opts?.memberId) q.set("memberId", opts.memberId);
  if (opts?.sigResultScalePct != null && Number.isFinite(opts.sigResultScalePct)) {
    q.set("sigResultScalePct", String(Math.floor(opts.sigResultScalePct)));
  }
  q.set("hideSigBoard", "1");
  return `${origin.replace(/\/$/, "")}/overlay/sig-sales-manual?${q.toString()}`;
}
