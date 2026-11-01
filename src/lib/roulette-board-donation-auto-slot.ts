/**
 * 후원 → 룰렛 보드 자동 칸 추가.
 * DIN ingest ACK 경로와 분리해 fire-and-forget 으로만 호출한다.
 */
import {
  buildDonationSlotLabel,
  calcAutoAddSlots,
} from "@/lib/roulette-board";
import { loadBoardRoulette, saveBoardRoulette } from "@/lib/roulette-board-storage";

export type RouletteDonationAutoSlotInput = {
  id?: string | null;
  donorName?: string | null;
  amount?: number | null;
  createdAt?: number | null;
};

export async function maybeAutoAddRouletteSlotsFromDonation(
  userId: string,
  event: RouletteDonationAutoSlotInput
): Promise<{ added: boolean; addCount: number; skipped?: string }> {
  const uid = String(userId || "").trim();
  if (!uid) return { added: false, addCount: 0, skipped: "no_user" };

  const board = await loadBoardRoulette(uid);
  const cfg = board.config;
  const amount = Number(event.amount || 0);
  const donationAt = Number(event.createdAt);
  if (
    cfg.cutoffTimestamp != null &&
    Number.isFinite(donationAt) &&
    donationAt > 0 &&
    donationAt < cfg.cutoffTimestamp
  ) {
    return { added: false, addCount: 0, skipped: "before_cutoff" };
  }

  const add = calcAutoAddSlots(amount, {
    enabled: cfg.enabled,
    minAmount: cfg.minAmount ?? 0,
    cutoffTimestamp: cfg.cutoffTimestamp ?? null,
    thresholdAmount: cfg.thresholdAmount ?? null,
    addSlotsPerThreshold: cfg.addSlotsPerThreshold ?? 1,
  });
  if (add.skipped || add.addCount <= 0) {
    return { added: false, addCount: 0, skipped: add.reason || "skipped" };
  }

  const nickname = String(event.donorName || "익명");
  const donationId = String(event.id || "").trim() || null;
  const newSlot = {
    id: `slot_donation_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    rouletteId: `board_${uid}`,
    label: buildDonationSlotLabel(nickname, amount),
    count: add.addCount,
    color: "#ef4444",
    source: "donation" as const,
    donationId,
    createdAt: Date.now(),
  };
  await saveBoardRoulette(uid, {
    ...board,
    dynamicSlots: [...(board.dynamicSlots || []), newSlot],
    updatedAt: Date.now(),
  });
  return { added: true, addCount: add.addCount };
}
