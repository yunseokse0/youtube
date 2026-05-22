import type { SigItem } from "@/types";
import { repairDiskUploadSigImagePath } from "@/lib/sig-image-mode";
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
  return {
    items: target.items,
    sliceId: target.sliceId,
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
  const seg = 360 / Math.max(1, count);
  const targetCenter = idx * seg + seg / 2;
  const normalizedTarget = ((360 - targetCenter) % 360 + 360) % 360;
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
  const url = `${base.replace(/\/$/, "")}/pipeline`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([["SET", key, JSON.stringify(value)]]),
  });
  return res.ok;
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
