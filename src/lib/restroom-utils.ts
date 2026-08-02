import type { Member, RestroomLog } from "@/types";

export function normalizeRestroomCount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  const raw = String(value ?? "")
    .replace(/,/g, "")
    .trim();
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export function applyRestroomCountDelta(current: unknown, delta: 1 | -1, amount: number): number {
  const curr = normalizeRestroomCount(current);
  const step = Math.max(0, Math.floor(amount));
  if (step <= 0) return curr;
  return delta > 0 ? curr + step : Math.max(0, curr - step);
}

export function createRestroomLog(
  memberId: string,
  delta: 1 | -1,
  amount: number,
  note = "",
  now = Date.now()
): RestroomLog {
  return {
    id: `rl_${now}_${Math.random().toString(36).slice(2, 6)}`,
    memberId,
    amount: Math.max(0, Math.floor(amount)),
    delta,
    note: note.trim(),
    at: now,
  };
}

/** 멤버 화장실 횟수를 절대값(0 포함)으로 설정 */
export function buildRestroomMemberUpdate(
  members: Member[],
  memberId: string,
  nextValue: number,
  note = "",
  now = Date.now()
): { members: Member[]; log: RestroomLog | null; changed: boolean } {
  const safe = normalizeRestroomCount(nextValue);
  let log: RestroomLog | null = null;
  let changed = false;
  const membersNext = members.map((m) => {
    if (m.id !== memberId) return m;
    const curr = normalizeRestroomCount(m.restroom);
    if (curr === safe) return m;
    changed = true;
    const delta: 1 | -1 = safe > curr ? 1 : -1;
    log = createRestroomLog(memberId, delta, Math.abs(safe - curr), note, now);
    return { ...m, restroom: safe };
  });
  return { members: membersNext, log, changed };
}
