import type { OverlayPresetLike } from "@/lib/overlay-params";

export type ExcelRankTop3Mode = "off" | "text" | "emoji" | "bg" | "both";
/** none=없음 colorShift=지정색 gradient 흐름 rainbow=등수별 무지개 흐름 glow=글로우 sparkle=반짝 pulse=레거시(무시) */
export type ExcelRankTop3RowEffect = "none" | "pulse" | "colorShift" | "rainbow" | "glow" | "sparkle";
/** @deprecated 전역 기본값 — rankNEffect 미설정 시 사용 */
export type ExcelRankTop3Effect = ExcelRankTop3RowEffect;
/** 4위 이하·배경만 모드 순위 숫자 표기 */
export type ExcelRankLabelFormat = "hash" | "plain" | "suffix";

export type ExcelRankTop3Style = {
  mode: ExcelRankTop3Mode;
  rankLabelFormat: ExcelRankLabelFormat;
  rank1Bg: string;
  rank2Bg: string;
  rank3Bg: string;
  rank1Mark: string;
  rank2Mark: string;
  rank3Mark: string;
  /** 전역 기본 효과(rankNEffect 비었을 때) */
  effect: ExcelRankTop3RowEffect;
  rank1Effect: ExcelRankTop3RowEffect | "";
  rank2Effect: ExcelRankTop3RowEffect | "";
  rank3Effect: ExcelRankTop3RowEffect | "";
  rank1TextColor: string;
  rank2TextColor: string;
  rank3TextColor: string;
  rank1TextColorAlt: string;
  rank2TextColorAlt: string;
  rank3TextColorAlt: string;
};

export const DEFAULT_EXCEL_RANK_TOP3_BGS = [
  "rgba(254, 240, 138, 0.92)",
  "rgba(254, 215, 170, 0.88)",
  "rgba(187, 247, 208, 0.88)",
] as const;

export const DEFAULT_EXCEL_RANK_TOP3_MARKS = ["🥇", "🥈", "🥉"] as const;

export const DEFAULT_EXCEL_RANK_TOP3_TEXT_COLORS = [
  { main: "#ca8a04", alt: "#fef08a" },
  { main: "#64748b", alt: "#e2e8f0" },
  { main: "#b45309", alt: "#fde68a" },
] as const;

export const DEFAULT_EXCEL_RANK_TOP3_EFFECTS: ExcelRankTop3RowEffect[] = [
  "colorShift",
  "glow",
  "sparkle",
];

export const DEFAULT_EXCEL_RANK_TOP3_STYLE: ExcelRankTop3Style = {
  mode: "off",
  rankLabelFormat: "hash",
  rank1Bg: "",
  rank2Bg: "",
  rank3Bg: "",
  rank1Mark: "",
  rank2Mark: "",
  rank3Mark: "",
  effect: "none",
  rank1Effect: "",
  rank2Effect: "",
  rank3Effect: "",
  rank1TextColor: "",
  rank2TextColor: "",
  rank3TextColor: "",
  rank1TextColorAlt: "",
  rank2TextColorAlt: "",
  rank3TextColorAlt: "",
};

function normalizeRankLabelFormat(raw: unknown): ExcelRankLabelFormat {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "plain" || v === "suffix") return v;
  return "hash";
}

export function formatExcelRankLabel(rank: number, format: ExcelRankLabelFormat): string {
  if (format === "plain") return String(rank);
  if (format === "suffix") return `${rank}위`;
  return `#${rank}`;
}

function normalizeMode(raw: unknown): ExcelRankTop3Mode {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "off") return "off";
  if (v === "text" || v === "emoji" || v === "bg" || v === "both") return "text";
  return "off";
}

export function isExcelRankTop3TextMode(mode: ExcelRankTop3Mode): boolean {
  return mode === "text";
}

export function normalizeExcelRankTop3RowEffect(raw: unknown): ExcelRankTop3RowEffect {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "pulse" || v === "colorshift" || v === "color-shift" || v === "color_shift") return "colorShift";
  if (v === "rainbow") return "rainbow";
  if (v === "glow") return "glow";
  if (v === "sparkle") return "sparkle";
  return "none";
}

function normalizePerRankEffect(raw: unknown): ExcelRankTop3RowEffect | "" {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  return normalizeExcelRankTop3RowEffect(t);
}

function normalizeMark(raw: unknown, fallback: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return fallback;
  return t.slice(0, 8);
}

function normalizeBg(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 80);
}

function normalizeTextColor(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 32);
}

type ExcelRankTop3StyleInput = {
  mode?: unknown;
  rankLabelFormat?: unknown;
  effect?: unknown;
  rank1Effect?: unknown;
  rank2Effect?: unknown;
  rank3Effect?: unknown;
  rank1Bg?: unknown;
  rank2Bg?: unknown;
  rank3Bg?: unknown;
  rank1Mark?: unknown;
  rank2Mark?: unknown;
  rank3Mark?: unknown;
  rank1TextColor?: unknown;
  rank2TextColor?: unknown;
  rank3TextColor?: unknown;
  rank1TextColorAlt?: unknown;
  rank2TextColorAlt?: unknown;
  rank3TextColorAlt?: unknown;
};

export function normalizeExcelRankTop3Style(input?: ExcelRankTop3StyleInput | null): ExcelRankTop3Style {
  const v = input && typeof input === "object" ? input : {};
  return {
    mode: normalizeMode(v.mode),
    rankLabelFormat: normalizeRankLabelFormat(v.rankLabelFormat),
    rank1Bg: normalizeBg(v.rank1Bg),
    rank2Bg: normalizeBg(v.rank2Bg),
    rank3Bg: normalizeBg(v.rank3Bg),
    rank1Mark: normalizeMark(v.rank1Mark, ""),
    rank2Mark: normalizeMark(v.rank2Mark, ""),
    rank3Mark: normalizeMark(v.rank3Mark, ""),
    effect: normalizeExcelRankTop3RowEffect(v.effect),
    rank1Effect: normalizePerRankEffect(v.rank1Effect),
    rank2Effect: normalizePerRankEffect(v.rank2Effect),
    rank3Effect: normalizePerRankEffect(v.rank3Effect),
    rank1TextColor: normalizeTextColor(v.rank1TextColor),
    rank2TextColor: normalizeTextColor(v.rank2TextColor),
    rank3TextColor: normalizeTextColor(v.rank3TextColor),
    rank1TextColorAlt: normalizeTextColor(v.rank1TextColorAlt),
    rank2TextColorAlt: normalizeTextColor(v.rank2TextColorAlt),
    rank3TextColorAlt: normalizeTextColor(v.rank3TextColorAlt),
  };
}

export function excelRankTop3StyleFromPreset(preset: OverlayPresetLike | null | undefined): ExcelRankTop3Style {
  if (!preset || typeof preset !== "object") return { ...DEFAULT_EXCEL_RANK_TOP3_STYLE };
  const p = preset as OverlayPresetLike & ExcelRankTop3StyleInput & {
    rankTop3Mode?: string;
    rankTop3Effect?: string;
    rankLabelFormat?: string;
  };
  return normalizeExcelRankTop3Style({
    mode: p.rankTop3Mode,
    rankLabelFormat: p.rankLabelFormat,
    rank1Bg: p.rank1Bg,
    rank2Bg: p.rank2Bg,
    rank3Bg: p.rank3Bg,
    rank1Mark: p.rank1Mark,
    rank2Mark: p.rank2Mark,
    rank3Mark: p.rank3Mark,
    effect: p.rankTop3Effect,
    rank1Effect: p.rank1Effect,
    rank2Effect: p.rank2Effect,
    rank3Effect: p.rank3Effect,
    rank1TextColor: p.rank1TextColor,
    rank2TextColor: p.rank2TextColor,
    rank3TextColor: p.rank3TextColor,
    rank1TextColorAlt: p.rank1TextColorAlt,
    rank2TextColorAlt: p.rank2TextColorAlt,
    rank3TextColorAlt: p.rank3TextColorAlt,
  });
}

type SearchParamsLike = { get(name: string): string | null };

function readParam(sp: SearchParamsLike, key: string): string {
  return (sp.get(key) || "").trim();
}

/** URL(테스트·미리보기) → 저장 프리셋 순으로 1~3위 강조 스타일 병합 */
export function resolveExcelRankTop3Style(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null | undefined,
  opts: { ready: boolean }
): ExcelRankTop3Style {
  const fromPreset = excelRankTop3StyleFromPreset(preset);
  if (opts.ready) return fromPreset;

  const urlMode = readParam(rawSp, "rankTop3Mode");
  const mode = urlMode ? normalizeMode(urlMode) : fromPreset.mode;
  return normalizeExcelRankTop3Style({
    mode,
    rankLabelFormat: readParam(rawSp, "rankLabelFormat") || fromPreset.rankLabelFormat,
    rank1Bg: readParam(rawSp, "rank1Bg") || fromPreset.rank1Bg,
    rank2Bg: readParam(rawSp, "rank2Bg") || fromPreset.rank2Bg,
    rank3Bg: readParam(rawSp, "rank3Bg") || fromPreset.rank3Bg,
    rank1Mark: readParam(rawSp, "rank1Mark") || fromPreset.rank1Mark,
    rank2Mark: readParam(rawSp, "rank2Mark") || fromPreset.rank2Mark,
    rank3Mark: readParam(rawSp, "rank3Mark") || fromPreset.rank3Mark,
    effect: readParam(rawSp, "rankTop3Effect")
      ? normalizeExcelRankTop3RowEffect(readParam(rawSp, "rankTop3Effect"))
      : fromPreset.effect,
    rank1Effect: readParam(rawSp, "rank1Effect") || fromPreset.rank1Effect,
    rank2Effect: readParam(rawSp, "rank2Effect") || fromPreset.rank2Effect,
    rank3Effect: readParam(rawSp, "rank3Effect") || fromPreset.rank3Effect,
    rank1TextColor: readParam(rawSp, "rank1TextColor") || fromPreset.rank1TextColor,
    rank2TextColor: readParam(rawSp, "rank2TextColor") || fromPreset.rank2TextColor,
    rank3TextColor: readParam(rawSp, "rank3TextColor") || fromPreset.rank3TextColor,
    rank1TextColorAlt: readParam(rawSp, "rank1TextColorAlt") || fromPreset.rank1TextColorAlt,
    rank2TextColorAlt: readParam(rawSp, "rank2TextColorAlt") || fromPreset.rank2TextColorAlt,
    rank3TextColorAlt: readParam(rawSp, "rank3TextColorAlt") || fromPreset.rank3TextColorAlt,
  });
}

export type ExcelRankTop3RowStyle = {
  rankLabel: string;
  rowBg?: string;
  rowClass?: string;
  rankCellClass?: string;
  rankCellStyle?: Record<string, string>;
  nameCellClass?: string;
  nameCellStyle?: Record<string, string>;
  /** gradient clip text — 외곽선 stroke와 분리 */
  gradientText?: boolean;
};

/** 지정색 A·B + 등수 톤으로 자연스러운 multi-stop gradient */
export function buildRankFlowGradient(main: string, alt: string, rank: 1 | 2 | 3): string {
  const accent =
    rank === 1 ? "#fffbeb" : rank === 2 ? "#f8fafc" : "#fef3c7";
  const mid =
    rank === 1 ? "#fde047" : rank === 2 ? "#cbd5e1" : "#fb923c";
  const stops = [main, alt, accent, mid, alt, main, alt, main];
  const parts = stops.map((color, i) => {
    const pct = (i / (stops.length - 1)) * 100;
    return `${color} ${pct.toFixed(1)}%`;
  });
  return `linear-gradient(90deg, ${parts.join(", ")})`;
}

export function isExcelRankGradientTextEffect(effect: ExcelRankTop3RowEffect): boolean {
  return effect === "colorShift" || effect === "rainbow";
}

/** 본문 글자색·stroke 강제 CSS에서 제외 — background-clip gradient 텍스트 */
export const EXCEL_RANK_FX_CSS_NOT =
  ":not(.overlay-rank-fx-colorShift):not(.overlay-rank-fx-rainbow):not(.overlay-rank-fx-glow):not(.overlay-rank-fx-sparkle)";

function resolveRankEffect(style: ExcelRankTop3Style, rank: 1 | 2 | 3): ExcelRankTop3RowEffect {
  if (!isExcelRankTop3TextMode(style.mode)) return "none";
  const perRank = [style.rank1Effect, style.rank2Effect, style.rank3Effect][rank - 1];
  if (perRank) return perRank;
  if (style.effect !== "none") return style.effect;
  return "colorShift";
}

function resolveRankTextColors(style: ExcelRankTop3Style, rank: 1 | 2 | 3): { main: string; alt: string } {
  const idx = rank - 1;
  const mains = [style.rank1TextColor, style.rank2TextColor, style.rank3TextColor];
  const alts = [style.rank1TextColorAlt, style.rank2TextColorAlt, style.rank3TextColorAlt];
  const defaults = DEFAULT_EXCEL_RANK_TOP3_TEXT_COLORS[idx]!;
  return {
    main: (mains[idx] || "").trim() || defaults.main,
    alt: (alts[idx] || "").trim() || defaults.alt,
  };
}

function buildRankTextCellClass(effect: ExcelRankTop3RowEffect, rank: number): string | undefined {
  if (effect === "none" || effect === "pulse") return undefined;
  if (effect === "rainbow") return `overlay-rank-fx-rainbow overlay-rank-tone-${rank}`;
  if (effect === "colorShift") return "overlay-rank-fx-colorShift";
  if (effect === "glow" || effect === "sparkle") return `overlay-rank-fx-${effect}`;
  return undefined;
}

function buildRankEffectClasses(effect: ExcelRankTop3RowEffect, rank: number): {
  rankCellClass?: string;
  nameCellClass?: string;
} {
  const textClass = buildRankTextCellClass(effect, rank);
  if (!textClass) return {};
  return {
    rankCellClass: textClass,
    nameCellClass: textClass,
  };
}

export function resolveExcelRankTop3RowStyle(
  rank: number | null,
  style: ExcelRankTop3Style,
  opts?: { donationTotal?: number }
): ExcelRankTop3RowStyle {
  if (rank == null) {
    return { rankLabel: "—" };
  }

  const numericLabel = formatExcelRankLabel(rank, style.rankLabelFormat);
  const plainRankLabel = String(rank);

  if (!isExcelRankTop3TextMode(style.mode) || rank > 3) {
    return { rankLabel: numericLabel };
  }

  const donationTotal = Math.max(0, Math.round(Number(opts?.donationTotal) || 0));
  if (donationTotal <= 0) {
    return { rankLabel: plainRankLabel };
  }

  const effect = resolveRankEffect(style, rank as 1 | 2 | 3);
  const textColors = resolveRankTextColors(style, rank as 1 | 2 | 3);
  const fx = buildRankEffectClasses(effect, rank);

  const textCellStyle: Record<string, string> = {
    "--excel-rank-c1": textColors.main,
    "--excel-rank-c2": textColors.alt,
  };

  if (effect === "colorShift") {
    textCellStyle["--excel-rank-gradient"] = buildRankFlowGradient(
      textColors.main,
      textColors.alt,
      rank as 1 | 2 | 3
    );
  } else if (effect === "glow" || effect === "sparkle") {
    textCellStyle.color = textColors.main;
  }

  const gradientText = isExcelRankGradientTextEffect(effect);
  const hasTextFx =
    effect === "colorShift" ||
    effect === "rainbow" ||
    effect === "glow" ||
    effect === "sparkle";

  return {
    rankLabel: plainRankLabel,
    rankCellClass: fx.rankCellClass,
    rankCellStyle: hasTextFx ? textCellStyle : undefined,
    nameCellClass: fx.nameCellClass,
    nameCellStyle: hasTextFx ? textCellStyle : undefined,
    gradientText,
  };
}

/** 1~3위 효과 CSS — overlay page style 태그에 삽입 */
export const EXCEL_RANK_TOP3_EFFECTS_CSS = `
@keyframes overlay-rank-gradient-flow {
  0% { background-position: 0% 50%; }
  100% { background-position: 300% 50%; }
}
@keyframes overlay-rank-glow {
  0%, 100% {
    filter: drop-shadow(0 0 1px var(--excel-rank-c1));
  }
  50% {
    filter: drop-shadow(0 0 6px var(--excel-rank-c2)) drop-shadow(0 0 10px var(--excel-rank-c1));
  }
}
@keyframes overlay-rank-sparkle {
  0%, 100% { filter: brightness(1); opacity: 1; }
  50% { filter: brightness(1.35); opacity: 0.92; }
}
.overlay-root .overlay-elegant-table tbody td .overlay-rank-fx-colorShift,
.overlay-root .overlay-elegant-table tbody td .overlay-rank-fx-rainbow,
.overlay-root .overlay-elegant-table tbody td .overlay-rank-fx-glow,
.overlay-root .overlay-elegant-table tbody td .overlay-rank-fx-sparkle {
  -webkit-text-stroke: 0 !important;
  text-shadow: none !important;
  paint-order: normal !important;
}
.overlay-root .overlay-rank-fx-colorShift,
.overlay-root .overlay-rank-fx-rainbow {
  display: inline-block;
  background-size: 300% 100%;
  background-repeat: repeat;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  animation: overlay-rank-gradient-flow 4.8s linear infinite !important;
  backface-visibility: hidden;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.55));
}
.overlay-root .overlay-rank-fx-colorShift {
  background-image: var(
    --excel-rank-gradient,
    linear-gradient(90deg, var(--excel-rank-c1), var(--excel-rank-c2), var(--excel-rank-c1))
  );
}
.overlay-root .overlay-rank-tone-1 {
  background-image: linear-gradient(
    90deg,
    #fef08a 0%,
    #fbbf24 14%,
    #f59e0b 28%,
    #fffbeb 42%,
    #fde047 57%,
    #fbbf24 71%,
    #ca8a04 85%,
    #fef08a 100%
  );
}
.overlay-root .overlay-rank-tone-2 {
  background-image: linear-gradient(
    90deg,
    #e2e8f0 0%,
    #94a3b8 14%,
    #64748b 28%,
    #f8fafc 42%,
    #cbd5e1 57%,
    #94a3b8 71%,
    #475569 85%,
    #e2e8f0 100%
  );
}
.overlay-root .overlay-rank-tone-3 {
  background-image: linear-gradient(
    90deg,
    #fde68a 0%,
    #f59e0b 14%,
    #d97706 28%,
    #fef3c7 42%,
    #fb923c 57%,
    #fbbf24 71%,
    #b45309 85%,
    #fde68a 100%
  );
}
.overlay-root .overlay-rank-fx-glow {
  animation: overlay-rank-glow 2s ease-in-out infinite !important;
}
.overlay-root .overlay-rank-fx-sparkle {
  animation: overlay-rank-sparkle 1.6s ease-in-out infinite !important;
}
.overlay-root .overlay-elegant-table tbody td .overlay-cell-text-inner.overlay-rank-fx-colorShift,
.overlay-root .overlay-elegant-table tbody td .overlay-cell-text-inner.overlay-rank-fx-rainbow,
.overlay-root .overlay-elegant-table tbody td .overlay-cell-text-inner.overlay-rank-fx-glow,
.overlay-root .overlay-elegant-table tbody td .overlay-cell-text-inner.overlay-rank-fx-sparkle {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
  -webkit-text-stroke: 0 !important;
  paint-order: normal !important;
}
.overlay-root .overlay-elegant-table tbody td .overlay-cell-text-inner.overlay-rank-fx-glow,
.overlay-root .overlay-elegant-table tbody td .overlay-cell-text-inner.overlay-rank-fx-sparkle {
  color: var(--excel-rank-c1, #ca8a04) !important;
  -webkit-text-fill-color: currentColor !important;
}
`;

export function appendExcelRankTop3Params(target: URLSearchParams, preset: OverlayPresetLike): void {
  const style = excelRankTop3StyleFromPreset(preset);
  if (isExcelRankTop3TextMode(style.mode)) target.set("rankTop3Mode", "text");
  if (style.rankLabelFormat !== "hash") target.set("rankLabelFormat", style.rankLabelFormat);
  if (style.rank1Bg.trim()) target.set("rank1Bg", style.rank1Bg.trim());
  if (style.rank2Bg.trim()) target.set("rank2Bg", style.rank2Bg.trim());
  if (style.rank3Bg.trim()) target.set("rank3Bg", style.rank3Bg.trim());
  if (style.rank1Mark.trim()) target.set("rank1Mark", style.rank1Mark.trim());
  if (style.rank2Mark.trim()) target.set("rank2Mark", style.rank2Mark.trim());
  if (style.rank3Mark.trim()) target.set("rank3Mark", style.rank3Mark.trim());
  if (style.effect !== "none") target.set("rankTop3Effect", style.effect);
  if (style.rank1Effect) target.set("rank1Effect", style.rank1Effect);
  if (style.rank2Effect) target.set("rank2Effect", style.rank2Effect);
  if (style.rank3Effect) target.set("rank3Effect", style.rank3Effect);
  if (style.rank1TextColor.trim()) target.set("rank1TextColor", style.rank1TextColor.trim());
  if (style.rank2TextColor.trim()) target.set("rank2TextColor", style.rank2TextColor.trim());
  if (style.rank3TextColor.trim()) target.set("rank3TextColor", style.rank3TextColor.trim());
  if (style.rank1TextColorAlt.trim()) target.set("rank1TextColorAlt", style.rank1TextColorAlt.trim());
  if (style.rank2TextColorAlt.trim()) target.set("rank2TextColorAlt", style.rank2TextColorAlt.trim());
  if (style.rank3TextColorAlt.trim()) target.set("rank3TextColorAlt", style.rank3TextColorAlt.trim());
}
