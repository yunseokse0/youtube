/**
 * Toontation 방식 일반 룰렛 보드 — 조회
 * GET /api/roulette-board
 *
 * 정적 아이템, 동적 슬롯, 섹터 맵, 확률, 설정을 반환.
 * OBS 오버레이에서 휠 렌더링에 사용.
 */

import { getRouletteUserId } from "@/app/api/roulette/edge-state-store";
import { loadBoardRoulette } from "@/lib/roulette-board-storage";
import {
  buildRouletteSectorMap,
  effectiveDrawWeight,
  sizeWeightForStatic,
  sizeWeightForDynamic,
} from "@/lib/roulette-board";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const revalidate = 0;

export async function GET(req: Request): Promise<Response> {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return json({ error: "unauthorized" }, 401);
    }

    const board = await loadBoardRoulette(userId);
    const staticItems = board.items ?? [];
    const dynamicSlots = board.dynamicSlots ?? [];

    const manualSlots = dynamicSlots.filter((s) => s.source === "manual");
    const donationSlots = dynamicSlots.filter((s) => s.source === "donation");

    const manualFlatCount = manualSlots.reduce((s, m) => s + Number(m.count || 1), 0);
    const donationFlatCount = donationSlots.reduce((s, m) => s + Number(m.count || 1), 0);

    const sectors = buildRouletteSectorMap(staticItems, dynamicSlots);

    const totalSizeWeight =
      staticItems.reduce((s, i) => s + sizeWeightForStatic(i), 0) +
      dynamicSlots.reduce((s, d) => s + sizeWeightForDynamic(d), 0) ||
      1;

    const totalDraw = sectors.reduce((s, sec) => s + effectiveDrawWeight(sec), 0);

    const probabilities = sectors.map((sec) => {
      const eff = effectiveDrawWeight(sec);
      return {
        winnerType: sec.winnerType,
        winnerId: sec.winnerId,
        winnerLabel: sec.winnerLabel,
        probability: totalDraw > 0 ? eff / totalDraw : 1 / sectors.length,
        sizeWeight: sec.sizeWeight,
      };
    });

    return json({
      ok: true,
      id: `board_${userId}`,
      enabled: board.config.enabled,
      minAmount: board.config.minAmount,
      cutoffTimestamp: board.config.cutoffTimestamp,
      thresholdAmount: board.config.thresholdAmount,
      addSlotsPerThreshold: board.config.addSlotsPerThreshold,
      currentRotationDeg: board.config.currentRotationDeg,
      staticItems: staticItems.map((i) => ({ ...i, drawWeight: i.drawWeight ?? null })),
      dynamicSlots: dynamicSlots.map((d) => ({ ...d, drawWeight: d.drawWeight ?? null })),
      counts: {
        static: staticItems.reduce((s, i) => s + sizeWeightForStatic(i), 0),
        manual: manualFlatCount,
        donation: donationFlatCount,
        total: totalSizeWeight,
      },
      sectors: sectors.map((s) => ({
        winnerType: s.winnerType,
        winnerId: s.winnerId,
        winnerLabel: s.winnerLabel,
        color: s.color,
        sizeWeight: s.sizeWeight,
        sectorStartDeg: s.sectorStartDeg,
        sectorEndDeg: s.sectorEndDeg,
        sectorMidDeg: s.sectorMidDeg,
      })),
      probabilities,
      version: board.updatedAt,
      updatedAt: board.updatedAt,
    });
  } catch (err) {
    console.error("[roulette-board]", err);
    return json({ error: "서버 오류" }, 500);
  }
}
