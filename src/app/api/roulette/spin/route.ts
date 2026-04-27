export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { normalizeSigInventory } from "@/lib/constants";
import type { SigItem } from "@/types";
import { getRouletteUserId, loadAppStateForRoulette, saveAppStateForRoulette } from "../edge-state-store";
import { setRouletteLock } from "../roulette-lock";
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

/** 서버에서만 랜덤 당첨 → Redis(또는 공유 메모리)에 rouletteState 저장 */
export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let spinCount = 1;
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

    let s = await loadAppStateForRoulette(userId);
    // Redis 미설정 시 Edge isolate 간 메모리가 분리될 수 있어 /api/state 최신본을 우선 조회
    try {
      const stateUrl = new URL(req.url);
      stateUrl.pathname = "/api/state";
      stateUrl.search = `?user=${encodeURIComponent(userId)}`;
      const stateRes = await fetch(stateUrl.toString(), { cache: "no-store" });
      if (stateRes.ok) {
        const remote = (await stateRes.json()) as AppState;
        if (remote && Array.isArray(remote.members)) {
          s = remote;
        }
      }
    } catch {}
    const excludedSet = new Set(
      Array.isArray((s as AppState).sigSalesExcludedIds)
        ? (s as AppState).sigSalesExcludedIds.map((x) => String(x))
        : []
    );
    const inv = normalizeSigInventory(s.sigInventory).filter((x) => !excludedSet.has(x.id));
    if (mode === "cinematic5") {
      const pool = inv.filter(
        (x) =>
          x.isActive &&
          x.id !== ONE_SHOT_SIG_ID &&
          x.soldCount < x.maxCount &&
          (!memberIdFilter || (x.memberId || "") === memberIdFilter)
      );
      // 라이브 운영 중 필터/활성 상태 때문에 후보가 5개 미만이어도
      // 회전판이 멈추지 않도록 단계적으로 풀을 확장한다.
      const broadActivePool = inv.filter(
        (x) => x.isActive && x.id !== ONE_SHOT_SIG_ID && x.soldCount < x.maxCount
      );
      const broadAnyPool = inv.filter(
        (x) => x.id !== ONE_SHOT_SIG_ID && x.soldCount < x.maxCount
      );
      const uniqueById = new Map<string, SigItem>();
      for (const item of pool) uniqueById.set(item.id, item);
      if (uniqueById.size < 5) {
        for (const item of broadActivePool) uniqueById.set(item.id, item);
      }
      if (uniqueById.size < 5) {
        for (const item of broadAnyPool) uniqueById.set(item.id, item);
      }
      const candidatePool = Array.from(uniqueById.values());
      if (candidatePool.length < 5) {
        return Response.json({ error: "not_enough_active_sigs" }, { status: 400, headers: { "Content-Type": "application/json" } });
      }
      const shuffled = [...candidatePool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const u = new Uint32Array(1);
        crypto.getRandomValues(u);
        const j = u[0]! % (i + 1);
        const t = shuffled[i]!;
        shuffled[i] = shuffled[j]!;
        shuffled[j] = t;
      }
      const selectedSigs = shuffled.slice(0, 5).map((x) => ({ ...x, maxCount: 1 }));
      const oneShot = {
        id: ONE_SHOT_SIG_ID,
        name: "한방 시그",
        price: selectedSigs.reduce((sum, x) => sum + Math.max(0, Math.floor(Number(x.price || 0))), 0),
      };
      const prevRs = normalizeRouletteState(s.rouletteState);
      const result = selectedSigs[selectedSigs.length - 1] || null;
      setRouletteLock(userId, 10_000);
      const next: AppState = {
        ...s,
        sigInventory: inv,
        rouletteState: {
          ...prevRs,
          phase: "SPINNING",
          isRolling: true,
          spinCount: 5,
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
      try {
        const url = new URL(req.url);
        url.pathname = "/api/state";
        url.search = `?user=${encodeURIComponent(userId)}`;
        await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rouletteState: next.rouletteState,
            updatedAt: next.updatedAt,
          }),
        });
      } catch {}
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
    const rollingPool = inv.filter((x) => x.isRolling && x.soldCount < x.maxCount);
    const pool = rollingPool.length > 0 ? rollingPool : inv.filter((x) => x.soldCount < x.maxCount);
    const usePool = pool.length > 0 ? pool : inv;
    const runtimePool = usePool.length > 0 ? usePool : buildFallbackPool(10);

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

    const results: SigItem[] = [];
    let fallbackUsed = usePool.length === 0;
    for (let i = 0; i < spinCount; i++) {
      const tier = plan[i] ?? null;
      const range = planRanges[i] ?? null;
      const basePool = tier == null ? runtimePool : runtimePool.filter((x) => Math.floor(Number(x.price || 0)) === tier);
      const tierPool = range == null
        ? basePool
        : basePool.filter((x) => {
            const price = Math.floor(Number(x.price || 0));
            if (!Number.isFinite(price) || price <= 0) return false;
            if (range.min != null && price < range.min) return false;
            if (range.max != null && price > range.max) return false;
            return true;
          });
      if (tierPool.length === 0) {
        fallbackUsed = true;
        const pickedFallback = pickRandom(runtimePool);
        results.push({ ...pickedFallback });
        continue;
      }
      const picked = pickRandom(tierPool);
      results.push({ ...picked });
    }

    const last = results[results.length - 1]!;

    const prevRs = normalizeRouletteState(s.rouletteState);
    // Spin 직후 짧은 시간 동안 rouletteState를 보호하여 다른 저장이 덮어쓰지 못하게 함.
    setRouletteLock(userId, 10_000);
    const next: AppState = {
      ...s,
      sigInventory: inv,
      rouletteState: {
        ...prevRs,
        isRolling: true,
        result: last,
        results,
        spinPriceFilters: plan,
        spinPriceRanges: planRanges,
        spinCount,
        startedAt: Date.now(),
      },
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, next);
    // Redis 미설정 환경(Edge 인메모리 분리)에서도 /api/state 응답이 즉시 최신 rouletteState를 보게 동기화
    try {
      const url = new URL(req.url);
      url.pathname = "/api/state";
      url.search = `?user=${encodeURIComponent(userId)}`;
      await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rouletteState: next.rouletteState,
          updatedAt: next.updatedAt,
        }),
      });
    } catch {}
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
