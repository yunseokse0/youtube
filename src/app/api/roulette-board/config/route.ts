/**
 * Toontation 방식 일반 룰렛 — 설정 변경
 * PATCH /api/roulette-board/config
 */

import { getRouletteUserId } from "@/app/api/roulette/edge-state-store";
import { patchBoardRoulette } from "@/lib/roulette-board-storage";
import { mergeRouletteConfig } from "@/lib/roulette-board";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export const revalidate = 0;

export async function PATCH(req: Request): Promise<Response> {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const body = (await req.json().catch(() => null)) as {
      enabled?: boolean;
      minAmount?: number | null;
      cutoffTimestamp?: number | null | string;
      thresholdAmount?: number | null | string;
      addSlotsPerThreshold?: number | null;
      currentRotationDeg?: number | null;
    };

    const patch: Record<string, unknown> = {};
    if (body.enabled !== undefined) patch.enabled = Boolean(body.enabled);
    if (body.minAmount !== undefined) {
      const mn = Number(body.minAmount);
      if (!Number.isFinite(mn) || mn < 0)
        return json({ error: "minAmount는 0 이상이어야 합니다." }, 400);
      patch.minAmount = mn;
    }
    if (body.cutoffTimestamp !== undefined) {
      patch.cutoffTimestamp =
        body.cutoffTimestamp === null
          ? null
          : new Date(String(body.cutoffTimestamp)).getTime();
    }
    if (body.thresholdAmount !== undefined) {
      patch.thresholdAmount =
        body.thresholdAmount === null ? null : Number(body.thresholdAmount);
    }
    if (body.addSlotsPerThreshold !== undefined) {
      const a = Number(body.addSlotsPerThreshold);
      if (!Number.isInteger(a) || a < 1 || a > 10000)
        return json({ error: "addSlotsPerThreshold는 1~10000 사이여야 합니다." }, 400);
      patch.addSlotsPerThreshold = a;
    }
    if (body.currentRotationDeg !== undefined) {
      const d = Number(body.currentRotationDeg);
      if (!Number.isFinite(d)) return json({ error: "currentRotationDeg가 올바르지 않습니다." }, 400);
      patch.currentRotationDeg = d;
    }

    const next = await patchBoardRoulette(userId, { config: patch as any });
    return json({ ok: true, config: next.config });
  } catch (err) {
    console.error("[roulette-board/config]", err);
    return json({ error: "서버 오류" }, 500);
  }
}
