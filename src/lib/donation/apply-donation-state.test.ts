import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import {
  applyDonationToAppState,
  dedupeDonorRows,
  revertDonationFromAppState,
  syncMemberTotalsFromDonors,
} from "./apply-donation-state";
import type { DonationEvent } from "./types";

describe("applyDonationToAppState", () => {
  it("credits member toon and records alert donor name for rankings", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    const event: DonationEvent = {
      id: "toonation:1",
      provider: "toonation",
      externalId: "1",
      donorName: "배지은",
      playerName: "피자",
      amount: 5000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.toon).toBe(5000);
    expect(result.state.donors?.[0]?.name).toBe("배지은");
  });

  it("auto-assigns member when toon has no player", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    const event: DonationEvent = {
      id: "toonation:2",
      provider: "toonation",
      externalId: "2",
      donorName: "배지은",
      amount: 3000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.toon).toBe(3000);
    expect(result.state.donors?.[0]?.memberAutoAssigned).toBe(true);
  });

  it("auto-assigns account donation when player is missing", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    const event: DonationEvent = {
      id: "toonation:4",
      provider: "toonation",
      externalId: "4",
      donorName: "햇님",
      amount: 2000,
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.account).toBe(2000);
    expect(result.state.donors?.[0]?.memberAutoAssigned).toBe(true);
  });

  it("manualAssignMemberId credits selected member and keeps donor display name", () => {
    const state = {
      ...defaultState(),
      members: [
        { id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "콜라", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [],
    };
    const event: DonationEvent = {
      id: "toonation:manual:1",
      provider: "toonation",
      externalId: "manual-1",
      donorName: "마이웨이",
      amount: 5000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
      manualAssignMemberId: "m2",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "m2")?.toon).toBe(5000);
    expect(result.state.members.find((m) => m.id === "m1")?.toon).toBe(0);
    expect(result.state.donors?.[0]?.name).toBe("마이웨이");
    expect(result.state.donors?.[0]?.memberId).toBe("m2");
  });

  it("allows separate weak-id donations with same donor·금액 within 30s", () => {
    const at = new Date("2026-06-11T13:55:00.000Z").toISOString();
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 1000, contribution: 1000 }],
      donors: [
        {
          id: "toonation:1718100000000-1000",
          name: "이니이니",
          amount: 1000,
          memberId: "m1",
          at: Date.parse(at),
          target: "toon" as const,
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:1718100000456-1000",
      provider: "toonation",
      externalId: "1718100000456-1000",
      donorName: "이니이니",
      amount: 1000,
      at,
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.toon).toBe(2000);
    expect(result.state.donors).toHaveLength(2);
  });

  it("syncMemberTotalsFromDonors sums each weak-id donor row", () => {
    const at = 1_718_100_000_000;
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 9999, contribution: 9999 }],
      donors: [
        { id: "toonation:1718100000000-1000", name: "이니이니", amount: 1000, memberId: "m1", at, target: "toon" as const },
        { id: "toonation:1718100000123-1000", name: "이니이니", amount: 1000, memberId: "m1", at: at + 2000, target: "toon" as const },
      ],
    };
    const synced = syncMemberTotalsFromDonors(state);
    expect(synced.members[0]?.toon).toBe(2000);
    expect(dedupeDonorRows(state.donors || [])).toHaveLength(2);
  });

  it("rejects duplicate when queue review id differs from stored donor id", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 5000, contribution: 5000 }],
      donors: [
        {
          id: "toonation:99",
          name: "배지은",
          amount: 5000,
          memberId: "m1",
          at: Date.now(),
          target: "toon" as const,
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:99::review",
      provider: "toonation",
      externalId: "99",
      donorName: "배지은",
      amount: 5000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
      alreadyApplied: true,
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate");
  });

  it("allows consecutive identical toonation donations with different external ids", () => {
    const at = Date.now();
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 1000, contribution: 1000 }],
      donors: [
        {
          id: "toonation:donation-1",
          name: "익명",
          amount: 1000,
          memberId: "m1",
          at,
          target: "toon" as const,
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:donation-2",
      provider: "toonation",
      externalId: "donation-2",
      donorName: "익명",
      amount: 1000,
      at: new Date(at + 500).toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.toon).toBe(2000);
    expect(result.state.donors).toHaveLength(2);
  });

  it("rejects near-duplicate toonation with same reliable external within 5s", () => {
    const at = Date.now();
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 1000, contribution: 1000 }],
      donors: [
        {
          id: "toonation:donation-abc",
          name: "익명",
          amount: 1000,
          memberId: "m1",
          at,
          target: "account" as const,
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:donation-abc::review",
      provider: "toonation",
      externalId: "donation-abc",
      donorName: "익명",
      amount: 1000,
      at: new Date(at + 500).toISOString(),
      status: "queued",
      target: "account",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate");
  });

  it("revertDonationFromAppState removes donor and updates rankings revision", () => {
    const at = Date.now();
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 5000, contribution: 5000 }],
      donors: [
        {
          id: "toonation:99",
          name: "배지은",
          amount: 5000,
          memberId: "m1",
          at,
          target: "toon" as const,
        },
      ],
      donorRankingsUpdatedAt: at - 1000,
    };
    const next = revertDonationFromAppState(state, "toonation:99");
    expect(next?.donors).toHaveLength(0);
    expect(next?.members[0]?.toon).toBe(0);
    expect(Number(next?.donorRankingsUpdatedAt || 0)).toBeGreaterThan(at - 1000);
  });

  it("syncMemberTotalsFromDonors aligns member columns with donor rows", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 61000, contribution: 61000 }],
      donors: [
        {
          id: "toonation:1",
          name: "두근거",
          amount: 51000,
          memberId: "m1",
          at: Date.now(),
          target: "toon" as const,
        },
        {
          id: "toonation:2",
          name: "두근거",
          amount: 10000,
          memberId: "m1",
          at: Date.now(),
          target: "toon" as const,
        },
      ],
    };
    const next = syncMemberTotalsFromDonors(state);
    expect(next.members[0]?.toon).toBe(61000);
    expect(next.members[0]?.account).toBe(0);
  });

  it("credits account column for 계좌 format", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    const event: DonationEvent = {
      id: "toonation:3",
      provider: "toonation",
      externalId: "3",
      donorName: "햇님",
      playerName: "피자",
      amount: 3000,
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.account).toBe(3000);
    expect(result.state.donors?.[0]?.target).toBe("account");
  });
});
