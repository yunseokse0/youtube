import { describe, expect, it } from "vitest";
import {
  buildToonaDonationsPullUrl,
  lastToonaDonationPullId,
  nextToonaDonationPullAfter,
  resolveToonaDonationPullAfter,
  resolveToonaDonationPullFromMs,
  TOONA_DONATION_PULL_PAGE_SIZE,
} from "@/lib/toona-hub-pull";

describe("toona-hub-pull", () => {
  it("pulls from linkedAt-1h unless reset is later", () => {
    const linkedAt = Date.parse("2026-09-23T09:00:00+09:00");
    expect(resolveToonaDonationPullFromMs({ linkedAt })).toBe(linkedAt - 60 * 60 * 1000);
    const clear = linkedAt + 10 * 60 * 1000;
    expect(resolveToonaDonationPullFromMs({ linkedAt, intentionalClearAtMs: clear })).toBe(clear);
  });

  it("keeps the saved floor across a later relink and raises it on settlement reset", () => {
    const linkedAt = Date.parse("2026-10-07T09:00:00+09:00");
    const floor = linkedAt - 3 * 60 * 60 * 1000;
    const relink = Date.parse("2026-10-07T22:30:00+09:00");
    expect(resolveToonaDonationPullFromMs({ linkedAt: relink, persistedFloorAt: floor })).toBe(floor);
    const reset = Date.parse("2026-10-08T01:07:55+09:00");
    expect(
      resolveToonaDonationPullFromMs({
        linkedAt: relink,
        persistedFloorAt: floor,
        intentionalClearAtMs: reset,
      })
    ).toBe(reset);
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

  it("continues cursor until a short page", () => {
    const full = Array.from({ length: TOONA_DONATION_PULL_PAGE_SIZE }, (_, i) => ({ id: `id${i}` }));
    expect(nextToonaDonationPullAfter(full, TOONA_DONATION_PULL_PAGE_SIZE)).toBe(
      `id${TOONA_DONATION_PULL_PAGE_SIZE - 1}`
    );
    expect(nextToonaDonationPullAfter(full.slice(0, 3), TOONA_DONATION_PULL_PAGE_SIZE)).toBeNull();
    expect(nextToonaDonationPullAfter([], TOONA_DONATION_PULL_PAGE_SIZE)).toBeNull();
  });
});
