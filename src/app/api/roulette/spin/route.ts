export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { normalizeSigInventory } from "@/lib/constants";
import type { SigItem } from "@/types";
import { getRouletteUserId, loadAppStateForRoulette, saveAppStateForRoulette } from "../edge-state-store";

/** 서버에서만 랜덤 당첨 → Redis(또는 공유 메모리)에 rouletteState 저장 */
export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    let spinCount = 1;
    try {
      const j = (await req.json()) as { spinCount?: number };
      if (j && typeof j.spinCount === "number" && Number.isFinite(j.spinCount)) {
        spinCount = Math.max(1, Math.min(999, Math.floor(j.spinCount)));
      }
    } catch {
      /* body 없음 → 1회 */
    }

    const s = await loadAppStateForRoulette(userId);
    const inv = normalizeSigInventory(s.sigInventory);
    const pool = inv.filter((x) => x.soldCount < x.maxCount);
    const usePool = pool.length > 0 ? pool : inv;
    if (usePool.length === 0) {
      return Response.json({ error: "empty_inventory" }, { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const u = new Uint32Array(1);
    crypto.getRandomValues(u);
    const picked = usePool[u[0]! % usePool.length]!;
    const result: SigItem = { ...picked };

    const prevRs = normalizeRouletteState(s.rouletteState);
    const next: AppState = {
      ...s,
      sigInventory: inv,
      rouletteState: {
        ...prevRs,
        isRolling: true,
        result,
        spinCount,
        startedAt: Date.now(),
      },
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, next);
    return Response.json(
      { ok: true, result, spinCount },
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
