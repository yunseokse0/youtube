export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isValidUserId, resolveWriteUserId } from "@/app/api/_shared/user-id";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import {
  cancelAllWaitingZubzub,
  cancelZubzubQueueItem,
  listWaitingZubzubQueues,
} from "@/lib/zubzub/zubzub-repo";
import { revertOrCancelZubzubQueue } from "@/lib/zubzub/zubzub-engine";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { publishSseEvent } from "@/lib/sse-clients-hub";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("u")?.trim() || "";
  if (!userId || !isValidUserId(userId)) {
    return NextResponse.json({ error: "invalid_user_id" }, { status: 400 });
  }

  try {
    const state = await loadAppStateForUserId(userId);
    const waitings = await listWaitingZubzubQueues(userId);
    return NextResponse.json({
      ok: true,
      settings: state?.zubzubSettings || {
        enabled: false,
        minSigPrice: 50000,
        priorityMode: "fifo",
      },
      waitingItems: waitings,
    });
  } catch (err) {
    console.error("[api/zubzub GET]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "invalid_body" }, { status: 400 });
    }

    const userId = resolveWriteUserId(body.userId || body.u);
    if (!userId || !isValidUserId(userId)) {
      return NextResponse.json({ error: "invalid_user_id" }, { status: 400 });
    }

    const action = String(body.action || "").trim();
    const state = await loadAppStateForUserId(userId);
    if (!state) {
      return NextResponse.json({ error: "state_not_found" }, { status: 404 });
    }

    // 1. 단건 줍줍 큐 취소 또는 회수
    if (action === "cancel") {
      const queueId = String(body.queueId || "").trim();
      if (!queueId) {
        return NextResponse.json({ error: "missing_queue_id" }, { status: 400 });
      }
      const res = await revertOrCancelZubzubQueue(userId, queueId, state);
      return NextResponse.json({ ok: res.ok });
    }

    // 2. 전체 대기열 일괄 취소
    if (action === "cancel_all") {
      const canceledCount = await cancelAllWaitingZubzub(userId);
      const nextState = {
        ...state,
        zubzubWaitingItems: [],
        updatedAt: Date.now(),
      };
      await saveAppStateForRoulette(userId, nextState);
      await publishSseEvent({
        type: "zubzub_canceled_all",
        userId,
        canceledCount,
        timestamp: Date.now(),
      });
      return NextResponse.json({ ok: true, canceledCount });
    }

    // 3. 설정 업데이트
    if (action === "update_settings") {
      const { enabled, minSigPrice, priorityMode, representativeMemberId, autoExpireMinutes } = body;
      const nextSettings = {
        enabled: Boolean(enabled),
        minSigPrice: Math.max(0, Math.round(Number(minSigPrice) || 0)),
        priorityMode: priorityMode === "highest" ? ("highest" as const) : ("fifo" as const),
        ...(representativeMemberId ? { representativeMemberId: String(representativeMemberId) } : {}),
        ...(autoExpireMinutes !== undefined ? { autoExpireMinutes: Math.max(0, Number(autoExpireMinutes) || 0) } : {}),
      };

      const nextState = {
        ...state,
        zubzubSettings: nextSettings,
        updatedAt: Date.now(),
      };
      await saveAppStateForRoulette(userId, nextState);
      await publishSseEvent({
        type: "zubzub_settings_updated",
        userId,
        settings: nextSettings,
        timestamp: Date.now(),
      });
      return NextResponse.json({ ok: true, settings: nextSettings });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (err) {
    console.error("[api/zubzub POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
