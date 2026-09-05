import type { DonorRankingsTheme, DonorRankingsPreset, OverlayConfig, DonorsAmountFormat } from "@/types";
import { normalizeOverlayConfig } from "@/presentation/overlay-normalizer.presentation";

export const DONOR_RANKINGS_COMPACT_TOP_MAX = 10;
export const DONOR_RANKINGS_OUTLINE_MAX_PX = 6;
const DONOR_RANKINGS_LEGACY_OUTLINE_WIDTH = 2.25;

export const DEFAULT_DONOR_RANKINGS_THEME: DonorRankingsTheme = {
  top: DONOR_RANKINGS_COMPACT_TOP_MAX,
  titleText: "👑 웹후원 순위 👑",
  titleSize: 34,
  rowSize: 28,
  rankSize: 30,
  overlayOpacity: 88,
  bg: "transparent",
  panelBg: "transparent",
  borderColor: "#000000",
  headerAccountBg: "transparent",
  headerToonBg: "transparent",
  rowEvenBg: "transparent",
  rowOddBg: "transparent",
  rankColor: "#ffffff",
  nameColor: "#ffc107",
  amountColor: "#ffc107",
  titleColor: "#ffc107",
  outlineColor: "#000000",
  outlineWidth: 4,
  zoomPct: 100,
};

export const BUILT_IN_DONOR_RANKINGS_PRESETS: DonorRankingsPreset[] = [
  {
    id: "dr_builtin_web_gold",
    name: "웹후원 골드",
    theme: { ...DEFAULT_DONOR_RANKINGS_THEME },
  },
  {
    id: "dr_builtin_neon_cyber",
    name: "네온 사이버",
    theme: {
      top: DONOR_RANKINGS_COMPACT_TOP_MAX,
      titleText: "⚡ 웹후원 순위 ⚡",
      titleSize: 32,
      rowSize: 26,
      rankSize: 28,
      overlayOpacity: 90,
      bg: "transparent",
      panelBg: "rgba(8, 12, 28, 0.78)",
      borderColor: "rgba(34, 211, 238, 0.35)",
      headerAccountBg: "linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(30,58,138,0.9) 100%)",
      headerToonBg: "linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(88,28,135,0.85) 100%)",
      rowEvenBg: "rgba(255, 255, 255, 0.04)",
      rowOddBg: "rgba(34, 211, 238, 0.08)",
      rankColor: "#67e8f9",
      nameColor: "#e0f2fe",
      amountColor: "#f0abfc",
      titleColor: "#22d3ee",
      outlineColor: "rgba(2, 6, 23, 0.95)",
      outlineWidth: 1.75,
      zoomPct: 100,
    },
  },
  {
    id: "dr_builtin_classic_pink",
    name: "클래식 핑크",
    theme: {
      top: DONOR_RANKINGS_COMPACT_TOP_MAX,
      titleText: "💖 후원 순위 💖",
      titleSize: 30,
      rowSize: 22,
      rankSize: 24,
      overlayOpacity: 96,
      bg: "transparent",
      panelBg: "rgba(255, 248, 252, 0.96)",
      borderColor: "rgba(244, 114, 182, 0.4)",
      headerAccountBg: "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 48%, #f9a8d4 100%)",
      headerToonBg: "linear-gradient(135deg, #fdf2f8 0%, #f9a8d4 100%)",
      rowEvenBg: "rgba(255, 228, 240, 0.35)",
      rowOddBg: "transparent",
      rankColor: "#be185d",
      nameColor: "#831843",
      amountColor: "#b45309",
      titleColor: "#9d174d",
      outlineColor: "rgba(255, 255, 255, 0.85)",
      outlineWidth: 1.25,
      zoomPct: 100,
    },
  },
  {
    id: "dr_builtin_midnight",
    name: "미드나잇",
    theme: {
      top: DONOR_RANKINGS_COMPACT_TOP_MAX,
      titleText: "🌙 웹후원 순위 🌙",
      titleSize: 32,
      rowSize: 26,
      rankSize: 28,
      overlayOpacity: 92,
      bg: "transparent",
      panelBg: "rgba(15, 17, 23, 0.82)",
      borderColor: "rgba(148, 163, 184, 0.25)",
      headerAccountBg: "rgba(30, 41, 59, 0.92)",
      headerToonBg: "rgba(30, 41, 59, 0.92)",
      rowEvenBg: "rgba(255, 255, 255, 0.03)",
      rowOddBg: "rgba(255, 255, 255, 0.07)",
      rankColor: "#f8fafc",
      nameColor: "#f1f5f9",
      amountColor: "#fde68a",
      titleColor: "#f8fafc",
      outlineColor: "rgba(0, 0, 0, 0.88)",
      outlineWidth: 1.5,
      zoomPct: 100,
    },
  },
  {
    id: "dr_builtin_emerald",
    name: "에메랄드",
    theme: {
      top: DONOR_RANKINGS_COMPACT_TOP_MAX,
      titleText: "✨ 웹후원 순위 ✨",
      titleSize: 32,
      rowSize: 26,
      rankSize: 28,
      overlayOpacity: 90,
      bg: "transparent",
      panelBg: "rgba(236, 253, 245, 0.78)",
      borderColor: "rgba(16, 185, 129, 0.35)",
      headerAccountBg: "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 50%, #6ee7b7 100%)",
      headerToonBg: "linear-gradient(135deg, #ecfdf5 0%, #6ee7b7 100%)",
      rowEvenBg: "rgba(167, 243, 208, 0.28)",
      rowOddBg: "transparent",
      rankColor: "#064e3b",
      nameColor: "#065f46",
      amountColor: "#b45309",
      titleColor: "#064e3b",
      outlineColor: "rgba(255, 255, 255, 0.9)",
      outlineWidth: 1.35,
      zoomPct: 100,
    },
  },
];

const BUILT_IN_DONOR_RANKINGS_PRESET_IDS = new Set(
  BUILT_IN_DONOR_RANKINGS_PRESETS.map((p) => p.id)
);

export function isBuiltInDonorRankingsPresetId(id: string | null | undefined): boolean {
  return Boolean(id && BUILT_IN_DONOR_RANKINGS_PRESET_IDS.has(id));
}

export function mergeBuiltInDonorRankingsPresets(
  existing: DonorRankingsPreset[] | null | undefined
): DonorRankingsPreset[] {
  const list = Array.isArray(existing) ? existing : [];
  const byId = new Map(list.map((p) => [p.id, p]));
  const merged: DonorRankingsPreset[] = BUILT_IN_DONOR_RANKINGS_PRESETS.map((builtIn) => {
    const prev = byId.get(builtIn.id);
    return {
      id: builtIn.id,
      name: prev?.name?.trim() ? prev.name : builtIn.name,
      theme: { ...builtIn.theme },
    };
  });
  for (const p of list) {
    if (!BUILT_IN_DONOR_RANKINGS_PRESET_IDS.has(p.id)) merged.push(p);
  }
  return merged;
}

export const DEFAULT_DONOR_RANKINGS_FULL_THEME: DonorRankingsTheme = {
  top: 0,
  titleText: "👑 후원 순위 👑",
  titleSize: 26,
  rowSize: 17,
  rankSize: 19,
  overlayOpacity: 88,
  bg: "transparent",
  panelBg: "rgba(255, 236, 246, 0.96)",
  borderColor: "rgba(244, 114, 182, 0.5)",
  headerAccountBg: "linear-gradient(135deg, #fce7f3 0%, #fbcfe8 48%, #f9a8d4 100%)",
  headerToonBg: "linear-gradient(135deg, #fdf2f8 0%, #f9a8d4 100%)",
  rowEvenBg: "rgba(255, 228, 240, 0.35)",
  rowOddBg: "transparent",
  rankColor: "#be185d",
  nameColor: "#831843",
  amountColor: "#b45309",
  titleColor: "#9d174d",
  outlineColor: "rgba(255, 255, 255, 0.82)",
  outlineWidth: 1.25,
  zoomPct: 100,
};

function normalizeDonorRankingsTheme(
  input: unknown,
  defaults: DonorRankingsTheme = DEFAULT_DONOR_RANKINGS_THEME
): DonorRankingsTheme {
  const v = input && typeof input === "object" ? (input as Partial<DonorRankingsTheme>) : {};
  const n = (x: unknown, min: number, max: number, fallback: number) => {
    const parsed = Number(x);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  };
  const s = (x: unknown, fallback: string) => {
    const raw = String(x ?? "").trim();
    return raw || fallback;
  };
  const titleText = (() => {
    const raw = String(v.titleText ?? "").trim();
    if (!raw) return defaults.titleText;
    return raw.slice(0, 60);
  })();
  const compactTheme = defaults !== DEFAULT_DONOR_RANKINGS_FULL_THEME;
  const topMin = compactTheme ? 1 : 0;
  const topMax = compactTheme ? DONOR_RANKINGS_COMPACT_TOP_MAX : 50;
  const topParsed = n(v.top, topMin, topMax, defaults.top);
  const top =
    compactTheme && topParsed === 7 ? defaults.top : topParsed;
  return {
    top,
    titleText,
    titleSize: n(v.titleSize, 14, 80, defaults.titleSize),
    rowSize: n(v.rowSize, 12, 64, defaults.rowSize),
    rankSize: n(v.rankSize, 12, 72, defaults.rankSize),
    overlayOpacity: n(v.overlayOpacity, 0, 100, defaults.overlayOpacity),
    bg: s(v.bg, defaults.bg),
    panelBg: (() => {
      const c = s(v.panelBg, defaults.panelBg);
      if (
        /^rgba\(\s*232\s*,\s*232\s*,\s*236\s*,\s*0\.7\s*\)$/i.test(c) ||
        /^rgba\(\s*232\s*,\s*232\s*,\s*236\s*,\s*0\.70\s*\)$/i.test(c)
      ) {
        return defaults.panelBg;
      }
      return c;
    })(),
    borderColor: (() => {
      const c = s(v.borderColor, defaults.borderColor);
      if (!compactTheme) return c;
      if (!c || c.toLowerCase() === "transparent" || /^#ffc107$/i.test(c)) {
        return defaults.borderColor;
      }
      return c;
    })(),
    headerAccountBg: (() => {
      const c = s(v.headerAccountBg, defaults.headerAccountBg);
      if (/^rgba\(\s*232\s*,\s*232\s*,\s*236\s*,\s*0\.55\s*\)$/i.test(c)) {
        return defaults.headerAccountBg;
      }
      return c;
    })(),
    headerToonBg: (() => {
      const c = s(v.headerToonBg, defaults.headerToonBg);
      if (/^rgba\(\s*232\s*,\s*232\s*,\s*236\s*,\s*0\.55\s*\)$/i.test(c)) {
        return defaults.headerToonBg;
      }
      return c;
    })(),
    rowEvenBg: s(v.rowEvenBg, defaults.rowEvenBg),
    rowOddBg: (() => {
      const c = s(v.rowOddBg, defaults.rowOddBg);
      if (/^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.14\s*\)$/i.test(c)) {
        return defaults.rowOddBg;
      }
      return c;
    })(),
    rankColor: (() => {
      const c = s(v.rankColor, defaults.rankColor);
      if (compactTheme && /^#ffc107$/i.test(c)) return defaults.rankColor;
      return c;
    })(),
    nameColor: s(v.nameColor, defaults.nameColor),
    amountColor: s(v.amountColor, defaults.amountColor),
    titleColor: (() => {
      const c = s(v.titleColor, defaults.titleColor);
      if (compactTheme && /^#fff(?:fff)?$/i.test(c)) return defaults.titleColor;
      return c;
    })(),
    outlineColor: (() => {
      const c = s(v.outlineColor, defaults.outlineColor);
      if (compactTheme && /^rgba\(\s*20\s*,\s*12\s*,\s*6\s*,\s*0\.96\s*\)$/i.test(c)) {
        return defaults.outlineColor;
      }
      return c;
    })(),
    outlineWidth: (() => {
      const raw = v.outlineWidth;
      if (raw === undefined || raw === null) return defaults.outlineWidth;
      const parsed = typeof raw === "number" ? raw : parseFloat(String(raw));
      if (!Number.isFinite(parsed)) return defaults.outlineWidth;
      if (
        compactTheme &&
        Math.abs(parsed - DONOR_RANKINGS_LEGACY_OUTLINE_WIDTH) < 0.01
      ) {
        return defaults.outlineWidth;
      }
      return Math.max(0, Math.min(DONOR_RANKINGS_OUTLINE_MAX_PX, Math.round(parsed * 100) / 100));
    })(),
    zoomPct: n(v.zoomPct, 30, 300, defaults.zoomPct ?? 100),
  };
}

export function normalizeDonorRankingsFullTheme(input: unknown): DonorRankingsTheme {
  return normalizeDonorRankingsTheme(input, DEFAULT_DONOR_RANKINGS_FULL_THEME);
}

export function isDefaultLikeDonorRankingsTheme(
  theme: DonorRankingsTheme | null | undefined,
  defaults: DonorRankingsTheme = DEFAULT_DONOR_RANKINGS_THEME
): boolean {
  if (!theme || typeof theme !== "object") return true;
  const n = normalizeDonorRankingsTheme(theme, defaults);
  const d = defaults;
  return (
    n.top === d.top &&
    n.titleText === d.titleText &&
    n.titleSize === d.titleSize &&
    n.rowSize === d.rowSize &&
    n.rankSize === d.rankSize &&
    n.overlayOpacity === d.overlayOpacity &&
    n.bg === d.bg &&
    n.panelBg === d.panelBg &&
    n.borderColor === d.borderColor &&
    n.headerAccountBg === d.headerAccountBg &&
    n.headerToonBg === d.headerToonBg &&
    n.rowEvenBg === d.rowEvenBg &&
    n.rowOddBg === d.rowOddBg &&
    n.rankColor === d.rankColor &&
    n.nameColor === d.nameColor &&
    n.amountColor === d.amountColor &&
    n.titleColor === d.titleColor &&
    n.outlineColor === d.outlineColor &&
    n.outlineWidth === d.outlineWidth &&
    n.zoomPct === d.zoomPct
  );
}

function normalizeDonorRankingsPresets(input: unknown): DonorRankingsPreset[] {
  if (!Array.isArray(input)) return mergeBuiltInDonorRankingsPresets([]);
  const normalized = input
    .filter((x) => x && typeof x === "object")
    .map((x, idx) => {
      const o = x as Record<string, unknown>;
      const id = typeof o.id === "string" && o.id.trim() ? o.id.trim() : `drp_${idx}_${Math.random().toString(36).slice(2, 6)}`;
      const name = typeof o.name === "string" && o.name.trim() ? o.name.trim() : `프리셋 ${idx + 1}`;
      return {
        id,
        name,
        theme: normalizeDonorRankingsTheme(o.theme),
      };
    });
  return mergeBuiltInDonorRankingsPresets(normalized);
}

export function normalizeDonorRankingsPreset(input: unknown): DonorRankingsPreset[] {
  return normalizeDonorRankingsPresets(input);
}

export function normalizeDonorRankingsOverlayConfig(input: unknown): OverlayConfig {
  return normalizeOverlayConfig(input);
}

export function normalizeDonorsAmountFormat(raw: unknown, fallback: DonorsAmountFormat = "full"): DonorsAmountFormat {
  const v = String(raw ?? "").trim();
  if (v === "full") return "full";
  if (v === "short") return "short";
  return fallback;
}

export function normalizeDonorsFormat(raw: unknown, fallback: DonorsAmountFormat = "full"): DonorsAmountFormat {
  return normalizeDonorsAmountFormat(raw, fallback);
}
