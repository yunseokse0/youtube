import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import type { AppState, Member } from "@/types";
import {
  applyGroupSplitDonationToAppState,
  previewGroupSplitDonation,
  resolveGroupSplitEligibleMembers,
} from "./group-split-donation";

function members(names: string[]): Member[] {
  return names.map((name, idx) => ({
    id: `m${idx + 1}`,
    name,
    account: 0,
    toon: 0,
    contribution: 0,
  }));
}

describe("group split donation", () => {
  it("excludes operating member and splits evenly with floor remainder dropped", () => {
    const state: AppState = {
      ...defaultState(),
      members: [
        ...members(["A", "B", "C", "D"]),
        { id: "op", name: "운영비", account: 0, toon: 0, contribution: 0, operating: true },
      ],
    };
    const preview = previewGroupSplitDonation(state, 100001);
    expect(preview.eligibleMembers.map((m) => m.name)).toEqual(["A", "B", "C", "D"]);
    expect(preview.sharePerMember).toBe(25000);
    expect(preview.remainderDropped).toBe(1);
  });

  it("respects excludedMemberIds from settings", () => {
    const state: AppState = {
      ...defaultState(),
      members: members(["A", "B", "C", "D"]),
      groupSplitDonationSettings: { excludedMemberIds: ["m2"] },
    };
    const eligible = resolveGroupSplitEligibleMembers(state, state.groupSplitDonationSettings);
    expect(eligible.map((m) => m.id)).toEqual(["m1", "m3", "m4"]);
    const preview = previewGroupSplitDonation(state, 90000, state.groupSplitDonationSettings);
    expect(preview.sharePerMember).toBe(30000);
  });

  it("creates split donor rows for each eligible member", () => {
    const state: AppState = {
      ...defaultState(),
      members: members(["A", "B"]),
    };
    const applied = applyGroupSplitDonationToAppState(state, {
      id: "toonation:test-1",
      provider: "toonation",
      externalId: "ext-1",
      donorName: "후원자",
      amount: 100000,
      at: new Date().toISOString(),
      target: "toon",
      status: "queued",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.donors).toHaveLength(2);
    expect(applied.donors.every((d) => d.amount === 50000)).toBe(true);
    expect(applied.state.members.find((m) => m.id === "m1")?.toon).toBe(50000);
    expect(applied.state.members.find((m) => m.id === "m2")?.toon).toBe(50000);
  });

  it("rejects duplicate apply for same event id", () => {
    const state: AppState = {
      ...defaultState(),
      members: members(["A", "B"]),
    };
    const event = {
      id: "toonation:dup-1",
      provider: "toonation" as const,
      externalId: "ext-dup",
      donorName: "후원자",
      amount: 100000,
      at: new Date().toISOString(),
      target: "toon" as const,
      status: "queued" as const,
    };
    const first = applyGroupSplitDonationToAppState(state, event);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyGroupSplitDonationToAppState(first.state, event);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("duplicate");
  });

  it("fails when per-member share floors to zero", () => {
    const state: AppState = {
      ...defaultState(),
      members: members(["A", "B", "C", "D", "E"]),
    };
    const applied = applyGroupSplitDonationToAppState(state, {
      id: "toonation:small-1",
      provider: "toonation",
      externalId: "ext-small",
      donorName: "후원자",
      amount: 4,
      at: new Date().toISOString(),
      target: "toon",
      status: "queued",
    });
    expect(applied.ok).toBe(false);
    if (applied.ok) return;
    expect(applied.reason).toBe("amount_too_small");
  });

  it("defaults to all non-operating members when exclude list is empty", () => {
    const state: AppState = {
      ...defaultState(),
      members: [...members(["A", "B", "C"]), { id: "op", name: "운영비", account: 0, toon: 0, contribution: 0, operating: true }],
      groupSplitDonationSettings: { excludedMemberIds: [] },
    };
    const eligible = resolveGroupSplitEligibleMembers(state, state.groupSplitDonationSettings);
    expect(eligible.map((m) => m.name)).toEqual(["A", "B", "C"]);
  });
});
