/** 방송·판매 표시용 멤버 고유 색 팔레트 (채도 높은 구분색) */
export const MEMBER_DISPLAY_COLOR_PALETTE = [
  "#22d3ee",
  "#f472b6",
  "#a78bfa",
  "#fbbf24",
  "#34d399",
  "#fb7185",
  "#60a5fa",
  "#f97316",
  "#c084fc",
  "#2dd4bf",
  "#e879f9",
  "#84cc16",
] as const;

function isHexColor(raw: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw);
}

function hashMemberId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 멤버마다 안정적인 고유 색.
 * - override(식사대전 게이지 색 등)가 있으면 우선
 * - memberIds(로스터 순서)가 있으면 인덱스 기반
 * - 없으면 id 해시
 */
export function resolveMemberDisplayColor(
  memberId: string | null | undefined,
  opts?: {
    override?: string | null;
    /** 멤버 id → 색 (예: mealBattle.memberGaugeColors) */
    colorByMemberId?: Record<string, string> | null;
    /** 로스터 순서 — 인접 멤버 색 충돌 완화 */
    memberIds?: string[] | null;
  }
): string {
  const id = String(memberId || "").trim();
  const fromMap = id && opts?.colorByMemberId ? String(opts.colorByMemberId[id] || "").trim() : "";
  const override = String(opts?.override || fromMap || "").trim();
  if (isHexColor(override)) return override.length === 4
    ? `#${override[1]}${override[1]}${override[2]}${override[2]}${override[3]}${override[3]}`
    : override;

  if (!id) return MEMBER_DISPLAY_COLOR_PALETTE[0];

  const roster = Array.isArray(opts?.memberIds) ? opts!.memberIds! : null;
  if (roster && roster.length > 0) {
    const idx = roster.findIndex((x) => x === id);
    if (idx >= 0) {
      return MEMBER_DISPLAY_COLOR_PALETTE[idx % MEMBER_DISPLAY_COLOR_PALETTE.length];
    }
  }

  return MEMBER_DISPLAY_COLOR_PALETTE[hashMemberId(id) % MEMBER_DISPLAY_COLOR_PALETTE.length];
}
