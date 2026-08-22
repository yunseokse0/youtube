/** 엑셀표 멤버·총합 테마 id (방송 Studio 글래스 크롬과 구분) */
export const EXCEL_MEMBER_THEME_IDS = [
  "excel",
  "excelLive",
  "excelBlue",
  "excelSlate",
  "excelAmber",
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
};

const STUDIO_PANEL_SHADOW = "0 8px 32px rgba(15, 23, 42, 0.4)";
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

export function resolveExcelMemberTableAccent(themeId: string): ExcelMemberTableAccent | null {
  if (!isExcelMemberTableTheme(themeId)) return null;
  return EXCEL_MEMBER_TABLE_ACCENT[themeId];
}

/** 비엑셀(방송 글래스) 테마 — 테마 자동 시 헤더·총합 액센트 (전부 동일 파란 고정 금지) */
const BROADCAST_THEME_HEADER_BG: Record<string, string> = {
  default: "rgba(124, 58, 237, 0.80)",
  neonExcel: "rgba(217, 70, 239, 0.80)",
  retro: "rgba(22, 101, 52, 0.90)",
  minimal: "rgba(255, 255, 255, 0.12)",
  rpg: "rgba(180, 83, 9, 0.90)",
  pastel: "rgba(124, 58, 237, 0.70)",
  neon: "rgba(8, 145, 178, 0.85)",
  rainbow: "rgba(236, 72, 153, 0.80)",
  sunset: "rgba(249, 115, 22, 0.85)",
  ocean: "rgba(14, 165, 233, 0.85)",
  forest: "rgba(22, 163, 74, 0.85)",
  aurora: "rgba(52, 211, 153, 0.80)",
  violet: "rgba(139, 92, 246, 0.85)",
  coral: "rgba(251, 113, 133, 0.85)",
  mint: "rgba(52, 211, 153, 0.85)",
  lava: "rgba(239, 68, 68, 0.85)",
  ice: "rgba(125, 211, 252, 0.80)",
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

const FALLBACK_HEADER_BG = "rgba(124, 58, 237, 0.80)";
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

/** 테마 자동 — 패널/헤더 외곽선 */
export function resolveTableThemePanelBorderCss(themeId: string): string {
  const excel = resolveExcelMemberTableAccent(themeId);
  if (excel) return excel.headerBorder;
  return STUDIO_EDGE;
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

export function resolveTableThemeLinePreviewHex(themeId: string): string {
  return cssColorToPreviewHex(resolveTableThemePanelBorderCss(themeId));
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
  };
}
