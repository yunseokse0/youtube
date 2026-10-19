/** 시그 대전 게이지 바 시각 테마 (URL `theme=` · 점수 로직과 무관) */

export const SIG_MATCH_GAUGE_THEME_IDS = [
  "neon-esports",
  "cyberpunk",
  "gold-luxury",
  "clean-minimal",
] as const;

export type SigMatchGaugeThemeId = (typeof SIG_MATCH_GAUGE_THEME_IDS)[number];

export type SigMatchGaugeTheme = {
  id: SigMatchGaugeThemeId;
  label: string;
  leftFill: string;
  rightFill: string;
  trackBg: string;
  trackBorder: string;
  trackShadow: string;
  vsBg: string;
  vsBorder: string;
  vsGlow: string;
  vsText: string;
  gapBg: string;
  gapBorder: string;
  gapText: string;
  leftAccent: string;
  rightAccent: string;
};

export const SIG_MATCH_GAUGE_THEMES: Record<SigMatchGaugeThemeId, SigMatchGaugeTheme> = {
  "neon-esports": {
    id: "neon-esports",
    label: "네온 이스포츠",
    leftFill: "linear-gradient(180deg, #ff5a8a 0%, #ff1e56 42%, #c4003a 100%)",
    rightFill: "linear-gradient(180deg, #4da3ff 0%, #0072ff 42%, #004bb5 100%)",
    trackBg: "rgba(6, 8, 16, 0.55)",
    trackBorder: "rgba(255,255,255,0.22)",
    trackShadow: "0 8px 28px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(255,255,255,0.08)",
    vsBg: "linear-gradient(145deg, #ffe566 0%, #f5c518 40%, #b8860b 100%)",
    vsBorder: "rgba(255, 248, 200, 0.85)",
    vsGlow: "0 0 16px rgba(255, 214, 90, 0.85), 0 0 28px rgba(255, 30, 86, 0.35)",
    vsText: "#1a1200",
    gapBg: "rgba(8, 8, 12, 0.88)",
    gapBorder: "rgba(255, 214, 90, 0.55)",
    gapText: "#ffe566",
    leftAccent: "#ff1e56",
    rightAccent: "#0072ff",
  },
  cyberpunk: {
    id: "cyberpunk",
    label: "사이버펑크",
    leftFill: "linear-gradient(180deg, #ff7ad9 0%, #ff2bd6 42%, #a0008a 100%)",
    rightFill: "linear-gradient(180deg, #5fffd7 0%, #00e5c0 42%, #00997a 100%)",
    trackBg: "rgba(18, 4, 32, 0.72)",
    trackBorder: "rgba(192, 132, 252, 0.55)",
    trackShadow: "0 8px 28px rgba(88, 28, 135, 0.55), 0 0 18px rgba(255, 43, 214, 0.22)",
    vsBg: "linear-gradient(145deg, #e9d5ff 0%, #c084fc 45%, #7c3aed 100%)",
    vsBorder: "rgba(233, 213, 255, 0.9)",
    vsGlow: "0 0 18px rgba(192, 132, 252, 0.9), 0 0 28px rgba(0, 229, 192, 0.35)",
    vsText: "#1e0533",
    gapBg: "rgba(24, 8, 40, 0.9)",
    gapBorder: "rgba(192, 132, 252, 0.6)",
    gapText: "#e9d5ff",
    leftAccent: "#ff2bd6",
    rightAccent: "#00e5c0",
  },
  "gold-luxury": {
    id: "gold-luxury",
    label: "골드 럭셔리",
    leftFill: "linear-gradient(180deg, #3a3a3a 0%, #1a1a1a 45%, #0a0a0a 100%)",
    rightFill: "linear-gradient(180deg, #f5e6c8 0%, #d4af37 45%, #8a6a1a 100%)",
    trackBg: "rgba(10, 10, 12, 0.72)",
    trackBorder: "rgba(212, 175, 55, 0.55)",
    trackShadow: "0 8px 28px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(212,175,55,0.2)",
    vsBg: "linear-gradient(145deg, #fff4d0 0%, #e8c547 40%, #9a7b1a 100%)",
    vsBorder: "rgba(255, 236, 180, 0.9)",
    vsGlow: "0 0 16px rgba(212, 175, 55, 0.75)",
    vsText: "#1a1408",
    gapBg: "rgba(12, 10, 6, 0.9)",
    gapBorder: "rgba(212, 175, 55, 0.55)",
    gapText: "#f5e6c8",
    leftAccent: "#a3a3a3",
    rightAccent: "#d4af37",
  },
  "clean-minimal": {
    id: "clean-minimal",
    label: "클린 미니멀",
    leftFill: "linear-gradient(180deg, #fda4af 0%, #fb7185 45%, #e11d48 100%)",
    rightFill: "linear-gradient(180deg, #a5b4fc 0%, #818cf8 45%, #4f46e5 100%)",
    trackBg: "rgba(15, 23, 42, 0.45)",
    trackBorder: "rgba(148, 163, 184, 0.4)",
    trackShadow: "0 6px 20px rgba(15, 23, 42, 0.35)",
    vsBg: "linear-gradient(145deg, #f8fafc 0%, #e2e8f0 50%, #cbd5e1 100%)",
    vsBorder: "rgba(255,255,255,0.85)",
    vsGlow: "0 0 12px rgba(148, 163, 184, 0.55)",
    vsText: "#0f172a",
    gapBg: "rgba(15, 23, 42, 0.75)",
    gapBorder: "rgba(148, 163, 184, 0.45)",
    gapText: "#f1f5f9",
    leftAccent: "#fb7185",
    rightAccent: "#818cf8",
  },
};

export const DEFAULT_SIG_MATCH_GAUGE_THEME: SigMatchGaugeThemeId = "neon-esports";

export function parseSigMatchGaugeThemeId(raw: unknown): SigMatchGaugeThemeId {
  const s = String(raw || "")
    .trim()
    .toLowerCase();
  if ((SIG_MATCH_GAUGE_THEME_IDS as readonly string[]).includes(s)) {
    return s as SigMatchGaugeThemeId;
  }
  return DEFAULT_SIG_MATCH_GAUGE_THEME;
}

export function getSigMatchGaugeTheme(raw: unknown): SigMatchGaugeTheme {
  return SIG_MATCH_GAUGE_THEMES[parseSigMatchGaugeThemeId(raw)];
}

/** 표시용 게이지 폭 클램프 (실제 금액 텍스트는 원본 유지) */
export function clampSigMatchGaugeDisplayPct(leftPctRaw: number): {
  leftPct: number;
  rightPct: number;
} {
  let leftPct = Math.max(15, Math.min(85, leftPctRaw));
  let rightPct = 100 - leftPct;
  rightPct = Math.max(15, Math.min(85, rightPct));
  leftPct = 100 - rightPct;
  const sum = leftPct + rightPct;
  if (sum > 0 && Math.abs(sum - 100) > 0.01) {
    leftPct = (leftPct / sum) * 100;
    rightPct = 100 - leftPct;
  }
  return { leftPct, rightPct };
}
