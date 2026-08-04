import type { Member, RestroomLog } from "@/types";

/** 멤버 restroom 필드 센티널 — 무제한 */
export const RESTROOM_UNLIMITED = -1;

/** 오버레이·관리자 표시용 무제한 기호 */
export const RESTROOM_UNLIMITED_SYMBOL = "∞";

export function isRestroomUnlimited(value: unknown): boolean {
  if (value === RESTROOM_UNLIMITED) return true;
  if (typeof value === "number" && Number.isFinite(value) && value < 0) return true;
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  return (
    raw === "∞" ||
    raw === "inf" ||
    raw === "infinity" ||
    raw === "unlimited" ||
    raw === "무제한"
  );
}

export function normalizeRestroomCount(value: unknown): number {
  if (isRestroomUnlimited(value)) return RESTROOM_UNLIMITED;
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

/** 엑셀표·로그 표시 문자열 */
export function formatRestroomDisplay(value: unknown): string {
  if (isRestroomUnlimited(value)) return RESTROOM_UNLIMITED_SYMBOL;
  return String(normalizeRestroomCount(value));
}

export function applyRestroomCountDelta(current: unknown, delta: 1 | -1, amount: number): number {
  if (isRestroomUnlimited(current)) {
    /** 무제한 상태에서는 +/- 횟수 반영 없음 — 명시적 0/무제한 설정만 변경 */
    return RESTROOM_UNLIMITED;
  }
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

export function isRestroomUnlimitedLog(log: Pick<RestroomLog, "note" | "amount" | "delta"> | null | undefined): boolean {
  if (!log) return false;
  const note = String(log.note || "").trim();
  return note === "무제한" || note.startsWith("무제한");
}

/** 멤버 화장실 횟수를 절대값(0·무제한 포함)으로 설정 */
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
    if (safe === RESTROOM_UNLIMITED) {
      /** amount = 이전 횟수(되돌리기용), note로 무제한 표시 */
      const baseNote = note.trim() || "무제한";
      log = createRestroomLog(
        memberId,
        1,
        curr === RESTROOM_UNLIMITED ? 0 : curr,
        baseNote.startsWith("무제한") ? baseNote : `무제한${baseNote ? ` · ${baseNote}` : ""}`,
        now
      );
      return { ...m, restroom: RESTROOM_UNLIMITED };
    }
    if (curr === RESTROOM_UNLIMITED) {
      log = createRestroomLog(memberId, -1, safe, note.trim() || (safe === 0 ? "무제한 해제" : "무제한→횟수"), now);
      return { ...m, restroom: safe };
    }
    const delta: 1 | -1 = safe > curr ? 1 : -1;
    log = createRestroomLog(memberId, delta, Math.abs(safe - curr), note, now);
    return { ...m, restroom: safe };
  });
  return { members: membersNext, log, changed };
}

/** 로그 되돌리기 시 적용할 다음 restroom 값 */
export function restroomValueAfterUndoLog(
  current: unknown,
  log: Pick<RestroomLog, "note" | "amount" | "delta">
): number {
  if (isRestroomUnlimitedLog(log) && log.delta > 0) {
    /** 무제한 설정 로그 되돌리기 → 이전 횟수(amount)로 복구 */
    return normalizeRestroomCount(log.amount);
  }
  const curr = normalizeRestroomCount(current);
  if (curr === RESTROOM_UNLIMITED) {
    return log.delta < 0 ? normalizeRestroomCount(log.amount) : RESTROOM_UNLIMITED;
  }
  return log.delta > 0
    ? Math.max(0, curr - Math.max(0, log.amount))
    : curr + Math.max(0, log.amount);
}
