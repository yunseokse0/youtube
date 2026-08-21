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

const STUDIO_PANEL_SHADOW = "0 8px 32px rgba(15, 20, 30, 0.35)";
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
