export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { isValidUserId } from "@/app/api/_shared/user-id";
import { verifyToonaIngestAuth } from "@/app/api/donations/_shared/toona-ingest-auth";
import { sanitizeDonationEventFromIngestBody } from "@/lib/donation/din-ingest";
import { enqueueDinExcelIngest } from "@/lib/din-ingest-batch-queue";
import { loadBoardRoulette, saveBoardRoulette } from "@/lib/roulette-board-storage";
import { calcAutoAddSlots, buildDonationSlotLabel } from "@/lib/roulette-board";
import {
  describeDonationIntakeMode,
  isDonationIntakeModeB,
} from "@/policies/donation-intake-mode";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * ✅ B모드 (= DIN허브 연결 모드) 에서만 처리:
 *   .env TOONA_INTAKE_MODE=B 일때만 DIN 허브 TOONA_INGEST_SECRET 인증 경로로 후원 유입.
 *   후원 출처는 오직 DIN 허브에 연동된 투나(Toona) 프로젝트 후원만 받음.
 *   A모드 (투네 직접)일땐 경로 자체를 거절 → 출처 1개로 단일화.
 *
 * POST /api/donations/ingest?u={userId}&applyExcel=false|true
 * Authorization: Bearer {TOONA_INGEST_SECRET}
 */
export async function POST(req: Request) {
  if (!isDonationIntakeModeB()) {
    return json(
      {
        skipped: true,
        mode: describeDonationIntakeMode(),
        error: "invalid_mode",
        message:
          "현재 " +
          describeDonationIntakeMode() +
          " 이므로 DIN 허브 경로 후원은 수신하지 않고 오직 투네 직접 WS 경로로만 후원을 받습니다. DIN 허브를 사용하려면 TOONA_INTAKE_MODE=B 로 설정하세요.",
      },
      410
    );
  }
  const auth = verifyToonaIngestAuth(req);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  let userId: string;
  try {
    const raw = new URL(req.url).searchParams.get("u")?.trim() || "";
    if (!raw || !isValidUserId(raw)) {
      return json({ error: "invalid_user_id" }, 400);
    }
    userId = raw;
  } catch {
    return json({ error: "invalid_request" }, 400);
  }

  const body = await req.json().catch(() => null);
  const event = sanitizeDonationEventFromIngestBody(body);
  if (!event) {
    return json({ error: "invalid_donation_event" }, 400);
  }

  try {
    /**
     * B모드 전용 라우트 — 허브가 applyExcel=false(시나리오 A 알림만)로 보내도 정산표에 넣는다.
     * ACK 후 계정당 워커가 메모리에서 처리하고, 끝난 뒤에만 AppState 저장 1회.
     */
    const enq = await enqueueDinExcelIngest(userId, event);

    /** 후원 시 룰렛 자동 칸 추가 (임계치 도달 시) */
    try {
      const board = await loadBoardRoulette(userId);
      const cfg = board.config;
      const amount = Number(event.amount || 0);
      const add = calcAutoAddSlots(amount, {
        enabled: cfg.enabled,
        minAmount: cfg.minAmount ?? 0,
        cutoffTimestamp: cfg.cutoffTimestamp ?? null,
        thresholdAmount: cfg.thresholdAmount ?? null,
        addSlotsPerThreshold: cfg.addSlotsPerThreshold ?? 1,
      } as Pick<
        typeof cfg,
        | "enabled"
        | "minAmount"
        | "cutoffTimestamp"
        | "thresholdAmount"
        | "addSlotsPerThreshold"
      >);
      if (!add.skipped && add.addCount > 0) {
        const nickname = String(event.donorName || "익명");
        const newSlot = {
          id: `slot_donation_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
          rouletteId: `board_${userId}`,
          label: buildDonationSlotLabel(nickname, amount),
          count: add.addCount,
          color: "#ef4444",
          source: "donation" as const,
          donationId: event.id,
          createdAt: Date.now(),
        };
        await saveBoardRoulette(userId, {
          ...board,
          dynamicSlots: [...(board.dynamicSlots || []), newSlot],
          updatedAt: Date.now(),
        });
      }
    } catch (rouErr) {
      console.error("[donations/ingest] roulette auto-slot failed:", rouErr);
      /* 룰렛 추가 실패는 후원 수집에 영향을 주지 않음 */
    }

    return json({
      userId,
      applyExcel: true,
      ok: true,
      queued: true,
      applied: true,
      accepted: 1,
      duplicateQueued: enq.duplicateQueued,
      queueDepth: enq.depth,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingest_failed";
    console.error("[donations/ingest]", userId, message);
    return json({ error: message }, 500);
  }
}
