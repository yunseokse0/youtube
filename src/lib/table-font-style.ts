export type TableFontFamilyId = "auto" | "mono" | "sans" | "pretendard" | "serif" | "gothic";

export const TABLE_FONT_FAMILY_OPTIONS: { id: TableFontFamilyId; label: string }[] = [
  { id: "auto", label: "테마 기본" },
  { id: "mono", label: "고정폭 (엑셀·숫자)" },
  { id: "pretendard", label: "Pretendard" },
  { id: "sans", label: "고딕 (시스템)" },
  { id: "gothic", label: "맑은 고딕 계열" },
  { id: "serif", label: "명조·세리프" },
];

const TABLE_FONT_FAMILY_CSS: Record<Exclude<TableFontFamilyId, "auto">, string> = {
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Courier New", monospace',
  sans: 'system-ui, -apple-system, "Segoe UI", "Noto Sans KR", sans-serif',
  pretendard: '"Pretendard Variable", Pretendard, "Noto Sans KR", system-ui, sans-serif',
  gothic: '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif',
  serif: 'Georgia, "Times New Roman", "Noto Serif KR", serif',
};

export function normalizeTableFontFamily(raw: unknown): TableFontFamilyId {
  const v = String(raw || "")
    .trim()
    .toLowerCase();
  if (v === "mono" || v === "sans" || v === "pretendard" || v === "serif" || v === "gothic") {
    return v;
  }
  return "auto";
}

/** CSS font-family. auto면 null(테마 tailwind 유지) */
export function resolveTableFontFamilyCss(id: TableFontFamilyId): string | null {
  if (id === "auto") return null;
  return TABLE_FONT_FAMILY_CSS[id];
}

export function clampTableMemberSizePx(raw: unknown, fallback = 24): number {
  const n = parseInt(String(raw ?? "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(10, Math.min(80, n));
}
