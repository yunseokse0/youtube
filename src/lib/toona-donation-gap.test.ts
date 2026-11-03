import { describe, expect, it } from "vitest";
import {
  bareDonationId,
  donorBareIdSet,
  findMissingToonaRows,
} from "@/lib/toona-donation-gap";
import type { ToonaHubDonationApiRow } from "@/lib/toona-hub-donation-map";

function row(partial: Partial<ToonaHubDonationApiRow> & { id: string }): ToonaHubDonationApiRow {
  return {
    nickname: "테스터",
    amount: 10000,
    channel: "account",
    createdAt: "2026-11-03T12:00:00+09:00",
    ...partial,
  };
}

describe("toona-donation-gap", () => {
  it("strips bank/toonation prefixes to the same bare id", () => {
    expect(bareDonationId("bank:din:abc123")).toBe("abc123");
    expect(bareDonationId("toonation:din:abc123")).toBe("abc123");
    expect(bareDonationId("ingest:bank:din:abc123")).toBe("abc123");
  });

  it("builds donor bare id set from ledger rows", () => {
    const set = donorBareIdSet([
      { id: "bank:din:aaa" },
      { id: "toonation:din:bbb", externalId: "bbb" },
    ]);
    expect(set.has("aaa")).toBe(true);
    expect(set.has("bbb")).toBe(true);
  });

  it("flags toona rows missing from the settlement ledger", () => {
    const donors = donorBareIdSet([{ id: "bank:din:kept1" }]);
    const result = findMissingToonaRows({
      rows: [
        row({ id: "kept1", channel: "account", amount: 1000 }),
        row({ id: "miss1", channel: "account", amount: 5000, nickname: "누락자" }),
      ],
      donorIds: donors,
      linkedAt: 1,
      settlementResetAt: 0,
      intentionalDonationClearAt: 0,
      importFromMs: 0,
    });
    expect(result.matched).toBe(1);
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]?.bareId).toBe("miss1");
    expect(result.missing[0]?.amount).toBe(5000);
  });

  it("discards pre-reset rows instead of counting them missing", () => {
    const resetAt = Date.parse("2026-11-03T10:00:00+09:00");
    const result = findMissingToonaRows({
      rows: [
        row({
          id: "old1",
          createdAt: "2026-11-03T09:00:00+09:00",
          amount: 9000,
        }),
        row({
          id: "new1",
          createdAt: "2026-11-03T11:00:00+09:00",
          amount: 8000,
        }),
      ],
      donorIds: new Set(),
      linkedAt: 1,
      settlementResetAt: resetAt,
      intentionalDonationClearAt: 0,
      importFromMs: resetAt,
    });
    expect(result.discardedReset).toBe(1);
    expect(result.missing.map((m) => m.bareId)).toEqual(["new1"]);
  });
});
