import { describe, expect, it } from "vitest";
import type { AppState, Donor, Member, RouletteState } from "@/types";
import {
  applyOverlayDonationDisplayTotals,
  collectAppearedSigPrices,
  filterDonorsForDay777Calc,
  filterDonorsFromAggregateAt,
  normalizeDonationAggregateFromAt,
} from "./overlay-donation-aggregate";

function member(partial: Partial<Member> & { id: string; name: string }): Member {
  return {
    account: 0,
    toon: 0,
    contribution: 0,
    goal: 0,
    operating: false,
    ...partial,
  };
}

function donor(partial: Partial<Donor> & { id: string; memberId: string; amount: number; at: number }): Donor {
  return {
    name: "d",
    target: "account",
    ...partial,
  };
}

describe("normalizeDonationAggregateFromAt", () => {
  it("treats empty as full period", () => {
    expect(normalizeDonationAggregateFromAt(undefined)).toBeNull();
    expect(normalizeDonationAggregateFromAt("")).toBeNull();
    expect(normalizeDonationAggregateFromAt(0)).toBeNull();
  });

  it("parses epoch ms", () => {
    expect(normalizeDonationAggregateFromAt("1700000000000")).toBe(1_700_000_000_000);
    expect(normalizeDonationAggregateFromAt(1_700_000_000_000.9)).toBe(1_700_000_000_000);
  });
});

describe("applyOverlayDonationDisplayTotals", () => {
  it("does not mutate original donors and only sums after fromAt", () => {
    const fromAt = 1_000;
    const donors: Donor[] = [
      donor({ id: "a", memberId: "m1", amount: 10_000, at: 500, target: "account" }),
      donor({ id: "b", memberId: "m1", amount: 20_000, at: 1_500, target: "account" }),
      donor({ id: "c", memberId: "m1", amount: 5_000, at: 2_000, target: "toon" }),
    ];
    const state = {
      members: [member({ id: "m1", name: "A", account: 99_999, toon: 99_999 })],
      donors,
      contributionLogs: [],
    } as AppState;

    const next = applyOverlayDonationDisplayTotals(state, { fromAt });
    expect(state.donors).toHaveLength(3);
    expect(next.members[0]?.account).toBe(20_000);
    expect(next.members[0]?.toon).toBe(5_000);
  });

  it("filterDonorsFromAggregateAt keeps at >= fromAt", () => {
    const rows = filterDonorsFromAggregateAt(
      [
        donor({ id: "a", memberId: "m1", amount: 1, at: 10 }),
        donor({ id: "b", memberId: "m1", amount: 1, at: 20 }),
      ],
      15
    );
    expect(rows.map((d) => d.id)).toEqual(["b"]);
  });
});

describe("day777Calc", () => {
  it("collects appeared sig prices from history and current, skips one-shot", () => {
    const rs: RouletteState = {
      isRolling: false,
      result: null,
      spinCount: 0,
      startedAt: 0,
      phase: "LANDED",
      selectedSigs: [
        { id: "s1", name: "A", price: 77_000, imageUrl: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: true },
        {
          id: "sig_one_shot",
          name: "한방 시그",
          price: 154_000,
          imageUrl: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: false,
          isActive: true,
        },
      ],
      historyLogs: [
        {
          id: "h1",
          sessionId: "sess",
          phase: "CONFIRMED",
          selectedSigs: [
            {
              id: "s2",
              name: "B",
              price: 100_000,
              imageUrl: "",
              maxCount: 1,
              soldCount: 0,
              isRolling: false,
              isActive: true,
            },
          ],
          selectedSigIds: ["s2"],
          oneShotPrice: 100_000,
          totalPrice: 100_000,
          timestamp: 2_000,
        },
        {
          id: "h0",
          sessionId: "old",
          phase: "CONFIRMED",
          selectedSigs: [
            {
              id: "s0",
              name: "old",
              price: 50_000,
              imageUrl: "",
              maxCount: 1,
              soldCount: 0,
              isRolling: false,
              isActive: true,
            },
          ],
          selectedSigIds: ["s0"],
          oneShotPrice: 50_000,
          totalPrice: 50_000,
          timestamp: 500,
        },
      ],
    };
    const prices = collectAppearedSigPrices({ rouletteState: rs, fromAt: 1_000 });
    expect([...prices].sort((a, b) => a - b)).toEqual([77_000, 100_000]);
  });

  it("contribution only counts donations matching appeared sig prices", () => {
    const fromAt = 1_000;
    const donors: Donor[] = [
      donor({ id: "a", memberId: "m1", amount: 77_000, at: 1_500, target: "account", contributionPoints: 77_000 }),
      donor({ id: "b", memberId: "m1", amount: 12_000, at: 1_600, target: "account", contributionPoints: 12_000 }),
      donor({ id: "c", memberId: "m1", amount: 100_000, at: 1_700, target: "toon", contributionPoints: 100_000 }),
    ];
    const state = {
      members: [member({ id: "m1", name: "A" })],
      donors,
      contributionLogs: [],
      rouletteState: {
        isRolling: false,
        result: null,
        spinCount: 0,
        startedAt: 0,
        phase: "LANDED",
        selectedSigs: [
          {
            id: "s1",
            name: "A",
            price: 77_000,
            imageUrl: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: false,
            isActive: true,
          },
          {
            id: "s2",
            name: "B",
            price: 100_000,
            imageUrl: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: false,
            isActive: true,
          },
        ],
        historyLogs: [],
      },
    } as AppState;

    const next = applyOverlayDonationDisplayTotals(state, { fromAt, day777Calc: true });
    expect(next.members[0]?.account).toBe(77_000 + 12_000);
    expect(next.members[0]?.toon).toBe(100_000);
    expect(next.members[0]?.contribution).toBe(77_000 + 100_000);
  });

  it("existing excel (day777 off) credits contribution from the donation amount including 777000", () => {
    const state = {
      members: [member({ id: "m1", name: "A" })],
      donors: [donor({ id: "shot", memberId: "m1", amount: 777_000, at: 1_500, target: "account" })],
      contributionLogs: [],
      rouletteState: {
        isRolling: false,
        result: null,
        spinCount: 0,
        startedAt: 0,
        phase: "LANDED",
        selectedSigs: [
          {
            id: "s1",
            name: "A",
            price: 77_000,
            imageUrl: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: false,
            isActive: true,
          },
        ],
        historyLogs: [],
      },
    } as AppState;

    const next = applyOverlayDonationDisplayTotals(state, { fromAt: 1, day777Calc: false });
    expect(next.members[0]?.account).toBe(777_000);
    expect(next.members[0]?.contribution).toBe(777_000);
  });

  it("777000 donation stays on account/toon; contribution is appeared sig prices only", () => {
    const donors: Donor[] = [
      donor({ id: "shot", memberId: "m1", amount: 777_000, at: 1_500, target: "account" }),
    ];
    const state = {
      members: [member({ id: "m1", name: "A" }), member({ id: "m2", name: "B" })],
      donors,
      contributionLogs: [],
      rouletteState: {
        isRolling: false,
        result: null,
        spinCount: 0,
        startedAt: 0,
        phase: "LANDED",
        selectedSigs: [
          {
            id: "s1",
            name: "A",
            price: 77_000,
            imageUrl: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: false,
            isActive: true,
          },
        ],
        historyLogs: [],
      },
    } as AppState;

    const next = applyOverlayDonationDisplayTotals(state, { day777Calc: true });
    expect(next.members[0]?.account).toBe(777_000);
    expect(next.members[0]?.contribution).toBe(77_000);
    expect(next.members[1]?.account).toBe(0);
    expect(next.members[1]?.contribution).toBe(0);
  });

  it("credits appeared sig to the 777000 recipient when sig has no buyer", () => {
    const donors: Donor[] = [
      donor({ id: "shot", memberId: "m2", amount: 777_000, at: 2_000, target: "toon" }),
    ];
    const state = {
      members: [member({ id: "m1", name: "A" }), member({ id: "m2", name: "B" })],
      donors,
      contributionLogs: [],
      rouletteState: {
        isRolling: false,
        result: null,
        spinCount: 0,
        startedAt: 0,
        phase: "LANDED",
        selectedSigs: [
          {
            id: "s1",
            name: "A",
            price: 50_000,
            imageUrl: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: false,
            isActive: true,
          },
        ],
        historyLogs: [],
      },
    } as AppState;

    const next = applyOverlayDonationDisplayTotals(state, { day777Calc: true });
    expect(next.members[0]?.toon).toBe(0);
    expect(next.members[1]?.toon).toBe(777_000);
    expect(next.members[0]?.contribution).toBe(0);
    expect(next.members[1]?.contribution).toBe(50_000);
  });

  it("filterDonorsForDay777Calc matches floor amount", () => {
    const prices = new Set([77_000]);
    const rows = filterDonorsForDay777Calc(
      [
        donor({ id: "a", memberId: "m1", amount: 77_000, at: 10 }),
        donor({ id: "b", memberId: "m1", amount: 77001, at: 10 }),
      ],
      prices,
      null
    );
    expect(rows.map((d) => d.id)).toEqual(["a"]);
  });
});
