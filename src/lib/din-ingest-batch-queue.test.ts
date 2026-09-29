import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import type { DonationEvent } from "@/lib/donation/types";
import type { AppState, Member } from "@/types";
import {
  eventMatchesDonorLedger,
  foldIngestEventsIntoState,
  shouldDiscardIngestEventForReset,
} from "./din-ingest-batch-fold";

function member(): Member {
  return {
    id: "m1",
    name: "테스터멤버",
    account: 0,
    toon: 0,
    contribution: 0,
    operating: false,
  } as Member;
}

function baseState(extra?: Partial<AppState>): AppState {
  return {
    ...defaultState(),
    members: [member()],
    donors: [],
    ...extra,
  };
}

function evt(id: string, atMs: number, extra?: Partial<DonationEvent>): DonationEvent {
  return {
    id,
    provider: "bank",
    externalId: id.replace(/^bank:din:/, ""),
    donorName: `연사_${id.slice(-4)}`,
    amount: 1000,
    at: new Date(atMs).toISOString(),
    status: "queued",
    target: "account",
    memberId: "m1",
    manualAssignMemberId: "m1",
    ...extra,
  };
}

describe("eventMatchesDonorLedger", () => {
  it("finds a hub log id when the ledger stored bank:din:<cuid>", () => {
    const event = evt("bank:toona:cmumgtnxp050g5jdim6kc0vlj", 10_000, {
      externalId: "cmumgtnxp050g5jdim6kc0vlj",
      amount: 34000,
    });
    expect(
      eventMatchesDonorLedger(event, [
        { id: "bank:din:cmumgtnxp050g5jdim6kc0vlj", amount: 34000 },
      ])
    ).toBe(true);
  });

  it("is false when neither the uid nor the external id is in the ledger", () => {
    const event = evt("bank:din:cmumgtnxp050g5jdim6kc0vlj", 10_000, {
      externalId: "cmumgtnxp050g5jdim6kc0vlj",
      amount: 34000,
    });
    expect(
      eventMatchesDonorLedger(event, [
        { id: "bank:din:cmumgto5a050m5jdiwu872g7c", externalId: "cmumgto5a050m5jdiwu872g7c", amount: 35000 },
      ])
    ).toBe(false);
  });
});

describe("shouldDiscardIngestEventForReset", () => {
  it("keeps events after settlementResetAt", () => {
    const e = evt("bank:din:a", 2_000);
    expect(shouldDiscardIngestEventForReset(e, 1_000, 0)).toBe(false);
  });

  it("discards events before reset stamp", () => {
    const e = evt("bank:din:a", 1_000);
    expect(shouldDiscardIngestEventForReset(e, 2_000, 0)).toBe(true);
  });
});

describe("foldIngestEventsIntoState", () => {
  it("applies unique events in memory so 정산표 저장 전에 중복이 걸러진다", () => {
    const a = evt("bank:din:one", 10_000);
    const dup = evt("bank:din:one", 10_100);
    const b = evt("bank:din:two", 10_200);
    const folded = foldIngestEventsIntoState(baseState(), [a, dup, b]);
    expect(folded.applied.map((x) => x.id)).toEqual(["bank:din:one", "bank:din:two"]);
    expect(folded.duplicates).toBe(1);
    expect(folded.state.donors?.filter((d) => !d.donationExcluded).length).toBe(2);
  });

  it("drops events older than settlementResetAt before they reach donors", () => {
    const oldOne = evt("bank:din:old", 1_000);
    const fresh = evt("bank:din:new", 9_000);
    const folded = foldIngestEventsIntoState(
      baseState({ settlementResetAt: 5_000 }),
      [oldOne, fresh]
    );
    expect(folded.discardedReset).toBe(1);
    expect(folded.applied.map((x) => x.id)).toEqual(["bank:din:new"]);
    expect((folded.state.donors || []).some((d) => d.id === "bank:din:old")).toBe(false);
  });
});
