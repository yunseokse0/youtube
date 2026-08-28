import { normalizeGoalHexColor } from "@/lib/overlay-params";
import type { OverlayPresetLike } from "@/lib/overlay-params";

export type ExcelMemberRankChangeStyle = {
  nameSizePx: number;
  rankSizePx: number;
  iconSizePx: number;
  nameColor: string;
  rankColor: string;
  accentColor: string;
  cardBg: string;
  cardBorder: string;
  confettiColors: string[];
};

export const DEFAULT_EXCEL_MEMBER_RANK_CHANGE_STYLE: ExcelMemberRankChangeStyle = {
  nameSizePx: 28,
  rankSizePx: 80,
  iconSizePx: 30,
  nameColor: "#ffffff",
  rankColor: "#ffd700",
  accentColor: "#ffd700",
  cardBg: "rgba(26, 32, 44, 0.92)",
  cardBorder: "rgba(77, 166, 255, 0.25)",
  confettiColors: ["#ffd700", "#ffffff", "#4da6ff", "#00e676"],
};

type StyleInput = {
  memberRankChangeNameSize?: unknown;
  memberRankChangeRankSize?: unknown;
  memberRankChangeIconSize?: unknown;
  memberRankChangeNameColor?: unknown;
  memberRankChangeRankColor?: unknown;
  memberRankChangeAccentColor?: unknown;
  memberRankChangeCardBg?: unknown;
  memberRankChangeCardBorder?: unknown;
  memberRankChangeConfettiColors?: unknown;
};

function clampPx(raw: unknown, fallback: number, min: number, max: number): number {
  const n = parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizeColor(raw: unknown, fallback: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return fallback;
  if (/^rgba?\(/i.test(t)) return t.slice(0, 80);
  const hex = normalizeGoalHexColor(t);
  return hex || fallback;
}

function normalizeConfettiColors(raw: unknown, fallback: string[]): string[] {
  const t = String(raw ?? "").trim();
  if (!t) return fallback;
  const parts = t
    .split(/[,;|]/)
    .map((s) => normalizeColor(s.trim(), ""))
    .filter(Boolean);
  return parts.length > 0 ? parts.slice(0, 8) : fallback;
}

export function normalizeExcelMemberRankChangeStyle(
  input?: StyleInput | null
): ExcelMemberRankChangeStyle {
  const v = input && typeof input === "object" ? input : {};
  const d = DEFAULT_EXCEL_MEMBER_RANK_CHANGE_STYLE;
  return {
    nameSizePx: clampPx(v.memberRankChangeNameSize, d.nameSizePx, 12, 72),
    rankSizePx: clampPx(v.memberRankChangeRankSize, d.rankSizePx, 32, 160),
    iconSizePx: clampPx(v.memberRankChangeIconSize, d.iconSizePx, 12, 80),
    nameColor: normalizeColor(v.memberRankChangeNameColor, d.nameColor),
    rankColor: normalizeColor(v.memberRankChangeRankColor, d.rankColor),
    accentColor: normalizeColor(v.memberRankChangeAccentColor, d.accentColor),
    cardBg: normalizeColor(v.memberRankChangeCardBg, d.cardBg),
    cardBorder: normalizeColor(v.memberRankChangeCardBorder, d.cardBorder),
    confettiColors: normalizeConfettiColors(v.memberRankChangeConfettiColors, d.confettiColors),
  };
}

type SearchParamsLike = { get(name: string): string | null };

function readParam(sp: SearchParamsLike, key: string): string {
  return (sp.get(key) || "").trim();
}

export function excelMemberRankChangeStyleFromPreset(
  preset: OverlayPresetLike | null | undefined
): ExcelMemberRankChangeStyle {
  if (!preset || typeof preset !== "object") return { ...DEFAULT_EXCEL_MEMBER_RANK_CHANGE_STYLE };
  return normalizeExcelMemberRankChangeStyle(preset as StyleInput);
}

/** URL(미리보기) → 프리셋 순으로 순위 변동 연출 스타일 병합 */
export function resolveExcelMemberRankChangeStyle(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null | undefined,
  opts: { ready: boolean }
): ExcelMemberRankChangeStyle {
  const fromPreset = excelMemberRankChangeStyleFromPreset(preset);
  if (opts.ready) return fromPreset;

  return normalizeExcelMemberRankChangeStyle({
    memberRankChangeNameSize: readParam(rawSp, "memberRankChangeNameSize") || fromPreset.nameSizePx,
    memberRankChangeRankSize: readParam(rawSp, "memberRankChangeRankSize") || fromPreset.rankSizePx,
    memberRankChangeIconSize: readParam(rawSp, "memberRankChangeIconSize") || fromPreset.iconSizePx,
    memberRankChangeNameColor: readParam(rawSp, "memberRankChangeNameColor") || fromPreset.nameColor,
    memberRankChangeRankColor: readParam(rawSp, "memberRankChangeRankColor") || fromPreset.rankColor,
    memberRankChangeAccentColor: readParam(rawSp, "memberRankChangeAccentColor") || fromPreset.accentColor,
    memberRankChangeCardBg: readParam(rawSp, "memberRankChangeCardBg") || fromPreset.cardBg,
    memberRankChangeCardBorder: readParam(rawSp, "memberRankChangeCardBorder") || fromPreset.cardBorder,
    memberRankChangeConfettiColors:
      readParam(rawSp, "memberRankChangeConfettiColors") || fromPreset.confettiColors.join(","),
  });
}

export function appendExcelMemberRankChangeStyleParams(
  target: URLSearchParams,
  preset: OverlayPresetLike
): void {
  const d = DEFAULT_EXCEL_MEMBER_RANK_CHANGE_STYLE;
  const s = excelMemberRankChangeStyleFromPreset(preset);
  if (s.nameSizePx !== d.nameSizePx) target.set("memberRankChangeNameSize", String(s.nameSizePx));
  if (s.rankSizePx !== d.rankSizePx) target.set("memberRankChangeRankSize", String(s.rankSizePx));
  if (s.iconSizePx !== d.iconSizePx) target.set("memberRankChangeIconSize", String(s.iconSizePx));
  if (s.nameColor !== d.nameColor) target.set("memberRankChangeNameColor", s.nameColor);
  if (s.rankColor !== d.rankColor) target.set("memberRankChangeRankColor", s.rankColor);
  if (s.accentColor !== d.accentColor) target.set("memberRankChangeAccentColor", s.accentColor);
  if (s.cardBg !== d.cardBg) target.set("memberRankChangeCardBg", s.cardBg);
  if (s.cardBorder !== d.cardBorder) target.set("memberRankChangeCardBorder", s.cardBorder);
  const confettiDefault = d.confettiColors.join(",");
  const confettiCurrent = s.confettiColors.join(",");
  if (confettiCurrent !== confettiDefault) target.set("memberRankChangeConfettiColors", confettiCurrent);
}

export function excelMemberRankChangeStyleToCssVars(
  style: ExcelMemberRankChangeStyle
): Record<string, string | number> {
  const rankBoxW = Math.round(style.rankSizePx * 1);
  const rankBoxH = Math.round(style.rankSizePx * 1.25);
  const cardW = Math.max(180, Math.round(style.rankSizePx * 3.1));
  return {
    "--excel-rank-fx-name-size": `${style.nameSizePx}px`,
    "--excel-rank-fx-rank-size": `${style.rankSizePx}px`,
    "--excel-rank-fx-icon-size": `${style.iconSizePx}px`,
    "--excel-rank-fx-name-color": style.nameColor,
    "--excel-rank-fx-rank-color": style.rankColor,
    "--excel-rank-fx-accent-color": style.accentColor,
    "--excel-rank-fx-card-bg": style.cardBg,
    "--excel-rank-fx-card-border": style.cardBorder,
    "--excel-rank-fx-rank-box-w": `${rankBoxW}px`,
    "--excel-rank-fx-rank-box-h": `${rankBoxH}px`,
    "--excel-rank-fx-card-w": `${cardW}px`,
  };
}
