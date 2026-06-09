import { describe, expect, it } from "vitest";
import {
  filterDonationQueueByPlayer,
  mapPlayerAlertQueueItems,
  mergePlayerAlertDisplayItems,
  ssePayloadToQueueItem,
} from "@/lib/donation/player-alert-queue";
import type { DonationEvent } from "@/lib/donation/types";

function evt(partial: Partial<DonationEvent> & Pick<DonationEvent, "id" | "donorName" | "amount">): DonationEvent {
  return {
    provider: "toonation",
    externalId: partial.id,
    at: partial.at || new Date().toISOString(),
    status: "queued",
    ...partial,
  };
}

describe("filterDonationQueueByPlayer", () => {
  const items = [
    evt({ id: "a", donorName: "A", amount: 1000, playerName: "루나" }),
    evt({ id: "b", donorName: "B", amount: 2000, playerName: "솔라" }),
    evt({ id: "c", donorName: "C", amount: 3000 }),
  ];

  it("returns all when filter empty", () => {
    expect(filterDonationQueueByPlayer(items, "")).toHaveLength(3);
  });

  it("filters by player name", () => {
    const filtered = filterDonationQueueByPlayer(items, "루나");
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe("a");
  });

  it("excludes items without player when filter set", () => {
    expect(filterDonationQueueByPlayer(items, "솔라").map((x) => x.id)).toEqual(["b"]);
  });
});

describe("mapPlayerAlertQueueItems", () => {
  it("includes toon and account donations from queue", () => {
    const items = [
      evt({ id: "a", donorName: "A", amount: 1000, playerName: "루나", target: "toon" }),
      evt({ id: "b", donorName: "B", amount: 2000, provider: "bank", target: "account" }),
      evt({ id: "c", donorName: "C", amount: 3000, target: "account" }),
    ];
    expect(mapPlayerAlertQueueItems(items).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

describe("ssePayloadToQueueItem", () => {
  it("maps alert payload to queue item", () => {
    const item = ssePayloadToQueueItem({
      type: "player_donation_alert",
      userId: "finalent",
      eventId: "toonation:1",
      donorName: "테스트",
      playerName: "루나",
      amount: 5000,
      message: "안녕",
      at: "2026-01-01T00:00:00.000Z",
    });
    expect(item?.id).toBe("toonation:1");
    expect(item?.donorName).toBe("테스트");
    expect(item?.playerName).toBe("루나");
  });
});

describe("mergePlayerAlertDisplayItems", () => {
  it("keeps live-only items for minLiveMs after queue removal", () => {
    const now = 1_000_000;
    const live = new Map([
      [
        "gone",
        {
          item: {
            id: "gone",
            at: "2026-01-01T00:00:00.000Z",
            donorName: "A",
            amount: 1000,
            message: "",
          },
          seenAt: now - 5_000,
        },
      ],
    ]);
    expect(mergePlayerAlertDisplayItems([], live, 60_000, now).map((x) => x.id)).toEqual(["gone"]);
    expect(mergePlayerAlertDisplayItems([], live, 60_000, now + 60_001)).toEqual([]);
  });

  it("prefers queue item over live snapshot", () => {
    const live = new Map([
      [
        "x",
        {
          item: { id: "x", at: "2026-01-01T00:00:00.000Z", donorName: "old", amount: 1, message: "" },
          seenAt: Date.now(),
        },
      ],
    ]);
    const queue = [
      { id: "x", at: "2026-01-01T00:00:00.000Z", donorName: "new", amount: 2, message: "m" },
    ];
    expect(mergePlayerAlertDisplayItems(queue, live)[0]?.donorName).toBe("new");
  });
});
