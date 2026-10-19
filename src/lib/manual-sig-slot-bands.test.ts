import { describe, expect, it } from "vitest";
import { pickRandomManualSigDraftsBySlotBands } from "@/lib/manual-sig-random";
import {
  normalizeManualSigSlotPriceBands,
  priceMatchesManualSigSlotBand,
} from "@/lib/manual-sig-workbench";
import { isForeignUserSigUpload, listActiveManualSigPool } from "@/lib/manual-sig-active-pool";
import type { SigItem } from "@/types";

describe("manual sig slot price bands", () => {
  it("normalizes and matches bands", () => {
    const bands = normalizeManualSigSlotPriceBands(
      [{ min: 10000, max: 30000 }, { min: 0, max: 0 }],
      2
    );
    expect(bands).toEqual([
      { min: 10000, max: 30000 },
      { min: 0, max: 0 },
    ]);
    expect(priceMatchesManualSigSlotBand(20000, bands[0]!)).toBe(true);
    expect(priceMatchesManualSigSlotBand(50000, bands[0]!)).toBe(false);
    expect(priceMatchesManualSigSlotBand(1, bands[1]!)).toBe(true);
  });

  it("picks one sig per band without duplicates", () => {
    const pool = [
      { id: "a", name: "A", price: 10000, imageUrl: "" },
      { id: "b", name: "B", price: 25000, imageUrl: "" },
      { id: "c", name: "C", price: 80000, imageUrl: "" },
      { id: "d", name: "D", price: 90000, imageUrl: "" },
    ];
    const drafts = pickRandomManualSigDraftsBySlotBands(pool, [
      { min: 10000, max: 30000 },
      { min: 70000, max: 100000 },
    ]);
    expect(drafts).toHaveLength(2);
    const prices = drafts!.map((d) => Number(d.priceInput));
    expect(prices[0]).toBeGreaterThanOrEqual(10000);
    expect(prices[0]).toBeLessThanOrEqual(30000);
    expect(prices[1]).toBeGreaterThanOrEqual(70000);
    expect(drafts![0]!.sourceSigId).not.toBe(drafts![1]!.sourceSigId);
  });

  it("returns null when a band has no candidates", () => {
    const pool = [{ id: "a", name: "A", price: 10000, imageUrl: "" }];
    expect(
      pickRandomManualSigDraftsBySlotBands(pool, [
        { min: 10000, max: 20000 },
        { min: 90000, max: 100000 },
      ])
    ).toBeNull();
  });
});

describe("foreign user sig upload filter", () => {
  it("detects other account upload paths", () => {
    expect(isForeignUserSigUpload("/uploads/sigs/finalent/a.gif", "din")).toBe(true);
    expect(isForeignUserSigUpload("/uploads/sigs/din/a.gif", "din")).toBe(false);
    expect(isForeignUserSigUpload("https://toona.example/x.gif", "din")).toBe(false);
  });

  it("listActiveManualSigPool excludes foreign uploads when ownerUserId set", () => {
    const inv: SigItem[] = [
      {
        id: "mine",
        name: "내시그",
        price: 10000,
        imageUrl: "/uploads/sigs/din/a.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: true,
      },
      {
        id: "theirs",
        name: "타계정",
        price: 20000,
        imageUrl: "/uploads/sigs/finalent/b.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isActive: true,
        isRolling: true,
      },
    ];
    const pool = listActiveManualSigPool(inv, { ignoreStock: true, ownerUserId: "din" });
    expect(pool.map((x) => x.id)).toEqual(["mine"]);
  });
});
