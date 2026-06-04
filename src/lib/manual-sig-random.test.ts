import { describe, expect, it } from "vitest";
import { pickRandomManualSigDrafts } from "@/lib/manual-sig-random";

describe("pickRandomManualSigDrafts", () => {
  it("returns null when fewer than 5 sellable sigs", () => {
    const pool = [{ id: "a", name: "A", price: 1000, imageUrl: "" }];
    expect(pickRandomManualSigDrafts(pool, 5)).toBeNull();
  });

  it("returns 5 unique drafts with sourceSigId", () => {
    const pool = Array.from({ length: 8 }, (_, i) => ({
      id: `sig-${i}`,
      name: `시그${i}`,
      price: 1000 + i,
      imageUrl: `/img/${i}.gif`,
    }));
    const picked = pickRandomManualSigDrafts(pool, 5);
    expect(picked).not.toBeNull();
    expect(picked).toHaveLength(5);
    const ids = new Set(picked!.map((d) => d.sourceSigId));
    expect(ids.size).toBe(5);
    for (const row of picked!) {
      expect(row.name).toMatch(/^시그\d$/);
      expect(Number(row.priceInput)).toBeGreaterThan(0);
    }
  });

  it("dedupes duplicate pool ids", () => {
    const pool = [
      { id: "x", name: "X", price: 5000, imageUrl: "" },
      { id: "x", name: "X dup", price: 9999, imageUrl: "" },
      { id: "y", name: "Y", price: 4000, imageUrl: "" },
      { id: "z", name: "Z", price: 3000, imageUrl: "" },
      { id: "w", name: "W", price: 2000, imageUrl: "" },
      { id: "v", name: "V", price: 1000, imageUrl: "" },
    ];
    const picked = pickRandomManualSigDrafts(pool, 5);
    expect(picked).toHaveLength(5);
    expect(new Set(picked!.map((d) => d.sourceSigId)).size).toBe(5);
  });
});
