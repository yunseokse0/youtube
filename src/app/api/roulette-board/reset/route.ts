/**
 * Toontation 방식 일반 룰렛 — 판 초기화
 * POST /api/roulette-board/reset
 */

import { getRouletteUserId } from "@/app/api/roulette/edge-state-store";
import {
  clearBoardDynamicSlots,
  loadBoardRoulette,
  patchBoardRoulette,
  saveBoardRoulette,
} from "@/lib/roulette-board-storage";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const revalidate = 0;

export async function POST(req: Request): Promise<Response> {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => null)) as {
      clearWonPool?: boolean;
    };

    const board = await loadBoardRoulette(userId);

    // 동적 슬롯 전체 삭제
    await clearBoardDynamicSlots(userId);

    // 설정 초기화
    const next = await patchBoardRoulette(userId, {
      config: {
        currentRotationDeg: 0,
        cutoffTimestamp: body?.clearWonPool ? null : board.config.cutoffTimestamp,
      } as any,
    });

    return json({
      ok: true,
      resetAt: Date.now(),
      newCutoff: next.config.cutoffTimestamp,
      config: next.config,
    });
  } catch (err) {
    console.error("[roulette-board/reset]", err);
    return json({ error: "서버 오류" }, 500);
  }
}
