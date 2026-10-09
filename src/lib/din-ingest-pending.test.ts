import { describe, expect, it } from "vitest";
import type { DonationEvent } from "@/lib/donation/types";
import {
  offerPendingIngest,
  resetDinIngestBatchQueueForTests,
  takeBatch,
} from "./din-ingest-pending";

function evt(id: string, atMs: number): DonationEvent {
  return {
    id,
    provider: "bank",
    externalId: id.replace(/^bank:din:/, ""),
    donorName: `연사_${id.slice(-4)}`,
    amount: 1000,
    at: new Date(atMs).toISOString(),
    status: "queued",
    target: "account",
  };
}

describe("offerPendingIngest", () => {
  it("accepts more than 8,000 unique donations without rejecting, and skips the same id", () => {
    resetDinIngestBatchQueueForTests();
    const at = 10_000;
    let lastDepth = 0;
    for (let i = 0; i < 20_000; i += 1) {
      const out = offerPendingIngest("din", "din", evt(`bank:din:burst-${i}`, at + i));
      expect(out.ok).toBe(true);
      expect(out.duplicateQueued).toBe(false);
      lastDepth = out.depth;
    }
    expect(lastDepth).toBe(20_000);
    const dup = offerPendingIngest("din", "din", evt("bank:din:burst-0", at));
    expect(dup.ok).toBe(true);
    expect(dup.duplicateQueued).toBe(true);
    expect(dup.depth).toBe(20_000);
    const first = takeBatch("din");
    expect(first).toHaveLength(200);
    expect(first[0]?.event.id).toBe("bank:din:burst-0");
    resetDinIngestBatchQueueForTests();
  });
});
