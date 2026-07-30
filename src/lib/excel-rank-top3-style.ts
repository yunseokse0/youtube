import type { OverlayPresetLike } from "@/lib/overlay-params";

export type ExcelRankTop3Mode = "off" | "emoji" | "bg" | "both";
export type ExcelRankTop3Effect = "none" | "pulse";
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
  effect: ExcelRankTop3Effect;
};

export const DEFAULT_EXCEL_RANK_TOP3_BGS = [
  "rgba(254, 240, 138, 0.92)",
  "rgba(254, 215, 170, 0.88)",
  "rgba(187, 247, 208, 0.88)",
] as const;

export const DEFAULT_EXCEL_RANK_TOP3_MARKS = ["🥇", "🥈", "🥉"] as const;

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
  if (v === "emoji" || v === "bg" || v === "both") return v;
  return "off";
}

function normalizeEffect(raw: unknown): ExcelRankTop3Effect {
  return String(raw || "")
    .trim()
    .toLowerCase() === "pulse"
    ? "pulse"
    : "none";
}

function normalizeMark(raw: unknown, fallback: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return fallback;
  return t.slice(0, 8);
}

function normalizeBg(raw: unknown): string {
  return String(raw ?? "").trim().slice(0, 80);
}

type ExcelRankTop3StyleInput = {
  mode?: unknown;
  rankLabelFormat?: unknown;
  effect?: unknown;
  rank1Bg?: unknown;
  rank2Bg?: unknown;
  rank3Bg?: unknown;
  rank1Mark?: unknown;
  rank2Mark?: unknown;
  rank3Mark?: unknown;
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
    effect: normalizeEffect(v.effect),
  };
}

export function excelRankTop3StyleFromPreset(preset: OverlayPresetLike | null | undefined): ExcelRankTop3Style {
  if (!preset || typeof preset !== "object") return { ...DEFAULT_EXCEL_RANK_TOP3_STYLE };
  const p = preset as OverlayPresetLike & {
    rankTop3Mode?: string;
    rankTop3Effect?: string;
    rankLabelFormat?: string;
    rank1Bg?: string;
    rank2Bg?: string;
    rank3Bg?: string;
    rank1Mark?: string;
    rank2Mark?: string;
    rank3Mark?: string;
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
    effect: readParam(rawSp, "rankTop3Effect") ? normalizeEffect(readParam(rawSp, "rankTop3Effect")) : fromPreset.effect,
  });
}

export type ExcelRankTop3RowStyle = {
  rankLabel: string;
  rowBg?: string;
  rowClass?: string;
};

export function resolveExcelRankTop3RowStyle(
  rank: number | null,
  style: ExcelRankTop3Style
): ExcelRankTop3RowStyle {
  if (rank == null) {
    return { rankLabel: "—" };
  }

  const numericLabel = formatExcelRankLabel(rank, style.rankLabelFormat);

  if (style.mode === "off" || rank > 3) {
    return { rankLabel: numericLabel };
  }

  const idx = rank - 1;
  const marks = [style.rank1Mark, style.rank2Mark, style.rank3Mark];
  const bgs = [style.rank1Bg, style.rank2Bg, style.rank3Bg];
  const showEmoji = style.mode === "emoji" || style.mode === "both";
  const showBg = style.mode === "bg" || style.mode === "both";
  const customMark = (marks[idx] || "").trim();
  const defaultMark = DEFAULT_EXCEL_RANK_TOP3_MARKS[idx] || numericLabel;
  const rowBg = showBg ? (bgs[idx] || "").trim() || DEFAULT_EXCEL_RANK_TOP3_BGS[idx] : undefined;
  const rowClass =
    style.effect === "pulse" && (showBg || showEmoji)
      ? `overlay-rank-top-${rank} overlay-rank-top-pulse`
      : showBg || showEmoji
        ? `overlay-rank-top-${rank}`
        : undefined;

  let rankLabel = numericLabel;
  if (showEmoji) {
    rankLabel = customMark || defaultMark;
  } else if (customMark) {
    rankLabel = customMark;
  }

  return {
    rankLabel,
    rowBg,
    rowClass,
  };
}

export function appendExcelRankTop3Params(target: URLSearchParams, preset: OverlayPresetLike): void {
  const style = excelRankTop3StyleFromPreset(preset);
  if (style.mode !== "off") target.set("rankTop3Mode", style.mode);
  if (style.rankLabelFormat !== "hash") target.set("rankLabelFormat", style.rankLabelFormat);
  if (style.rank1Bg.trim()) target.set("rank1Bg", style.rank1Bg.trim());
  if (style.rank2Bg.trim()) target.set("rank2Bg", style.rank2Bg.trim());
  if (style.rank3Bg.trim()) target.set("rank3Bg", style.rank3Bg.trim());
  if (style.rank1Mark.trim()) target.set("rank1Mark", style.rank1Mark.trim());
  if (style.rank2Mark.trim()) target.set("rank2Mark", style.rank2Mark.trim());
  if (style.rank3Mark.trim()) target.set("rank3Mark", style.rank3Mark.trim());
  if (style.effect === "pulse") target.set("rankTop3Effect", "pulse");
}
