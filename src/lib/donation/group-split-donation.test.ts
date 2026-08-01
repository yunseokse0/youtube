import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import type { AppState, Member } from "@/types";
import {
  applyGroupSplitDonationToAppState,
  computeGroupSplitAmounts,
  countGroupSplitParts,
  isGroupSplitSourceDonor,
  previewGroupSplitDonation,
  resolveGroupSplitEligibleMembers,
  splitExistingDonorInAppState,
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
  it("excludes operating member and preserves total with remainder on first member", () => {
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
    expect(preview.remainderToFirst).toBe(1);
    expect(computeGroupSplitAmounts(100001, 4)).toEqual([25001, 25000, 25000, 25000]);
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
    expect(computeGroupSplitAmounts(90000, 3)).toEqual([30000, 30000, 30000]);
  });

  it("creates split donor rows whose amounts sum to the original total", () => {
    const state: AppState = {
      ...defaultState(),
      members: members(["A", "B"]),
    };
    const applied = applyGroupSplitDonationToAppState(state, {
      id: "toonation:test-1",
      provider: "toonation",
      externalId: "ext-1",
      donorName: "후원자",
      amount: 100001,
      at: new Date().toISOString(),
      target: "toon",
      status: "queued",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.donors).toHaveLength(2);
    const sum = applied.donors.reduce((s, d) => s + d.amount, 0);
    expect(sum).toBe(100001);
    expect(applied.donors[0]!.amount).toBe(50001);
    expect(applied.donors[1]!.amount).toBe(50000);
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

  it("splitExistingDonorInAppState keeps source row excluded and adds member-count split rows", () => {
    const state: AppState = {
      ...defaultState(),
      members: members(["A", "B", "C"]),
      donors: [
        {
          id: "toonation:orig-1",
          name: "후원자",
          amount: 100003,
          memberId: "m1",
          at: Date.now(),
          target: "toon",
        },
      ],
    };
    const applied = splitExistingDonorInAppState(state, "toonation:orig-1");
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.donors).toHaveLength(3);
    expect(applied.donors.every((d) => d.groupSplit)).toBe(true);
    expect(applied.donors.map((d) => d.id)).toEqual([
      "toonation:orig-1:split:m1",
      "toonation:orig-1:split:m2",
      "toonation:orig-1:split:m3",
    ]);
    const sum = applied.donors.reduce((s, d) => s + d.amount, 0);
    expect(sum).toBe(100003);
    expect(applied.state.donors).toHaveLength(4);
    const source = applied.state.donors.find((d) => d.id === "toonation:orig-1");
    expect(source?.donationExcluded).toBe(true);
    expect(source?.groupSplitSource).toBe(true);
    expect(applied.donors[0]!.memberId).toBe("m1");
    expect(applied.donors[0]!.amount).toBe(33335);
    expect(applied.state.members.find((m) => m.id === "m1")?.toon).toBe(33335);
    expect(applied.state.members.find((m) => m.id === "m2")?.toon).toBe(33334);
    expect(countGroupSplitParts(applied.state, "toonation:orig-1")).toBe(3);
    const sourceDonor = applied.state.donors.find((d) => d.id === "toonation:orig-1")!;
    expect(isGroupSplitSourceDonor(applied.state, sourceDonor)).toBe(true);
  });
});
