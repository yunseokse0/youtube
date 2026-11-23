import type { CSSProperties } from "react";
import { buildTextOutlineStyle } from "@/lib/text-outline-style";

export const SIG_ROLLING_THEME_IDS = [
  "default",
  "gold",
  "neon-pink",
  "cyber-blue",
  "violet",
  "emerald",
  "amber-warm",
  "glass",
  "clean-white",
] as const;

export type SigRollingThemeId = (typeof SIG_ROLLING_THEME_IDS)[number];

export type SigRollingTheme = {
  id: SigRollingThemeId;
  label: string;
  badge?: string;
  shellBorder: string;
  shellBg: string;
  shellShadow: string;
  mediaBg: string;
  footerBg: string;
  footerBorderTop: string;
  nameColor: string;
  nameOutlineColor: string;
  priceColor: string;
  priceOutlineColor: string;
  glowColor?: string;
  accentGradient?: string;
};

export const SIG_ROLLING_THEMES: Record<SigRollingThemeId, SigRollingTheme> = {
  default: {
    id: "default",
    label: "다크 클래식",
    badge: "기본",
    shellBorder: "rgba(255, 255, 255, 0.22)",
    shellBg: "rgba(18, 18, 24, 0.78)",
    shellShadow: "0 8px 24px rgba(0, 0, 0, 0.55)",
    mediaBg: "rgba(0, 0, 0, 0.25)",
    footerBg: "rgba(0, 0, 0, 0.88)",
    footerBorderTop: "1px solid rgba(255, 255, 255, 0.22)",
    nameColor: "#ffffff",
    nameOutlineColor: "rgba(0, 0, 0, 0.98)",
    priceColor: "#facc15",
    priceOutlineColor: "rgba(0, 0, 0, 0.98)",
    glowColor: "rgba(250, 204, 21, 0.3)",
    accentGradient: "linear-gradient(135deg, #facc15, #ca8a04)",
  },
  gold: {
    id: "gold",
    label: "VIP 골드",
    badge: "추천",
    shellBorder: "rgba(255, 215, 0, 0.58)",
    shellBg: "linear-gradient(180deg, rgba(38, 28, 10, 0.88) 0%, rgba(18, 13, 4, 0.94) 100%)",
    shellShadow: "0 0 22px rgba(255, 215, 0, 0.32), 0 8px 28px rgba(0, 0, 0, 0.65)",
    mediaBg: "rgba(28, 20, 6, 0.4)",
    footerBg: "linear-gradient(180deg, rgba(48, 34, 10, 0.96) 0%, rgba(22, 16, 4, 0.98) 100%)",
    footerBorderTop: "1px solid rgba(255, 215, 0, 0.48)",
    nameColor: "#fffbeb",
    nameOutlineColor: "rgba(45, 30, 0, 0.98)",
    priceColor: "#ffd700",
    priceOutlineColor: "rgba(45, 30, 0, 0.98)",
    glowColor: "rgba(255, 215, 0, 0.5)",
    accentGradient: "linear-gradient(135deg, #ffd700, #b8860b)",
  },
  "neon-pink": {
    id: "neon-pink",
    label: "사이버 핑크",
    badge: "인기",
    shellBorder: "rgba(244, 63, 142, 0.65)",
    shellBg: "linear-gradient(180deg, rgba(35, 10, 26, 0.88) 0%, rgba(16, 4, 12, 0.94) 100%)",
    shellShadow: "0 0 22px rgba(244, 63, 142, 0.38), 0 8px 28px rgba(0, 0, 0, 0.65)",
    mediaBg: "rgba(28, 6, 20, 0.4)",
    footerBg: "linear-gradient(180deg, rgba(42, 12, 32, 0.96) 0%, rgba(18, 4, 14, 0.98) 100%)",
    footerBorderTop: "1px solid rgba(244, 63, 142, 0.45)",
    nameColor: "#ffffff",
    nameOutlineColor: "rgba(40, 0, 22, 0.98)",
    priceColor: "#ff66c4",
    priceOutlineColor: "rgba(40, 0, 22, 0.98)",
    glowColor: "rgba(244, 63, 142, 0.5)",
    accentGradient: "linear-gradient(135deg, #ff66c4, #db2777)",
  },
  "cyber-blue": {
    id: "cyber-blue",
    label: "사이버 블루",
    badge: "인기",
    shellBorder: "rgba(14, 165, 233, 0.65)",
    shellBg: "linear-gradient(180deg, rgba(8, 26, 45, 0.88) 0%, rgba(4, 12, 22, 0.94) 100%)",
    shellShadow: "0 0 22px rgba(14, 165, 233, 0.38), 0 8px 28px rgba(0, 0, 0, 0.65)",
    mediaBg: "rgba(5, 18, 32, 0.4)",
    footerBg: "linear-gradient(180deg, rgba(8, 30, 52, 0.96) 0%, rgba(3, 12, 22, 0.98) 100%)",
    footerBorderTop: "1px solid rgba(14, 165, 233, 0.45)",
    nameColor: "#f0f9ff",
    nameOutlineColor: "rgba(0, 20, 42, 0.98)",
    priceColor: "#38bdf8",
    priceOutlineColor: "rgba(0, 20, 42, 0.98)",
    glowColor: "rgba(14, 165, 233, 0.5)",
    accentGradient: "linear-gradient(135deg, #38bdf8, #0284c7)",
  },
  violet: {
    id: "violet",
    label: "바이올렛",
    shellBorder: "rgba(168, 85, 247, 0.65)",
    shellBg: "linear-gradient(180deg, rgba(28, 12, 45, 0.88) 0%, rgba(12, 5, 22, 0.94) 100%)",
    shellShadow: "0 0 22px rgba(168, 85, 247, 0.38), 0 8px 28px rgba(0, 0, 0, 0.65)",
    mediaBg: "rgba(20, 8, 34, 0.4)",
    footerBg: "linear-gradient(180deg, rgba(34, 14, 55, 0.96) 0%, rgba(14, 5, 24, 0.98) 100%)",
    footerBorderTop: "1px solid rgba(168, 85, 247, 0.45)",
    nameColor: "#fdf4ff",
    nameOutlineColor: "rgba(25, 4, 42, 0.98)",
    priceColor: "#c084fc",
    priceOutlineColor: "rgba(25, 4, 42, 0.98)",
    glowColor: "rgba(168, 85, 247, 0.5)",
    accentGradient: "linear-gradient(135deg, #c084fc, #7e22ce)",
  },
  emerald: {
    id: "emerald",
    label: "에메랄드",
    shellBorder: "rgba(16, 185, 129, 0.65)",
    shellBg: "linear-gradient(180deg, rgba(6, 32, 22, 0.88) 0%, rgba(3, 16, 11, 0.94) 100%)",
    shellShadow: "0 0 20px rgba(16, 185, 129, 0.35), 0 8px 28px rgba(0, 0, 0, 0.65)",
    mediaBg: "rgba(5, 22, 15, 0.4)",
    footerBg: "linear-gradient(180deg, rgba(8, 38, 26, 0.96) 0%, rgba(3, 18, 12, 0.98) 100%)",
    footerBorderTop: "1px solid rgba(16, 185, 129, 0.45)",
    nameColor: "#f0fdf4",
    nameOutlineColor: "rgba(0, 28, 14, 0.98)",
    priceColor: "#34d399",
    priceOutlineColor: "rgba(0, 28, 14, 0.98)",
    glowColor: "rgba(16, 185, 129, 0.5)",
    accentGradient: "linear-gradient(135deg, #34d399, #059669)",
  },
  "amber-warm": {
    id: "amber-warm",
    label: "앰버 오렌지",
    shellBorder: "rgba(245, 158, 11, 0.65)",
    shellBg: "linear-gradient(180deg, rgba(38, 20, 5, 0.88) 0%, rgba(18, 9, 2, 0.94) 100%)",
    shellShadow: "0 0 20px rgba(245, 158, 11, 0.35), 0 8px 28px rgba(0, 0, 0, 0.65)",
    mediaBg: "rgba(26, 13, 3, 0.4)",
    footerBg: "linear-gradient(180deg, rgba(46, 24, 6, 0.96) 0%, rgba(20, 10, 2, 0.98) 100%)",
    footerBorderTop: "1px solid rgba(245, 158, 11, 0.45)",
    nameColor: "#fffbeb",
    nameOutlineColor: "rgba(42, 16, 0, 0.98)",
    priceColor: "#fbbf24",
    priceOutlineColor: "rgba(42, 16, 0, 0.98)",
    glowColor: "rgba(245, 158, 11, 0.5)",
    accentGradient: "linear-gradient(135deg, #fbbf24, #d97706)",
  },
  glass: {
    id: "glass",
    label: "글래스 유리",
    shellBorder: "rgba(255, 255, 255, 0.35)",
    shellBg: "rgba(255, 255, 255, 0.12)",
    shellShadow: "0 8px 32px 0 rgba(0, 0, 0, 0.45), inset 0 0 0 1px rgba(255, 255, 255, 0.18)",
    mediaBg: "rgba(0, 0, 0, 0.18)",
    footerBg: "rgba(0, 0, 0, 0.68)",
    footerBorderTop: "1px solid rgba(255, 255, 255, 0.28)",
    nameColor: "#ffffff",
    nameOutlineColor: "rgba(0, 0, 0, 0.98)",
    priceColor: "#facc15",
    priceOutlineColor: "rgba(0, 0, 0, 0.98)",
    glowColor: "rgba(255, 255, 255, 0.3)",
    accentGradient: "linear-gradient(135deg, #e2e8f0, #94a3b8)",
  },
  "clean-white": {
    id: "clean-white",
    label: "화이트 모던",
    shellBorder: "rgba(0, 0, 0, 0.14)",
    shellBg: "rgba(255, 255, 255, 0.95)",
    shellShadow: "0 8px 24px rgba(0, 0, 0, 0.22)",
    mediaBg: "rgba(241, 245, 249, 0.6)",
    footerBg: "rgba(248, 250, 252, 0.98)",
    footerBorderTop: "1px solid rgba(0, 0, 0, 0.1)",
    nameColor: "#0f172a",
    nameOutlineColor: "rgba(255, 255, 255, 0.98)",
    priceColor: "#d97706",
    priceOutlineColor: "rgba(255, 255, 255, 0.98)",
    glowColor: "rgba(217, 119, 6, 0.3)",
    accentGradient: "linear-gradient(135deg, #f8fafc, #e2e8f0)",
  },
};

export const DEFAULT_SIG_ROLLING_THEME: SigRollingThemeId = "default";

export function resolveSigRollingTheme(themeId?: string | null): SigRollingTheme {
  const norm = String(themeId || "").trim().toLowerCase();
  if (norm in SIG_ROLLING_THEMES) {
    return SIG_ROLLING_THEMES[norm as SigRollingThemeId];
  }
  // aliases
  if (norm === "pink" || norm === "rose") return SIG_ROLLING_THEMES["neon-pink"];
  if (norm === "blue" || norm === "cyan") return SIG_ROLLING_THEMES["cyber-blue"];
  if (norm === "purple") return SIG_ROLLING_THEMES["violet"];
  if (norm === "green") return SIG_ROLLING_THEMES["emerald"];
  if (norm === "amber" || norm === "orange") return SIG_ROLLING_THEMES["amber-warm"];
  if (norm === "white") return SIG_ROLLING_THEMES["clean-white"];
  return SIG_ROLLING_THEMES[DEFAULT_SIG_ROLLING_THEME];
}

const OUTLINE_WIDTH_PX = 2.4;

export function sigRollingThemeTextOutlineStyle(
  textColor: string,
  outlineColor: string,
  fontSizePx = 21
): CSSProperties {
  return {
    color: textColor,
    ...buildTextOutlineStyle({
      fontSizePx,
      outlineColor,
      outlineWidthPx: OUTLINE_WIDTH_PX,
    }),
  };
}
