/** 엑셀표 멤버·총합 테마 id (방송 Studio 글래스 크롬과 구분) */
export const EXCEL_MEMBER_THEME_IDS = [
  "excel",
  "excelLive",
  "excelBlue",
  "excelSlate",
  "excelAmber",
  "excelGold",
  "excelRose",
  "excelNavy",
  "excelTeal",
  "excelPurple",
  "excelEmerald",
  "excelOrange",
  "excelIndigo",
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
  /** 웹후원 골드 — 골드 헤더·테두리 (표 뒤 패널·줄무늬 배경 없음) */
  excelGold: {
    headerBg: "#ffc107",
    headerText: "#1a1408",
    headerBorder: "#ffc107",
    totalRowBorder: "rgba(255, 193, 7, 0.45)",
    panelBorder: "#ffc107",
    panelShadow: "none",
    rowEvenBg: "transparent",
    rowOddBg: "transparent",
    contributionColor: "#ffc107",
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
  "accountColor",
  "toonColor",
  "contributionColor",
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
    accountColor: "",
    toonColor: "",
    contributionColor: "",
    tableRowEvenBg: "",
    tableRowOddBg: "",
    tablePanelBorderColor: "",
  };
}
