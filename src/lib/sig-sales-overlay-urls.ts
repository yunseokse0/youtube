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
  q.set("host", "obs");
  return `${origin.replace(/\/$/, "")}/overlay/sig-sales-manual?${q.toString()}`;
}

/** OBS — 판매 중 시그 전체 네온 메뉴 보드 */
export function buildSigMenuOverlayUrl(
  origin: string,
  userId: string,
  opts?: { memberId?: string }
): string {
  const q = new URLSearchParams();
  q.set("u", userId);
  if (opts?.memberId) q.set("memberId", opts.memberId);
  q.set("host", "obs");
  return `${origin.replace(/\/$/, "")}/overlay/sig-menu?${q.toString()}`;
}

/** 참고 메뉴(~21칸) 기준 7열. 적으면 칸 수에 맞춤 */
export function sigNeonMenuColumnCount(itemCount: number): number {
  const n = Math.max(0, Math.floor(itemCount));
  if (n <= 0) return 1;
  if (n <= 4) return n;
  if (n <= 6) return 3;
  if (n <= 12) return Math.min(6, n);
  return 7;
}
