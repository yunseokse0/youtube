import type { DonorRankingsTheme, SigItem } from "@/types";

/** 프리셋 → URL 쿼리 변환. OBS 등 별도 컨텍스트에서 API 없이 동작하도록 URL에 설정 포함 */
export type OverlayPresetLike = {
  id?: string;
  scale?: string;
  memberSize?: string;
  totalSize?: string;
  layout?: "center-fixed" | "center";
  zoomMode?: "follow" | "invert" | "neutral";
  dense?: boolean;
  anchor?: string;
  tableFree?: boolean;
  tableX?: string;
  tableY?: string;
  autoFont?: boolean;
  compact?: boolean;
  tight?: boolean;
  lockWidth?: boolean;
  nameGrow?: boolean;
  nameCh?: string;
  tableMarginTop?: string;
  tableMarginRight?: string;
  tableMarginBottom?: string;
  tableMarginLeft?: string;
  autoFit?: "none" | "width" | "height" | "contain" | "cover";
  autoFitPin?: "cc" | "tl" | "tr" | "bl" | "br" | "tc" | "bc" | "cl" | "cr";
  box?: "full" | "tight";
  noCrop?: boolean;
  sumAnchor?: string;
  sumX?: string;
  sumY?: string;
  sumFree?: boolean;
  theme?: string;
  membersTheme?: string;
  totalTheme?: string;
  goalTheme?: string;
  tickerBaseTheme?: string;
  timerTheme?: string;
  missionTheme?: string;
  showMembers?: boolean;
  showTotal?: boolean;
  totalMode?: "total" | "contribution";
  showGoal?: boolean;
  goal?: string;
  /** 후원 초기화 시 복원할 목표(백오피스·자동 상향 스냅샷) */
  goalBaseline?: string;
  goalLabel?: string;
  goalWidth?: string;
  goalAnchor?: string;
  goalCurrent?: string;
  goalOpacity?: string;
  goalOpacityText?: boolean;
  goalTextColor?: string;
  goalFontSize?: string;
  goalTextOutlineColor?: string;
  goalTextOutlineWidth?: string;
  showPersonalGoal?: boolean;
  personalGoalTheme?: string;
  personalGoalAnchor?: string;
  personalGoalLimit?: string;
  personalGoalFree?: boolean;
  personalGoalX?: string;
  personalGoalY?: string;
  tickerInMembers?: boolean;
  tickerInGoal?: boolean;
  tickerInPersonalGoal?: boolean;
  showTicker?: boolean;
  tickerAnchor?: string;
  tickerWidth?: string;
  tickerFree?: boolean;
  tickerX?: string;
  tickerY?: string;
  showTimer?: boolean;
  timerStart?: number | null;
  timerAnchor?: string;
  timerShowHours?: boolean;
  timerFontColor?: string;
  timerBgColor?: string;
  timerBorderColor?: string;
  timerBgOpacity?: string;
  timerScale?: string;
  showMission?: boolean;
  missionAnchor?: string;
  missionWidth?: string;
  missionDuration?: string;
  missionBgOpacity?: string;
  missionBgColor?: string;
  missionItemColor?: string;
  missionTitleColor?: string;
  missionFontSize?: string;
  missionTitleText?: string;
  missionTitleEffect?: string;
  missionEffect?: string;
  missionEffectHotOnly?: string;
  missionDisplayMode?: string;
  missionVisibleCount?: string;
  missionSpeed?: string;
  missionGapSize?: string;
  host?: string;
  showBottomDonors?: boolean;
  donorsSize?: string;
  donorsGap?: string;
  donorsSpeed?: string;
  donorsLimit?: string;
  donorsFormat?: string;
  donorsUnit?: string;
  donorsColor?: string;
  donorsBgColor?: string;
  donorsBgOpacity?: string;
  tickerTheme?: string;
  tickerGlow?: string;
  tickerShadow?: string;
  currencyLocale?: string;
  tableOnly?: boolean;
  confettiMilestone?: string;
  tableBgOpacity?: string;
  tableBgGifUrl?: string;
  tableBgGifOpacity?: string;
  tableBgGifBrightness?: string;
  totalLineVisible?: boolean;
  vertical?: boolean;
  accountColor?: string;
  toonColor?: string;
  tableTextColor?: string;
};

export function presetToParams(preset: OverlayPresetLike | null): URLSearchParams {
  const q = new URLSearchParams();
  if (!preset) return q;
  q.set("scale", preset.scale || "0.75");
  q.set("memberSize", preset.memberSize || "18");
  q.set("totalSize", preset.totalSize || "40");
  if (preset.layout === "center-fixed" || preset.layout === "center") q.set("layout", "center-fixed");
  if (preset.zoomMode && preset.zoomMode !== "follow") q.set("zoomMode", preset.zoomMode);
  q.set("dense", String(preset.dense ?? true));
  if (preset.tableFree) {
    q.set("tableFree", "true");
    q.set("tableX", preset.tableX || "50");
    q.set("tableY", preset.tableY || "50");
  } else {
    q.set("anchor", preset.anchor || "cc");
  }
  if (preset.autoFont) q.set("autoFont", "true");
  if (preset.compact) q.set("compact", "true");
  if (preset.tight) q.set("tight", "true");
  if (preset.lockWidth) q.set("lockWidth", "true");
  if (preset.nameGrow === false) q.set("nameGrow", "false");
  if (preset.nameCh && preset.nameCh.trim()) q.set("nameCh", preset.nameCh.trim());
  if (preset.tableMarginTop && preset.tableMarginTop.trim()) q.set("tableMarginTop", preset.tableMarginTop.trim());
  if (preset.tableMarginRight && preset.tableMarginRight.trim()) q.set("tableMarginRight", preset.tableMarginRight.trim());
  if (preset.tableMarginBottom && preset.tableMarginBottom.trim()) q.set("tableMarginBottom", preset.tableMarginBottom.trim());
  if (preset.tableMarginLeft && preset.tableMarginLeft.trim()) q.set("tableMarginLeft", preset.tableMarginLeft.trim());
  if (preset.autoFit && preset.autoFit !== "none") q.set("autoFit", preset.autoFit);
  if (preset.autoFitPin && preset.autoFitPin !== "cc") q.set("fitPin", preset.autoFitPin);
  if (preset.box && preset.box !== "full") q.set("box", preset.box);
  if (preset.noCrop === false) q.set("noCrop", "false");
  q.set("theme", preset.theme || "default");
  if (preset.membersTheme && preset.membersTheme !== "auto") q.set("membersTheme", preset.membersTheme);
  if (preset.totalTheme && preset.totalTheme !== "auto") q.set("totalTheme", preset.totalTheme);
  if (preset.goalTheme && preset.goalTheme !== "auto") q.set("goalTheme", preset.goalTheme);
  if (preset.tickerBaseTheme && preset.tickerBaseTheme !== "auto") q.set("tickerBaseTheme", preset.tickerBaseTheme);
  if (preset.timerTheme && preset.timerTheme !== "auto") q.set("timerTheme", preset.timerTheme);
  if (preset.missionTheme && preset.missionTheme !== "auto") q.set("missionTheme", preset.missionTheme);
  q.set("showMembers", String(preset.showMembers ?? true));
  q.set("showTotal", String(preset.showTotal ?? true));
  if (preset.totalMode === "contribution") q.set("totalMode", "contribution");
  if (preset.sumFree) {
    q.set("sumX", preset.sumX || "50");
    q.set("sumY", preset.sumY || "90");
  } else {
    q.set("sumAnchor", preset.sumAnchor || "bc");
  }
  if (preset.showGoal) {
    q.set("showGoal", "true");
    q.set("goal", preset.goal || "0");
    q.set("goalLabel", preset.goalLabel || "후원");
    q.set("goalWidth", preset.goalWidth || "400");
    q.set("goalAnchor", preset.goalAnchor || "bc");
    if (preset.goalCurrent && preset.goalCurrent.trim()) q.set("goalCurrent", preset.goalCurrent.trim());
    if (preset.goalOpacity && preset.goalOpacity.trim()) q.set("goalOpacity", preset.goalOpacity.trim());
    if (preset.goalOpacityText) q.set("goalOpacityText", "true");
    appendGoalBarStyleParams(q, preset);
  }
  if (preset.showPersonalGoal) q.set("showPersonalGoal", "true");
  if (preset.personalGoalTheme && preset.personalGoalTheme.trim()) q.set("personalGoalTheme", preset.personalGoalTheme.trim());
  if (preset.personalGoalFree) {
    q.set("personalGoalFree", "true");
    q.set("personalGoalX", preset.personalGoalX || "78");
    q.set("personalGoalY", preset.personalGoalY || "82");
  } else if (preset.personalGoalAnchor && preset.personalGoalAnchor.trim()) {
    q.set("personalGoalAnchor", preset.personalGoalAnchor.trim());
  }
  if (preset.personalGoalLimit && preset.personalGoalLimit.trim()) q.set("personalGoalLimit", preset.personalGoalLimit.trim());
  if (preset.tickerInMembers) q.set("tickerInMembers", "true");
  if (preset.tickerInGoal) q.set("tickerInGoal", "true");
  if (preset.tickerInPersonalGoal) q.set("tickerInPersonalGoal", "true");
  if (preset.showTicker) {
    q.set("showTicker", "true");
    if (preset.tickerFree) {
      q.set("tickerX", preset.tickerX || "50");
      q.set("tickerY", preset.tickerY || "86");
    } else if (preset.tickerAnchor) {
      q.set("tickerAnchor", preset.tickerAnchor);
    }
    if (preset.tickerWidth && preset.tickerWidth.trim()) q.set("tickerWidth", preset.tickerWidth.trim());
  }
  if (preset.showTimer && preset.timerStart) {
    q.set("showTimer", "true");
    q.set("timerStart", String(preset.timerStart));
    q.set("timerAnchor", preset.timerAnchor || "tr");
    if (preset.timerShowHours) q.set("timerShowHours", "true");
    if (preset.timerFontColor && preset.timerFontColor.trim()) q.set("timerFontColor", preset.timerFontColor.trim());
    if (preset.timerBgColor && preset.timerBgColor.trim()) q.set("timerBgColor", preset.timerBgColor.trim());
    if (preset.timerBorderColor && preset.timerBorderColor.trim()) q.set("timerBorderColor", preset.timerBorderColor.trim());
    if (preset.timerBgOpacity && preset.timerBgOpacity.trim()) q.set("timerBgOpacity", preset.timerBgOpacity.trim());
    if (preset.timerScale && preset.timerScale.trim()) q.set("timerScale", preset.timerScale.trim());
  }
  if (preset.showMission) {
    q.set("showMission", "true");
    if (preset.missionAnchor && preset.missionAnchor.trim()) q.set("missionAnchor", preset.missionAnchor);
    if (preset.missionWidth && preset.missionWidth.trim()) q.set("missionWidth", preset.missionWidth.trim());
    if (preset.missionDuration && preset.missionDuration.trim()) q.set("missionDuration", preset.missionDuration.trim());
    q.set("missionBgOpacity", (preset.missionBgOpacity && preset.missionBgOpacity.trim()) ? preset.missionBgOpacity.trim() : "85");
    if (preset.missionBgColor && preset.missionBgColor.trim()) q.set("missionBgColor", preset.missionBgColor.trim());
    if (preset.missionItemColor && preset.missionItemColor.trim()) q.set("missionItemColor", preset.missionItemColor.trim());
    if (preset.missionTitleColor && preset.missionTitleColor.trim()) q.set("missionTitleColor", preset.missionTitleColor.trim());
    if (preset.missionFontSize && preset.missionFontSize.trim()) q.set("missionFontSize", preset.missionFontSize.trim());
    if (preset.missionTitleText && preset.missionTitleText.trim()) q.set("missionTitleText", preset.missionTitleText.trim());
    if (preset.missionTitleEffect && preset.missionTitleEffect.trim()) q.set("missionTitleEffect", preset.missionTitleEffect.trim());
    if (preset.missionEffect && preset.missionEffect.trim()) q.set("missionEffect", preset.missionEffect.trim());
    if (preset.missionEffectHotOnly && preset.missionEffectHotOnly.trim()) q.set("missionEffectHotOnly", preset.missionEffectHotOnly.trim());
    if (preset.missionDisplayMode && preset.missionDisplayMode.trim()) q.set("displayMode", preset.missionDisplayMode.trim());
    if (preset.missionVisibleCount && preset.missionVisibleCount.trim()) q.set("visibleCount", preset.missionVisibleCount.trim());
    if (preset.missionSpeed && preset.missionSpeed.trim()) q.set("missionSpeed", preset.missionSpeed.trim());
    if (preset.missionGapSize && preset.missionGapSize.trim()) q.set("gapSize", preset.missionGapSize.trim());
  }
  if (preset.showBottomDonors) q.set("showBottomDonors", "true");
  if (preset.donorsSize && preset.donorsSize.trim()) q.set("donorsSize", preset.donorsSize.trim());
  if (preset.donorsGap && preset.donorsGap.trim()) q.set("donorsGap", preset.donorsGap.trim());
  q.set("donorsSpeed", (preset.donorsSpeed && preset.donorsSpeed.trim()) ? preset.donorsSpeed.trim() : "60");
  if (preset.donorsLimit && preset.donorsLimit.trim()) q.set("donorsLimit", preset.donorsLimit.trim());
  q.set("donorsFormat", (preset.donorsFormat || "short").trim() === "full" ? "full" : "short");
  if (preset.donorsUnit && preset.donorsUnit.trim()) q.set("donorsUnit", preset.donorsUnit.trim());
  if (preset.donorsColor && preset.donorsColor.trim()) q.set("donorsColor", preset.donorsColor.trim());
  if (preset.donorsBgColor && preset.donorsBgColor.trim()) q.set("donorsBgColor", preset.donorsBgColor.trim());
  q.set("donorsBgOpacity", (preset.donorsBgOpacity && preset.donorsBgOpacity.trim()) ? preset.donorsBgOpacity.trim() : "0");
  if (preset.tickerTheme && preset.tickerTheme.trim()) q.set("tickerTheme", preset.tickerTheme.trim());
  q.set("tickerGlow", (preset.tickerGlow && preset.tickerGlow.trim()) ? preset.tickerGlow.trim() : "45");
  q.set("tickerShadow", (preset.tickerShadow && preset.tickerShadow.trim()) ? preset.tickerShadow.trim() : "35");
  q.set("currencyLocale", (preset.currencyLocale && preset.currencyLocale.trim()) ? preset.currencyLocale.trim() : "ko-KR");
  if (preset.tableOnly) q.set("tableOnly", "true");
  if (preset.confettiMilestone && preset.confettiMilestone.trim()) q.set("confettiMilestone", preset.confettiMilestone.trim());
  q.set("tableBgOpacity", (preset.tableBgOpacity && preset.tableBgOpacity.trim()) ? preset.tableBgOpacity.trim() : "100");
  if (preset.tableBgGifUrl && preset.tableBgGifUrl.trim()) q.set("tableBgGifUrl", preset.tableBgGifUrl.trim());
  if (preset.tableBgGifOpacity && preset.tableBgGifOpacity.trim()) q.set("tableBgGifOpacity", preset.tableBgGifOpacity.trim());
  if (preset.tableBgGifBrightness && preset.tableBgGifBrightness.trim()) q.set("tableBgGifBrightness", preset.tableBgGifBrightness.trim());
  if (preset.totalLineVisible) q.set("totalLineVisible", "true");
  if (preset.accountColor && preset.accountColor.trim()) q.set("accountColor", preset.accountColor.trim());
  if (preset.toonColor && preset.toonColor.trim()) q.set("toonColor", preset.toonColor.trim());
  if (preset.tableTextColor && preset.tableTextColor.trim()) q.set("tableTextColor", preset.tableTextColor.trim());
  if (preset.vertical) q.set("vertical", "true");
  if (preset.host && preset.host.trim()) q.set("host", preset.host.trim());
  return q;
}

/** OBS·Prism URL에 넣을 프리셋 시각 파라미터(goal·goalCurrent 제외 — 목표는 /api/state 동기) */
const PRESET_BROADCAST_SKIP_KEYS = new Set(["goal", "goalCurrent"]);

/**
 * 오버레이가 `/api/state` 프리셋을 읽은 뒤에는 URL에 박힌 예전 스타일보다 프리셋을 우선한다.
 * (관리자에서 색·크기 변경 시 URL 재복사·OBS 소스 재등록 없이 실시간 반영)
 */
export const OVERLAY_LIVE_PRESET_STYLE_KEYS = new Set([
  "goalTextColor",
  "goalFontSize",
  "goalTextOutlineColor",
  "goalTextOutlineWidth",
  "goalOpacity",
  "goalOpacityText",
  "memberSize",
  "totalSize",
  "tableTextColor",
  "accountColor",
  "toonColor",
  "tableBgOpacity",
  "tableBgGifOpacity",
  "tableBgGifBrightness",
]);

const GOAL_HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** 후원 목표 글자색 — `#` 없이 입력해도 허용 */
export function normalizeGoalHexColor(raw: string): string | null {
  const s = String(raw || "").trim();
  if (GOAL_HEX_COLOR_RE.test(s)) return s;
  const bare = s.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3,8}$/.test(bare)) return `#${bare}`;
  return null;
}

/**
 * `/api/state` 프리셋이 준비되면 URL에 박힌 예전 스타일보다 프리셋 우선(OBS `host` 유무와 무관).
 */
export function resolveLivePresetStyleParam(
  key: string,
  rawSp: SearchParamsLike,
  presetParams: URLSearchParams,
  opts: { ready: boolean }
): string | null {
  const fromPreset = presetParams.get(key);
  if (
    opts.ready &&
    OVERLAY_LIVE_PRESET_STYLE_KEYS.has(key) &&
    fromPreset !== null &&
    fromPreset !== ""
  ) {
    return fromPreset;
  }
  const direct = rawSp.get(key);
  if (direct !== null && direct !== "") return direct;
  return fromPreset;
}

export function resolveGoalTextColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  const merged = resolveLivePresetStyleParam(
    "goalTextColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeGoalHexColor(merged || "") || "#6b2d4a";
}

export function resolveGoalFontSizePx(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number | undefined {
  const raw = resolveLivePresetStyleParam("goalFontSize", rawSp, presetToParams(preset), opts) || "";
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.max(10, Math.min(48, n)) : undefined;
}

export function resolveGoalTextOutlineColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string | undefined {
  const merged = resolveLivePresetStyleParam(
    "goalTextOutlineColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  const hex = normalizeGoalHexColor(merged || "");
  return hex || undefined;
}

export function resolveGoalTextOutlineWidthPx(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number | undefined {
  const raw =
    resolveLivePresetStyleParam("goalTextOutlineWidth", rawSp, presetToParams(preset), opts) || "";
  if (!raw.trim()) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(3, n));
}

/** 후원 목표 막대 글자색·폰트(px) — OBS URL·프리셋 공통 */
export function appendGoalBarStyleParams(target: URLSearchParams, preset: OverlayPresetLike): void {
  const goalTextColor = normalizeGoalHexColor((preset.goalTextColor || "").trim());
  if (goalTextColor) target.set("goalTextColor", goalTextColor);
  const goalFontRaw = (preset.goalFontSize || "").trim();
  if (goalFontRaw) {
    const gfs = Math.max(10, Math.min(48, parseInt(goalFontRaw, 10) || 0));
    if (gfs > 0) target.set("goalFontSize", String(gfs));
  }
  const goalOutlineColor = normalizeGoalHexColor((preset.goalTextOutlineColor || "").trim());
  if (goalOutlineColor) target.set("goalTextOutlineColor", goalOutlineColor);
  const outlineW = (preset.goalTextOutlineWidth || "").trim();
  if (outlineW) {
    const w = Math.max(0, Math.min(3, parseFloat(outlineW) || 0));
    target.set("goalTextOutlineWidth", String(w));
  }
}

/** 후원순위 OBS URL에 테마·폰트 크기 반영(관리자 저장값과 동일하게) */
export function donorRankingsThemeToSearchParams(theme: DonorRankingsTheme): URLSearchParams {
  const q = new URLSearchParams();
  q.set("top", String(theme.top));
  q.set("titleSize", String(theme.titleSize));
  q.set("rowSize", String(theme.rowSize));
  q.set("rankSize", String(theme.rankSize));
  q.set("overlayOpacity", String(theme.overlayOpacity));
  if (theme.bg.trim()) q.set("bg", theme.bg.trim());
  if (theme.panelBg.trim()) q.set("panelBg", theme.panelBg.trim());
  if (theme.borderColor.trim()) q.set("border", theme.borderColor.trim());
  if (theme.headerAccountBg.trim()) q.set("headerAccountBg", theme.headerAccountBg.trim());
  if (theme.headerToonBg.trim()) q.set("headerToonBg", theme.headerToonBg.trim());
  if (theme.rankColor.trim()) q.set("rankColor", theme.rankColor.trim());
  if (theme.nameColor.trim()) q.set("nameColor", theme.nameColor.trim());
  if (theme.amountColor.trim()) q.set("amountColor", theme.amountColor.trim());
  if (theme.titleColor.trim()) q.set("titleColor", theme.titleColor.trim());
  if (theme.outlineColor.trim()) q.set("outline", theme.outlineColor.trim());
  return q;
}

export function mergePresetBroadcastVisualParams(
  target: URLSearchParams,
  preset: OverlayPresetLike | null
): void {
  const pp = presetToParams(preset);
  pp.forEach((value, key) => {
    if (PRESET_BROADCAST_SKIP_KEYS.has(key)) return;
    if (value !== "") target.set(key, value);
  });
}

type SearchParamsLike = {
  get(name: string): string | null;
};

/** 인벤 `imageUrl` 의 `/uploads/sigs/<uid>/` 에서 이미지 소유 계정 추론(OBS `u=` 오타 시 복구) */
export function inferSigUploadUserIdFromInventory(
  inventory: SigItem[] | undefined,
  fallback: string
): string {
  if (!inventory?.length) return fallback;
  const counts = new Map<string, number>();
  for (const item of inventory) {
    const m = String(item.imageUrl || "").match(/\/uploads\/sigs\/([a-zA-Z0-9_-]{1,64})\//i);
    if (m?.[1]) counts.set(m[1]!, (counts.get(m[1]!) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [uid, n] of counts) {
    if (n > bestN) {
      best = uid;
      bestN = n;
    }
  }
  return best || fallback;
}

export function getOverlayUserIdFromSearchParams(
  searchParams: SearchParamsLike,
  fallback = "finalent"
): string {
  /** `n=`·`id=` 레거시·오타 호환 (OBS에서 u 대신 붙인 경우 폴링 user 불일치 → 회전 상태 꼬임) */
  const userId =
    searchParams.get("u") ||
    searchParams.get("user") ||
    searchParams.get("n") ||
    searchParams.get("id");
  return (userId || "").trim() || fallback;
}

/** OBS 프리셋 등에서 `memberId=null` 문자열이 들어오면 필터가 깨지므로 무시 */
export function getOverlayMemberFilterIdFromSearchParams(searchParams: SearchParamsLike): string {
  const raw = (searchParams.get("memberId") || searchParams.get("member") || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "null" || lower === "undefined" || lower === "none" || lower === "-" || lower === "nil") {
    return "";
  }
  return raw;
}

import {
  isOverlayToolsHubPath,
  shouldUseOverlayScrollableShell,
} from "@/lib/overlay-shell-layout";

export { isOverlayToolsHubPath, shouldUseOverlayScrollableShell };

/** 관리자 대시보드 안 `<iframe>` 미리보기 — 과다 `/api/state`·SSE로 동기화가 막히는 것을 줄이기 위한 플래그 */
export function isAdminDashboardPreviewEmbed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("adminPreviewEmbed") === "1";
  } catch {
    return false;
  }
}

/**
 * 동일 오리진에서 `/admin`이 `<iframe src="/overlay...">`로 넣은 경우.
 * `adminPreviewEmbed=1`이 빠진 구 URL·캐시 번들에서도 `/api/events`·연쇄 GET이 겹치지 않게 한다.
 */
export function isEmbeddedInSameOriginAdminFrame(): boolean {
  if (typeof window === "undefined") return false;
  if (window.parent === window) return false;
  try {
    if (window.parent.location.origin !== window.location.origin) return false;
    const p = window.parent.location.pathname || "";
    return p.startsWith("/admin");
  } catch {
    return false;
  }
}

export const OVERLAY_POLL_MS_QUERY = "overlayPollMs";

/** 방송·OBS용 URL에서 주기 폴링 쿼리 제거(관리자 복사·북마크 정리) */
export function sanitizeBroadcastOverlayUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = raw.startsWith("http://") || raw.startsWith("https://") ? new URL(raw) : new URL(raw, base);
    parsed.searchParams.delete(OVERLAY_POLL_MS_QUERY);
    if (raw.startsWith("http://") || raw.startsWith("https://")) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw
      .replace(/([?&])overlayPollMs=[^&]*&?/gi, "$1")
      .replace(/[?&]$/, "")
      .replace(/\?&/, "?");
  }
}

/**
 * @deprecated OverlayBroadcastHygiene 가 `router.replace` 로 처리. 직접 `history.replaceState` 는 App Router 오류 유발.
 */
export function stripOverlayPollMsFromBrowserLocation(): void {
  /* noop — 레이아웃 OverlayBroadcastHygiene 사용 */
}

/** 미리보기 iframe·데모 허브 등에서 SSE 생략. 디버그 시 `?overlayAllowSse=1`로 다시 켤 수 있음. */
export function shouldSuppressOverlaySseConnection(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("overlayAllowSse") === "1") return false;
    if (isOverlayToolsHubPath(window.location.pathname)) return true;
    if (sp.get("hubPreview") === "1") return true;
    if (sp.get("demo") === "true") return true;
    if (sp.has("snap") || sp.has("snapKey")) return true;
    if (sp.has("_verify")) return true;
  } catch {
    /* noop */
  }
  return isAdminDashboardPreviewEmbed() || isEmbeddedInSameOriginAdminFrame();
}

/**
 * 관리자 iframe `src`에만 붙입니다. OBS·방송용으로 복사하는 URL에는 넣지 마세요.
 * 상대 경로(`/overlay/...`)도 처리합니다.
 */
export function appendAdminPreviewEmbedToOverlayUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u) return u;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = u.startsWith("http://") || u.startsWith("https://") ? new URL(u) : new URL(u, base);
    if (parsed.searchParams.get("adminPreviewEmbed") === "1") {
      return u.startsWith("http://") || u.startsWith("https://") ? u : `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    parsed.searchParams.set("adminPreviewEmbed", "1");
    parsed.searchParams.set("hubPreview", "1");
    if (!parsed.searchParams.has("scalePct")) parsed.searchParams.set("scalePct", "100");
    if (u.startsWith("http://") || u.startsWith("https://")) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const extra = "adminPreviewEmbed=1&hubPreview=1&scalePct=100";
    return u.includes("adminPreviewEmbed=1") ? u : `${u}${u.includes("?") ? "&" : "?"}${extra}`;
  }
}
