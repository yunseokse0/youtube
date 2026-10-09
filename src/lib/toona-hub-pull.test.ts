import { describe, expect, it } from "vitest";
import {
  buildToonaDonationsPullUrl,
  collectToonaDonationsSequentially,
  lastToonaDonationPullId,
  nextToonaDonationPullAfter,
  resolveToonaDonationPullAfter,
  resolveToonaDonationPullFromMs,
  TOONA_DONATION_PULL_PAGE_SIZE,
} from "@/lib/toona-hub-pull";

describe("toona-hub-pull", () => {
  it("does not cut the ledger by link time or settlement reset", () => {
    const linkedAt = Date.parse("2026-09-23T09:00:00+09:00");
    const reset = Date.parse("2026-10-08T01:07:55+09:00");
    expect(resolveToonaDonationPullFromMs({ linkedAt })).toBe(0);
    expect(
      resolveToonaDonationPullFromMs({
        linkedAt,
        persistedFloorAt: reset,
        intentionalClearAtMs: reset,
      })
    ).toBe(0);
  });

  it("continues the cursor on the same floor and drops it when the floor moves", () => {
    expect(resolveToonaDonationPullAfter({ fromMs: 100, savedFromMs: 100, savedAfter: "abc" })).toBe("abc");
    expect(resolveToonaDonationPullAfter({ fromMs: 200, savedFromMs: 100, savedAfter: "abc" })).toBe("");
    expect(resolveToonaDonationPullAfter({ fromMs: 100, savedFromMs: 100, savedAfter: "  " })).toBe("");
    expect(lastToonaDonationPullId([{ id: "a" }, { id: "" }, { id: "c" }])).toBe("c");
  });

  it("builds asc+fromMs+after URL instead of page=1&limit=50", () => {
    const url = buildToonaDonationsPullUrl({
      baseUrl: "http://13.125.221.195:4000/",
      streamKey: "sk_test",
      fromMs: 1790154000000,
      after: "cmudvlaqy00k75juzetoe2gi5",
    });
    expect(url).toContain("/api/donations/sk_test?");
    expect(url).toContain("sort=asc");
    expect(url).toContain("fromMs=1790154000000");
    expect(url).toContain("after=cmudvlaqy00k75juzetoe2gi5");
    expect(url).toContain(`limit=${TOONA_DONATION_PULL_PAGE_SIZE}`);
    expect(url).not.toContain("page=1");
    expect(url).not.toContain("limit=50");
  });

  it("reproduces the four missed donations after a 5,000 cap, then brings them in order", () => {
    const prior = Array.from({ length: 5200 }, (_, i) => ({ id: `old${i}` }));
    const missed = [
      { id: "chun-17000" },
      { id: "jaki-18000" },
      { id: "rimo-70500" },
      { id: "seung-600000" },
    ];
    const ledger = [...prior, ...missed];
    const broken = collectToonaDonationsSequentially({
      ledger,
      pageSize: TOONA_DONATION_PULL_PAGE_SIZE,
      maxPagesPerCycle: 25,
      persistCursor: false,
    });
    expect(broken.ids).not.toEqual(expect.arrayContaining(missed.map((row) => row.id)));

    const fixed = collectToonaDonationsSequentially({
      ledger,
      pageSize: TOONA_DONATION_PULL_PAGE_SIZE,
      maxPagesPerCycle: 25,
      persistCursor: true,
    });
    expect(fixed.ids.slice(-4)).toEqual(missed.map((row) => row.id));
    expect(fixed.ids).toEqual(ledger.map((row) => row.id));
  });

  it("reproduces the 5,000 cap miss and then catches the rest in order", () => {
    const ledger = Array.from({ length: 5204 }, (_, i) => ({ id: `d${i}` }));
    const broken = collectToonaDonationsSequentially({
      ledger,
      pageSize: TOONA_DONATION_PULL_PAGE_SIZE,
      maxPagesPerCycle: 25,
      persistCursor: false,
    });
    expect(broken.ids).toHaveLength(TOONA_DONATION_PULL_PAGE_SIZE * 25);
    expect(broken.ids).not.toContain("d5200");
    expect(broken.reachedEnd).toBe(false);

    const fixed = collectToonaDonationsSequentially({
      ledger,
      pageSize: TOONA_DONATION_PULL_PAGE_SIZE,
      maxPagesPerCycle: 25,
      persistCursor: true,
    });
    expect(fixed.reachedEnd).toBe(true);
    expect(fixed.ids).toEqual(ledger.map((row) => row.id));
    expect(fixed.ids.slice(-4)).toEqual(["d5200", "d5201", "d5202", "d5203"]);
    expect(fixed.cycles).toBeGreaterThan(1);
  });

  it("continues cursor until a short page", () => {
    const full = Array.from({ length: TOONA_DONATION_PULL_PAGE_SIZE }, (_, i) => ({ id: `id${i}` }));
    expect(nextToonaDonationPullAfter(full, TOONA_DONATION_PULL_PAGE_SIZE)).toBe(
      `id${TOONA_DONATION_PULL_PAGE_SIZE - 1}`
    );
    expect(nextToonaDonationPullAfter(full.slice(0, 3), TOONA_DONATION_PULL_PAGE_SIZE)).toBeNull();
    expect(nextToonaDonationPullAfter([], TOONA_DONATION_PULL_PAGE_SIZE)).toBeNull();
  });
});
