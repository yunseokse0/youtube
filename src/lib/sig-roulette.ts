import type { SigItem } from "@/types";
import { repairDiskUploadSigImagePath } from "@/lib/sig-image-mode";
import { isBundledSigPlaceholderItem } from "@/lib/sig-placeholder";
import { getServerMemoryRouletteLogs, setServerMemoryRouletteLogs } from "@/lib/server-memory-roulette-logs";

export const ONE_SHOT_SIG_ID = "sig_one_shot";

/**
 * 멤버 필터 매칭. `memberFilterId`가 있으면 해당 멤버 전용 시그 + 공통(`memberId` 빈 값) 시그를 포함한다.
 * 필터가 비어 있으면 멤버 구분 없이 전체(호출 측에서 활성·제외 등 추가 필터).
 */
export function sigMatchesMemberFilter(
  item: Pick<SigItem, "memberId">,
  memberFilterId?: string | null
): boolean {
  const mid = String(memberFilterId ?? "").trim();
  if (!mid) return true;
  const sigMid = String(item.memberId ?? "").trim();
  if (!sigMid) return true;
  return sigMid === mid;
}

/** 회전판 메뉴 슬라이스 id(`실제SigId__wslot_n`) → 재고 `SigItem.id` */
export function canonicalSigIdFromWheelSliceId(sliceId: string): string {
  const raw = String(sliceId || "").trim();
  const m = /^(.+)__wslot_(\d+)$/.exec(raw);
  return m?.[1] || raw;
}

/** 회전판·관리자 표시용 — 깨진 대체 문자()·제어문자 제거 */
export function sanitizeWheelDisplayName(name: string): string {
  return String(name || "")
    .replace(/\uFFFD/g, "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();
}

/** 회전판 칸 수에 맞춰 시그명을 그래핌 단위로 줄인다(CSS ellipsis 대신 여기서만 자름). */
export function formatWheelSegmentLabel(name: string, segmentCount: number): string {
  const raw = sanitizeWheelDisplayName(name);
  if (!raw) return "—";
  const n = Math.max(1, Math.floor(segmentCount || 1));
  const maxChars = n >= 18 ? 6 : n >= 14 ? 7 : n >= 10 ? 8 : 10;
  const chars = [...raw];
  if (chars.length <= maxChars) return raw;
  return `${chars.slice(0, Math.max(1, maxChars - 1)).join("")}…`;
}

/**
 * 휠 조각 id(`원본id__wslot_N`)와 서버에서 넘어오는 당첨 id(캐노니컬만)가 다를 때 `===` 매칭이 실패해
 * 항상 0번 칸으로 착지하던 문제를 막는다.
 */
export function findSliceIndexForResult(
  items: SigItem[],
  resultId: string | null,
  duplicatePick = 0,
  usedSliceIds?: ReadonlySet<string>
): number {
  if (!resultId || items.length === 0) return -1;
  const exact = items.findIndex((x) => x.id === resultId);
  if (exact >= 0) return exact;
  const picked = pickWheelSliceIdForWin(items, resultId, duplicatePick, usedSliceIds);
  if (!picked) return -1;
  return items.findIndex((x) => x.id === picked);
}

/** `wheel_demo_13` vs `wheel_demo_13__wslot_12` 등 문자열이 달라도 같은 휠 칸이면 true */
export function wheelSliceIdsReferToSameSlot(
  wheelItems: SigItem[],
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ia = findSliceIndexForResult(wheelItems, a);
  const ib = findSliceIndexForResult(wheelItems, b);
  return ia >= 0 && ib >= 0 && ia === ib;
}

/** 회전판 표시 칸 수(5~20) — 관리자·OBS 공통 */
export function clampSigSalesMenuCount(raw: string | number | null | undefined): number {
  const n =
    typeof raw === "number" ? raw : parseInt(String(raw || "").replace(/[^\d]/g, "") || "10", 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(5, Math.min(20, Math.floor(n)));
}

/** 활성 시그가 있으면 회전판 칸 수는 활성 수보다 많아야 함(중복 칸으로 채움). */
export function minSigSalesMenuCountForActive(activeSigCount: number): number {
  const n = Math.max(0, Math.floor(activeSigCount));
  if (n <= 0) return 5;
  return Math.min(20, n + 1);
}

/** 관리자 설정값과 활성 시그 수를 반영한 실제 휠 칸 수 */
export function resolveSigSalesMenuCount(
  adminMenuCount: string | number | null | undefined,
  activeSigCount: number
): number {
  const admin = clampSigSalesMenuCount(adminMenuCount);
  const floor = minSigSalesMenuCountForActive(activeSigCount);
  return Math.max(admin, floor);
}

export type BuildSigSalesWheelDisplayPoolOptions = {
  inventory: SigItem[];
  sigSalesExcludedIds?: string[];
  sessionExcludedSigIds?: string[];
  memberFilterId?: string;
  menuCount: number;
  menuFillFromAllActive?: boolean;
  /** 스핀 당첨·pending — 휠 후보에 반드시 포함 */
  ensureItems?: SigItem[];
};

/** 관리자·OBS 동일 후보 풀(칸 수는 `buildWheelMenuSlices`에서 적용) */
export function buildSigSalesWheelDisplayPool(opts: BuildSigSalesWheelDisplayPoolOptions): SigItem[] {
  const {
    inventory,
    sigSalesExcludedIds = [],
    sessionExcludedSigIds = [],
    memberFilterId = "",
    menuCount,
    menuFillFromAllActive = false,
    ensureItems = [],
  } = opts;
  const excluded = new Set(sigSalesExcludedIds.map((x) => String(x)));
  const sessionExclusion = buildSessionSpinExclusion(inventory, sessionExcludedSigIds);
  const activeNormalPool = inventory.filter(
    (x) =>
      x.isActive &&
      x.id !== ONE_SHOT_SIG_ID &&
      !excluded.has(x.id) &&
      !isBundledSigPlaceholderItem(x) &&
      sigEligibleForSessionSpinPool(x, sessionExclusion) &&
      x.soldCount < x.maxCount &&
      sigMatchesMemberFilter(x, memberFilterId)
  );
  const targetCount = Math.max(20, clampSigSalesMenuCount(menuCount));
  const unique = new Map<string, SigItem>();
  for (const raw of ensureItems) {
    if (!raw?.id) continue;
    const canon = canonicalSigIdFromWheelSliceId(raw.id);
    const fromInv = inventory.find((x) => x.id === canon) || inventory.find((x) => x.id === raw.id);
    unique.set(canon, fromInv ? { ...fromInv } : { ...raw, id: canon });
  }
  for (const item of activeNormalPool) unique.set(item.id, item);
  if (menuFillFromAllActive && unique.size < targetCount) {
    const broadActivePool = inventory.filter(
      (x) =>
        x.isActive &&
        x.id !== ONE_SHOT_SIG_ID &&
        !excluded.has(x.id) &&
        !isBundledSigPlaceholderItem(x) &&
        x.soldCount < x.maxCount
    );
    for (const item of broadActivePool) {
      unique.set(item.id, item);
      if (unique.size >= targetCount) break;
    }
  }
  return Array.from(unique.values());
}

/**
 * 확정 당첨 큐만으로 휠 칸 구성(칸당 시그 1개).
 * 순차 연출에서 이미 공개된 시그 칸이 남아 다시 착지하는 것을 막는다.
 */
export function buildWheelMenuSlicesFromWinnerQueue(winners: SigItem[]): SigItem[] {
  if (!winners.length) return [];
  return winners.map((raw, i) => {
    const canon = canonicalSigIdFromWheelSliceId(raw.id);
    return {
      ...raw,
      id: `${canon}__wslot_${i}`,
      name: String(raw.name || canon).trim() || canon,
    };
  });
}

/** 휠 메뉴 칸(5~20) — 동일 시그는 `__wslot_i` 로 칸마다 구분. `menuCount`는 보통 `resolveSigSalesMenuCount` 결과 */
export function buildWheelMenuSlices(pool: SigItem[], menuCount: number): SigItem[] {
  const n = Math.max(1, Math.min(20, Math.floor(menuCount || 1)));
  if (!pool.length) return [];
  const out: SigItem[] = [];
  for (let i = 0; i < n; i++) {
    const canonical = pool[i % pool.length]!;
    const canon = canonicalSigIdFromWheelSliceId(canonical.id);
    out.push({ ...canonical, id: `${canon}__wslot_${i}` });
  }
  return out;
}

export type WheelSpinTarget = {
  items: SigItem[];
  sliceId: string | null;
  expectedCanon: string | null;
};

/** 이미 당첨된 시그(세션 제외 목록) — id + 표시명(재고에 동일 이름 다른 id) */
export function buildSessionSpinExclusion(
  inventory: SigItem[],
  sessionExcludedSigIds: string[] | undefined,
  priorWinners: Pick<SigItem, "id" | "name">[] = []
): { excludedIds: Set<string>; excludedNameKeys: Set<string> } {
  const excludedIds = new Set<string>();
  const excludedNameKeys = new Set<string>();
  for (const raw of sessionExcludedSigIds || []) {
    const canon = canonicalSigIdFromWheelSliceId(String(raw || "").trim());
    if (canon) excludedIds.add(canon);
  }
  for (const row of inventory) {
    const canon = canonicalSigIdFromWheelSliceId(row.id);
    const nk = normalizeSigPickNameKey(row.name);
    if (row.soldCount >= row.maxCount) {
      excludedIds.add(canon);
      if (nk) excludedNameKeys.add(nk);
    }
    if (!excludedIds.has(canon)) continue;
    if (nk) excludedNameKeys.add(nk);
  }
  for (const w of priorWinners) {
    const canon = canonicalSigIdFromWheelSliceId(w.id);
    if (!canon || !excludedIds.has(canon)) continue;
    const nk = normalizeSigPickNameKey(w.name);
    if (nk) excludedNameKeys.add(nk);
  }
  return { excludedIds, excludedNameKeys };
}

/** 스핀 후보·휠 메뉴 풀에서 제외 */
export function sigEligibleForSessionSpinPool(
  item: Pick<SigItem, "id" | "name">,
  exclusion: { excludedIds: Set<string>; excludedNameKeys: Set<string> }
): boolean {
  if (item.id === ONE_SHOT_SIG_ID) return false;
  const canon = canonicalSigIdFromWheelSliceId(item.id);
  if (exclusion.excludedIds.has(canon)) return false;
  const nk = normalizeSigPickNameKey(item.name);
  if (nk && exclusion.excludedNameKeys.has(nk)) return false;
  return true;
}

/** 당첨 큐에 id·표시명 중복이 없는지 */
export function isSigQueueDistinctByIdAndName(queue: SigItem[]): boolean {
  return dedupeSigQueueByIdAndName(queue).length === queue.length;
}

/** 순차 회전 당첨 큐 — id·표시명 중복 제거(이미 나온 시그가 다음 회차에 또 당첨되는 것 방지) */
export function dedupeSigQueueByIdAndName(queue: SigItem[]): SigItem[] {
  const out: SigItem[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  for (const item of queue) {
    const id = canonicalSigIdFromWheelSliceId(item.id);
    if (!id || usedIds.has(id)) continue;
    const nameKey = normalizeSigPickNameKey(item.name);
    if (nameKey && usedNames.has(nameKey)) continue;
    usedIds.add(id);
    if (nameKey) usedNames.add(nameKey);
    out.push(item);
  }
  return out;
}

/**
 * 동일 시그가 휠에 여러 칸일 때, 이번 회차 당첨 전에 같은 시그가 몇 번 나왔는지(슬라이스 pick용).
 * `roundIndex` 를 그대로 쓰면 다른 시그 2회차가 2번째 칸으로 착지하는 등 오동작이 난다.
 */
export function wheelDuplicatePickForWinner(
  priorWinners: readonly SigItem[],
  serverWinner: SigItem
): number {
  const canon = canonicalSigIdFromWheelSliceId(serverWinner.id);
  let n = 0;
  for (const w of priorWinners) {
    if (canonicalSigIdFromWheelSliceId(w.id) === canon) n++;
  }
  return n;
}

/**
 * 서버 당첨 시그가 휠에 반드시 있도록 보장하고, 해당 회차 착지용 slice id를 반환한다.
 * (카드 A / 휠 B 불일치 방지 — 당첨은 서버 큐, 휠은 이 함수 출력만 사용)
 */
export function resolveWheelSpinTarget(
  wheelSlices: SigItem[],
  serverWinner: SigItem | null,
  roundIndex: number,
  usedSliceIds?: ReadonlySet<string>,
  priorWinners?: readonly SigItem[]
): WheelSpinTarget {
  if (!serverWinner || wheelSlices.length === 0) {
    return { items: wheelSlices, sliceId: null, expectedCanon: null };
  }
  const expectedCanon = canonicalSigIdFromWheelSliceId(serverWinner.id);
  const duplicatePick =
    priorWinners !== undefined
      ? wheelDuplicatePickForWinner(priorWinners, serverWinner)
      : Math.max(0, roundIndex);
  let items = [...wheelSlices];
  let sliceId = pickWheelSliceIdForWin(items, serverWinner.id, duplicatePick, usedSliceIds);
  if (!sliceId) {
    const slotIdx = Math.max(0, roundIndex) % items.length;
    const canon = expectedCanon;
    items = [...items];
    items[slotIdx] = {
      ...serverWinner,
      id: `${canon}__wslot_${slotIdx}`,
      name: String(serverWinner.name || items[slotIdx]?.name || canon).trim() || canon,
    };
    sliceId = items[slotIdx]!.id;
  }
  let idx = findSliceIndexForResult(items, sliceId);
  if (idx < 0) {
    /** 주입·슬라이스 id가 있는데 인덱스만 실패하면 원본 휠로 되돌리지 않고 한 번 더 맞춤 */
    const retry = pickWheelSliceIdForWin(items, sliceId, duplicatePick, usedSliceIds);
    if (retry) {
      sliceId = retry;
      idx = findSliceIndexForResult(items, sliceId);
    }
  }
  if (idx < 0) {
    return { items, sliceId: null, expectedCanon };
  }
  return { items, sliceId, expectedCanon };
}

export type BindWheelToRoundWinnerOptions = {
  wheelSlices: SigItem[];
  /** 이번에 나올(서버 큐) 시그 — 회전판·카드의 기준 */
  roundWinner: SigItem | null;
  roundIndex: number;
  usedSliceIds?: ReadonlySet<string>;
  priorWinners?: readonly SigItem[];
};

/**
 * 단일 규칙: `roundWinner`(이번에 나올 시그)에 맞춰 휠 칸·감속 `resultId`를 한 번에 결정.
 * 관리자·OBS는 이 함수 출력만 `RouletteWheel`에 넘긴다(`machine.result` 사용 금지).
 */
export function bindWheelAnimationToRoundWinner(opts: BindWheelToRoundWinnerOptions): {
  items: SigItem[];
  sliceId: string | null;
  /** `RouletteWheel` `targetSliceIndex` — `findSliceIndexForResult` 를 페이지마다 다시 호출하지 않음 */
  targetSliceIndex: number | null;
  animationResultId: string | null;
  duplicatePick: number;
} {
  const prior = opts.priorWinners;
  const target = resolveWheelSpinTarget(
    opts.wheelSlices,
    opts.roundWinner,
    opts.roundIndex,
    opts.usedSliceIds,
    prior
  );
  const duplicatePick =
    prior !== undefined && opts.roundWinner
      ? wheelDuplicatePickForWinner(prior, opts.roundWinner)
      : Math.max(0, opts.roundIndex);
  const animationResultId = pickWheelAnimationResultId(target.sliceId, opts.roundWinner, {
    wheelItems: target.items,
    duplicatePick,
    usedSliceIds: opts.usedSliceIds,
  });
  const targetSliceIndex =
    target.sliceId != null
      ? findSliceIndexForResult(target.items, target.sliceId, duplicatePick, opts.usedSliceIds)
      : -1;
  return {
    items: target.items,
    sliceId: target.sliceId,
    targetSliceIndex: targetSliceIndex >= 0 ? targetSliceIndex : null,
    animationResultId,
    duplicatePick,
  };
}

/** 이번 회차 당첨 1개만 휠에 올릴 때(테스트·레거시; 연출 기본은 `resolveWheelSlicesForSpinVisual`) */
export function buildWheelSlicesForCurrentRoundWinner(winner: SigItem | null): SigItem[] {
  if (!winner) return [];
  return buildWheelMenuSlicesFromWinnerQueue([winner]);
}

export type ResolveWheelSlicesForSpinVisualOptions = {
  menuPool: SigItem[];
  menuCount: number;
  /** `winnersOnly` 오버레이: 당첨 큐만 칸으로 표시 */
  winnersOnly?: boolean;
  winnerQueue?: SigItem[];
  /** 세션 동안 고정된 칸 배치(폴링으로 `__wslot_n` 매핑이 바뀌지 않게) */
  pinnedSlices?: SigItem[] | null;
};

/** 회전 연출용 휠 — 여러 칸(메뉴 풀)을 보여 주고 착지는 `resolveWheelSpinTarget`으로 맞춘다 */
export function resolveWheelSlicesForSpinVisual(
  opts: ResolveWheelSlicesForSpinVisualOptions
): SigItem[] {
  const pinned = opts.pinnedSlices;
  if (pinned?.length) return pinned;
  const queue = opts.winnerQueue || [];
  if (opts.winnersOnly && queue.length > 0) {
    return buildWheelMenuSlicesFromWinnerQueue(queue);
  }
  return buildWheelMenuSlices(opts.menuPool, opts.menuCount);
}

export type PickWheelAnimationResultIdOptions = {
  wheelItems?: SigItem[] | null;
  duplicatePick?: number;
  usedSliceIds?: ReadonlySet<string>;
  demoResultId?: string | null;
};

/**
 * 휠 `RouletteWheel` `resultId` prop.
 * `machine.result` 는 cinematic5 다중 당첨 시 **마지막** 시그 id → 1·2회차에 쓰면 휠·카드 불일치.
 * 캐노니컬 id만 넘기면 동일 시그 중복 칸 중 **첫 칸**으로 착지하므로 `wheelItems`·`duplicatePick`을 넘긴다.
 */
export function pickWheelAnimationResultId(
  sliceId: string | null,
  roundWinner: SigItem | null,
  opts?: string | null | PickWheelAnimationResultIdOptions
): string | null {
  const o: PickWheelAnimationResultIdOptions =
    typeof opts === "string" || opts === null || opts === undefined
      ? { demoResultId: opts ?? undefined }
      : opts;
  if (sliceId) return sliceId;
  if (roundWinner?.id && o.wheelItems?.length) {
    const picked = pickWheelSliceIdForWin(
      o.wheelItems,
      roundWinner.id,
      o.duplicatePick ?? 0,
      o.usedSliceIds
    );
    if (picked) return picked;
  }
  if (roundWinner?.id) return roundWinner.id;
  return o.demoResultId ?? null;
}

/** 착지 slice id가 이번 회차 서버 당첨과 같은 시그인지 */
export function wheelSliceMatchesServerWinner(
  landedSliceId: string | null,
  serverWinner: SigItem | null
): boolean {
  if (!landedSliceId || !serverWinner) return false;
  return (
    canonicalSigIdFromWheelSliceId(landedSliceId) === canonicalSigIdFromWheelSliceId(serverWinner.id)
  );
}

/** 휠 착지 정합 점검(데모·테스트) — 확정 시그 vs 포인터 아래 칸 */
export type WheelRoundAlignmentReport = {
  roundIndex: number;
  winnerId: string;
  winnerName: string;
  winnerCanon: string;
  targetSliceId: string | null;
  animationResultId: string | null;
  landedSliceId: string | null;
  targetIndex: number;
  landedIndex: number;
  targetLabel: string;
  landedLabel: string;
  /** 착지 칸의 시그 id(캐노니컬)가 확정 당첨과 동일 */
  matchesWinner: boolean;
  /** 착지 인덱스가 목표 slice id 인덱스와 동일 */
  indexAligned: boolean;
  /** DOM(앵커·라벨) 측정 칸. −1 이면 미측정(표시는 수식 칸으로 대체) */
  visualPointerIndex: number;
  /** 수식 역산 칸 = DOM 측정 칸 */
  visualFormulaAligned: boolean;
  /** 포인터(▼) 아래 라벨 칸 — DOM 우선, 없으면 수식 */
  pointerIndex: number;
  /** `pointerRotationDeg` 역산 칸 — 수식만 */
  formulaPointerIndex: number;
  pointerLabel: string;
  pointerSliceId: string | null;
  /** 포인터 아래 칸이 확정 시그와 같음 */
  pointerMatchesWinner: boolean;
  /** 착지 직후 휠 `rotate` 값(도, mod 360) — DOM `transform` 우선 */
  pointerRotationDeg: number | null;
  /** MotionValue vs CSS matrix 차이(도) — 0.5 초과 시 desync */
  motionDesyncDeg: number | null;
  /** 수식 역산 칸이 목표와 같음(진단용) */
  formulaAligned: boolean;
  /** landed·target slice id가 동일 칸을 가리킴 */
  sliceIdAligned: boolean;
  ok: boolean;
  /** ok 가 false 일 때 요약 */
  failReason: string | null;
};

export function buildWheelRoundAlignmentReport(opts: {
  wheelItems: SigItem[];
  serverWinner: SigItem;
  targetSliceId: string | null;
  animationResultId: string | null;
  landedSliceId: string | null;
  /** 착지 직후 휠 회전각(도). 있으면 포인터 아래 칸을 각도로 계산 */
  pointerRotationDeg?: number | null;
  /** 라벨 DOM 기준 포인터 아래 칸(있으면 OK 판정에 사용) */
  visualPointerIndex?: number | null;
  motionDesyncDeg?: number | null;
  roundIndex?: number;
  getLabel?: (item: SigItem) => string;
}): WheelRoundAlignmentReport {
  const { wheelItems, serverWinner, targetSliceId, animationResultId, landedSliceId } = opts;
  const roundIndex = Math.max(0, Math.floor(opts.roundIndex ?? 0));
  const labelOf = (item: SigItem | undefined) => {
    if (!item) return "—";
    const raw = opts.getLabel ? opts.getLabel(item) : item.name;
    return sanitizeWheelDisplayName(raw) || "—";
  };
  const targetIndex = targetSliceId ? findSliceIndexForResult(wheelItems, targetSliceId) : -1;
  const landedIndex = landedSliceId ? findSliceIndexForResult(wheelItems, landedSliceId) : -1;
  const targetItem = targetIndex >= 0 ? wheelItems[targetIndex] : undefined;
  const landedItem = landedIndex >= 0 ? wheelItems[landedIndex] : undefined;
  const pointerRotationDeg =
    opts.pointerRotationDeg != null && Number.isFinite(opts.pointerRotationDeg)
      ? opts.pointerRotationDeg
      : null;
  const hasPointerDeg = pointerRotationDeg != null;
  const formulaPointerIndex = hasPointerDeg
    ? findSliceIndexAtPointerRotation(pointerRotationDeg!, wheelItems.length)
    : -1;
  const visualPointerIndex =
    opts.visualPointerIndex != null && Number.isFinite(opts.visualPointerIndex)
      ? Math.floor(opts.visualPointerIndex)
      : -1;
  const pointerIndex = visualPointerIndex >= 0 ? visualPointerIndex : formulaPointerIndex;
  const pointerSliceId =
    pointerIndex >= 0 ? wheelItems[pointerIndex]?.id ?? null : null;
  const matchesWinner = wheelSliceMatchesServerWinner(pointerSliceId, serverWinner);
  const indexAligned =
    pointerIndex >= 0 && targetIndex >= 0 && pointerIndex === targetIndex;
  const formulaAligned =
    formulaPointerIndex >= 0 &&
    targetIndex >= 0 &&
    formulaPointerIndex === targetIndex;
  const pointerItem = pointerIndex >= 0 ? wheelItems[pointerIndex] : undefined;
  const pointerMatchesWinner = wheelSliceMatchesServerWinner(pointerSliceId, serverWinner);
  const sliceIdAligned = wheelSliceIdsReferToSameSlot(
    wheelItems,
    landedSliceId,
    targetSliceId
  );
  const visualFormulaAligned =
    visualPointerIndex >= 0 &&
    formulaPointerIndex >= 0 &&
    visualPointerIndex === formulaPointerIndex;
  const expectedNormDeg =
    targetIndex >= 0 ? wheelRotationNormForSliceIndex(targetIndex, wheelItems.length) : null;
  const angleMatch =
    hasPointerDeg &&
    expectedNormDeg != null &&
    pointerRotationDeg != null &&
    Math.abs(wheelNormalizeDegDelta(pointerRotationDeg - expectedNormDeg)) <= 0.5;
  const visualOk =
    visualPointerIndex >= 0 && visualPointerIndex === targetIndex;
  /** 수식만 맞고 ▼ 아래 라벨이 다르면 fail (거짓 OK 방지) */
  const ok =
    Boolean(targetSliceId) &&
    targetIndex >= 0 &&
    angleMatch &&
    formulaAligned &&
    formulaPointerIndex === targetIndex &&
    pointerMatchesWinner &&
    sliceIdAligned &&
    visualOk &&
    visualFormulaAligned;
  const failReason = ok
    ? null
    : !targetSliceId
      ? "목표 slice 없음"
      : !hasPointerDeg || !angleMatch
        ? "착지 각도가 목표 칸과 다름"
        : !visualOk
          ? "▼ 아래 라벨 ≠ 목표 칸"
          : !formulaAligned || formulaPointerIndex !== targetIndex
            ? "수식 역산 칸 ≠ 목표"
          : !pointerMatchesWinner
            ? "포인터 아래 다른 시그"
            : !sliceIdAligned
              ? "landed·target slice id 불일치"
              : "기타";
  return {
    roundIndex,
    winnerId: serverWinner.id,
    winnerName: sanitizeWheelDisplayName(serverWinner.name) || serverWinner.id,
    winnerCanon: canonicalSigIdFromWheelSliceId(serverWinner.id),
    targetSliceId,
    animationResultId,
    landedSliceId: landedSliceId ?? pointerSliceId,
    targetIndex,
    landedIndex: landedIndex >= 0 ? landedIndex : pointerIndex,
    targetLabel: labelOf(targetItem),
    landedLabel: labelOf(landedItem ?? pointerItem),
    matchesWinner,
    indexAligned,
    visualPointerIndex,
    visualFormulaAligned,
    pointerIndex,
    formulaPointerIndex,
    pointerLabel: labelOf(pointerItem),
    pointerSliceId,
    pointerMatchesWinner,
    pointerRotationDeg:
      pointerRotationDeg != null && Number.isFinite(pointerRotationDeg)
        ? pointerRotationDeg
        : null,
    motionDesyncDeg:
      opts.motionDesyncDeg != null && Number.isFinite(opts.motionDesyncDeg)
        ? opts.motionDesyncDeg
        : null,
    formulaAligned,
    sliceIdAligned,
    ok,
    failReason,
  };
}

/**
 * 당첨 id(재고 id 또는 `__wslot_n` 접미사 포함)에 맞는 휠 슬라이스 id를 고른다.
 * 동일 시그가 여러 칸이면 `duplicatePick`(순차 라운드 인덱스 등)으로 어느 칸을 쓸지 나눈다.
 * 오버레이에서 `realId`만 캐노니컬로 비교하고 `=== rid`로 걸면 매칭 실패 → 마지막 칸 폴백으로
 * 휠과 결과 카드가 엇갈리던 문제를 막는다.
 */
export function pickWheelSliceIdForWin(
  items: SigItem[],
  winningRealId: string | null,
  duplicatePick = 0,
  usedSliceIds?: ReadonlySet<string>
): string | null {
  if (!winningRealId || items.length === 0) return null;
  const winCanon = canonicalSigIdFromWheelSliceId(winningRealId);
  const indices: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (canonicalSigIdFromWheelSliceId(items[i]!.id) === winCanon) indices.push(i);
  }
  if (indices.length === 0) return null;
  let pickFrom = indices;
  if (usedSliceIds && usedSliceIds.size > 0) {
    const unused = indices.filter((i) => !usedSliceIds.has(items[i]!.id));
    if (unused.length > 0) pickFrom = unused;
  }
  const slot = pickFrom[Math.max(0, duplicatePick) % pickFrom.length]!;
  return items[slot]!.id;
}

export type SpinQueueSessionPin = { sessionId: string; queue: SigItem[] };

function spinQueueCanonKey(queue: SigItem[]): string {
  return queue
    .map((s) => canonicalSigIdFromWheelSliceId(s.id))
    .sort()
    .join(",");
}

/** 같은 session·같은 당첨 집합이면 폴링으로 순서만 바뀐 primary를 무시한다 */
function spinQueueSameCanonSet(a: SigItem[], b: SigItem[]): boolean {
  if (a.length !== b.length) return false;
  return spinQueueCanonKey(a) === spinQueueCanonKey(b);
}

/**
 * 폴링/SSE 순간에 `selectedSigs`가 비었다가 다시 오면 순차 인덱스·당첨 큐가 리셋되어
 * 휠·카드가 엇갈리거나 이미 나온 시그가 다시 당첨되는 것처럼 보이는 것을 막는다.
 */
export function resolveSpinQueueForSession(
  pin: SpinQueueSessionPin,
  sessionId: string,
  primary: SigItem[],
  fallback: SigItem[],
  maxSlots: number
): { pin: SpinQueueSessionPin; queue: SigItem[] } {
  const sid = String(sessionId || "").trim();
  const cap = Math.max(1, Math.floor(maxSlots || 1));
  const primarySlice = primary.slice(0, cap);
  const fallbackSlice = fallback.slice(0, cap);
  const pick = primarySlice.length > 0 ? primarySlice : fallbackSlice;
  if (pick.length > 0) {
    const dedupedPick = dedupeSigQueueByIdAndName(pick);
    if (!sid || pin.sessionId !== sid) {
      const next = { sessionId: sid, queue: dedupedPick };
      return { pin: next, queue: dedupedPick };
    }
    if (dedupedPick.length > pin.queue.length) {
      const extended = dedupeSigQueueByIdAndName([
        ...pin.queue,
        ...dedupedPick.slice(pin.queue.length),
      ]);
      const next = { sessionId: sid, queue: extended };
      return { pin: next, queue: extended };
    }
    if (dedupedPick.length === pin.queue.length) {
      if (spinQueueSameCanonSet(dedupedPick, pin.queue)) {
        return { pin, queue: pin.queue };
      }
      const next = { sessionId: sid, queue: dedupedPick };
      return { pin: next, queue: dedupedPick };
    }
    return { pin, queue: pin.queue };
  }
  if (sid && pin.sessionId === sid && pin.queue.length > 0) {
    return { pin, queue: pin.queue };
  }
  return { pin: { sessionId: sid, queue: [] }, queue: [] };
}

/** 순차 회전: 이미 착지한 슬라이스 id는 다음 라운드 후보에서 제외(동일 시그 재당첨 시 다른 칸) */
export function rememberUsedWheelSliceId(used: Set<string>, sliceId: string | null | undefined): void {
  const id = String(sliceId || "").trim();
  if (id) used.add(id);
}

/** 순차 회전: 이미 당첨 확정된 시그(캐노니컬 id) — 큐 검증·연출 보조 */
export function rememberUsedWheelCanonSigId(
  used: Set<string>,
  winner: SigItem | null | undefined
): void {
  const canon = canonicalSigIdFromWheelSliceId(String(winner?.id || ""));
  if (canon) used.add(canon);
}

/**
 * conic·라벨 phase 미세 보정(도). `R=(360−θ)` 모델에서는 θ에 더하면 안 되고,
 * 필요 시 `R=(360−θ−OFFSET)` 형태로만 조정. 기본 0.
 */
export const WHEEL_VISUAL_ROTATION_OFFSET_DEG = 0;

/** 라벨 역회전 `rotate(-θ-R+offset)` — 육안만 틀리면 ±9·±18 테스트 */
export const WHEEL_VISUAL_LABEL_OFFSET_DEG = 0;

/** 칸 수에 따른 한 조각 각도(도) */
export function wheelSliceSegmentDeg(sliceCount: number): number {
  return 360 / Math.max(1, Math.floor(sliceCount));
}

/** conic `from` — 라벨 `wheelSliceCenterDeg`(9°·27°…)와 동일: 칸 i 중심 = i·seg + seg/2 */
export function wheelConicGradientFromDeg(_sliceCount?: number): number {
  return 0;
}

/** 휠 배경 conic-gradient CSS — 라벨 `wheelSliceCenterDeg`·착지 수식과 동일 phase */
export function buildWheelConicGradientCss(
  colors: readonly string[],
  sliceCount: number
): string {
  const n = Math.max(1, Math.floor(sliceCount));
  const seg = wheelSliceSegmentDeg(n);
  const phase = wheelConicGradientFromDeg(n);
  const stops = colors.slice(0, n).map((color, i) => {
    const from = i * seg;
    const to = (i + 1) * seg;
    return `${color} ${from}deg ${to}deg`;
  });
  return `conic-gradient(from ${phase}deg, ${stops.join(", ")})`;
}

/** from → to 최단 칸 차이(−⌊n/2⌋ … ⌊n/2⌋) */
export function wheelSliceIndexDelta(fromIndex: number, toIndex: number, sliceCount: number): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const from = ((Math.floor(fromIndex) % n) + n) % n;
  const to = ((Math.floor(toIndex) % n) + n) % n;
  let d = to - from;
  if (d > n / 2) d -= n;
  if (d < -n / 2) d += n;
  return d;
}

/**
 * 포인터(12시) 아래 칸을 from → to 로 맞출 때 `rotate`에 더할 각도(도).
 * 칸 인덱스가 +1 오르면 R은 seg만큼 감소(θ+R≡0).
 */
export function wheelRotationCorrectionDeg(
  fromIndex: number,
  toIndex: number,
  sliceCount: number
): number {
  return -wheelSliceIndexDelta(fromIndex, toIndex, sliceCount) * wheelSliceSegmentDeg(sliceCount);
}

/** 칸 인덱스의 중심각(도) — 12시=0° 시계방향, conic·착지·라벨 공통 */
export function wheelSliceCenterDeg(sliceIndex: number, sliceCount: number): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const idx = Math.max(0, Math.min(n - 1, Math.floor(sliceIndex)));
  const seg = wheelSliceSegmentDeg(n);
  return idx * seg + seg / 2;
}

/** 극좌표 라벨 위치(px) — `rotate+translateY` 체인 1칸 어긋남 방지 */
/** 칸 중심 림에서 글자를 둘레 접선 방향(가로 읽기)으로 둘 때 `rotate` 각도 */
export function wheelSliceLabelTextRotateDeg(sliceCenterDeg: number): number {
  const a = ((sliceCenterDeg % 360) + 360) % 360;
  return a > 90 && a < 270 ? -90 : 90;
}

/** 부채꼴 섹터 무게중심 반경(px) — 라벨이 허브·림 사이 칸 안에 오도록 */
export function wheelSliceLabelRadiusPx(
  innerRadiusPx: number,
  sliceCount: number,
  centerHubRadiusPx: number
): number {
  const R = Math.max(1, innerRadiusPx);
  const n = Math.max(1, Math.floor(sliceCount));
  const hub = Math.max(0, centerHubRadiusPx);
  const minR = hub + 12;
  const maxR = R - 12;
  if (n <= 1) return Math.max(minR, Math.round(R * 0.5));
  const phi = (2 * Math.PI) / n;
  const centroid = (R * (4 * Math.sin(phi / 2))) / (3 * phi);
  return Math.max(minR, Math.round(Math.min(centroid, maxR)));
}

/** 칸 중심→바깥 방향으로 글자를 둘 때 `rotate`(도) */
export function wheelSliceLabelRotateDeg(sliceCenterDeg: number): number {
  return sliceCenterDeg - 90;
}

/** 칸 호(arc) 길이에 맞는 라벨 최대 너비(px) */
export function wheelSliceLabelMaxWidthPx(sliceCount: number, radiusPx: number): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const segRad = (Math.PI * 2) / n;
  const chord = 2 * Math.max(1, radiusPx) * Math.sin(segRad / 2);
  const factor = n >= 20 ? 0.7 : n >= 16 ? 0.76 : n >= 12 ? 0.82 : 0.88;
  return Math.max(20, Math.floor(chord * factor));
}

/** 칸 수·스케일에 맞는 라벨 글자 크기(px) */
export function wheelSliceLabelFontPx(sliceCount: number, scalePct: number): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const scale = Math.max(55, Math.min(140, Math.floor(Number(scalePct) || 100))) / 100;
  const base = n >= 20 ? 10 : n >= 16 ? 11 : n >= 12 ? 12 : 13;
  return Math.max(9, Math.round(base * scale));
}

export function wheelSliceLabelPolarOffsetPx(
  sliceIndex: number,
  sliceCount: number,
  radiusPx: number
): { x: number; y: number } {
  const mid = wheelSliceCenterDeg(sliceIndex, sliceCount);
  const rad = ((mid - 90) * Math.PI) / 180;
  return {
    x: Math.cos(rad) * radiusPx,
    y: Math.sin(rad) * radiusPx,
  };
}

/** 디스크 중심 기준 12시=0° 시계방향 각도(화면 좌표) */
export function wheelAngleFromCenterClockwise(
  centerX: number,
  centerY: number,
  x: number,
  y: number
): number {
  const dx = x - centerX;
  const dy = y - centerY;
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

/** 최단 부호 각도 차(−180~180) */
export function wheelNormalizeDegDelta(deltaDeg: number): number {
  let d = deltaDeg % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

export function wheelAngularDistanceDeg(aDeg: number, bDeg: number): number {
  return Math.abs(wheelNormalizeDegDelta(aDeg - bDeg));
}

/**
 * 포인터(12시) 아래 칸 중심각 θ(도) — 디스크 로컬.
 * `rotate(R)` 후 로컬 θ가 12시에 오려면 (θ + R) ≡ 0 → θ ≡ (360 − R).
 */
export function wheelAngleUnderPointer(rotationDeg: number, _sliceCount?: number): number {
  const r = ((rotationDeg % 360) + 360) % 360;
  return ((360 - r) % 360 + 360) % 360;
}

/** 칸 중심 θ가 12시 포인터에 오도록 하는 `rotate` 각도(mod 360) — `θ+R ≡ 0 (mod 360)` */
export function wheelRotationNormForSliceCenter(
  targetCenterDeg: number,
  _sliceCount?: number
): number {
  const theta = ((targetCenterDeg % 360) + 360) % 360;
  const off = WHEEL_VISUAL_ROTATION_OFFSET_DEG;
  return (((360 - theta - off) % 360) + 360) % 360;
}

/** 칸 인덱스 → 12시 포인터 착지 각도(mod 360). 라벨은 `wheelSliceCenterDeg` 와 동일 기준 */
export function wheelRotationNormForSliceIndex(
  sliceIndex: number,
  sliceCount: number
): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const idx = Math.max(0, Math.min(n - 1, Math.floor(sliceIndex)));
  return wheelRotationNormForSliceCenter(wheelSliceCenterDeg(idx, n), n);
}

/**
 * 목표 칸 index → 스핀 종료 절대각(도). `targetSliceIndex` 기준(문자열 재조회 없음).
 */
export function wheelAbsoluteLandAngleForSliceIndex(
  currentAbsDeg: number,
  targetIndex: number,
  sliceCount: number,
  minFullTurns = 4
): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const idx = Math.max(0, Math.min(n - 1, Math.floor(targetIndex)));
  const norm = wheelRotationNormForSliceIndex(idx, n);
  const base = Number.isFinite(currentAbsDeg) ? currentAbsDeg : 0;
  const curMod = ((base % 360) + 360) % 360;
  let delta = ((norm - curMod + 360) % 360);
  if (delta < 1e-6) delta = 360;
  return base + Math.max(1, Math.floor(minFullTurns)) * 360 + delta;
}

/** 애니 종료 직후 — 누적 바퀴 유지·mod 360 만 목표 칸 norm 에 맞춤 */
export function snapWheelAbsoluteToSliceNorm(
  currentAbsDeg: number,
  targetIndex: number,
  sliceCount: number
): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const idx = Math.max(0, Math.min(n - 1, Math.floor(targetIndex)));
  const norm = wheelRotationNormForSliceIndex(idx, n);
  const base = Number.isFinite(currentAbsDeg) ? currentAbsDeg : 0;
  return Math.floor(base / 360) * 360 + norm;
}

/**
 * 현재 누적 회전(정수 바퀴)은 유지하고 mod 360 만 목표 칸에 맞춘 절대 각도.
 * Framer `rotate` 스냅·역산 불일치를 막기 위해 착지 시 항상 이 값을 쓴다.
 */
export function snapWheelRotateToTargetSlice(
  currentRotateDeg: number,
  targetIndex: number,
  sliceCount: number
): number {
  const norm = wheelRotationNormForSliceIndex(targetIndex, sliceCount);
  const base = Number.isFinite(currentRotateDeg) ? currentRotateDeg : 0;
  const turns = Math.floor(base / 360);
  return turns * 360 + norm;
}

export type WheelPointerClientPoint = { x: number; y: number };

/**
 * 포인터(▼)에 가장 가까운 라벨 칩 — `getBoundingClientRect` (육안·OK 판정 기준).
 */
export function findSliceIndexAtPointerFromWheelDom(
  wheelDiscEl: HTMLElement | null | undefined,
  sliceCount: number,
  pointer?: WheelPointerClientPoint | null
): number {
  if (!wheelDiscEl || typeof window === "undefined" || sliceCount <= 0) return -1;
  const disc = wheelDiscEl.getBoundingClientRect();
  if (disc.width < 2 || disc.height < 2) return -1;
  const px = pointer?.x ?? disc.left + disc.width / 2;
  const py = pointer?.y ?? disc.top;
  let best = -1;
  let bestD2 = Infinity;
  wheelDiscEl.querySelectorAll<HTMLElement>("[data-wheel-slot-label]").forEach((node) => {
    const raw = node.getAttribute("data-wheel-slot-index");
    const idx = raw != null ? Number.parseInt(raw, 10) : -1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= sliceCount) return;
    const r = node.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    const lx = r.left + r.width / 2;
    const ly = r.top + r.height / 2;
    const d2 = (lx - px) ** 2 + (ly - py) ** 2;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = idx;
    }
  });
  return best;
}

function waitWheelAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export type WheelDomRotateControl = {
  get: () => number;
  set: (value: number) => void;
};

function safeWheelRotateGet(rotateCtl: WheelDomRotateControl | null | undefined): number {
  if (!rotateCtl || typeof rotateCtl.get !== "function") return 0;
  const v = rotateCtl.get();
  return Number.isFinite(v) ? v : 0;
}

export type WheelLandRotationResult = {
  landDeg: number;
  formulaIndex: number;
  visualIndex: number;
  /** MotionValue(mod 360) vs DOM matrix — 0.5° 초과면 Framer·CSS desync */
  motionDesyncDeg: number | null;
};

/** Framer `rotate` MotionValue와 디스크 실제 `transform` 행렬 비교 */
export function measureWheelRotationDesync(
  discEl: HTMLElement | null | undefined,
  motionDeg: number
): { motionModDeg: number; visualDeg: number | null; diffDeg: number | null } {
  const motionModDeg = ((motionDeg % 360) + 360) % 360;
  const visualDeg = readElementRotationDeg(discEl);
  if (visualDeg == null) {
    return { motionModDeg, visualDeg: null, diffDeg: null };
  }
  return {
    motionModDeg,
    visualDeg,
    diffDeg: Math.abs(wheelNormalizeDegDelta(motionModDeg - visualDeg)),
  };
}

/**
 * 착지 스냅: MotionValue + 디스크 `transform`/`rotate` CSS를 같은 절대각으로 강제.
 * animate 직후 Framer·matrix desync 방지용.
 */
export function forceWheelRotationSync(
  discEl: HTMLElement | null | undefined,
  rotateCtl: WheelDomRotateControl,
  absoluteDeg: number
): { motionModDeg: number; visualDeg: number | null; diffDeg: number | null } {
  const deg = Number.isFinite(absoluteDeg) ? absoluteDeg : 0;
  const visual = ((deg % 360) + 360) % 360;
  const synced = Math.floor(deg / 360) * 360 + visual;
  rotateCtl.set(synced);
  if (discEl) {
    discEl.style.transformOrigin = "center center";
    discEl.style.transform = `rotate(${visual}deg)`;
    discEl.style.removeProperty("rotate");
    void discEl.offsetHeight;
  }
  return measureWheelRotationDesync(discEl, safeWheelRotateGet(rotateCtl));
}

/** 라벨·색상 DOM 기준 포인터 아래 칸 — motion 각도는 사용하지 않음 */
/** 12시 포인터·디스크 행렬로 로컬 각 → 칸 (라벨 rect 사용 안 함) */
export function findSliceIndexAtPointerByDiscWorldAngle(
  discEl: HTMLElement | null | undefined,
  sliceCount: number,
  pointer?: WheelPointerClientPoint | null,
  borderInsetPx = 8
): number {
  if (!discEl || typeof window === "undefined" || sliceCount <= 0) return -1;
  const domDeg = readElementRotationDeg(discEl);
  if (domDeg == null) return -1;
  const disc = discEl.getBoundingClientRect();
  if (disc.width < 2) return -1;
  const cx = disc.left + disc.width / 2;
  const cy = disc.top + disc.height / 2;
  const pt = pointer ?? wheelDiscTwelveOClockPoint(discEl, borderInsetPx);
  if (!pt) return -1;
  const worldAng = wheelAngleFromCenterClockwise(cx, cy, pt.x, pt.y);
  const localAng = ((worldAng - domDeg) % 360 + 360) % 360;
  return findSliceIndexAtPointerRotationFromLocalAngle(localAng, sliceCount);
}

export function findSliceIndexAtPointerRotationFromLocalAngle(
  localAngleDeg: number,
  sliceCount: number
): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const seg = wheelSliceSegmentDeg(n);
  const theta = ((localAngleDeg % 360) + 360) % 360;
  let idx = Math.round(theta / seg - 0.5);
  if (idx < 0) idx = 0;
  if (idx >= n) idx = n - 1;
  return idx;
}

/**
 * ▼ 끝 기준 포인터 아래 칸 — 칸 중심각+디스크 회전(수식·극좌표 라벨과 동일).
 */
export function measureVisualPointerSliceIndex(
  discEl: HTMLElement | null | undefined,
  sliceCount: number,
  pointer?: WheelPointerClientPoint | null,
  borderInsetPx = 8
): number {
  if (!discEl || typeof window === "undefined" || sliceCount <= 0) return -1;
  const pt = pointer ?? wheelDiscTwelveOClockPoint(discEl, borderInsetPx);
  if (!pt) return -1;
  const disc = discEl.getBoundingClientRect();
  if (disc.width < 2) return -1;
  const cx = disc.left + disc.width / 2;
  const cy = disc.top + disc.height / 2;
  const pointerAng = wheelAngleFromCenterClockwise(cx, cy, pt.x, pt.y);
  const domDeg = readElementRotationDeg(discEl) ?? 0;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < sliceCount; i++) {
    const worldAng =
      ((wheelSliceCenterDeg(i, sliceCount) + domDeg) % 360 + 360) % 360;
    const dist = wheelAngularDistanceDeg(pointerAng, worldAng);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** motion/DOM 행렬 역산 칸(수식). 육안 OK 판정과 분리 */
export function measureFormulaPointerSliceIndex(
  rotationDeg: number | null | undefined,
  sliceCount: number
): number {
  if (rotationDeg == null || !Number.isFinite(rotationDeg) || sliceCount <= 0) return -1;
  return findSliceIndexAtPointerRotation(rotationDeg, sliceCount);
}

/** @deprecated `forceWheelRotationSync` 사용 */
export function applyWheelRotationSync(
  discEl: HTMLElement | null | undefined,
  rotateCtl: WheelDomRotateControl,
  absoluteDeg: number
): void {
  forceWheelRotationSync(discEl, rotateCtl, absoluteDeg);
}

/** 디스크 bbox 상단(회전 시 12시 림과 어긋날 수 있음) */
export function wheelDiscTwelveOClockPoint(
  discEl: HTMLElement | null | undefined,
  borderInsetPx = 8
): WheelPointerClientPoint | null {
  if (!discEl) return null;
  const dr = discEl.getBoundingClientRect();
  if (dr.width < 2) return null;
  const inset = Math.max(0, borderInsetPx);
  return {
    x: dr.left + dr.width / 2,
    y: dr.top + inset,
  };
}

/**
 * 현재 `rotate` 상태에서 화면 12시(최상단)에 오는 림 위 한 점.
 * 포인터·육안·착지 보정은 이 점 기준(칸 중심이 여기로 오도록 R을 맞춤).
 */
export function wheelDiscRimTwelveOClockClientPoint(
  discEl: HTMLElement | null | undefined,
  borderInsetPx = 8
): WheelPointerClientPoint | null {
  if (!discEl || typeof window === "undefined") return null;
  const dr = discEl.getBoundingClientRect();
  if (dr.width < 2 || dr.height < 2) return null;
  const cx = dr.left + dr.width / 2;
  const cy = dr.top + dr.height / 2;
  const inset = Math.max(0, borderInsetPx);
  const radius = Math.max(4, Math.min(dr.width, dr.height) / 2 - inset);
  const domDeg = readElementRotationDeg(discEl);
  const rot = domDeg != null ? domDeg : 0;
  const localAtTop = ((-rot % 360) + 360) % 360;
  const rad = (localAtTop * Math.PI) / 180;
  return {
    x: cx + radius * Math.sin(rad),
    y: cy - radius * Math.cos(rad),
  };
}

/** ▼ 삼각형 끝(육안·착지 판정 기준) */
export function wheelPointerTriangleTipPoint(
  pointerEl: HTMLElement | null | undefined
): WheelPointerClientPoint | null {
  const pr = pointerEl?.getBoundingClientRect();
  if (!pr || pr.width < 1) return null;
  return { x: pr.left + pr.width / 2, y: pr.bottom };
}

/**
 * 포인터·착지 판별 — ▼ 끝 우선(화면과 동일), 없으면 림 12시.
 */
export function wheelPointerClientPointFromElements(
  pointerEl: HTMLElement | null | undefined,
  discEl?: HTMLElement | null | undefined,
  borderInsetPx = 8
): WheelPointerClientPoint | null {
  const tip = wheelPointerTriangleTipPoint(pointerEl);
  if (tip) return tip;
  const rim = wheelDiscRimTwelveOClockClientPoint(discEl, borderInsetPx);
  if (rim) return rim;
  return wheelDiscTwelveOClockPoint(discEl, borderInsetPx);
}

/** DOM `transform` 행렬 각도로 포인터 아래 칸 */
export function findSliceIndexAtPointerFromDomRotation(
  discEl: HTMLElement | null | undefined,
  sliceCount: number
): number {
  const domDeg = readElementRotationDeg(discEl);
  if (domDeg == null || sliceCount <= 0) return -1;
  return findSliceIndexAtPointerRotation(domDeg, sliceCount);
}

/** 림 앵커(칸 중심 반경) 기준 12시 포인터 아래 칸 — 라벨 칩 rect 보다 정확 */
export function findSliceIndexAtPointerFromSliceAnchors(
  discEl: HTMLElement | null | undefined,
  sliceCount: number,
  pointer?: WheelPointerClientPoint | null,
  borderInsetPx = 8
): number {
  if (!discEl || typeof window === "undefined" || sliceCount <= 0) return -1;
  const disc = discEl.getBoundingClientRect();
  if (disc.width < 2) return -1;
  const cx = disc.left + disc.width / 2;
  const cy = disc.top + disc.height / 2;
  const pt = pointer ?? wheelDiscTwelveOClockPoint(discEl, borderInsetPx);
  if (!pt) return -1;
  const pointerAng = wheelAngleFromCenterClockwise(cx, cy, pt.x, pt.y);
  let best = -1;
  let bestDist = Infinity;
  discEl.querySelectorAll<HTMLElement>("[data-wheel-slice-anchor]").forEach((node) => {
    const raw = node.getAttribute("data-wheel-slot-index");
    const idx = raw != null ? Number.parseInt(raw, 10) : -1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= sliceCount) return;
    const rim = node.querySelector<HTMLElement>("[data-wheel-slice-rim], span[aria-hidden]");
    const target = rim ?? node;
    const r = target.getBoundingClientRect();
    const lx = r.left + r.width / 2;
    const ly = r.top + r.height / 2;
    if (!Number.isFinite(lx) || !Number.isFinite(ly)) return;
    const anchorAng = wheelAngleFromCenterClockwise(cx, cy, lx, ly);
    const dist = wheelAngularDistanceDeg(pointerAng, anchorAng);
    if (dist < bestDist) {
      bestDist = dist;
      best = idx;
    }
  });
  if (best >= 0) return best;

  const domDeg = readElementRotationDeg(discEl);
  if (domDeg == null) return -1;
  let theoryBest = -1;
  let theoryDist = Infinity;
  for (let i = 0; i < sliceCount; i++) {
    const worldAng =
      ((wheelSliceCenterDeg(i, sliceCount) + domDeg) % 360 + 360) % 360;
    const dist = wheelAngularDistanceDeg(pointerAng, worldAng);
    if (dist < theoryDist) {
      theoryDist = dist;
      theoryBest = i;
    }
  }
  return theoryBest;
}

/** 12시 기준 각도로 가장 가까운 라벨 칸(칩 너비·rect 거리보다 안정) */
export function findSliceIndexAtPointerAngular(
  discEl: HTMLElement | null | undefined,
  sliceCount: number,
  pointer?: WheelPointerClientPoint | null,
  borderInsetPx = 8
): number {
  if (!discEl || typeof window === "undefined" || sliceCount <= 0) return -1;
  const disc = discEl.getBoundingClientRect();
  if (disc.width < 2) return -1;
  const cx = disc.left + disc.width / 2;
  const cy = disc.top + disc.height / 2;
  const pt = pointer ?? wheelDiscTwelveOClockPoint(discEl, borderInsetPx);
  if (!pt) return -1;
  const pointerAng = wheelAngleFromCenterClockwise(cx, cy, pt.x, pt.y);
  let best = -1;
  let bestDist = Infinity;
  discEl.querySelectorAll<HTMLElement>("[data-wheel-slot-label]").forEach((node) => {
    const raw = node.getAttribute("data-wheel-slot-index");
    const idx = raw != null ? Number.parseInt(raw, 10) : -1;
    if (!Number.isFinite(idx) || idx < 0 || idx >= sliceCount) return;
    const r = node.getBoundingClientRect();
    if (r.width < 1 && r.height < 1) return;
    const labelAng = wheelAngleFromCenterClockwise(
      cx,
      cy,
      r.left + r.width / 2,
      r.top + r.height / 2
    );
    const dist = wheelAngularDistanceDeg(pointerAng, labelAng);
    if (dist < bestDist) {
      bestDist = dist;
      best = idx;
    }
  });
  return best;
}

/** DOM 육안 → 행렬 → motion 순. motion·target 폴백으로 거짓 OK 금지 */
export function resolvePointerSliceIndex(
  discEl: HTMLElement | null | undefined,
  rotateCtl: WheelDomRotateControl,
  sliceCount: number,
  pointer: WheelPointerClientPoint | null | undefined,
  fallbackIndex: number,
  borderInsetPx = 8
): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const visual = measureVisualPointerSliceIndex(discEl, n, pointer, borderInsetPx);
  if (visual >= 0) return visual;
  if (typeof window === "undefined") {
    const fromMotion = findSliceIndexAtPointerRotation(safeWheelRotateGet(rotateCtl), n);
    return fromMotion >= 0 ? fromMotion : -1;
  }
  return -1;
}

/** 개발용: 디스크·포인터 중심 오프셋 로그 */
export function logWheelGeometryCheck(
  discEl: HTMLElement | null | undefined,
  pointerEl: HTMLElement | null | undefined,
  sliceCount = 0
): void {
  if (typeof window === "undefined" || process.env.NODE_ENV !== "development") return;
  const dr = discEl?.getBoundingClientRect();
  const pr = pointerEl?.getBoundingClientRect();
  if (!dr || !pr) return;
  const discCx = dr.left + dr.width / 2;
  const discCy = dr.top + dr.height / 2;
  const px = pr.left + pr.width / 2;
  const py = pr.bottom;
  const n = Math.max(0, Math.floor(sliceCount));
  const pointerPt = wheelPointerTriangleTipPoint(pointerEl);
  const domDeg = readElementRotationDeg(discEl);
  const displayDeg = domDeg != null ? ((domDeg % 360) + 360) % 360 : null;
  const pointerIdx =
    n > 0 && pointerPt
      ? measureVisualPointerSliceIndex(discEl, n, pointerPt)
      : -1;
  const pointerWheelLabel =
    n > 0 && pointerIdx >= 0
      ? discEl?.querySelector<HTMLElement>(
          `[data-wheel-slot-label][data-wheel-slot-index="${pointerIdx}"]`
        )?.textContent?.trim() ?? `#${pointerIdx + 1}`
      : null;
  console.info("[wheel] geometry", {
    discCenter: { x: discCx.toFixed(1), y: discCy.toFixed(1) },
    pointerTip: { x: px.toFixed(1), y: py.toFixed(1) },
    pointerDeg: displayDeg,
    displayDeg,
    pointerIdx,
    pointerWheelLabel,
    pointerDx: (px - discCx).toFixed(1),
    pointerAboveCenterPx: (discCy - py).toFixed(1),
    discTop: dr.top.toFixed(1),
  });
}

/**
 * 착지 직후 각도만 **미리 정해진 칸(`targetIndex`)** 에 맞춤.
 * DOM·수식 측정은 판별용이며, 최종 각도·반환 인덱스는 항상 `targetIndex`(서버 확정 시그 칸)이다.
 */
export async function correctWheelLandToTargetSlice(
  discEl: HTMLElement | null | undefined,
  rotateCtl: WheelDomRotateControl,
  targetIndex: number,
  sliceCount: number,
  pointer?: WheelPointerClientPoint | null,
  borderInsetPx = 8
): Promise<{ landDeg: number; visualIndex: number; corrected: boolean }> {
  const n = Math.max(1, Math.floor(sliceCount));
  const target = Math.max(0, Math.min(n - 1, Math.floor(targetIndex)));

  const measureVisual = () =>
    measureVisualPointerSliceIndex(discEl, n, pointer, borderInsetPx);

  const expectedNorm = wheelRotationNormForSliceIndex(target, n);

  let visual = measureVisual();
  let corrected = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const domDeg = readElementRotationDeg(discEl);
    const domMod = domDeg != null ? ((domDeg % 360) + 360) % 360 : null;
    const formulaIdx =
      domMod != null ? findSliceIndexAtPointerRotation(domMod, n) : -1;
    const needsAngleSnap =
      domMod != null &&
      Math.abs(wheelNormalizeDegDelta(domMod - expectedNorm)) > 0.75;
    const needsIndexFix =
      (visual >= 0 && visual !== target) ||
      (formulaIdx >= 0 && formulaIdx !== target);
    if (!needsAngleSnap && !needsIndexFix) break;

    const cur = safeWheelRotateGet(rotateCtl);
    const curMod = ((cur % 360) + 360) % 360;
    let fixedMod = expectedNorm;
    if (needsIndexFix) {
      const fromIdx = visual >= 0 ? visual : formulaIdx;
      if (fromIdx >= 0) {
        fixedMod =
          (((curMod + wheelRotationCorrectionDeg(fromIdx, target, n)) % 360) + 360) % 360;
      }
    }
    const fixed = Math.floor(cur / 360) * 360 + fixedMod;
    forceWheelRotationSync(discEl, rotateCtl, fixed);
    corrected = true;
    await waitWheelAnimationFrame();
    await waitWheelAnimationFrame();
    visual = measureVisual();
  }
  const finalVisual = measureVisual();
  if (finalVisual !== target) {
    const forced = Math.floor(safeWheelRotateGet(rotateCtl) / 360) * 360 + expectedNorm;
    forceWheelRotationSync(discEl, rotateCtl, forced);
    corrected = true;
  }
  const landDeg =
    readElementRotationDeg(discEl) ?? expectedNorm;
  return {
    landDeg,
    visualIndex: target,
    corrected,
  };
}

/** 확정 칸 index → 착지 후 측정만(재스냅 없음 — `RouletteWheel` 착지 1회와 충돌 방지) */
export async function finalizeWheelLandRotation(
  discEl: HTMLElement | null | undefined,
  rotateCtl: WheelDomRotateControl,
  targetIndex: number,
  sliceCount: number,
  pointer?: WheelPointerClientPoint | null
): Promise<WheelLandRotationResult> {
  const n = Math.max(1, Math.floor(sliceCount));
  const target = Math.max(0, Math.min(n - 1, Math.floor(targetIndex)));

  const rimPt =
    pointer ??
    wheelDiscRimTwelveOClockClientPoint(discEl) ??
    wheelDiscTwelveOClockPoint(discEl) ??
    null;

  await waitWheelAnimationFrame();

  const visualIndex = measureVisualPointerSliceIndex(discEl, n, rimPt);
  const landDeg =
    readElementRotationDeg(discEl) ?? ((safeWheelRotateGet(rotateCtl) % 360) + 360) % 360;
  const finalSync = measureWheelRotationDesync(discEl, safeWheelRotateGet(rotateCtl));
  return {
    landDeg,
    formulaIndex: findSliceIndexAtPointerRotation(landDeg, n),
    visualIndex: visualIndex >= 0 ? visualIndex : target,
    motionDesyncDeg: finalSync.diffDeg,
  };
}

/** motion·DOM 행렬·육안 라벨 desync 허용 오차(도) */
export const WHEEL_RENDER_DESYNC_TOLERANCE_DEG = 0.5;

export type WheelRenderSyncReport = {
  sliceIndex: number;
  sliceLabel: string;
  expectedNormDeg: number;
  motionModDeg: number;
  domMatrixDeg: number | null;
  /** MotionValue(mod 360) vs DOM matrix */
  motionDomDesyncDeg: number | null;
  /** motion vs 목표 착지각 */
  motionVsExpectedDeg: number;
  /** DOM vs 목표 착지각 */
  domVsExpectedDeg: number | null;
  formulaIndexFromMotion: number;
  formulaIndexFromDom: number;
  visualPointerIndex: number;
  /** motion ≈ DOM (화면이 motion 각도대로 그려졌는가) */
  renderSyncOk: boolean;
  /** DOM 라벨 기준 포인터 아래 칸 = 목표 칸 */
  visualAlignOk: boolean;
  /** 수식 역산(DOM) = 목표 칸 */
  formulaDomAlignOk: boolean;
  ok: boolean;
  failReason: string | null;
};

export function evaluateWheelRenderSyncMetrics(opts: {
  sliceIndex: number;
  sliceCount: number;
  motionModDeg: number;
  domMatrixDeg: number | null;
  visualPointerIndex: number;
  desyncToleranceDeg?: number;
}): Omit<WheelRenderSyncReport, "sliceLabel"> {
  const n = Math.max(1, Math.floor(opts.sliceCount));
  const idx = Math.max(0, Math.min(n - 1, Math.floor(opts.sliceIndex)));
  const tol = opts.desyncToleranceDeg ?? WHEEL_RENDER_DESYNC_TOLERANCE_DEG;
  const expectedNormDeg = wheelRotationNormForSliceIndex(idx, n);
  const motionModDeg = ((opts.motionModDeg % 360) + 360) % 360;
  const domMatrixDeg =
    opts.domMatrixDeg != null && Number.isFinite(opts.domMatrixDeg)
      ? ((opts.domMatrixDeg % 360) + 360) % 360
      : null;
  const motionDomDesyncDeg =
    domMatrixDeg != null
      ? Math.abs(wheelNormalizeDegDelta(motionModDeg - domMatrixDeg))
      : null;
  const motionVsExpectedDeg = Math.abs(wheelNormalizeDegDelta(motionModDeg - expectedNormDeg));
  const domVsExpectedDeg =
    domMatrixDeg != null
      ? Math.abs(wheelNormalizeDegDelta(domMatrixDeg - expectedNormDeg))
      : null;
  const formulaIndexFromMotion = findSliceIndexAtPointerRotation(motionModDeg, n);
  const formulaIndexFromDom =
    domMatrixDeg != null ? findSliceIndexAtPointerRotation(domMatrixDeg, n) : -1;
  const visualPointerIndex =
    opts.visualPointerIndex >= 0 ? Math.floor(opts.visualPointerIndex) : -1;
  const renderSyncOk =
    motionDomDesyncDeg != null && motionDomDesyncDeg <= tol;
  const visualAlignOk = visualPointerIndex === idx;
  const formulaDomAlignOk = formulaIndexFromDom === idx;
  const ok = renderSyncOk && visualAlignOk && formulaDomAlignOk;
  const failReason = ok
    ? null
    : motionDomDesyncDeg == null
      ? "DOM 회전각 읽기 실패"
      : !renderSyncOk
        ? `motion·DOM desync ${motionDomDesyncDeg.toFixed(2)}°`
        : !visualAlignOk
          ? `육안 칸 #${visualPointerIndex + 1} ≠ 목표 #${idx + 1}`
          : !formulaDomAlignOk
            ? `DOM 역산 #${formulaIndexFromDom + 1} ≠ 목표 #${idx + 1}`
            : "기타";
  return {
    sliceIndex: idx,
    expectedNormDeg,
    motionModDeg,
    domMatrixDeg,
    motionDomDesyncDeg,
    motionVsExpectedDeg,
    domVsExpectedDeg,
    formulaIndexFromMotion,
    formulaIndexFromDom,
    visualPointerIndex,
    renderSyncOk,
    visualAlignOk,
    formulaDomAlignOk,
    ok,
    failReason,
  };
}

/** 브라우저에서 motion·DOM·육안이 목표 칸 각도와 일치하는지 측정 */
export function buildWheelRenderSyncReport(
  discEl: HTMLElement | null | undefined,
  rotateCtl: WheelDomRotateControl,
  sliceIndex: number,
  sliceCount: number,
  pointer?: WheelPointerClientPoint | null,
  borderInsetPx = 8,
  sliceLabel = ""
): WheelRenderSyncReport {
  const n = Math.max(1, Math.floor(sliceCount));
  const motionModDeg = ((safeWheelRotateGet(rotateCtl) % 360) + 360) % 360;
  const domMatrixDeg = readElementRotationDeg(discEl);
  const visualPointerIndex = measureVisualPointerSliceIndex(
    discEl,
    n,
    pointer,
    borderInsetPx
  );
  return {
    sliceLabel,
    ...evaluateWheelRenderSyncMetrics({
      sliceIndex,
      sliceCount: n,
      motionModDeg,
      domMatrixDeg,
      visualPointerIndex,
    }),
  };
}

/** DOM `transform`/`rotate` 에서 시계 방향 회전각(도) — Framer `style.rotate` 포함 */
export function readElementRotationDeg(el: HTMLElement | null | undefined): number | null {
  if (!el || typeof window === "undefined") return null;
  const cs = window.getComputedStyle(el);
  const tr = cs.transform;
  if (tr && tr !== "none") {
    try {
      const m = new DOMMatrix(tr);
      const deg = (Math.atan2(m.b, m.a) * 180) / Math.PI;
      return ((deg % 360) + 360) % 360;
    } catch {
      /* fall through */
    }
  }
  const rotateRaw = cs.rotate;
  if (rotateRaw && rotateRaw !== "none") {
    const num = Number.parseFloat(String(rotateRaw).replace(/deg$/i, "").trim());
    if (Number.isFinite(num)) return ((num % 360) + 360) % 360;
  }
  return null;
}

/**
 * 휠 최종 회전각(도) 기준 포인터(12시) 아래 칸 인덱스.
 * `calculateSpinFinalAngle` 과 역함수 관계.
 */
export function findSliceIndexAtPointerRotation(
  rotationDeg: number,
  sliceCount: number
): number {
  const n = Math.max(1, Math.floor(sliceCount));
  const theta = wheelAngleUnderPointer(rotationDeg, n);
  return findSliceIndexAtPointerRotationFromLocalAngle(theta, n);
}

/** 포인터 아래 slice id — 육안 착지·정합 리포트용 */
export function resolveWheelSliceIdAtPointer(
  items: SigItem[],
  rotationDeg: number
): string | null {
  if (!items.length) return null;
  const idx = findSliceIndexAtPointerRotation(rotationDeg, items.length);
  return items[idx]?.id ?? null;
}

/** 목표 slice id 가 12시 포인터에 오도록 하는 `rotate` 각도(mod 360) — `onLanded` 각도 누락 시 폴백 */
export function wheelRotationNormForTargetSlice(
  wheelItems: SigItem[],
  targetSliceId: string | null
): number | null {
  if (!targetSliceId || !wheelItems.length) return null;
  const idx = findSliceIndexForResult(wheelItems, targetSliceId);
  if (idx < 0) return null;
  return wheelRotationNormForSliceIndex(idx, wheelItems.length);
}

/**
 * 시네마틱 휠 감속 구간 최종 회전 각도(도). `RouletteWheel`과 동일한 수식.
 */
export function calculateSpinFinalAngle(
  items: SigItem[],
  targetId: string | null,
  count: number,
  currentBase: number,
  minTurns: number
): number {
  if (!targetId || !items.length) return currentBase + Math.max(1, minTurns) * 360;
  const idx = findSliceIndexForResult(items, targetId);
  if (idx < 0) return currentBase + Math.max(1, minTurns) * 360;
  const n = Math.max(1, items.length);
  const sliceCount = n;
  void count;
  const normalizedTarget = wheelRotationNormForSliceIndex(idx, sliceCount);
  const currentNorm = ((currentBase % 360) + 360) % 360;
  const deltaToTarget = ((normalizedTarget - currentNorm) % 360 + 360) % 360;
  return currentBase + minTurns * 360 + deltaToTarget;
}

/**
 * 방송 오버레이·휠은 재고 `sigInventory` 기준 이름/이미지를 쓰고, 당첨 배열은 API 스냅샷이라 불일치할 수 있음.
 * 동일 시그 id로 인벤 행을 합쳐 표시를 맞춘다(당첨 금액은 요청 항목 우선).
 */
export function hydrateSigItemFromInventory(
  item: SigItem,
  inventory: SigItem[] | undefined,
  userId?: string
): SigItem {
  const canon = canonicalSigIdFromWheelSliceId(item.id);
  if (!inventory?.length) {
    const imageUrl = repairDiskUploadSigImagePath(String(item.imageUrl || ""), userId);
    return { ...item, id: canon, imageUrl: imageUrl || item.imageUrl };
  }
  const fromInv =
    inventory.find((x) => x.id === canon) ||
    inventory.find((x) => x.id === item.id);
  if (!fromInv) {
    const imageUrl = repairDiskUploadSigImagePath(String(item.imageUrl || ""), userId);
    return { ...item, id: canon, imageUrl: imageUrl || item.imageUrl };
  }
  const price = Math.max(0, Math.floor(Number(item.price ?? fromInv.price ?? 0)));
  const rawImage = String(fromInv.imageUrl || item.imageUrl || "").trim();
  const imageUrl = repairDiskUploadSigImagePath(rawImage, userId) || rawImage;
  return {
    ...fromInv,
    id: canon,
    price,
    imageUrl,
  };
}
export const SPIN_SOUND_PATHS = {
  tick: "/sounds/spin-tick.wav",
  final: "/sounds/spin-final.wav",
  success: "/sounds/success.wav",
  oneShot: "/sounds/oneshot.wav",
} as const;
export const SOUND_ASSETS_ENABLED = true;
/** false: 회전판은 wav 대신 Web Audio 절차음만 사용(더 절제된 톤). 오버레이 한방 등 다른 경로는 `SOUND_ASSETS_ENABLED` 유지 */
export const ROULETTE_WHEEL_WAV_ASSETS_ENABLED = false;
/** false: 회전 틱·착지·한방 착지 효과음 전부 끔(추후 다시 켤 때 true) */
export const ROULETTE_WHEEL_SFX_ENABLED = false;

export function normalizeSigPickNameKey(name: string): string {
  return sanitizeWheelDisplayName(name).toLowerCase();
}

export function pickDistinctSigs(pool: SigItem[], count: number): SigItem[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = t;
  }
  return copy.slice(0, Math.max(0, Math.min(count, copy.length)));
}

/** id·표시명(동일 이름 중복 행) 모두 한 세션에서 한 번만 당첨 */
export function pickDistinctSigsByIdAndName(pool: SigItem[], count: number): SigItem[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const u = new Uint32Array(1);
    crypto.getRandomValues(u);
    const j = u[0]! % (i + 1);
    const t = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = t;
  }
  const out: SigItem[] = [];
  const usedIds = new Set<string>();
  const usedNames = new Set<string>();
  for (const item of copy) {
    if (out.length >= count) break;
    const id = canonicalSigIdFromWheelSliceId(item.id);
    if (!id || usedIds.has(id)) continue;
    const nameKey = normalizeSigPickNameKey(item.name);
    if (nameKey && usedNames.has(nameKey)) continue;
    usedIds.add(id);
    if (nameKey) usedNames.add(nameKey);
    out.push(item);
  }
  return out;
}

export function mergeSessionExcludedSigIds(
  existing: string[] | undefined,
  winners: SigItem[]
): string[] {
  const next = new Set((existing || []).map((x) => String(x).trim()).filter(Boolean));
  for (const sig of winners) {
    const canon = canonicalSigIdFromWheelSliceId(sig.id);
    if (canon) next.add(canon);
  }
  return Array.from(next);
}

export function calcOneShotPriceFromSelected(selected: SigItem[]): number {
  return selected.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.price || 0))), 0);
}

export function clampOverlayOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 0.85;
  return Math.max(0.4, Math.min(1, opacity));
}

export function formatWon(value: number): string {
  const safe = Math.max(0, Math.floor(value || 0));
  return `${safe.toLocaleString("ko-KR")}원`;
}

export type RouletteSessionLog = {
  id: string;
  sessionId: string;
  /** LANDED: 방송 착지(결과 확정), CONFIRMED: 판매 확정, CANCELLED: 취소 */
  phase: "LANDED" | "CONFIRMED" | "CANCELLED";
  selectedSigs: SigItem[];
  selectedSigIds: string[];
  oneShotPrice: number;
  totalPrice: number;
  timestamp: number;
  adminId?: string;
  reason?: string;
};

/** AppState.rouletteState.historyLogs — GIF URL 제외·최소 필드만(Upstash/메모리 JSON 한도) */
export function slimRouletteHistoryLogsForState(logs: RouletteSessionLog[]): RouletteSessionLog[] {
  return logs.slice(0, 50).map((log) => ({
    id: log.id,
    sessionId: log.sessionId,
    phase: log.phase,
    selectedSigIds: [...(log.selectedSigIds || [])],
    selectedSigs: (log.selectedSigIds || []).map((id) => ({
      id,
      name: log.selectedSigs.find((s) => s.id === id)?.name?.slice(0, 80) || "",
      price: Math.max(0, Math.floor(Number(log.selectedSigs.find((s) => s.id === id)?.price || 0))),
      imageUrl: "",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: false,
      isActive: true,
    })),
    oneShotPrice: log.oneShotPrice,
    totalPrice: log.totalPrice,
    timestamp: log.timestamp,
    adminId: log.adminId,
    reason: log.reason,
  }));
}

const LOG_KEY_PREFIX = "excel-broadcast-roulette-log-v1";

function getLogKey(userId: string) {
  return `${LOG_KEY_PREFIX}:${userId}`;
}

function getEnv() {
  const base = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  return { base, token };
}

async function upstashGetJson<T>(key: string): Promise<T | null> {
  const { base, token } = getEnv();
  if (!base || !token) return null;
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: string | null };
  if (!data?.result) return null;
  try {
    return JSON.parse(data.result) as T;
  } catch {
    return null;
  }
}

async function upstashSetJson(key: string, value: unknown): Promise<boolean> {
  const { base, token } = getEnv();
  if (!base || !token) return false;
  let payload: string;
  try {
    payload = JSON.stringify(value);
  } catch {
    return false;
  }
  const url = `${base.replace(/\/$/, "")}/pipeline`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify([["SET", key, payload]]),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listRouletteLogs(userId: string): Promise<RouletteSessionLog[]> {
  const key = getLogKey(userId);
  const remote = await upstashGetJson<RouletteSessionLog[]>(key);
  if (Array.isArray(remote)) return remote;
  return getServerMemoryRouletteLogs(key);
}

export async function getRouletteHistory(userId: string, limit = 20, sessionId?: string): Promise<RouletteSessionLog[]> {
  const logs = await listRouletteLogs(userId);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
  const filtered = sessionId ? logs.filter((x) => x.sessionId === sessionId) : logs;
  return filtered.slice(0, safeLimit);
}

export async function saveRouletteLog(params: {
  userId: string;
  sessionId: string;
  phase: "LANDED" | "CONFIRMED" | "CANCELLED";
  selectedSigs: SigItem[];
  oneShotPrice: number;
  adminId?: string;
  reason?: string;
}): Promise<{ ok: true; logId: string; duplicate: boolean; logs: RouletteSessionLog[] }> {
  const key = getLogKey(params.userId);
  const existing = await listRouletteLogs(params.userId);
  const duplicate = existing.some((x) => x.sessionId === params.sessionId);
  if (duplicate) {
    const prev = existing.find((x) => x.sessionId === params.sessionId)!;
    const totalPrice = params.selectedSigs.reduce(
      (sum, s) => sum + Math.max(0, Math.floor(Number(s.price || 0))),
      0,
    );
    const nextLog: RouletteSessionLog = {
      ...prev,
      phase: params.phase,
      selectedSigs: params.selectedSigs.map((x) => ({ ...x })),
      selectedSigIds: params.selectedSigs.map((x) => x.id),
      oneShotPrice: Math.max(0, Math.floor(params.oneShotPrice || 0)),
      totalPrice,
      timestamp: Date.now(),
      adminId: params.adminId ?? prev.adminId,
      reason: params.reason !== undefined ? params.reason : prev.reason,
    };
    const unchanged =
      prev.phase === nextLog.phase &&
      prev.oneShotPrice === nextLog.oneShotPrice &&
      prev.totalPrice === nextLog.totalPrice &&
      prev.selectedSigIds.join(",") === nextLog.selectedSigIds.join(",");
    if (unchanged) {
      return { ok: true, logId: prev.id, duplicate: true, logs: existing };
    }
    const replaced = existing.map((x) => (x.sessionId === params.sessionId ? nextLog : x));
    const savedRemote = await upstashSetJson(key, replaced);
    if (!savedRemote) setServerMemoryRouletteLogs(key, replaced);
    return { ok: true, logId: prev.id, duplicate: false, logs: replaced };
  }
  const totalPrice = params.selectedSigs.reduce((sum, s) => sum + Math.max(0, Math.floor(Number(s.price || 0))), 0);
  const log: RouletteSessionLog = {
    id: `rlog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: params.sessionId,
    phase: params.phase,
    selectedSigs: params.selectedSigs.map((x) => ({ ...x })),
    selectedSigIds: params.selectedSigs.map((x) => x.id),
    oneShotPrice: Math.max(0, Math.floor(params.oneShotPrice || 0)),
    totalPrice,
    timestamp: Date.now(),
    adminId: params.adminId,
    reason: params.reason,
  };
  const next = [log, ...existing].slice(0, 50);
  const savedRemote = await upstashSetJson(key, next);
  if (!savedRemote) setServerMemoryRouletteLogs(key, next);
  return { ok: true, logId: log.id, duplicate: false, logs: next };
}

export async function cancelRouletteSession(params: {
  userId: string;
  sessionId: string;
  selectedSigs: SigItem[];
  oneShotPrice: number;
  adminId?: string;
  reason?: string;
}) {
  return saveRouletteLog({
    userId: params.userId,
    sessionId: params.sessionId,
    phase: "CANCELLED",
    selectedSigs: params.selectedSigs,
    oneShotPrice: params.oneShotPrice,
    adminId: params.adminId,
    reason: params.reason || "operator_cancelled",
  });
}
