export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { isValidUserId, resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { loadAppStateForUserId } from "@/lib/app-state-server-load";
import {
  cancelAllWaitingZubzub,
  cancelZubzubQueueItem,
  listWaitingZubzubQueues,
  insertZubzubQueueItem,
} from "@/lib/zubzub/zubzub-repo";
import {
  createZubzubBonusContributionLog,
  revertOrCancelZubzubQueue,
} from "@/lib/zubzub/zubzub-engine";
import { syncMemberTotalsFromDonors } from "@/domain/sync/sync-repair-1pass";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import type { AppState, Donor } from "@/types";

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
        overlayScale: 1,
        maxVisibleItems: 3,
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

    const auth = resolveWriteUserId(req, { allowAnonymousUrlUser: true });
    if (!auth.ok) {
      return writeUserIdErrorResponse(auth);
    }
    const userId = auth.userId;

    const action = String(body.action || "").trim();
    const state = await loadAppStateForUserId(userId);
    if (!state) {
      return NextResponse.json({ error: "state_not_found" }, { status: 404 });
    }

    // 1. 단건 줍줍 큐 취소 또는 이미 획득한 보너스 회수
    if (action === "cancel" || action === "revert_bonus") {
      const queueId = String(body.queueId || body.donorId || "").trim();
      if (!queueId) {
        return NextResponse.json({ error: "missing_queue_id_or_donor_id" }, { status: 400 });
      }
      const res = await revertOrCancelZubzubQueue(userId, queueId, state);
      return NextResponse.json({ ok: res.ok, newState: res.newState });
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
      const {
        enabled,
        minSigPrice,
        priorityMode,
        representativeMemberId,
        autoExpireMinutes,
        embedInMainOverlay,
        alwaysShowWaiting,
        overlayScale,
        maxVisibleItems,
        applyContributionToPongdang,
        doubleContribution,
        multiplier,
        applyDoubleContributionToPongdang,
        align,
        rollIntervalSec,
      } = body;
      const parsedOverlayScale = Number(overlayScale);
      const parsedMaxVisibleItems = Number(maxVisibleItems);
      const isDouble = doubleContribution !== false;
      const parsedMultiplier = Math.max(
        1,
        Math.min(10, Math.round(Number(multiplier) || (isDouble ? 2 : 1)))
      );
      const parsedRollInterval = Math.max(1, Math.min(10, Number(rollIntervalSec) || 2.5));
      const parsedAlign: "left" | "center" | "right" =
        align === "center" ? "center" : align === "right" ? "right" : "left";
      const nextSettings = {
        enabled: Boolean(enabled),
        minSigPrice: Math.max(0, Math.round(Number(minSigPrice) || 0)),
        priorityMode: priorityMode === "highest" ? ("highest" as const) : ("fifo" as const),
        embedInMainOverlay: Boolean(embedInMainOverlay),
        alwaysShowWaiting: alwaysShowWaiting !== false,
        overlayScale: Number.isFinite(parsedOverlayScale) && parsedOverlayScale > 0
          ? Math.round(Math.min(4, Math.max(0.5, parsedOverlayScale)) * 100) / 100
          : 1,
        maxVisibleItems: Number.isFinite(parsedMaxVisibleItems)
          ? Math.min(10, Math.max(1, Math.round(parsedMaxVisibleItems)))
          : 3,
        applyContributionToPongdang: applyContributionToPongdang !== false,
        doubleContribution: isDouble,
        multiplier: parsedMultiplier,
        applyDoubleContributionToPongdang: applyDoubleContributionToPongdang !== false,
        align: parsedAlign,
        rollIntervalSec: parsedRollInterval,
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

    // 4. 테스트 성공 알림 발동 (시뮬레이션)
    if (action === "test_claim") {
      const dummyEvent = body.event;
      if (dummyEvent) {
        await publishSseEvent({
          ...dummyEvent,
          userId,
          timestamp: Date.now(),
        });
      }
      return NextResponse.json({ ok: true });
    }

    // 5. 줍줍 대기열에 수동 추가
    if (action === "enqueue_manual") {
      const sigName = String(body.sigName || "").trim() || "대표 줍줍 시그";
      const bonusAmount = Math.max(1000, Math.round(Number(body.bonusAmount) || 50000));
      const sigImageUrl = typeof body.sigImageUrl === "string" ? body.sigImageUrl : undefined;

      const queueId = `zubzub_manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const queueItem = await insertZubzubQueueItem(userId, {
        id: queueId,
        triggerDonationId: `manual_${Date.now()}`,
        sigName,
        sigImageUrl,
        bonusAmount,
      });

      const currentWaitings = await listWaitingZubzubQueues(userId);
      const nextState: AppState = {
        ...state,
        zubzubWaitingItems: currentWaitings,
        updatedAt: Date.now(),
      };
      await saveAppStateForRoulette(userId, nextState);
      await publishSseEvent({
        type: "zubzub_enqueued",
        userId,
        queueItem,
        waitingCount: currentWaitings.length,
        timestamp: Date.now(),
      });
      return NextResponse.json({ ok: true, queueItem, waitingItems: currentWaitings });
    }

    // 6. 특정 멤버에게 줍줍 직접 수동 지급
    if (action === "claim_manual") {
      const memberId = String(body.memberId || "").trim();
      const targetMember = (state.members || []).find((m) => m.id === memberId);
      if (!targetMember) {
        return NextResponse.json({ error: "member_not_found" }, { status: 400 });
      }

      const sigName = String(body.sigName || "").trim() || "대표 줍줍 시그";
      const bonusAmount = Math.max(1000, Math.round(Number(body.bonusAmount) || 50000));
      const manualQueueId = `zubzub_manual_claim_${Date.now()}`;
      const multiplier = Math.max(
        1,
        Math.min(10, Math.round(Number(state.zubzubSettings?.multiplier) || (state.zubzubSettings?.doubleContribution === false ? 1 : 2)))
      );
      const isDouble = multiplier > 1;
      const baseSigPrice = bonusAmount;
      const totalBonusPoints = baseSigPrice * multiplier;

      const bonusDonor: Donor = {
        id: `zubzub_bonus_${manualQueueId}`,
        name: `[대표 줍줍] ${sigName}`,
        donorName: `대표 시그 줍줍(수동)`,
        amount: bonusAmount,
        memberId: targetMember.id,
        at: Date.now(),
        message: `[대표 시그 줍줍] ${sigName} (+${totalBonusPoints.toLocaleString()}점${multiplier > 1 ? ` [${multiplier}배 적용]` : ""})`,
        donationExcluded: true,
        isSigCredit: true,
        sigPrice: baseSigPrice,
        contributionPoints: totalBonusPoints,
        zubzubMultiplier: multiplier,
        isZubzubBonus: true,
        zubzubQueueId: manualQueueId,
        provider: "zubzub_bonus",
        externalId: manualQueueId,
      };
      const contributionLog = createZubzubBonusContributionLog(
        manualQueueId,
        targetMember.id,
        totalBonusPoints,
        sigName,
        Date.now(),
        {
          doubleContribution: isDouble,
          multiplier,
          baseSigPrice,
          isManualClaim: true,
        }
      );

      const currentWaitings = await listWaitingZubzubQueues(userId);
      const nextStateWithContribution: AppState = {
        ...state,
        contributionLogs: [
          ...(state.contributionLogs || []).filter((log) => log.id !== contributionLog.id),
          contributionLog,
        ],
        zubzubWaitingItems: currentWaitings,
        updatedAt: Date.now(),
      };

      const syncedState = syncMemberTotalsFromDonors(nextStateWithContribution);
      const saved = await saveAppStateForRoulette(userId, syncedState);
      await publishSseEvent({
        type: "state_updated",
        userId,
        updatedAt: saved.state.updatedAt,
      });

      await publishSseEvent({
        type: "zubzub_claimed",
        userId,
        queueItem: {
          id: manualQueueId,
          userId,
          triggerDonationId: `manual_${Date.now()}`,
          sigName,
          bonusAmount,
          status: "CLAIMED",
          createdAt: Date.now(),
        },
        memberId: targetMember.id,
        memberName: targetMember.name,
        bonusAmount,
        bonusDonor,
        contributionLog,
        remainingWaitingCount: currentWaitings.length,
        timestamp: Date.now(),
      });

      return NextResponse.json({ ok: true, bonusDonor, contributionLog, newState: syncedState });
    }

    return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  } catch (err) {
    console.error("[api/zubzub POST]", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
