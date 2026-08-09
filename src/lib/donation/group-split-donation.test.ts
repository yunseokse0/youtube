import { describe, expect, it } from "vitest";
import { defaultState, filterDonorsAfterSettlementReset, rebumpDonorsPastSettlementReset } from "@/lib/state";
import type { AppState, Member } from "@/types";
import {
  applyGroupSplitDonationToAppState,
  applyGroupSplitFromEventOnState,
  computeGroupSplitAmounts,
  countGroupSplitParts,
  hasGroupSplitSignatureForDonation,
  isGroupSplitDonationKeyword,
  isGroupSplitSourceDonor,
  previewGroupSplitDonation,
  resolveGroupSplitEligibleMembers,
  resolveGroupSplitFallbackMemberId,
  shouldAutoGroupSplitDonation,
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
    expect(applied.state.donors).toHaveLength(3);
    expect(applied.state.donors.some((d) => d.groupSplitSource)).toBe(true);
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

  it("detects 단체·단짠 keyword in donor name or message", () => {
    expect(isGroupSplitDonationKeyword({ donorName: "단체후원", message: "" })).toBe(true);
    expect(isGroupSplitDonationKeyword({ donorName: "홍길동", message: "단체짠!" })).toBe(true);
    expect(isGroupSplitDonationKeyword({ donorName: "홍길동", message: "단체 응원" })).toBe(true);
    expect(isGroupSplitDonationKeyword({ donorName: "단짠", message: "" })).toBe(true);
    expect(isGroupSplitDonationKeyword({ donorName: "홍길동", message: "단짠 ㅋㅋ" })).toBe(true);
    expect(isGroupSplitDonationKeyword({ donorName: "홍길동", message: "응원" })).toBe(false);
  });

  it("resolveGroupSplitFallbackMemberId prefers representative then rank 1", () => {
    const state: AppState = {
      ...defaultState(),
      members: [
        { id: "m1", name: "A", account: 5000, toon: 0, contribution: 5000 },
        { id: "m2", name: "B", account: 9000, toon: 0, contribution: 9000 },
        { id: "m3", name: "C", account: 1000, toon: 0, contribution: 1000 },
      ],
      memberPositions: { m3: "대표" },
    };
    expect(resolveGroupSplitFallbackMemberId(state)).toBe("m3");

    const noRep: AppState = {
      ...state,
      memberPositions: {},
    };
    expect(resolveGroupSplitFallbackMemberId(noRep)).toBe("m2");
  });

  it("shouldAutoGroupSplitDonation respects autoSplitOnKeyword setting", () => {
    expect(
      shouldAutoGroupSplitDonation(
        { donorName: "단체", message: "" },
        { excludedMemberIds: [], autoSplitOnKeyword: true }
      )
    ).toBe(true);
    expect(
      shouldAutoGroupSplitDonation(
        { donorName: "단체", message: "" },
        { excludedMemberIds: [], autoSplitOnKeyword: false }
      )
    ).toBe(false);
  });

  it("hasGroupSplitSignatureForDonation detects cross-id duplicate after auto split", () => {
    const state: AppState = {
      ...defaultState(),
      members: members(["A", "B"]),
    };
    const eventA = {
      id: "toonation:queue-1",
      provider: "toonation" as const,
      externalId: "queue-1",
      donorName: "엔젤",
      amount: 60000,
      at: new Date("2026-08-03T12:00:00.000Z").toISOString(),
      target: "toon" as const,
      status: "queued" as const,
    };
    const first = applyGroupSplitDonationToAppState(state, eventA);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const eventB = {
      ...eventA,
      id: "toon-1785761532559-60000-abc",
      externalId: "1785761532559-60000-abc",
    };
    expect(hasGroupSplitSignatureForDonation(first.state, eventB)).toBe(true);
    const second = applyGroupSplitFromEventOnState(first.state, eventB);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("duplicate");
  });

  it("applyGroupSplitFromEventOnState splits existing single row instead of adding duplicate", () => {
    const at = Date.now();
    const state: AppState = {
      ...defaultState(),
      members: members(["A", "B", "C"]),
      donors: [
        {
          id: "toonation:already-1",
          name: "엔젤",
          amount: 60000,
          memberId: "m1",
          at,
          target: "toon",
        },
      ],
    };
    const unmatchedEvent = {
      id: "toon-different-id",
      provider: "toonation" as const,
      externalId: "different-id",
      donorName: "엔젤",
      amount: 60000,
      at: new Date(at).toISOString(),
      target: "toon" as const,
      status: "queued" as const,
    };
    const applied = applyGroupSplitFromEventOnState(state, unmatchedEvent);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.donors).toHaveLength(3);
    expect(applied.state.donors.find((d) => d.id === "toonation:already-1")?.donationExcluded).toBe(true);
    const memberSum = applied.state.members.reduce((s, m) => s + (m.toon || 0), 0);
    expect(memberSum).toBe(60000);
  });

  it("splitExistingDonorInAppState marks source excluded and keeps member totals after settlement reset", () => {
    const at = Date.now() - 60_000;
    const state: AppState = {
      ...defaultState(),
      settlementResetAt: Date.now() - 30_000,
      members: members(["A", "B", "C"]),
      donors: [
        {
          id: "toonation:split-src",
          name: "익명2",
          amount: 300_000,
          memberId: "m1",
          at,
          target: "toon",
        },
      ],
    };
    const applied = splitExistingDonorInAppState(state, "toonation:split-src");
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const source = applied.state.donors.find((d) => d.id === "toonation:split-src");
    expect(source?.donationExcluded).toBe(true);
    expect(source?.groupSplitSource).toBe(true);
    expect(Number(source?.at)).toBeGreaterThanOrEqual(at);
    expect(applied.state.members.reduce((s, m) => s + (m.toon || 0), 0)).toBe(300_000);
    expect(
      filterDonorsAfterSettlementReset(
        rebumpDonorsPastSettlementReset(applied.state.donors, Number(state.settlementResetAt)),
        Number(state.settlementResetAt)
      ).length
    ).toBeGreaterThan(0);
  });
});
