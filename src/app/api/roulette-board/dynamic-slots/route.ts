/**
 * Toontation 방식 일반 룰렛 — 동적 슬롯 CRUD
 * POST /api/roulette-board/dynamic-slots
 * PATCH /api/roulette-board/dynamic-slots/[id]
 * DELETE /api/roulette-board/dynamic-slots/[id]
 */

import { getRouletteUserId } from "@/app/api/roulette/edge-state-store";
import { loadBoardRoulette, saveBoardRoulette } from "@/lib/roulette-board-storage";
import { isValidRouletteColor } from "@/lib/roulette-board";

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
      label?: string;
      count?: number | string;
      color?: string;
      source?: "manual" | "donation";
      donationId?: string | null;
    };

    if (!body?.label || !String(body.label).trim())
      return json({ error: "label은 필수입니다." }, 400);

    const count = Math.min(10000, Math.max(1, Number(body.count) || 1));
    const color = body.color || "#ef4444";
    if (!isValidRouletteColor(color))
      return json({ error: "올바른 색상 값이 아닙니다." }, 400);

    const board = await loadBoardRoulette(userId);
    const slot = {
      id: `slot_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      rouletteId: `board_${userId}`,
      label: String(body.label).trim(),
      count,
      color,
      source: body.source || "manual",
      donationId: body.donationId ?? null,
      createdAt: Date.now(),
    };

    await saveBoardRoulette(userId, {
      ...board,
      dynamicSlots: [...(board.dynamicSlots || []), slot],
      updatedAt: Date.now(),
    });

    return json({ ok: true, slot }, 201);
  } catch (err) {
    console.error("[roulette-board/dynamic-slots POST]", err);
    return json({ error: "서버 오류" }, 500);
  }
}

export async function PATCH(req: Request): Promise<Response> {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id가 필요합니다." }, 400);

    const body = (await req.json().catch(() => null)) as {
      label?: string;
      count?: number | string;
      color?: string;
      drawWeight?: number | null;
    };

    const board = await loadBoardRoulette(userId);
    const slotIdx = (board.dynamicSlots || []).findIndex((s) => s.id === id);
    if (slotIdx === -1) return json({ error: "슬롯을 찾을 수 없습니다." }, 404);

    const slot = { ...(board.dynamicSlots || [])[slotIdx] };

    if (body.label !== undefined) {
      const lb = String(body.label).trim();
      if (lb.length === 0 || lb.length > 80)
        return json({ error: "label은 1~80자 이내여야 합니다." }, 400);
      slot.label = lb;
    }
    if (body.count !== undefined) {
      const c = Number(body.count);
      if (!Number.isInteger(c) || c < 1 || c > 10000)
        return json({ error: "count는 1~10000 사이 정수여야 합니다." }, 400);
      slot.count = c;
    }
    if (body.color !== undefined) {
      if (!isValidRouletteColor(body.color))
        return json({ error: "올바른 색상 값이 아닙니다." }, 400);
      slot.color = body.color.toLowerCase();
    }
    if (body.drawWeight !== undefined) {
      slot.drawWeight = body.drawWeight === null ? null : Number(body.drawWeight);
    }

    const nextSlots = [...(board.dynamicSlots || [])];
    nextSlots[slotIdx] = slot;

    await saveBoardRoulette(userId, {
      ...board,
      dynamicSlots: nextSlots,
      updatedAt: Date.now(),
    });

    return json({ ok: true, slot });
  } catch (err) {
    console.error("[roulette-board/dynamic-slots PATCH]", err);
    return json({ error: "서버 오류" }, 500);
  }
}

export async function DELETE(req: Request): Promise<Response> {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) return json({ error: "unauthorized" }, 401);

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "id가 필요합니다." }, 400);

    const board = await loadBoardRoulette(userId);
    const nextSlots = (board.dynamicSlots || []).filter((s) => s.id !== id);

    if (nextSlots.length === (board.dynamicSlots || []).length)
      return json({ error: "슬롯을 찾을 수 없습니다." }, 404);

    await saveBoardRoulette(userId, {
      ...board,
      dynamicSlots: nextSlots,
      updatedAt: Date.now(),
    });

    return json({ ok: true });
  } catch (err) {
    console.error("[roulette-board/dynamic-slots DELETE]", err);
    return json({ error: "서버 오류" }, 500);
  }
}
