export const runtime = "edge";
export const revalidate = 0;

import { z } from "zod";
import { getRouletteHistory } from "@/lib/sig-roulette";
import { loadAppStateForRoulette } from "../edge-state-store";
import { getRouletteUserId } from "../edge-state-store";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sessionId: z.string().trim().min(1).optional(),
});

export async function GET(req: Request) {
  try {
    const userId = getRouletteUserId(req);
    if (!userId) {
      return Response.json({ error: "unauthorized" }, { status: 401, headers: { "Content-Type": "application/json" } });
    }
    const url = new URL(req.url);
    const parsed = querySchema.safeParse({
      limit: url.searchParams.get("limit") || undefined,
      sessionId: url.searchParams.get("sessionId") || undefined,
    });
    if (!parsed.success) {
      return Response.json(
        { ok: false, error: "invalid_query", details: parsed.error.flatten() },
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    const limit = parsed.data.limit ?? 20;
    const appState = await loadAppStateForRoulette(userId);
    const fromState = appState.rouletteState?.historyLogs || [];
    const stateFiltered = parsed.data.sessionId ? fromState.filter((x) => x.sessionId === parsed.data.sessionId) : fromState;
    const history = stateFiltered.length > 0 ? stateFiltered.slice(0, limit) : await getRouletteHistory(userId, limit, parsed.data.sessionId);
    return Response.json(
      {
        ok: true,
        count: history.length,
        history: history.map((x) => ({
          id: x.id,
          sessionId: x.sessionId,
          phase: x.phase,
          selectedSigs: x.selectedSigs.map((s) => ({ id: s.id, name: s.name, price: s.price })),
          selectedSigsSummary: x.selectedSigs.map((s) => s.name).join(", "),
          oneShotPrice: x.oneShotPrice,
          totalPrice: x.totalPrice,
          timestamp: x.timestamp,
          adminId: x.adminId || null,
          reason: x.reason || null,
        })),
      },
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return Response.json(
      { ok: false, error: String(e) },
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
