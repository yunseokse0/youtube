/**
 * Toontation 방식 일반 룰렛 — 정적 아이템 CRUD
 * POST /api/roulette-board/items
 * DELETE /api/roulette-board/items/[id]
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
      weight?: number | string;
      color?: string;
      sortOrder?: number | string;
    };

    if (!body?.label || !String(body.label).trim())
      return json({ error: "label은 필수입니다." }, 400);

    const weight = Number(body.weight);
    if (!Number.isInteger(weight) || weight < 5 || weight > 10000 || weight % 5 !== 0)
      return json({ error: "weight는 5단위 5~10000 사이 정수여야 합니다." }, 400);

    const color = body.color || "#ef4444";
    if (!isValidRouletteColor(color))
      return json({ error: "올바른 색상 값이 아닙니다." }, 400);

    const sortOrder = Number(body.sortOrder) || 0;

    const board = await loadBoardRoulette(userId);
    const item = {
      id: `item_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      label: String(body.label).trim(),
      weight,
      color,
      sortOrder,
    };

    await saveBoardRoulette(userId, {
      ...board,
      items: [...(board.items || []), item],
      updatedAt: Date.now(),
    });

    return json({ ok: true, item }, 201);
  } catch (err) {
    console.error("[roulette-board/items POST]", err);
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
    const idx = (board.items || []).findIndex((i) => i.id === id);
    if (idx === -1) return json({ error: "항목을 찾을 수 없습니다." }, 404);

    const nextItems = (board.items || []).filter((_, i) => i !== idx);
    await saveBoardRoulette(userId, {
      ...board,
      items: nextItems,
      updatedAt: Date.now(),
    });

    return json({ ok: true });
  } catch (err) {
    console.error("[roulette-board/items DELETE]", err);
    return json({ error: "서버 오류" }, 500);
  }
}
