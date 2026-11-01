import { beforeEach, describe, expect, it, vi } from "vitest";

const loadBoardRoulette = vi.fn();
const saveBoardRoulette = vi.fn();

vi.mock("@/lib/roulette-board-storage", () => ({
  loadBoardRoulette: (...args: unknown[]) => loadBoardRoulette(...args),
  saveBoardRoulette: (...args: unknown[]) => saveBoardRoulette(...args),
}));

import { maybeAutoAddRouletteSlotsFromDonation } from "./roulette-board-donation-auto-slot";

describe("maybeAutoAddRouletteSlotsFromDonation", () => {
  beforeEach(() => {
    loadBoardRoulette.mockReset();
    saveBoardRoulette.mockReset();
    saveBoardRoulette.mockResolvedValue(true);
  });

  it("skips when threshold is not configured", async () => {
    loadBoardRoulette.mockResolvedValue({
      config: {
        enabled: true,
        minAmount: 0,
        cutoffTimestamp: null,
        thresholdAmount: null,
        addSlotsPerThreshold: 1,
      },
      items: [],
      dynamicSlots: [],
      updatedAt: 0,
    });
    const out = await maybeAutoAddRouletteSlotsFromDonation("din", {
      id: "d1",
      donorName: "a",
      amount: 50_000,
    });
    expect(out.added).toBe(false);
    expect(saveBoardRoulette).not.toHaveBeenCalled();
  });

  it("adds a donation slot when threshold is met", async () => {
    loadBoardRoulette.mockResolvedValue({
      config: {
        enabled: true,
        minAmount: 0,
        cutoffTimestamp: null,
        thresholdAmount: 10_000,
        addSlotsPerThreshold: 1,
      },
      items: [],
      dynamicSlots: [],
      updatedAt: 0,
    });
    const out = await maybeAutoAddRouletteSlotsFromDonation("din", {
      id: "d2",
      donorName: "후원자",
      amount: 20_000,
    });
    expect(out.added).toBe(true);
    expect(out.addCount).toBe(2);
    expect(saveBoardRoulette).toHaveBeenCalledTimes(1);
    const saved = saveBoardRoulette.mock.calls[0]?.[1] as {
      dynamicSlots: Array<{ source: string; donationId: string | null; count: number }>;
    };
    expect(saved.dynamicSlots).toHaveLength(1);
    expect(saved.dynamicSlots[0]?.source).toBe("donation");
    expect(saved.dynamicSlots[0]?.donationId).toBe("d2");
    expect(saved.dynamicSlots[0]?.count).toBe(2);
  });
});
