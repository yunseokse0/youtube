/**
 * Toontation 방식 일반 룰렛 — 스핀
 * POST /api/roulette-board/spin
 *
 * 백엔드에서 deterministic 당첨을 결정하고, 결과를 SSE로 브로드캐스트.
 * 클라이언트는 이 결과를 받아 휠 애니메이션을 재생.
 */

import { getRouletteUserId } from "@/app/api/roulette/edge-state-store";
import { broadcastStateUpdatedAt } from "@/lib/sse-post";
import { loadBoardRoulette, saveBoardRoulette } from "@/lib/roulette-board-storage";
import { buildSpinResult, weightedRouletteDraw } from "@/lib/roulette-board";

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
    if (!userId) {
      return json({ error: "unauthorized" }, 401);
    }

    const board = await loadBoardRoulette(userId);
    if (!board.config.enabled) {
      return json({ error: "roulette_disabled" }, 400);
    }

    const winner = weightedRouletteDraw(board.items, board.dynamicSlots);
    if (!winner) {
      return json({ error: "empty_roulette" }, 400);
    }

    const durationMs = 3500;
    const turns = 6 + Math.floor(Math.random() * 3);
    const spinTargetDeg = turns * 360 + (360 - winner.sectorMidDeg);

    // 현재 회전 각도 업데이트
    const next = {
      ...board,
      config: {
        ...board.config,
        currentRotationDeg: spinTargetDeg % 360,
        updatedAt: Date.now(),
      },
      updatedAt: Date.now(),
    };
    await saveBoardRoulette(userId, next);

    // SSE 브로드캐스트 (OBS 오버레이 알림)
    try {
      broadcastStateUpdatedAt(Date.now(), {
        roulettePhase: "SPIN",
        rouletteSessionId: `board_spin_${Date.now()}`,
      });
    } catch {
      /* SSE 전송 실패는 무시 */
    }

    return json({
      ok: true,
      winner: {
        winnerType: winner.winnerType,
        winnerId: winner.winnerId,
        winnerLabel: winner.winnerLabel,
        color: winner.color,
        sectorStartDeg: winner.sectorStartDeg,
        sectorEndDeg: winner.sectorEndDeg,
        sectorMidDeg: winner.sectorMidDeg,
      },
      turns,
      spinTargetDeg,
      durationMs,
      timestamp: Date.now(),
      currentRotationDeg: next.config.currentRotationDeg,
    });
  } catch (err) {
    console.error("[roulette-board/spin]", err);
    return json({ error: "서버 오류" }, 500);
  }
}
