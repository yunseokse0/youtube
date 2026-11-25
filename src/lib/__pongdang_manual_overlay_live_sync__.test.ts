import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import type { AppState, Member, ContributionLog } from "@/types";
import { buildOverlaySyncSignature } from "@/lib/overlay-sync-signature";
import {
  projectStateForGetPick,
  revisionForStatePick,
  STATE_PICK_OVERLAY,
  STATE_PICK_OVERLAY_DONORS,
} from "@/lib/state-api-pick";
import { membersWithOverlayDonationAggregate } from "@/lib/overlay-donation-aggregate";

describe("Pongdang manual live sync & overlay real-time update", () => {
  const baseMembers: Member[] = [
    { id: "m1", name: "진아", contribution: 0 },
    { id: "m2", name: "수린", contribution: 0 },
    { id: "m3", name: "채영", contribution: 0 },
  ];

  it("buildOverlaySyncSignature changes when pongdangManualContributions changes", () => {
    const s1: AppState = {
      ...defaultState(),
      members: baseMembers,
      pongdangManualContributions: {},
    };
    const s2: AppState = {
      ...s1,
      pongdangManualContributions: { m1: 50000 },
    };

    const sig1 = buildOverlaySyncSignature(s1);
    const sig2 = buildOverlaySyncSignature(s2);

    expect(sig1).not.toBe(sig2);
  });

  it("buildOverlaySyncSignature changes when a manual contribution log is added or delta toggled", () => {
    const s1: AppState = {
      ...defaultState(),
      members: baseMembers,
      contributionLogs: [],
    };
    const newLog: ContributionLog = {
      id: "cl_pd_1732560000000_abcd",
      memberId: "m1",
      donorName: "팬A",
      amount: 50000,
      delta: 1,
      note: "퐁당퐁당 수동 추가",
      at: 1732560000000,
    };
    const s2: AppState = {
      ...s1,
      contributionLogs: [newLog],
    };
    const s3: AppState = {
      ...s1,
      contributionLogs: [{ ...newLog, delta: -1, pongdangMinus: true }],
    };

    const sig1 = buildOverlaySyncSignature(s1);
    const sig2 = buildOverlaySyncSignature(s2);
    const sig3 = buildOverlaySyncSignature(s3);

    expect(sig1).not.toBe(sig2);
    expect(sig2).not.toBe(sig3);
  });

  it("buildOverlaySyncSignature changes when pongdangExcludedMemberIds changes", () => {
    const s1: AppState = {
      ...defaultState(),
      members: baseMembers,
      pongdangExcludedMemberIds: [],
    };
    const s2: AppState = {
      ...s1,
      pongdangExcludedMemberIds: ["m3"],
    };

    const sig1 = buildOverlaySyncSignature(s1);
    const sig2 = buildOverlaySyncSignature(s2);

    expect(sig1).not.toBe(sig2);
  });

  it("revisionForStatePick tracks contributionLogs timestamp and pongdangResetAt so OBS does not get stuck on 304", () => {
    const s1: AppState = {
      ...defaultState(),
      updatedAt: 1000,
      membersRosterUpdatedAt: 1000,
      donorRankingsUpdatedAt: 1000,
      pongdangResetAt: 0,
      contributionLogs: [],
    };
    expect(revisionForStatePick(s1, STATE_PICK_OVERLAY_DONORS)).toBe(1000);

    // pongdangResetAt bumps revision
    const s2: AppState = {
      ...s1,
      pongdangResetAt: 5000,
    };
    expect(revisionForStatePick(s2, STATE_PICK_OVERLAY_DONORS)).toBe(5000);

    // contributionLogs with newer timestamp bumps revision
    const s3: AppState = {
      ...s1,
      contributionLogs: [
        {
          id: "cl_pd_1",
          memberId: "m1",
          amount: 10000,
          delta: 1,
          at: 9000,
        },
      ],
    };
    expect(revisionForStatePick(s3, STATE_PICK_OVERLAY_DONORS)).toBe(9000);
  });

  it("projectStateForGetPick delivers pongdangManualContributions, pongdangExcludedMemberIds, and contributionLogs", () => {
    const state: AppState = {
      ...defaultState(),
      members: baseMembers,
      pongdangResetAt: 3000,
      pongdangManualMode: true,
      pongdangManualContributions: { m1: 50000, m2: -10000 },
      pongdangExcludedMemberIds: ["m3"],
      contributionLogs: [
        {
          id: "cl_pd_test",
          memberId: "m1",
          amount: 20000,
          delta: 1,
          at: 4000,
        },
      ],
    };

    const out = projectStateForGetPick(state, STATE_PICK_OVERLAY_DONORS) as Record<string, unknown>;
    expect(out.pongdangManualContributions).toEqual({ m1: 50000, m2: -10000 });
    expect(out.pongdangExcludedMemberIds).toEqual(["m3"]);
    expect(out.pongdangManualMode).toBe(true);
    expect(out.pongdangResetAt).toBe(3000);
    expect(out.contributionLogs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "cl_pd_test", amount: 20000 })])
    );
  });

  it("membersWithOverlayDonationAggregate reflects direct manual and manual log in real-time", () => {
    const state: AppState = {
      ...defaultState(),
      members: baseMembers,
      pongdangManualMode: true,
      pongdangManualContributions: { m1: 50000 },
      contributionLogs: [
        {
          id: "cl_pd_1",
          memberId: "m2",
          amount: 30000,
          delta: 1,
          at: 1000,
          isPongdang: true,
        } as any,
      ],
    };

    const aggregated = membersWithOverlayDonationAggregate(
      state,
      state.members,
      null,
      { isPongdangPopup: true, day777Calc: true }
    );

    const m1 = aggregated.find((m) => m.id === "m1");
    const m2 = aggregated.find((m) => m.id === "m2");
    const m3 = aggregated.find((m) => m.id === "m3");

    expect(m1?.contribution).toBe(50000);
    expect(m2?.contribution).toBe(30000);
    expect(m3?.contribution).toBe(0);
  });

  it("membersWithOverlayDonationAggregate supports negative manual adjustments", () => {
    const state: AppState = {
      ...defaultState(),
      members: baseMembers,
      pongdangManualMode: true,
      pongdangManualContributions: { m1: -50000 },
    };

    const aggregated = membersWithOverlayDonationAggregate(
      state,
      state.members,
      null,
      { isPongdangPopup: true, day777Calc: true }
    );

    const m1 = aggregated.find((m) => m.id === "m1");
    expect(m1?.contribution).toBe(-50000);
  });
});
