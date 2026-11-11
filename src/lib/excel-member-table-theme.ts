/** 엑셀표 멤버·총합 테마 id (방송 Studio 글래스 크롬과 구분) */
export const EXCEL_MEMBER_THEME_IDS = [
  "excel",
  "excelLive",
  "excelBlue",
  "excelSlate",
  "excelAmber",
  "excelGold",
  "excelPongdang",
  "excelRose",
  "excelNavy",
  "excelTeal",
  "excelPurple",
  "excelEmerald",
  "excelOrange",
  "excelIndigo",
  "excelViolet",
] as const;

export type ExcelMemberThemeId = (typeof EXCEL_MEMBER_THEME_IDS)[number];

export type ExcelMemberTableAccent = {
  headerBg: string;
  headerText: string;
  headerBorder: string;
  totalRowBorder: string;
  panelBorder: string;
  panelShadow: string;
  /** 멤버 행 줄무늬 — 비우면 transparent(줄무늬 OFF) */
  rowEvenBg?: string;
  rowOddBg?: string;
  /** 기여도 열 강조색 */
  contributionColor?: string;
  /** 기여도 열 셀 배경(줄무늬 위에 겹침) */
  contributionColumnBg?: string;
  /** 기여도 숫자 캡슐 배경 */
  contributionPillBg?: string;
};

/** 웹후원 골드 — 1~3위 순위·이름 색 (랭킹 TOP3 효과가 꺼져 있을 때) */
export const EXCEL_GOLD_RANK_TEXT_COLORS = ["#ff5eb8", "#6ecbff", "#ffc107"] as const;

const STUDIO_PANEL_SHADOW = "0 8px 32px 0 rgba(0, 0, 0, 0.37)";
const STUDIO_EDGE = "rgba(255, 255, 255, 0.12)";

export const EXCEL_MEMBER_TABLE_ACCENT: Record<ExcelMemberThemeId, ExcelMemberTableAccent> = {
  excel: {
    headerBg: "rgba(33, 115, 70, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(33, 115, 70, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelLive: {
    headerBg: "rgba(26, 82, 118, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(26, 82, 118, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelBlue: {
    headerBg: "rgba(37, 99, 235, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(37, 99, 235, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelSlate: {
    headerBg: "rgba(51, 65, 85, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(51, 65, 85, 0.55)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelAmber: {
    headerBg: "rgba(217, 119, 6, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(217, 119, 6, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  /** 웹후원 골드 — 골드 헤더·테두리 · 행 알약(줄무늬) */
  excelGold: {
    headerBg: "#ffc107",
    headerText: "#1a1408",
    headerBorder: "#ffc107",
    totalRowBorder: "rgba(255, 193, 7, 0.45)",
    panelBorder: "#ffc107",
    panelShadow: "none",
    rowEvenBg: "rgba(255, 255, 255, 0.08)",
    rowOddBg: "rgba(255, 255, 255, 0.16)",
    contributionColor: "#ffc107",
  },
  /** 퐁당퐁당 — 에메랄드 나이트 조화 배색 (다크 포레스트 그린 · 민트 네온 테두리) */
  excelPongdang: {
    headerBg: "#064e3b",
    headerText: "#ffffff",
    headerBorder: "#10b981",
    totalRowBorder: "rgba(16, 185, 129, 0.45)",
    panelBorder: "#10b981",
    panelShadow: "none",
    rowEvenBg: "rgba(10, 60, 48, 0.60)",
    rowOddBg: "rgba(4, 30, 24, 0.60)",
    contributionColor: "#34d399",
  },
  excelRose: {
    headerBg: "rgba(225, 29, 72, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(225, 29, 72, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelNavy: {
    headerBg: "rgba(30, 58, 138, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(30, 58, 138, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelTeal: {
    headerBg: "rgba(13, 148, 136, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(13, 148, 136, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelPurple: {
    headerBg: "rgba(124, 58, 237, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(124, 58, 237, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelEmerald: {
    headerBg: "rgba(5, 150, 105, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(5, 150, 105, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelOrange: {
    headerBg: "rgba(234, 88, 12, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(234, 88, 12, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  excelIndigo: {
    headerBg: "rgba(79, 70, 229, 0.72)",
    headerText: "#ffffff",
    headerBorder: "rgba(255, 255, 255, 0.14)",
    totalRowBorder: "rgba(79, 70, 229, 0.45)",
    panelBorder: STUDIO_EDGE,
    panelShadow: STUDIO_PANEL_SHADOW,
  },
  /** 바이올렛 럭셔리 (xplay 스타일) — 딥 바이올렛 글래스 · 네온 퍼플 테두리 & 발광 글루 */
  excelViolet: {
    headerBg: "rgba(46, 8, 84, 0.92)",
    headerText: "#ffffff",
    headerBorder: "rgba(168, 85, 247, 0.45)",
    totalRowBorder: "rgba(168, 85, 247, 0.55)",
    panelBorder: "#a855f7",
    panelShadow: "0 0 16px rgba(168, 85, 247, 0.40)",
    rowEvenBg: "rgba(42, 12, 70, 0.60)",
    rowOddBg: "rgba(22, 6, 38, 0.60)",
    contributionColor: "#c084fc",
    contributionColumnBg: "rgba(168, 85, 247, 0.15)",
    contributionPillBg: "rgba(168, 85, 247, 0.25)",
  },
};

export function isExcelMemberTableTheme(themeId: string): themeId is ExcelMemberThemeId {
  return (EXCEL_MEMBER_THEME_IDS as readonly string[]).includes(themeId);
}

export function isExcelGoldTableTheme(themeId: string): boolean {
  return themeId === "excelGold";
}

export function resolveExcelMemberTableAccent(themeId: string): ExcelMemberTableAccent | null {
  if (!isExcelMemberTableTheme(themeId)) return null;
  return EXCEL_MEMBER_TABLE_ACCENT[themeId];
}

/** 비엑셀(방송 글래스) 테마 — 테마 자동 시 헤더·총합 액센트 (전부 동일 파란 고정 금지) */
const BROADCAST_THEME_HEADER_BG: Record<string, string> = {
  default: "rgba(124, 58, 237, 0.72)",
  neonExcel: "rgba(217, 70, 239, 0.72)",
  retro: "rgba(22, 101, 52, 0.72)",
  minimal: "rgba(255, 255, 255, 0.12)",
  rpg: "rgba(180, 83, 9, 0.72)",
  pastel: "rgba(124, 58, 237, 0.72)",
  neon: "rgba(8, 145, 178, 0.72)",
  rainbow: "rgba(236, 72, 153, 0.72)",
  sunset: "rgba(249, 115, 22, 0.72)",
  ocean: "rgba(14, 165, 233, 0.72)",
  forest: "rgba(22, 163, 74, 0.72)",
  aurora: "rgba(52, 211, 153, 0.72)",
  violet: "rgba(139, 92, 246, 0.72)",
  coral: "rgba(251, 113, 133, 0.72)",
  mint: "rgba(52, 211, 153, 0.72)",
  lava: "rgba(239, 68, 68, 0.72)",
  ice: "rgba(125, 211, 252, 0.72)",
  excelViolet: "rgba(46, 8, 84, 0.92)",
};

const BROADCAST_THEME_TOTAL_BORDER: Record<string, string> = {
  default: "rgba(124, 58, 237, 0.45)",
  neonExcel: "rgba(217, 70, 239, 0.45)",
  retro: "rgba(34, 197, 94, 0.45)",
  minimal: "rgba(255, 255, 255, 0.25)",
  rpg: "rgba(234, 179, 8, 0.45)",
  pastel: "rgba(124, 58, 237, 0.40)",
  neon: "rgba(34, 211, 238, 0.45)",
  rainbow: "rgba(236, 72, 153, 0.45)",
  sunset: "rgba(249, 115, 22, 0.45)",
  ocean: "rgba(14, 165, 233, 0.45)",
  forest: "rgba(22, 163, 74, 0.45)",
  aurora: "rgba(52, 211, 153, 0.45)",
  violet: "rgba(139, 92, 246, 0.45)",
  coral: "rgba(251, 113, 133, 0.45)",
  mint: "rgba(52, 211, 153, 0.45)",
  lava: "rgba(239, 68, 68, 0.45)",
  ice: "rgba(125, 211, 252, 0.45)",
  excelViolet: "rgba(168, 85, 247, 0.55)",
};

const FALLBACK_HEADER_BG = "rgba(124, 58, 237, 0.72)";
const FALLBACK_TOTAL_BORDER = "rgba(124, 58, 237, 0.45)";

/** 테마 자동 — 헤더 배경 CSS (엑셀 액센트 또는 방송 테마별 색) */
export function resolveTableThemeHeaderBgCss(themeId: string): string {
  const excel = resolveExcelMemberTableAccent(themeId);
  if (excel) return excel.headerBg;
  return BROADCAST_THEME_HEADER_BG[themeId] || FALLBACK_HEADER_BG;
}

/** 테마 자동 — 총합 행 구분선 */
export function resolveTableThemeTotalBorderCss(themeId: string): string {
  const excel = resolveExcelMemberTableAccent(themeId);
  if (excel) return excel.totalRowBorder;
  return BROADCAST_THEME_TOTAL_BORDER[themeId] || FALLBACK_TOTAL_BORDER;
}

/** 테마 자동 — 패널 외곽 테두리 */
export function resolveTableThemePanelBorderCss(themeId: string): string {
  const excel = resolveExcelMemberTableAccent(themeId);
  if (excel) return excel.panelBorder;
  return STUDIO_EDGE;
}

/** 테마 자동 — 멤버 행 줄무늬 */
export function resolveTableThemeRowStripeCss(
  themeId: string,
  which: "even" | "odd"
): string {
  const excel = resolveExcelMemberTableAccent(themeId);
  if (!excel) return "transparent";
  return which === "even" ? excel.rowEvenBg || "transparent" : excel.rowOddBg || "transparent";
}

/** 테마 자동 — 기여도 열 강조색 */
export function resolveTableThemeContributionColorCss(themeId: string): string {
  const excel = resolveExcelMemberTableAccent(themeId);
  return excel?.contributionColor || "";
}

/** 기여도 글자색 → 열 배경(알파 겹침) */
export function contributionColumnBgFromColor(css: string, alpha = 0.22): string {
  const hex = cssColorToPreviewHex((css || "").trim());
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return tableRowStripeBgFromPickerHex(hex, alpha);
  return "rgba(255, 193, 7, 0.22)";
}

export function resolveTableThemeContributionColumnBgCss(themeId: string): string {
  const excel = resolveExcelMemberTableAccent(themeId);
  if (excel?.contributionColumnBg) return excel.contributionColumnBg;
  const color = excel?.contributionColor;
  return color ? contributionColumnBgFromColor(color) : "";
}

export function resolveTableThemeContributionPillBgCss(themeId: string): string {
  const excel = resolveExcelMemberTableAccent(themeId);
  return excel?.contributionPillBg || "";
}

function cssColorToPreviewHex(css: string): string {
  const rgba = css.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i
  );
  if (rgba) {
    const toHex = (n: string) =>
      Math.max(0, Math.min(255, parseInt(n, 10)))
        .toString(16)
        .padStart(2, "0");
    return `#${toHex(rgba[1])}${toHex(rgba[2])}${toHex(rgba[3])}`;
  }
  const hex = css.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`.toLowerCase();
  }
  return "#7c3aed";
}

/** 관리자 color input 미리보기용 — 테마 자동일 때 표시할 헤더 색 */
export function resolveTableThemeHeaderPreviewHex(themeId: string): string {
  return cssColorToPreviewHex(resolveTableThemeHeaderBgCss(themeId));
}

export function resolveTableThemeHeaderTextPreviewHex(themeId: string): string {
  const excel = resolveExcelMemberTableAccent(themeId);
  if (excel?.headerText) return cssColorToPreviewHex(excel.headerText);
  return "#ffffff";
}

export function resolveTableThemeLinePreviewHex(themeId: string): string {
  return cssColorToPreviewHex(resolveTableThemePanelBorderCss(themeId));
}

export function resolveTableThemePanelBorderPreviewHex(themeId: string): string {
  return resolveTableThemeLinePreviewHex(themeId);
}

export function resolveTableThemeRowStripePreviewHex(
  themeId: string,
  which: "even" | "odd"
): string {
  return cssColorToPreviewHex(resolveTableThemeRowStripeCss(themeId, which));
}

export function resolveTableThemeContributionPreviewHex(themeId: string): string {
  const css = resolveTableThemeContributionColorCss(themeId);
  return css ? cssColorToPreviewHex(css) : "#ffc107";
}

/** color input(#rrggbb) → 줄무늬용 rgba */
export function tableRowStripeBgFromPickerHex(hex: string, alpha: number): string {
  const m = hex.match(/^#([0-9a-fA-F]{6})$/i);
  if (!m) return hex;
  const h = m[1];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** 표 수동 색 필드 — 테마 전환·「전체 테마 자동」에서 비움 */
export const TABLE_THEME_AUTO_COLOR_FIELDS = [
  "tableHeaderBgColor",
  "tableHeaderTextColor",
  "tableBgColor",
  "tableLineColor",
  "tableTextColor",
  "totalTextColor",
  "rankColor",
  "customColor",
  "roleColor",
  "nameColor",
  "accountColor",
  "toonColor",
  "combinedColor",
  "contributionColor",
  "restroomColor",
  "rankBg",
  "customBg",
  "roleBg",
  "nameBg",
  "accountBg",
  "toonBg",
  "combinedBg",
  "contributionBg",
  "restroomBg",
  "tableRowEvenBg",
  "tableRowOddBg",
  "tablePanelBorderColor",
] as const;

export type TableThemeAutoColorField = (typeof TABLE_THEME_AUTO_COLOR_FIELDS)[number];

export function emptyTableThemeAutoColorPatch(): Record<TableThemeAutoColorField, ""> {
  return {
    tableHeaderBgColor: "",
    tableHeaderTextColor: "",
    tableBgColor: "",
    tableLineColor: "",
    tableTextColor: "",
    totalTextColor: "",
    rankColor: "",
    customColor: "",
    roleColor: "",
    nameColor: "",
    accountColor: "",
    toonColor: "",
    combinedColor: "",
    contributionColor: "",
    restroomColor: "",
    rankBg: "",
    customBg: "",
    roleBg: "",
    nameBg: "",
    accountBg: "",
    toonBg: "",
    combinedBg: "",
    contributionBg: "",
    restroomBg: "",
    tableRowEvenBg: "",
    tableRowOddBg: "",
    tablePanelBorderColor: "",
  };
}

export type TableBorderGlowIntensity = "none" | "soft" | "neon" | "vivid";

export type HarmonyThemePalette = {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  badgeBg: string;
  colors: {
    tableHeaderBgColor: string;
    tableHeaderTextColor: string;
    tableBgColor: string;
    tableLineColor: string;
    tablePanelBorderColor: string;
    tableBorderGlow: TableBorderGlowIntensity;
    tableBorderRadius: string;
    tableRowEvenBg: string;
    tableRowOddBg: string;
    tableTextColor: string;
    contributionColor: string;
    totalTextColor: string;
  };
};

export const HARMONY_THEME_PALETTES: HarmonyThemePalette[] = [
  {
    id: "violetLuxury",
    name: "바이올렛 럭셔리",
    emoji: "🔮",
    tagline: "xplay 방송풍 딥 바이올렛 글래스 + 네온 퍼플 테두리 & 발광 글루",
    badgeBg: "linear-gradient(135deg, #2e0854, #a855f7)",
    colors: {
      tableHeaderBgColor: "#2e0854",
      tableHeaderTextColor: "#ffffff",
      tableBgColor: "#120520",
      tableLineColor: "rgba(168, 85, 247, 0.35)",
      tablePanelBorderColor: "#a855f7",
      tableBorderGlow: "neon",
      tableBorderRadius: "12",
      tableRowEvenBg: "rgba(42, 12, 70, 0.60)",
      tableRowOddBg: "rgba(22, 6, 38, 0.60)",
      tableTextColor: "#f3e8ff",
      contributionColor: "#c084fc",
      totalTextColor: "#ffffff",
    },
  },
  {
    id: "goldLuxury",
    name: "골드 럭셔리",
    emoji: "👑",
    tagline: "블랙 골드 글래스 + 황금빛 샴페인 앰버 테두리 & 소프트 글루",
    badgeBg: "linear-gradient(135deg, #261a06, #f59e0b)",
    colors: {
      tableHeaderBgColor: "#261a06",
      tableHeaderTextColor: "#fef3c7",
      tableBgColor: "#0f0b04",
      tableLineColor: "rgba(245, 158, 11, 0.35)",
      tablePanelBorderColor: "#f59e0b",
      tableBorderGlow: "soft",
      tableBorderRadius: "12",
      tableRowEvenBg: "rgba(45, 30, 8, 0.60)",
      tableRowOddBg: "rgba(20, 14, 4, 0.60)",
      tableTextColor: "#fffbeb",
      contributionColor: "#fbbf24",
      totalTextColor: "#fef3c7",
    },
  },
  {
    id: "cyberNeon",
    name: "사이버 네온",
    emoji: "💎",
    tagline: "다크 나이트 블루 + 형광 사이안 테두리 & 네온 글루",
    badgeBg: "linear-gradient(135deg, #082f49, #06b6d4)",
    colors: {
      tableHeaderBgColor: "#082f49",
      tableHeaderTextColor: "#ffffff",
      tableBgColor: "#031525",
      tableLineColor: "rgba(6, 182, 212, 0.35)",
      tablePanelBorderColor: "#06b6d4",
      tableBorderGlow: "neon",
      tableBorderRadius: "12",
      tableRowEvenBg: "rgba(12, 44, 72, 0.60)",
      tableRowOddBg: "rgba(4, 22, 38, 0.60)",
      tableTextColor: "#ecfeff",
      contributionColor: "#22d3ee",
      totalTextColor: "#ffffff",
    },
  },
  {
    id: "roseVelvet",
    name: "로즈 벨벳",
    emoji: "🌹",
    tagline: "버건디 와인 글래스 + 핫로즈 마젠타 테두리 & 네온 글루",
    badgeBg: "linear-gradient(135deg, #4c0519, #f43f5e)",
    colors: {
      tableHeaderBgColor: "#4c0519",
      tableHeaderTextColor: "#ffffff",
      tableBgColor: "#1c0209",
      tableLineColor: "rgba(244, 63, 94, 0.35)",
      tablePanelBorderColor: "#f43f5e",
      tableBorderGlow: "neon",
      tableBorderRadius: "12",
      tableRowEvenBg: "rgba(76, 10, 30, 0.60)",
      tableRowOddBg: "rgba(35, 4, 14, 0.60)",
      tableTextColor: "#fff1f2",
      contributionColor: "#fb7185",
      totalTextColor: "#ffffff",
    },
  },
  {
    id: "emeraldNight",
    name: "에메랄드 나이트",
    emoji: "🌲",
    tagline: "딥 포레스트 그린 글래스 + 민트 에메랄드 테두리 & 네온 글루",
    badgeBg: "linear-gradient(135deg, #064e3b, #10b981)",
    colors: {
      tableHeaderBgColor: "#064e3b",
      tableHeaderTextColor: "#ffffff",
      tableBgColor: "#02241b",
      tableLineColor: "rgba(16, 185, 129, 0.35)",
      tablePanelBorderColor: "#10b981",
      tableBorderGlow: "neon",
      tableBorderRadius: "12",
      tableRowEvenBg: "rgba(10, 60, 48, 0.60)",
      tableRowOddBg: "rgba(4, 30, 24, 0.60)",
      tableTextColor: "#ecfdf5",
      contributionColor: "#34d399",
      totalTextColor: "#ffffff",
    },
  },
  {
    id: "modernSlate",
    name: "모던 다크 슬레이트",
    emoji: "🖤",
    tagline: "깔끔한 무채색 미니멀 다크 글래스 + 실버 라인 & 소프트 글루",
    badgeBg: "linear-gradient(135deg, #1e293b, #94a3b8)",
    colors: {
      tableHeaderBgColor: "#1e293b",
      tableHeaderTextColor: "#ffffff",
      tableBgColor: "#0f172a",
      tableLineColor: "rgba(148, 163, 184, 0.30)",
      tablePanelBorderColor: "#94a3b8",
      tableBorderGlow: "soft",
      tableBorderRadius: "12",
      tableRowEvenBg: "rgba(30, 41, 59, 0.60)",
      tableRowOddBg: "rgba(15, 23, 42, 0.60)",
      tableTextColor: "#f8fafc",
      contributionColor: "#38bdf8",
      totalTextColor: "#ffffff",
    },
  },
];

export function parseColorToRgb(color: string): [number, number, number] | null {
  if (!color) return null;
  const c = color.trim();
  const hexMatch = c.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) {
      hex = hex.split("").map((ch) => ch + ch).join("");
    }
    return [
      parseInt(hex.slice(0, 2), 16),
      parseInt(hex.slice(2, 4), 16),
      parseInt(hex.slice(4, 6), 16),
    ];
  }
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgbMatch) {
    return [
      Math.max(0, Math.min(255, parseInt(rgbMatch[1], 10))),
      Math.max(0, Math.min(255, parseInt(rgbMatch[2], 10))),
      Math.max(0, Math.min(255, parseInt(rgbMatch[3], 10))),
    ];
  }
  return null;
}

export function buildTableBorderGlowBoxShadow(
  color: string,
  glowMode: TableBorderGlowIntensity | string
): string {
  const mode = String(glowMode || "").trim().toLowerCase();
  if (!mode || mode === "none" || mode === "off" || mode === "false") return "";
  const rgb = parseColorToRgb(color);
  if (!rgb) return "";
  const [r, g, b] = rgb;
  if (mode === "soft") {
    return `0 0 10px rgba(${r}, ${g}, ${b}, 0.40)`;
  }
  if (mode === "neon") {
    return `0 0 16px rgba(${r}, ${g}, ${b}, 0.55), 0 0 4px rgba(${r}, ${g}, ${b}, 0.85)`;
  }
  if (mode === "vivid") {
    return `0 0 24px rgba(${r}, ${g}, ${b}, 0.70), 0 0 8px rgba(${r}, ${g}, ${b}, 0.95), 0 0 2px rgba(255, 255, 255, 0.75)`;
  }
  return "";
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const rgb = parseColorToRgb(hex) || [168, 85, 247];
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h = Math.round(h * 60);
  }
  return { h, s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToRgbValues(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

function hslToHexStr(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgbValues(h, s, l);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hslToRgbaStr(h: number, s: number, l: number, a: number): string {
  const [r, g, b] = hslToRgbValues(h, s, l);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function generateHarmoniousTablePalette(accentHex: string) {
  const { h, s } = hexToHsl(accentHex);
  const sat = Math.max(40, s);
  return {
    tableHeaderBgColor: hslToHexStr(h, Math.min(80, sat + 10), 16),
    tableHeaderTextColor: "#ffffff",
    tableBgColor: hslToHexStr(h, Math.min(70, sat), 7),
    tableLineColor: hslToRgbaStr(h, sat, 60, 0.35),
    tablePanelBorderColor: hslToHexStr(h, Math.min(100, sat + 15), 58),
    tableBorderGlow: "neon" as const,
    tableBorderRadius: "12",
    tableRowEvenBg: hslToRgbaStr(h, sat, 18, 0.60),
    tableRowOddBg: hslToRgbaStr(h, sat, 9, 0.60),
    tableTextColor: hslToHexStr(h, 20, 95),
    contributionColor: hslToHexStr((h + 10) % 360, Math.min(100, sat + 20), 72),
    totalTextColor: "#ffffff",
  };
}
