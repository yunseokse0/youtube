/** OBS 브라우저 소스용 시그 판매 오버레이 URL (회전판 / 수동 분리) */

/** 수동 시그 OBS 테마 — 당첨 카드 vs 네온 메뉴 보드 */
export const MANUAL_SIG_OVERLAY_THEME_KEY = "sigSalesManualOverlayTheme";
export type ManualSigOverlayTheme = "result" | "menu";

export function normalizeManualSigOverlayTheme(raw: unknown): ManualSigOverlayTheme {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if (s === "menu" || s === "sig-menu" || s === "neon-menu") return "menu";
  return "result";
}

export function readManualSigOverlayThemeFromOverlaySettings(
  os: Record<string, unknown> | undefined | null
): ManualSigOverlayTheme {
  if (!os || typeof os !== "object") return "result";
  return normalizeManualSigOverlayTheme(os[MANUAL_SIG_OVERLAY_THEME_KEY]);
}

export function manualSigOverlayThemeLabel(theme: ManualSigOverlayTheme): string {
  return theme === "menu" ? "시그 메뉴(네온 보드)" : "당첨 결과 카드";
}

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

/**
 * 수동 시그 OBS 공통 URL — `/overlay/sig-sales-manual`.
 * 테마는 overlaySettings + URL `theme=` 로 전달(미리보기·OBS pick 누락 대비).
 * 전용 메뉴 URL이 필요하면 `buildSigMenuOverlayUrl` 을 쓴다.
 */
export function buildManualSigThemeOverlayUrl(
  origin: string,
  userId: string,
  theme?: ManualSigOverlayTheme | unknown,
  opts?: { memberId?: string; sigResultScalePct?: number }
): string {
  const base = buildSigSalesManualOverlayUrl(origin, userId, {
    memberId: opts?.memberId,
    sigResultScalePct: opts?.sigResultScalePct ?? 92,
  });
  const t = normalizeManualSigOverlayTheme(theme);
  if (t !== "menu") return base;
  const u = new URL(base);
  u.searchParams.set("theme", "menu");
  return u.toString();
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
