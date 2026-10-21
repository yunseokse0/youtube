/** 엑셀표 커스텀 열(상벌금 등) — 멤버별 자유 텍스트 */

export const DEFAULT_MEMBER_CUSTOM_HEADER_LABEL = "상벌금";
export const MAX_MEMBER_CUSTOM_CELL_LEN = 48;

export function normalizeMemberCustomHeaderLabel(input: unknown): string {
  const s = String(input ?? "").trim();
  return s || DEFAULT_MEMBER_CUSTOM_HEADER_LABEL;
}

export function normalizeMemberCustomCells(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, string> = {};
  for (const [rawId, rawVal] of Object.entries(input as Record<string, unknown>)) {
    const id = String(rawId || "").trim();
    if (!id) continue;
    const text = String(rawVal ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_MEMBER_CUSTOM_CELL_LEN);
    if (text) out[id] = text;
  }
  return out;
}
