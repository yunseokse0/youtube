export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { normalizeSigInventory } from "@/lib/constants";
import type { SigItem } from "@/types";
import {
  buildSessionSpinExclusion,
  canonicalSigIdFromWheelSliceId,
  dedupeSigQueueByIdAndName,
  isSigQueueDistinctByIdAndName,
  normalizeSigPickNameKey,
  pickDistinctSigsByIdAndName,
  sigEligibleForSessionSpinPool,
  sigMatchesMemberFilter,
} from "@/lib/sig-roulette";
import { getRouletteUserId, saveAppStateForRoulette } from "../edge-state-store";
import { setRouletteLock } from "../roulette-lock";
import {
  loadAppStateForRouletteRequest,
  publishRouletteStateAfterSave,
} from "../roulette-state-sync";
const ONE_SHOT_SIG_ID = "sig_one_shot";

function buildFallbackPool(size = 10): SigItem[] {
  return Array.from({ length: Math.max(1, size) }).map((_, i) => {
    const idx = i + 1;
    return {
      id: `fallback_sig_${idx}`,
      name: `예비 시그 ${idx}`,
      price: idx * 10000,
      imageUrl: "",
      memberId: "",
      maxCount: 9999,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    } as SigItem;
  });
}

function pickRandom<T>(arr: T[]): T {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return arr[u[0]! % arr.length]!;
}

function filterPoolByTierAndRange(
  list: SigItem[],
  tier: number | null,
  range: { min: number | null; max: number | null } | null
): SigItem[] {
  let base = tier == null ? list : list.filter((x) => Math.floor(Number(x.price || 0)) === tier);
  if (range == null) return base;
  return base.filter((x) => {
    const price = Math.floor(Number(x.price || 0));
    if (!Number.isFinite(price) || price <= 0) return false;
    if (range.min != null && price < range.min) return false;
    if (range.max != null && price > range.max) return false;
    return true;
  });
}

/** 서버에서만 랜덤 당첨 → Redis(또는 공유 메모리)에 rouletteState 저장 */
export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let spinCount = 1;
    /** 본문에 spinCount 숫자가 있었는지(통합 관리자 회전 N회 등). 없으면 cinematic5 는 레거시처럼 최대 5·풀 크기만 적용 */
    let spinCountExplicit = false;
    let mode: "default" | "cinematic5" = "default";
    let memberIdFilter: string | null = null;
    let legacyPriceFilter: number | null = null;
    let priceFilters: (number | null)[] | null = null;
    let priceRanges: ({ min: number | null; max: number | null } | null)[] | null = null;
    try {
      const j = (await req.json()) as {
        spinCount?: number;
        mode?: string;
        memberId?: string | null;
        priceFilter?: number | null;
        priceFilters?: (number | null)[];
        priceRanges?: ({ min?: number | null; max?: number | null } | null)[];
      };
      if (j && typeof j.spinCount === "number" && Number.isFinite(j.spinCount)) {
        spinCount = Math.max(1, Math.min(999, Math.floor(j.spinCount)));
        spinCountExplicit = true;
      }
      if (j?.mode === "cinematic5") {
        mode = "cinematic5";
      }
      if (typeof j?.memberId === "string") {
        const v = j.memberId.trim();
        memberIdFilter = v.length > 0 ? v : null;
      }
      if (j && typeof j.priceFilter === "number" && Number.isFinite(j.priceFilter) && j.priceFilter > 0) {
        legacyPriceFilter = Math.max(0, Math.floor(j.priceFilter));
      }
      if (Array.isArray(j?.priceFilters) && j.priceFilters.length > 0) {
        priceFilters = j.priceFilters.map((x) => {
          if (x === null || x === undefined) return null;
          const n = Number(x);
          return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
        });
      }
      if (Array.isArray(j?.priceRanges) && j.priceRanges.length > 0) {
        priceRanges = j.priceRanges.map((x) => {
          if (!x || typeof x !== "object") return null;
          const minNum = Number(x.min);
          const maxNum = Number(x.max);
          const min = Number.isFinite(minNum) && minNum > 0 ? Math.floor(minNum) : null;
          const max = Number.isFinite(maxNum) && maxNum > 0 ? Math.floor(maxNum) : null;
          if (min == null && max == null) return null;
          if (min != null && max != null && min > max) {
            return { min: max, max: min };
          }
          return { min, max };
        });
      }
    } catch {
      /* body 없음 → 1회 */
    }

    const s = await loadAppStateForRouletteRequest(req, userId);
    const excludedSet = new Set(
      Array.isArray((s as AppState).sigSalesExcludedIds)
        ? (s as AppState).sigSalesExcludedIds.map((x) => String(x))
        : []
    );
    const inv = normalizeSigInventory(s.sigInventory).filter((x) => !excludedSet.has(x.id));
    const prevRs = normalizeRouletteState(s.rouletteState);
    const priorWinners = [
      ...(prevRs.selectedSigs || []),
      ...(prevRs.results || []),
      ...(prevRs.result ? [prevRs.result] : []),
    ];
    const sessionExclusion = buildSessionSpinExclusion(
      inv,
      prevRs.sessionExcludedSigIds,
      priorWinners
    );
    const allowPool = (list: SigItem[]) =>
      list.filter((x) => sigEligibleForSessionSpinPool(x, sessionExclusion));
    const invById = new Map(inv.map((row) => [row.id, row]));
    const enrichPick = (pick: SigItem): SigItem => {
      const row = invById.get(pick.id);
      return row ? { ...row, price: Math.max(0, Math.floor(Number(pick.price ?? row.price ?? 0))) } : { ...pick };
    };
    if (mode === "cinematic5") {
      const pool = allowPool(
        inv.filter(
          (x) =>
            x.isActive &&
            x.soldCount < x.maxCount &&
            sigMatchesMemberFilter(x, memberIdFilter)
        )
      );
      // 라이브 운영 중 필터/활성 상태 때문에 후보가 5개 미만이어도
      // 회전판이 멈추지 않도록 단계적으로 풀을 확장한다.
      const broadActivePool = allowPool(
        inv.filter((x) => x.isActive && x.soldCount < x.maxCount)
      );
      const broadAnyPool = allowPool(inv.filter((x) => x.soldCount < x.maxCount));
      const uniqueById = new Map<string, SigItem>();
      for (const item of pool) uniqueById.set(item.id, item);
      if (uniqueById.size < 5) {
        for (const item of broadActivePool) uniqueById.set(item.id, item);
      }
      if (uniqueById.size < 5) {
        for (const item of broadAnyPool) uniqueById.set(item.id, item);
      }
      const candidatePool = Array.from(uniqueById.values());
      if (candidatePool.length < 1) {
        return Response.json({ error: "not_enough_active_sigs" }, { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const expandedPool = candidatePool;
      /** 명시된 회전 수: 최대 40까지(통합 관리자 회전판과 유사). 미지정 시 레거시 최대 5·풀 크기 */
      const CINEMATIC5_MAX_EXPLICIT = 40;
      const CINEMATIC5_MAX_LEGACY = 5;
      const selectedCount = spinCountExplicit
        ? Math.max(1, Math.min(CINEMATIC5_MAX_EXPLICIT, spinCount))
        : Math.max(1, Math.min(CINEMATIC5_MAX_LEGACY, expandedPool.length));
      if (selectedCount > expandedPool.length) {
        return Response.json(
          { error: "not_enough_distinct_sigs", need: selectedCount, have: expandedPool.length },
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      const distinctPicks = pickDistinctSigsByIdAndName(expandedPool, selectedCount);
      if (distinctPicks.length < selectedCount) {
        return Response.json(
          {
            error: "not_enough_distinct_sigs",
            need: selectedCount,
            have: distinctPicks.length,
            sessionExcluded: sessionExclusion.excludedIds.size,
          },
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      const selectedSigs = dedupeSigQueueByIdAndName(
        distinctPicks.map((pick) => ({
          ...enrichPick(pick),
          maxCount: 1,
        }))
      );
      if (selectedSigs.length < selectedCount || !isSigQueueDistinctByIdAndName(selectedSigs)) {
        return Response.json(
          {
            error: "not_enough_distinct_sigs",
            need: selectedCount,
            have: selectedSigs.length,
            sessionExcluded: sessionExclusion.excludedIds.size,
          },
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      const oneShot = selectedSigs.length >= 2
        ? {
            id: ONE_SHOT_SIG_ID,
            name: "한방 시그",
            price: selectedSigs.reduce((sum, x) => sum + Math.max(0, Math.floor(Number(x.price || 0))), 0),
          }
        : null;
      const result = selectedSigs[selectedSigs.length - 1] || null;
      setRouletteLock(userId, 10_000);
      const next: AppState = {
        ...s,
        sigInventory: inv,
        rouletteState: {
          ...prevRs,
          sessionExcludedSigIds: prevRs.sessionExcludedSigIds,
          phase: "SPINNING",
          isRolling: true,
          spinCount: selectedSigs.length,
          result,
          results: selectedSigs,
          selectedSigs,
          oneShotResult: oneShot,
          startedAt: Date.now(),
          sessionId: `session_${Date.now()}`,
        },
        updatedAt: Date.now(),
      };
      await saveAppStateForRoulette(userId, next);
      await publishRouletteStateAfterSave(req, userId, {
        rouletteState: next.rouletteState,
        updatedAt: next.updatedAt,
      });
      return Response.json(
        {
          ok: true,
          mode,
          fallbackExpanded: candidatePool.length !== pool.length,
          startedAt: next.rouletteState.startedAt,
          sessionId: next.rouletteState.sessionId,
          result,
          selectedSigs,
          oneShot,
        },
        { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }
    const runtimePool = allowPool(
      inv.filter((x) => x.isActive && x.soldCount < x.maxCount)
    );
    if (runtimePool.length === 0) {
      return Response.json(
        { error: "empty_inventory" },
        { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
      );
    }
    /** 복원 추첨이므로 후보 1개만 있어도 spinCount 회까지 반복 당첨 가능 → 길이 비교 거절 제거 */

    const plan: (number | null)[] = [];
    const planRanges: ({ min: number | null; max: number | null } | null)[] = [];
    if (priceFilters && priceFilters.length === spinCount) {
      for (let i = 0; i < spinCount; i++) plan.push(priceFilters[i] ?? null);
    } else if (priceFilters && priceFilters.length > 0) {
      for (let i = 0; i < spinCount; i++) plan.push(priceFilters[Math.min(i, priceFilters.length - 1)] ?? null);
    } else {
      for (let i = 0; i < spinCount; i++) plan.push(legacyPriceFilter);
    }
    if (priceRanges && priceRanges.length === spinCount) {
      for (let i = 0; i < spinCount; i++) planRanges.push(priceRanges[i] ?? null);
    } else if (priceRanges && priceRanges.length > 0) {
      for (let i = 0; i < spinCount; i++) planRanges.push(priceRanges[Math.min(i, priceRanges.length - 1)] ?? null);
    } else {
      for (let i = 0; i < spinCount; i++) planRanges.push(null);
    }

    /** 한 세션·회차 내 동일 시그 id 중복 당첨 방지(가격 필터는 회차별, 후보는 회차마다 소진) */
    const results: SigItem[] = [];
    const fallbackUsed = false;
    const pickedIds = new Set<string>();
    const pickedNames = new Set<string>();

    for (let i = 0; i < spinCount; i++) {
      const tier = plan[i] ?? null;
      const range = planRanges[i] ?? null;
      const tierPool = filterPoolByTierAndRange(runtimePool, tier, range).filter((x) => {
        const canon = canonicalSigIdFromWheelSliceId(x.id) || x.id;
        if (pickedIds.has(canon)) return false;
        const nameKey = normalizeSigPickNameKey(x.name);
        if (nameKey && pickedNames.has(nameKey)) return false;
        return true;
      });
      if (tierPool.length === 0) {
        return Response.json(
          {
            error: results.length > 0 ? "not_enough_distinct_sigs" : "empty_price_range",
            round: i + 1,
            sessionExcluded: sessionExclusion.excludedIds.size,
          },
          { status: 400, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
        );
      }
      const picked = pickRandom(tierPool);
      pickedIds.add(canonicalSigIdFromWheelSliceId(picked.id) || picked.id);
      const nameKey = normalizeSigPickNameKey(picked.name);
      if (nameKey) pickedNames.add(nameKey);
      results.push(enrichPick(picked));
    }

    const last = results[results.length - 1]!;
    const selectedSigs = results.map((x) => ({ ...x }));
    const oneShot =
      selectedSigs.length >= 2
        ? {
            id: ONE_SHOT_SIG_ID,
            name: "한방 시그",
            price: selectedSigs.reduce((sum, x) => sum + Math.max(0, Math.floor(Number(x.price || 0))), 0),
          }
        : null;

    // Spin 직후 짧은 시간 동안 rouletteState를 보호하여 다른 저장이 덮어쓰지 못하게 함.
    setRouletteLock(userId, 10_000);
    const next: AppState = {
      ...s,
      sigInventory: inv,
      rouletteState: {
        ...prevRs,
        sessionExcludedSigIds: prevRs.sessionExcludedSigIds,
        phase: "SPINNING",
        isRolling: true,
        result: last,
        results,
        selectedSigs,
        oneShotResult: oneShot,
        spinPriceFilters: plan,
        spinPriceRanges: planRanges,
        spinCount: selectedSigs.length,
        startedAt: Date.now(),
        sessionId: `session_${Date.now()}`,
      },
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, next);
    await publishRouletteStateAfterSave(req, userId, {
      rouletteState: next.rouletteState,
      updatedAt: next.updatedAt,
    });
    return Response.json(
      { ok: true, result: last, results, spinCount, spinPriceFilters: plan, spinPriceRanges: planRanges, fallbackUsed },
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
