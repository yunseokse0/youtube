import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import { applyDonationToAppState } from "./apply-donation-state";
import type { DonationEvent } from "./types";

describe("applyDonationToAppState", () => {
  it("credits member toon and records alert donor name for rankings", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 100, contribution: 100 }],
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
    expect(result.state.members[0]?.toon).toBe(5100);
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
