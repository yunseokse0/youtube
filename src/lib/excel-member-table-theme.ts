/** 엑셀표 멤버·총합 테마 id (방송 분홍 크롬과 구분) */
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

export const EXCEL_MEMBER_TABLE_ACCENT: Record<ExcelMemberThemeId, ExcelMemberTableAccent> = {
  excel: {
    headerBg: "rgba(33, 115, 70, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#1a5c37",
    totalRowBorder: "rgba(33, 115, 70, 0.45)",
    panelBorder: "#1a5c37",
    panelShadow: "0 2px 10px rgba(33, 115, 70, 0.22)",
  },
  excelLive: {
    headerBg: "rgba(26, 82, 118, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#0f3d56",
    totalRowBorder: "rgba(26, 82, 118, 0.45)",
    panelBorder: "#7eb8d4",
    panelShadow: "0 2px 10px rgba(30, 80, 120, 0.25)",
  },
  excelBlue: {
    headerBg: "rgba(37, 99, 235, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#1d4ed8",
    totalRowBorder: "rgba(37, 99, 235, 0.45)",
    panelBorder: "#1d4ed8",
    panelShadow: "0 2px 10px rgba(37, 99, 235, 0.22)",
  },
  excelSlate: {
    headerBg: "rgba(51, 65, 85, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#475569",
    totalRowBorder: "rgba(51, 65, 85, 0.55)",
    panelBorder: "#475569",
    panelShadow: "0 2px 10px rgba(15, 23, 42, 0.35)",
  },
  excelAmber: {
    headerBg: "rgba(217, 119, 6, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#b45309",
    totalRowBorder: "rgba(217, 119, 6, 0.45)",
    panelBorder: "#b45309",
    panelShadow: "0 2px 10px rgba(217, 119, 6, 0.22)",
  },
  excelRose: {
    headerBg: "rgba(225, 29, 72, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#be123c",
    totalRowBorder: "rgba(225, 29, 72, 0.45)",
    panelBorder: "#be123c",
    panelShadow: "0 2px 10px rgba(225, 29, 72, 0.22)",
  },
  excelNavy: {
    headerBg: "rgba(30, 58, 138, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#1e40af",
    totalRowBorder: "rgba(30, 58, 138, 0.45)",
    panelBorder: "#1e40af",
    panelShadow: "0 2px 10px rgba(15, 23, 42, 0.35)",
  },
  excelTeal: {
    headerBg: "rgba(13, 148, 136, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#0f766e",
    totalRowBorder: "rgba(13, 148, 136, 0.45)",
    panelBorder: "#0f766e",
    panelShadow: "0 2px 10px rgba(13, 148, 136, 0.22)",
  },
  excelPurple: {
    headerBg: "rgba(124, 58, 237, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#6d28d9",
    totalRowBorder: "rgba(124, 58, 237, 0.45)",
    panelBorder: "#6d28d9",
    panelShadow: "0 2px 10px rgba(124, 58, 237, 0.22)",
  },
  excelEmerald: {
    headerBg: "rgba(5, 150, 105, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#047857",
    totalRowBorder: "rgba(5, 150, 105, 0.45)",
    panelBorder: "#047857",
    panelShadow: "0 2px 10px rgba(5, 150, 105, 0.22)",
  },
  excelOrange: {
    headerBg: "rgba(234, 88, 12, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#c2410c",
    totalRowBorder: "rgba(234, 88, 12, 0.45)",
    panelBorder: "#c2410c",
    panelShadow: "0 2px 10px rgba(234, 88, 12, 0.22)",
  },
  excelIndigo: {
    headerBg: "rgba(79, 70, 229, 0.96)",
    headerText: "#ffffff",
    headerBorder: "#4338ca",
    totalRowBorder: "rgba(79, 70, 229, 0.45)",
    panelBorder: "#4338ca",
    panelShadow: "0 2px 10px rgba(79, 70, 229, 0.22)",
  },
};

export function isExcelMemberTableTheme(themeId: string): themeId is ExcelMemberThemeId {
  return (EXCEL_MEMBER_THEME_IDS as readonly string[]).includes(themeId);
}

export function resolveExcelMemberTableAccent(themeId: string): ExcelMemberTableAccent | null {
  if (!isExcelMemberTableTheme(themeId)) return null;
  return EXCEL_MEMBER_TABLE_ACCENT[themeId];
}
