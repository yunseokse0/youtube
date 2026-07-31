import {
  normalizeTableFontFamily,
  resolveTableFontFamilyCss,
  type TableFontFamilyId,
} from "@/lib/table-font-style";

const GOAL_HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

function normalizeHexColor(raw: string): string | null {
  const s = String(raw || "").trim();
  if (GOAL_HEX_COLOR_RE.test(s)) return s;
  const bare = s.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3,8}$/.test(bare)) return `#${bare}`;
  return null;
}

export const GOAL_BAR_DEFAULT_TRACK_BG = "#fde8f2";
export const GOAL_BAR_DEFAULT_TRACK_BORDER = "#f5b8d4";
export const GOAL_BAR_DEFAULT_FILL = "#ff6eb5";

export type GoalBarAnimationMode = "off" | "pulse" | "sweep" | "both";

export function normalizeGoalBarAnimation(raw: unknown): GoalBarAnimationMode {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "off" || v === "none" || v === "0" || v === "false") return "off";
  if (v === "pulse") return "pulse";
  if (v === "sweep") return "sweep";
  return "both";
}

function clampChannel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const n = normalizeHexColor(hex);
  if (!n) return null;
  const h = n.length === 4 ? n.slice(1).split("").map((c) => c + c).join("") : n.slice(1);
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (![r, g, b].every(Number.isFinite)) return null;
  return [r, g, b];
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clampChannel(c).toString(16).padStart(2, "0")).join("")}`;
}

export function darkenHexColor(hex: string, ratio = 0.12): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return GOAL_BAR_DEFAULT_TRACK_BORDER;
  const [r, g, b] = rgb;
  return rgbToHex(r * (1 - ratio), g * (1 - ratio), b * (1 - ratio));
}

export function lightenHexColor(hex: string, ratio = 0.18): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) return hex;
  const [r, g, b] = rgb;
  return rgbToHex(r + (255 - r) * ratio, g + (255 - g) * ratio, b + (255 - b) * ratio);
}

export function resolveGoalBarTrackBg(raw: unknown): string {
  return normalizeHexColor(String(raw || "").trim()) || GOAL_BAR_DEFAULT_TRACK_BG;
}

export function resolveGoalBarFillColor(raw: unknown): string {
  return normalizeHexColor(String(raw || "").trim()) || GOAL_BAR_DEFAULT_FILL;
}

export function buildGoalBarFillBackground(fillColor: string): string {
  const main = resolveGoalBarFillColor(fillColor);
  const start = lightenHexColor(main, 0.12);
  const end = lightenHexColor(main, 0.28);
  return `linear-gradient(90deg, ${start} 0%, ${main} 42%, ${end} 100%)`;
}

export function resolveGoalBarFontFamilyCss(raw: unknown): string | null {
  const id = normalizeTableFontFamily(raw) as TableFontFamilyId;
  return resolveTableFontFamilyCss(id);
}

export function goalBarFillGlowRgba(fillColor: string, alpha: number): string {
  const rgb = parseHexRgb(resolveGoalBarFillColor(fillColor));
  if (!rgb) return `rgba(255, 110, 180, ${alpha})`;
  const [r, g, b] = rgb;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
