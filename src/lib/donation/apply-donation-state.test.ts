import { describe, expect, it } from "vitest";
import { normalizeHighSocietySettings } from "@/lib/high-society";
import { defaultState } from "@/lib/state";
import {
  applyDonationToAppState,
  dedupeDonorRows,
  mergeDonorRowFields,
  purgeDonorsForMemberRoster,
  reassignDonorMemberInAppState,
  repairMemberTotalsForDonorRoster,
  revertDonationFromAppState,
  syncMemberTotalsFromDonors,
  updateDonorMessageInAppState,
} from "./apply-donation-state";
import type { DonationEvent } from "./types";

describe("purgeDonorsForMemberRoster", () => {
  it("removes donors for deleted members and keeps remaining totals", () => {
    const members = [
      { id: "m1", name: "A", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "B", account: 0, toon: 0, contribution: 0 },
    ];
    const donors = [
      { id: "d1", name: "후원1", amount: 10_000, memberId: "m1", at: 1, target: "toon" as const },
      { id: "d2", name: "후원2", amount: 20_000, memberId: "m2", at: 2, target: "toon" as const },
      { id: "d3", name: "후원3", amount: 5_000, memberId: "m_del", at: 3, target: "toon" as const },
    ];
    const purged = purgeDonorsForMemberRoster(donors, members);
    expect(purged.map((d) => d.id)).toEqual(["d1", "d2"]);
    const synced = syncMemberTotalsFromDonors({
      ...defaultState(),
      members,
      donors: purged,
    });
    expect(synced.members.find((m) => m.id === "m1")?.toon).toBe(10_000);
    expect(synced.members.find((m) => m.id === "m2")?.toon).toBe(20_000);
  });
});

describe("member delete keeps donor records", () => {
  it("removes member from roster but keeps orphan donors and remaining totals", () => {
    const members = [
      { id: "m1", name: "A", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "B", account: 0, toon: 0, contribution: 0 },
    ];
    const donors = [
      { id: "d1", name: "후원1", amount: 10_000, memberId: "m1", at: 1, target: "toon" as const },
      { id: "d2", name: "후원2", amount: 20_000, memberId: "m2", at: 2, target: "toon" as const },
    ];
    const afterDelete = syncMemberTotalsFromDonors({
      ...defaultState(),
      members: members.filter((m) => m.id !== "m2"),
      donors,
    });
    expect(afterDelete.members.map((m) => m.id)).toEqual(["m1"]);
    expect(afterDelete.donors.map((d) => d.id)).toEqual(["d1", "d2"]);
    expect(afterDelete.members.find((m) => m.id === "m1")?.toon).toBe(10_000);
    expect(afterDelete.members.find((m) => m.id === "m2")).toBeUndefined();
  });
});

describe("repairMemberTotalsForDonorRoster", () => {
  it("does not restore old roster when members were intentionally replaced", () => {
    const oldRoster = {
      ...defaultState(),
      updatedAt: 1000,
      members: [{ id: "jaki", name: "쟈키", account: 0, toon: 53800, contribution: 53800 }],
      donors: [
        {
          id: "d1",
          name: "후원",
          amount: 53800,
          memberId: "jaki",
          at: 1,
          target: "toon" as const,
        },
      ],
    };
    const newRoster = {
      ...defaultState(),
      updatedAt: 2000,
      members: [
        { id: "sagi", name: "사기", account: 0, toon: 0, contribution: 0 },
        { id: "susi", name: "수시", account: 0, toon: 0, contribution: 0 },
      ],
      donors: oldRoster.donors,
    };
    const repaired = repairMemberTotalsForDonorRoster(newRoster, oldRoster);
    expect(repaired.members.map((m) => m.id)).toEqual(["sagi", "susi"]);
    expect(repaired.members.find((m) => m.id === "jaki")).toBeUndefined();
  });
});

describe("reassignDonorMemberInAppState", () => {
  it("keeps donor name and moves amount between members", () => {
    const state = {
      ...defaultState(),
      members: [
        { id: "m1", name: "피자", account: 0, toon: 50_000, contribution: 50_000 },
        { id: "m2", name: "비서", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [
        {
          id: "toonation:re1",
          name: "두근거",
          amount: 50_000,
          memberId: "m1",
          at: Date.now(),
          target: "toon" as const,
          message: "응원합니다",
        },
      ],
    };
    const next = reassignDonorMemberInAppState(state, "toonation:re1", "m2");
    expect(next).not.toBeNull();
    expect(next!.donors[0]?.name).toBe("두근거");
    expect(next!.donors[0]?.message).toBe("응원합니다");
    expect(next!.donors[0]?.memberId).toBe("m2");
    expect(next!.members.find((m) => m.id === "m1")?.toon).toBe(0);
    expect(next!.members.find((m) => m.id === "m2")?.toon).toBe(50_000);
    expect(next!.donors[0]?.at).toBeGreaterThanOrEqual(state.donors[0]!.at);
    expect(next!.donors[0]?.memberAutoAssigned).toBe(false);
  });
});

describe("applyDonationToAppState", () => {
  it("stores donation message on donor row", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    const event: DonationEvent = {
      id: "toonation:msg-1",
      provider: "toonation",
      externalId: "msg-1",
      donorName: "배지은",
      playerName: "피자",
      amount: 5000,
      message: "제트스키 부탁해요!",
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.donors?.[0]?.message).toBe("제트스키 부탁해요!");
  });

  it("auto-marks hsTerritoryExcluded when amount is not 1만원 exact multiple", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    const ineligible: DonationEvent = {
      id: "bank:bad-1",
      provider: "bank",
      externalId: "bad-1",
      donorName: "익명",
      amount: 13_000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
      memberId: "m1",
    };
    const bad = applyDonationToAppState(state, ineligible);
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(bad.state.donors?.[0]?.hsTerritoryExcluded).toBe(true);

    const eligible: DonationEvent = {
      ...ineligible,
      id: "bank:good-1",
      externalId: "good-1",
      amount: 10_000,
    };
    const good = applyDonationToAppState(state, eligible);
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.state.donors?.[0]?.hsTerritoryExcluded).toBeUndefined();

    const hsOn = {
      ...state,
      highSocietySettings: normalizeHighSocietySettings({ enabled: true, seatMemberIds: ["m1"] }),
      donationSyncMode: "highSociety" as const,
    };
    const hsEligible = applyDonationToAppState(hsOn, {
      ...eligible,
      id: "bank:hs-1",
      externalId: "hs-1",
    });
    expect(hsEligible.ok).toBe(true);
    if (!hsEligible.ok) return;
    expect(hsEligible.state.donors?.[0]?.hsTerritoryExcluded).toBe(true);
  });

  it("still applies donation while high society territory is paused", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
      highSocietySettings: {
        enabled: true,
        territoryPaused: true,
        territoryPausedAt: Date.now(),
        seatMemberIds: [],
        defaultMiddlePush: "right",
        donationLinks: {},
      },
    };
    const event: DonationEvent = {
      id: "bank:paused-1",
      provider: "bank",
      externalId: "paused-1",
      donorName: "테스트",
      amount: 10_000,
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
      manualAssignMemberId: "m1",
      memberId: "m1",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.account).toBe(10_000);
    expect(result.state.donors?.[0]?.amount).toBe(10_000);
  });

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

  it("auto-assigns operating member when toon has no player hint", () => {
    const state = {
      ...defaultState(),
      members: [
        { id: "op", name: "운영비", account: 0, toon: 0, contribution: 0, operating: true },
        { id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [],
    };
    const event: DonationEvent = {
      id: "toonation:2",
      provider: "toonation",
      externalId: "2",
      donorName: "배지은",
      amount: 1000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "op")?.toon).toBe(1000);
    expect(result.state.members.find((m) => m.id === "m1")?.toon).toBe(0);
    expect(result.event.memberAutoAssigned).toBe(true);
  });

  it("auto-assigns operating member when account donation has no player hint", () => {
    const state = {
      ...defaultState(),
      members: [
        { id: "op", name: "운영비", account: 0, toon: 0, contribution: 0, operating: true },
        { id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [],
    };
    const event: DonationEvent = {
      id: "toonation:4",
      provider: "toonation",
      externalId: "4",
      donorName: "햇님",
      amount: 1000,
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "op")?.account).toBe(1000);
    expect(result.state.members.find((m) => m.id === "m1")?.account).toBe(0);
    expect(result.event.memberAutoAssigned).toBe(true);
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

  it("allows separate weak-id donations with same donor·금액 after near-dup window", () => {
    const firstAt = Date.parse("2026-06-11T13:55:00.000Z");
    const secondAt = new Date(firstAt + 5_000).toISOString();
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 1000, contribution: 1000 }],
      donors: [
        {
          id: "toonation:1718100000000-1000",
          name: "이니이니",
          amount: 1000,
          memberId: "m1",
          at: firstAt,
          target: "toon" as const,
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:1718100000456-1000",
      provider: "toonation",
      externalId: "1718100000456-1000",
      donorName: "이니이니",
      playerName: "피자",
      amount: 1000,
      at: secondAt,
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
        { id: "toonation:1718100000123-1000", name: "이니이니", amount: 1000, memberId: "m1", at: at + 5000, target: "toon" as const },
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
    const at = Date.now() - 5_000;
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
      playerName: "피자",
      amount: 1000,
      at: new Date().toISOString(),
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

  it("rejects owner-remap split pair (익명 계좌 + 원닉 투네) within 3s", () => {
    const at = Date.now();
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "연비서", account: 100000, toon: 0, contribution: 100000 }],
      donors: [
        {
          id: "toonation:test-account-1",
          name: "익명",
          amount: 100000,
          memberId: "m1",
          at,
          target: "account" as const,
          message: "익명 연비서",
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:test-toon-2",
      provider: "toonation",
      externalId: "test-toon-2",
      donorName: "철수",
      amount: 100000,
      message: "익명 연비서",
      at: new Date(at + 500).toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate");
  });

  it("rejects same-instant content duplicate from dual apply paths", () => {
    const at = Date.now();
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "이시아", account: 0, toon: 100, contribution: 100 }],
      donors: [
        {
          id: "toonation:server-id-1",
          name: "스페이스x",
          amount: 100,
          memberId: "m1",
          at,
          target: "toon" as const,
          message: "빡수아님 저 미셨네",
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:fp-client-id-2",
      provider: "toonation",
      externalId: "fp-client-id-2",
      donorName: "스페이스x",
      amount: 100,
      message: "빡수아님 저 미셨네",
      at: new Date(at).toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate");
  });

  it("rejects near-duplicate weak fp- ids with same content within 3s (이중 반영)", () => {
    const at = Date.now();
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 60000, toon: 0, contribution: 60000 }],
      donors: [
        {
          id: "toonation:fp-1-60000-a",
          name: "익명5",
          amount: 60000,
          memberId: "m1",
          at,
          target: "account" as const,
          message: "계좌 익명5 피자",
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:fp-2-60000-b",
      provider: "toonation",
      externalId: "fp-2-60000-b",
      donorName: "익명5",
      amount: 60000,
      message: "계좌 익명5 피자",
      at: new Date(at + 1000).toISOString(),
      status: "queued",
      target: "account",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate");
  });

  it("allows five consecutive identical donations one second apart", () => {
    const baseAt = Date.now() - 10_000;
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    let cur = state;
    for (let i = 0; i < 5; i += 1) {
      const event: DonationEvent = {
        id: `toonation:seq-${i}`,
        provider: "toonation",
        externalId: `seq-${i}`,
        donorName: "동일후원",
        playerName: "피자",
        amount: 10_000,
        at: new Date(baseAt + i * 1000).toISOString(),
        status: "queued",
        target: "toon",
      };
      const result = applyDonationToAppState(cur, event);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      cur = result.state;
    }
    expect(cur.donors).toHaveLength(5);
    expect(cur.members[0]?.toon).toBe(50_000);
  });

  it("allows consecutive identical content after identical-message dedupe window", () => {
    const at = Date.now() - 16_000;
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 60000, toon: 0, contribution: 60000 }],
      donors: [
        {
          id: "toonation:fp-1-60000-a",
          name: "익명5",
          amount: 60000,
          memberId: "m1",
          at,
          target: "account" as const,
          message: "계좌 익명5 피자",
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:fp-2-60000-b",
      provider: "toonation",
      externalId: "fp-2-60000-b",
      donorName: "익명5",
      amount: 60000,
      message: "계좌 익명5 피자",
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.donors).toHaveLength(2);
    expect(result.state.members[0]?.account).toBe(120000);
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

  it("revertDonationFromAppState removes only one row when duplicate ids exist", () => {
    const at = Date.now();
    const row = {
      id: "toonation:dup",
      name: "중복",
      amount: 3000,
      memberId: "m1",
      at,
      target: "toon" as const,
    };
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 6000, contribution: 6000 }],
      donors: [row, { ...row }],
    };
    const next = revertDonationFromAppState(state, "toonation:dup");
    expect(next?.donors).toHaveLength(1);
    expect(next?.members[0]?.toon).toBe(3000);
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

  it("rejects dual-apply with different weak ids and 2s at skew", () => {
    const at = Date.parse("2026-08-20T11:12:56.000Z");
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "이시아", account: 0, toon: 13300, contribution: 13300 }],
      donors: [
        {
          id: "toonation:toon-real-id-1734567890123-13300-0-abc",
          name: "자기집안나",
          amount: 13300,
          memberId: "m1",
          at,
          target: "toon" as const,
          message: "게롤보 박자기",
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:fp-client-2",
      provider: "toonation",
      externalId: "fp-client-2",
      donorName: "자기집안나",
      amount: 13300,
      message: "게롤보 박자기",
      at: new Date(at + 2000).toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate");
  });

  it("rejects dual-apply with same toonation real id and 3s skew (toon-{real}-{unique})", () => {
    const at = Date.parse("2026-09-01T22:19:32.000+09:00");
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "쟈키", account: 0, toon: 19200, contribution: 19200 }],
      donors: [
        {
          id: "toonation:toon-donation-8821-1735680000000-19200-0-aaa",
          name: "소밍",
          amount: 19200,
          memberId: "m1",
          at,
          target: "toon" as const,
          message: "응원하겠습니다 쟈키업 쟈키만업",
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:toon-donation-8821-1735680000456-19200-0-bbb",
      provider: "toonation",
      externalId: "toon-donation-8821-1735680000456-19200-0-bbb",
      donorName: "소밍",
      amount: 19200,
      message: "응원하겠습니다 쟈키업 쟈키만업",
      at: new Date(at + 3000).toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate");
  });

  it("rejects dual-apply with same toonation real id, 4s skew, and remapped message (메리)", () => {
    const at = Date.parse("2026-09-01T22:09:57.000+09:00");
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "쟈키", account: 0, toon: 10000, contribution: 10000 }],
      donors: [
        {
          id: "toonation:toon-donation-7711-1735680597000-10000-0-aaa",
          name: "메리",
          amount: 10000,
          memberId: "m1",
          at,
          target: "toon" as const,
          message: "시그니처 랜덤시그 - 쟈키님♡♡",
        },
      ],
    };
    const event: DonationEvent = {
      id: "toonation:toon-donation-7711-1735680601000-10000-0-bbb",
      provider: "toonation",
      externalId: "toon-donation-7711-1735680601000-10000-0-bbb",
      donorName: "메리",
      amount: 10000,
      message: "쟈키양♡♡",
      at: new Date(at + 4000).toISOString(),
      status: "queued",
      target: "toon",
    };
    const result = applyDonationToAppState(state, event);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("duplicate");
    expect(
      dedupeDonorRows([
        ...state.donors,
        {
          id: event.id,
          name: "메리",
          amount: 10000,
          memberId: "m1",
          at: at + 4000,
          target: "toon" as const,
          message: "쟈키양♡♡",
        },
      ])
    ).toHaveLength(1);
  });

  it("rejects burst of identical-message weak fp ids within 15s (WS 연사)", () => {
    const baseAt = Date.parse("2026-09-01T22:35:11.000+09:00");
    const msg = "시그니처 팬덤시그 - 언니 생일인데 재롱부려야징. ^^";
    let state = {
      ...defaultState(),
      members: [{ id: "m1", name: "쟈키", account: 0, toon: 0, contribution: 0 }],
      donors: [] as NonNullable<ReturnType<typeof defaultState>["donors"]>,
    };
    for (let i = 0; i < 6; i += 1) {
      const event: DonationEvent = {
        id: `toonation:fp-10000-burst-${i}`,
        provider: "toonation",
        externalId: `fp-10000-burst-${i}`,
        donorName: "구름하정",
        amount: 10000,
        message: msg,
        at: new Date(baseAt + i * 1500).toISOString(),
        status: "queued",
        target: "toon",
      };
      const result = applyDonationToAppState(state, event);
      if (i === 0) {
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        state = result.state;
      } else {
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.reason).toBe("duplicate");
      }
    }
    expect(state.donors).toHaveLength(1);
    expect(state.members[0]?.toon).toBe(10000);
  });

  it("allows consecutive identical-message donations with distinct toona ids", () => {
    const baseAt = Date.now() - 10_000;
    const msg = "자키 화이팅";
    let cur = {
      ...defaultState(),
      members: [{ id: "m1", name: "자키", account: 0, toon: 0, contribution: 0 }],
      donors: [] as NonNullable<ReturnType<typeof defaultState>["donors"]>,
    };
    for (let i = 0; i < 3; i += 1) {
      const event: DonationEvent = {
        id: `toonation:don-real-${i}`,
        provider: "toonation",
        externalId: `don-real-${i}`,
        donorName: "후원자",
        amount: 10000,
        message: msg,
        at: new Date(baseAt + i * 1000).toISOString(),
        status: "queued",
        target: "toon",
      };
      const result = applyDonationToAppState(cur, event);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      cur = result.state;
    }
    expect(cur.donors).toHaveLength(3);
    expect(cur.members[0]?.toon).toBe(30000);
  });

  it("rejects consecutive fp- fallback ids within near-dup window", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    const firstAt = Date.now() - 1_000;
    const first: DonationEvent = {
      id: "toonation:fp-10000-aaa-t1",
      provider: "toonation",
      externalId: "fp-10000-aaa-t1",
      donorName: "익명",
      playerName: "피자",
      amount: 10000,
      at: new Date(firstAt).toISOString(),
      status: "queued",
      target: "account",
    };
    const second: DonationEvent = {
      ...first,
      id: "toonation:fp-10000-aaa-t2",
      externalId: "fp-10000-aaa-t2",
      at: new Date(firstAt + 500).toISOString(),
    };
    const r1 = applyDonationToAppState(state, first);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = applyDonationToAppState(r1.state, second);
    expect(r2.ok).toBe(false);
    if (r2.ok) return;
    expect(r2.reason).toBe("duplicate");
  });

  it("revertDonationFromAppState rejects donationExcluded source rows", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [
        {
          id: "toonation:orig",
          name: "후원자",
          amount: 9000,
          memberId: "m1",
          at: Date.now(),
          target: "toon" as const,
          donationExcluded: true,
        },
      ],
    };
    expect(revertDonationFromAppState(state, "toonation:orig")).toBeNull();
  });

  it("syncMemberTotalsFromDonors skips donationExcluded rows", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 99999, contribution: 99999 }],
      donors: [
        {
          id: "toonation:orig",
          name: "후원자",
          amount: 9000,
          memberId: "m1",
          at: Date.now(),
          target: "toon" as const,
          donationExcluded: true,
        },
        {
          id: "toonation:orig:split:m1",
          name: "후원자",
          amount: 3000,
          memberId: "m1",
          at: Date.now(),
          target: "toon" as const,
          groupSplit: true,
        },
      ],
    };
    const next = syncMemberTotalsFromDonors(state);
    expect(next.members[0]?.toon).toBe(3000);
  });
});

describe("mergeDonorRowFields", () => {
  it("fills missing message from fallback row", () => {
    expect(
      mergeDonorRowFields(
        { id: "a", name: "익명", amount: 1000, memberId: "m1", at: 2 },
        { id: "a", name: "익명", amount: 1000, memberId: "m1", at: 1, message: "익명 연비서" }
      ).message
    ).toBe("익명 연비서");
  });

  it("preserves donationExcluded and groupSplit flags from either side", () => {
    const merged = mergeDonorRowFields(
      { id: "src", name: "익명2", amount: 300_000, memberId: "m1", at: 1000 },
      {
        id: "src",
        name: "익명2",
        amount: 300_000,
        memberId: "m1",
        at: 1000,
        donationExcluded: true,
        groupSplitSource: true,
      }
    );
    expect(merged.donationExcluded).toBe(true);
    expect(merged.groupSplitSource).toBe(true);

    const merged2 = mergeDonorRowFields(
      {
        id: "src:split:m1",
        name: "익명2",
        amount: 60_000,
        memberId: "m1",
        at: 2000,
        groupSplit: true,
      },
      { id: "src:split:m1", name: "익명2", amount: 60_000, memberId: "m1", at: 2000 }
    );
    expect(merged2.groupSplit).toBe(true);
  });

  it("marks hsTerritoryExcluded when merged amount is not 1만원 exact multiple", () => {
    const merged = mergeDonorRowFields(
      { id: "d1", name: "G-곱곱", amount: 14_600, memberId: "m1", at: 100 },
      { id: "d1", name: "G-곱곱", amount: 14_600, memberId: "m1", at: 99 }
    );
    expect(merged.hsTerritoryExcluded).toBe(true);
  });
});

describe("dedupeDonorRows message preservation", () => {
  it("keeps message when newer duplicate row lacks it", () => {
    const rows = dedupeDonorRows([
      { id: "d1", name: "익명", amount: 1000, memberId: "m1", at: 1, message: "익명 비서" },
      { id: "d1", name: "익명", amount: 1000, memberId: "m1", at: 2 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.message).toBe("익명 비서");
  });

  it("collapses dual-apply rows with different weak ids within 3s", () => {
    const at = 1_725_678_832_000;
    const rows = dedupeDonorRows([
      {
        id: "toonation:fp-a",
        name: "스페이스x",
        amount: 100,
        memberId: "m1",
        at,
        target: "toon" as const,
        message: "테스트",
      },
      {
        id: "toonation:fp-b",
        name: "스페이스x",
        amount: 100,
        memberId: "m1",
        at: at + 1500,
        target: "toon" as const,
        message: "테스트",
      },
    ]);
    expect(rows).toHaveLength(1);
  });

  it("collapses dual-apply rows with different weak ids same at ms", () => {
    const at = 1_725_678_832_000;
    const rows = dedupeDonorRows([
      {
        id: "toonation:fp-a",
        name: "스페이스x",
        amount: 100,
        memberId: "m1",
        at,
        target: "toon" as const,
        message: "테스트",
      },
      {
        id: "toonation:fp-b",
        name: "스페이스x",
        amount: 100,
        memberId: "m1",
        at,
        target: "toon" as const,
        message: "테스트",
      },
    ]);
    expect(rows).toHaveLength(1);
  });
});

describe("updateDonorMessageInAppState", () => {
  it("updates message without changing totals", () => {
    const state = {
      ...defaultState(),
      members: [{ id: "m1", name: "피자", account: 0, toon: 5000, contribution: 5000 }],
      donors: [
        {
          id: "d1",
          name: "익명",
          amount: 5000,
          memberId: "m1",
          at: Date.now(),
          target: "toon" as const,
        },
      ],
    };
    const next = updateDonorMessageInAppState(state, "d1", "익원 감사");
    expect(next?.donors?.[0]?.message).toBe("익원 감사");
    expect(next?.members[0]?.toon).toBe(5000);
  });
});

describe("contribution formula (apply-from-now)", () => {
  it("sync rebuilds contribution from donor contributionPoints (not account+toon)", () => {
    const synced = syncMemberTotalsFromDonors({
      ...defaultState(),
      contributionFormula: { accountWeightPct: 10, toonWeightPct: 10 },
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 18_000 }],
      donors: [
        {
          id: "d1",
          name: "익명",
          amount: 18_000,
          memberId: "m1",
          at: 1,
          target: "toon" as const,
          contributionPoints: 1_800,
        },
      ],
    });
    expect(synced.members[0]?.toon).toBe(18_000);
    expect(synced.members[0]?.contribution).toBe(1_800);
  });

  it("sync uses formula for legacy donors without contributionPoints", () => {
    const synced = syncMemberTotalsFromDonors({
      ...defaultState(),
      contributionFormula: { accountWeightPct: 100, toonWeightPct: 50 },
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 12_345 }],
      donors: [
        {
          id: "d1",
          name: "익명",
          amount: 10_000,
          memberId: "m1",
          at: 1,
          target: "toon" as const,
        },
      ],
    });
    expect(synced.members[0]?.toon).toBe(10_000);
    expect(synced.members[0]?.contribution).toBe(5_000);
  });

  it("new donation uses formula and stores contributionPoints", () => {
    const base = {
      ...defaultState(),
      contributionFormula: { accountWeightPct: 100, toonWeightPct: 50 },
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 1_000 }],
      contributionLogs: [
        {
          id: "cl1",
          memberId: "m1",
          amount: 1_000,
          delta: 1 as const,
          at: 1,
          note: "",
        },
      ],
      donors: [] as ReturnType<typeof defaultState>["donors"],
    };
    const event: DonationEvent = {
      id: "e1",
      donorName: "테스터",
      amount: 10_000,
      at: new Date().toISOString(),
      target: "toon",
      playerName: "피자",
      status: "pending",
    };
    const result = applyDonationToAppState(base, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.toon).toBe(10_000);
    expect(result.state.members[0]?.contribution).toBe(1_000 + 5_000);
    expect(result.state.donors[0]?.contributionPoints).toBe(5_000);
  });

  it("ingest contributionPoints override and event formula persist to state", () => {
    const base = {
      ...defaultState(),
      contributionFormula: { accountWeightPct: 100, toonWeightPct: 100 },
      members: [{ id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 }],
      donors: [] as ReturnType<typeof defaultState>["donors"],
    };
    const event: DonationEvent = {
      id: "e1",
      donorName: "테스터",
      amount: 10_000,
      at: new Date().toISOString(),
      target: "toon",
      playerName: "피자",
      status: "pending",
      contributionPoints: 1_000,
      contributionFormula: { accountWeightPct: 10, toonWeightPct: 10 },
    };
    const result = applyDonationToAppState(base, event);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.contribution).toBe(1_000);
    expect(result.state.donors[0]?.contributionPoints).toBe(1_000);
    expect(result.state.contributionFormula).toEqual({ accountWeightPct: 10, toonWeightPct: 10 });
  });

  it("revert subtracts stored contributionPoints after formula change", () => {
    const withDonation = {
      ...defaultState(),
      contributionFormula: { accountWeightPct: 0, toonWeightPct: 100 },
      members: [{ id: "m1", name: "피자", account: 0, toon: 10_000, contribution: 6_000 }],
      donors: [
        {
          id: "d1",
          name: "테스터",
          amount: 10_000,
          memberId: "m1",
          at: Date.now(),
          target: "toon" as const,
          contributionPoints: 5_000,
        },
      ],
    };
    const next = revertDonationFromAppState(withDonation, "d1");
    expect(next?.members[0]?.toon).toBe(0);
    expect(next?.members[0]?.contribution).toBe(1_000);
    expect(next?.donors).toHaveLength(0);
  });
});
