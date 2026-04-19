export const runtime = "edge";
export const revalidate = 0;

import type { AppState } from "@/lib/state";
import { normalizeRouletteState } from "@/lib/state";
import { getRouletteUserId, loadAppStateForRoulette, saveAppStateForRoulette } from "../edge-state-store";

/** 룰렛 애니메이션 종료 후 isRolling=false (당첨 result는 유지) */
export async function POST(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const s = await loadAppStateForRoulette(userId);
    const rs = normalizeRouletteState(s.rouletteState);
    const next: AppState = {
      ...s,
      rouletteState: {
        ...rs,
        isRolling: false,
      },
      updatedAt: Date.now(),
    };
    await saveAppStateForRoulette(userId, next);
    return Response.json({ ok: true }, { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
