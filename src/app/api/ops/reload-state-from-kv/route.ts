export const runtime = "nodejs";
export const revalidate = 0;

import { getUrlUserIdFromRequest, isValidUserId } from "@/app/api/_shared/user-id";
import { upstashGetAppStateJson } from "@/app/api/_shared/upstash-app-state";
import {
  appStateStorageKey,
  invalidateAppStateKvCache,
  seedAppStateKvCache,
} from "@/lib/app-state-server-load";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import { setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { normalizeDonorsArray, totalCombined } from "@/lib/state";
import type { AppState } from "@/types";

function isLoopbackRequest(req: Request): boolean {
  try {
    const host = new URL(req.url).hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  } catch {
    /* ignore */
  }
  const xf = (req.headers.get("x-forwarded-for") || "").split(",")[0]?.trim();
  if (xf === "127.0.0.1" || xf === "::1") return true;
  return false;
}

/**
 * EC2/ops: MySQL(app_kv)에 직접 쓴 뒤 Node 메모리·KV 캐시·SSE 를 맞춘다.
 * coalesce 없이 KV 본문을 메모리에 올려, 툴 정렬이 관리자에 자동 반영되게 함.
 * localhost 전용.
 *
 *   curl -sS -X POST "http://127.0.0.1:3000/api/ops/reload-state-from-kv?user=din"
 */
export async function POST(req: Request) {
  if (!isLoopbackRequest(req)) {
    return new Response(JSON.stringify({ error: "localhost_only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  const fromUrl = getUrlUserIdFromRequest(req);
  const body = (await req.json().catch(() => null)) as { userId?: string } | null;
  const userId = fromUrl || (typeof body?.userId === "string" ? body.userId.trim() : "");
  if (!userId || !isValidUserId(userId)) {
    return new Response(JSON.stringify({ error: "user_required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  invalidateAppStateKvCache(userId);
  /** 옛 메모리(961)와 union 하지 않도록 먼저 비움 */
  setServerMemoryAppState(userId, null);
  const fromKv = await upstashGetAppStateJson<AppState>(appStateStorageKey(userId));
  if (!fromKv || !Array.isArray(fromKv.members)) {
    return new Response(JSON.stringify({ error: "kv_empty" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  setServerMemoryAppState(userId, fromKv);
  seedAppStateKvCache(userId, fromKv);
  await publishSseEvent({
    type: "state_updated",
    updatedAt: Number(fromKv.updatedAt || Date.now()),
    ...(typeof fromKv.donorRankingsUpdatedAt === "number" && fromKv.donorRankingsUpdatedAt > 0
      ? { donorRankingsUpdatedAt: fromKv.donorRankingsUpdatedAt }
      : {}),
  });

  return new Response(
    JSON.stringify({
      ok: true,
      userId,
      donors: normalizeDonorsArray(fromKv.donors).length,
      total: totalCombined(fromKv),
      updatedAt: fromKv.updatedAt,
      settlementResetAt: fromKv.settlementResetAt || 0,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    }
  );
}
