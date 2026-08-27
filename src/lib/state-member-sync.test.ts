import { describe, expect, it } from "vitest";
import {
  buildDefaultMembersCount,
  defaultState,
  hasExpandedSigInventory,
  hasMeaningfulBroadcastData,
  hasMeaningfulMemberRoster,
  isAccidentalEmptyRosterState,
  shouldBlockAccidentalEmptyOverwrite,
  hasSigSalesMemberPresets,
  isDefaultLikeState,
  isDefaultPlaceholderMemberList,
  isShrunkToDefaultSigInventory,
  membersDifferByIds,
  isMemberRosterStrictSuperset,
  pickMemberRosterPreferNewer,
  mergeServerSaveApiBodies,
  appStatePayloadForApi,
  mergeBroadcastSessionPreservingDonations,
  shouldAvoidOverwritingLocalStateWithRemote,
  shouldPreferLocalSigInventoryOverIncoming,
  wouldShrinkDonationData,
} from "@/lib/state";
import { DEFAULT_SIG_INVENTORY } from "@/lib/constants";
import type { AppState, Member } from "@/types";

describe("member sync helpers", () => {
  it("detects default placeholder member lists", () => {
    expect(isDefaultPlaceholderMemberList(defaultState().members)).toBe(true);
    expect(
      isDefaultPlaceholderMemberList([{ id: "m1", name: "멤버1", account: 0, toon: 0, contribution: 0 }])
    ).toBe(true);
    expect(
      isDefaultPlaceholderMemberList([
        { id: "m1", name: "패자", account: 0, toon: 0, contribution: 0 },
      ])
    ).toBe(false);
  });

  it("single custom member is meaningful vs default 3-member state", () => {
    const one: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "패자", account: 0, toon: 0, contribution: 0 }],
    };
    expect(isDefaultLikeState(one)).toBe(false);
    expect(hasMeaningfulBroadcastData(one)).toBe(true);
    expect(hasMeaningfulMemberRoster(one)).toBe(true);
    expect(isDefaultLikeState(defaultState())).toBe(true);
    expect(hasMeaningfulMemberRoster(defaultState())).toBe(false);
    expect(membersDifferByIds(one.members, defaultState().members)).toBe(true);
  });

  it("placeholder members are never a meaningful roster (even with money/donors)", () => {
    const placeholders: AppState = {
      ...defaultState(),
      updatedAt: Date.now(),
      members: buildDefaultMembersCount(3),
    };
    expect(hasMeaningfulMemberRoster(placeholders)).toBe(false);
    expect(hasMeaningfulBroadcastData(placeholders)).toBe(false);

    const withMoney: AppState = {
      ...defaultState(),
      members: [{ id: "m1", name: "멤버1", account: 0, toon: 50000, contribution: 0 }],
      donors: [{ id: "d1", name: "x", amount: 1000, memberId: "m1", at: Date.now(), target: "toon" }],
    };
    expect(isDefaultPlaceholderMemberList(withMoney.members)).toBe(true);
    expect(hasMeaningfulMemberRoster(withMoney)).toBe(false);
  });

  it("allows intentional member-init when remote settlementResetAt is newer", () => {
    const local: AppState = {
      ...defaultState(),
      settlementResetAt: 100,
      updatedAt: 1000,
      members: [
        { id: "m1", name: "헛치", account: 10000, toon: 0, contribution: 10000 },
        { id: "m2", name: "현민", account: 5000, toon: 0, contribution: 5000 },
      ],
      donors: [
        { id: "d1", name: "a", amount: 10000, memberId: "m1", at: 1, target: "account" },
      ],
    };
    const remotePlaceholder: AppState = {
      ...defaultState(),
      settlementResetAt: 9999,
      updatedAt: 2000,
      members: buildDefaultMembersCount(3),
      donors: [],
    };
    expect(isAccidentalEmptyRosterState(remotePlaceholder)).toBe(true);
    expect(shouldBlockAccidentalEmptyOverwrite(local, remotePlaceholder)).toBe(false);
    expect(shouldAvoidOverwritingLocalStateWithRemote(local, remotePlaceholder)).toBe(false);
  });

  it("blocks accidental placeholder wipe when settlementResetAt did not advance", () => {
    const local: AppState = {
      ...defaultState(),
      settlementResetAt: 100,
      updatedAt: 1000,
      members: [
        { id: "m1", name: "헛치", account: 10000, toon: 0, contribution: 10000 },
      ],
      donors: [
        { id: "d1", name: "a", amount: 10000, memberId: "m1", at: 1, target: "account" },
      ],
    };
    const remotePlaceholder: AppState = {
      ...defaultState(),
      settlementResetAt: 100,
      updatedAt: 2000,
      members: buildDefaultMembersCount(3),
      donors: [],
    };
    expect(isAccidentalEmptyRosterState(remotePlaceholder)).toBe(true);
    expect(shouldBlockAccidentalEmptyOverwrite(local, remotePlaceholder)).toBe(true);
  });

  it("allows keep-members settlement reset (real names, zero amounts) to overwrite", () => {
    const local: AppState = {
      ...defaultState(),
      settlementResetAt: 100,
      members: [
        { id: "m1", name: "헛치", account: 10000, toon: 0, contribution: 10000 },
      ],
      donors: [
        { id: "d1", name: "a", amount: 10000, memberId: "m1", at: 1, target: "account" },
      ],
    };
    const remoteKeepMembers: AppState = {
      ...defaultState(),
      settlementResetAt: 9999,
      members: [
        { id: "m1", name: "헛치", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [],
    };
    expect(isAccidentalEmptyRosterState(remoteKeepMembers)).toBe(false);
    expect(shouldBlockAccidentalEmptyOverwrite(local, remoteKeepMembers)).toBe(false);
  });

  it("avoids overwriting local donation totals with empty remote snapshot", () => {
    const local: AppState = {
      ...defaultState(),
      settlementResetAt: 100,
      members: [
        { id: "m1", name: "BT태호", account: 260000, toon: 0, contribution: 260000 },
        { id: "m2", name: "대니현", account: 100000, toon: 0, contribution: 100000 },
      ],
      donors: [
        { id: "d1", name: "a", amount: 260000, memberId: "m1", at: 1, target: "account" },
        { id: "d2", name: "b", amount: 100000, memberId: "m2", at: 2, target: "account" },
      ],
    };
    const remoteZero: AppState = {
      ...defaultState(),
      settlementResetAt: 100,
      members: [
        { id: "m1", name: "BT태호", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "대니현", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [],
    };
    expect(shouldAvoidOverwritingLocalStateWithRemote(local, remoteZero)).toBe(true);

    const remoteReset: AppState = {
      ...remoteZero,
      settlementResetAt: 200,
    };
    expect(shouldAvoidOverwritingLocalStateWithRemote(local, remoteReset)).toBe(false);
  });

  it("detects donation shrinkage not only empty wipe", () => {
    const local: AppState = {
      ...defaultState(),
      members: [
        { id: "m1", name: "BT태호", account: 260000, toon: 0, contribution: 260000 },
        { id: "m2", name: "대니현", account: 100000, toon: 0, contribution: 100000 },
      ],
      donors: [
        { id: "d1", name: "a", amount: 260000, memberId: "m1", at: 1, target: "account" },
        { id: "d2", name: "b", amount: 100000, memberId: "m2", at: 2, target: "account" },
      ],
    };
    const shrunk: AppState = {
      ...local,
      members: [{ id: "m1", name: "BT태호", account: 260000, toon: 0, contribution: 260000 }],
      donors: [{ id: "d1", name: "a", amount: 260000, memberId: "m1", at: 1, target: "account" }],
    };
    expect(wouldShrinkDonationData(local, shrunk)).toBe(true);
    expect(wouldShrinkDonationData(local, local)).toBe(false);
  });

  it("treats empty remote donors as shrink even when member totals are already 0", () => {
    const local: AppState = {
      ...defaultState(),
      members: [
        { id: "m1", name: "BT태호", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "대니현", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [
        { id: "d1", name: "a", amount: 260000, memberId: "m1", at: 1, target: "account" },
        { id: "d2", name: "b", amount: 100000, memberId: "m2", at: 2, target: "account" },
      ],
    };
    const remoteEmpty: AppState = {
      ...local,
      donors: [],
    };
    expect(wouldShrinkDonationData(local, remoteEmpty)).toBe(true);
    expect(shouldAvoidOverwritingLocalStateWithRemote(local, remoteEmpty)).toBe(true);
  });

  it("buildDefaultMembersCount(1) is not default-like for 3-slot default", () => {
    const one = buildDefaultMembersCount(1);
    expect(one).toHaveLength(1);
    expect(isDefaultPlaceholderMemberList(one as Member[])).toBe(true);
  });

  it("detects shrunk vs expanded sig inventory", () => {
    const shrunk = DEFAULT_SIG_INVENTORY.map((x) => ({ ...x }));
    expect(isShrunkToDefaultSigInventory(shrunk)).toBe(true);
    expect(hasExpandedSigInventory(shrunk)).toBe(false);
    const expanded = [
      ...shrunk,
      {
        id: "sig_roll_test",
        name: "04클럽춤",
        price: 23000,
        imageUrl: "/uploads/sigs/finalent/test.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    expect(isShrunkToDefaultSigInventory(expanded)).toBe(false);
    expect(hasExpandedSigInventory(expanded)).toBe(true);
  });

  it("prefers local sig inventory when remote reverts to default preset", () => {
    const local = [
      ...DEFAULT_SIG_INVENTORY.map((x) => ({ ...x })),
      {
        id: "sig_custom",
        name: "04클럽춤",
        price: 23000,
        imageUrl: "/uploads/sigs/finalent/test.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const remoteDefault = DEFAULT_SIG_INVENTORY.map((x) => ({ ...x }));
    expect(
      shouldPreferLocalSigInventoryOverIncoming(local, remoteDefault, {
        localUpdatedAt: 2000,
        incomingUpdatedAt: 1000,
      })
    ).toBe(true);
  });

  it("does not prefer local when remote toona import is richer", () => {
    const local = [
      {
        id: "oneshot",
        name: "한방",
        price: 0,
        imageUrl: "",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const remote = Array.from({ length: 20 }, (_, i) => ({
      id: `toona_${i}`,
      name: `시그${i}`,
      price: 1000 * (i + 1),
      imageUrl: "http://toona/x.gif",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    }));
    expect(
      shouldPreferLocalSigInventoryOverIncoming(local, remote, {
        localUpdatedAt: Date.now(),
        incomingUpdatedAt: Date.now() - 10_000,
      })
    ).toBe(false);
  });

  it("does not prefer local when remote is newer after intentional bulk delete", () => {
    const makeSig = (id: string) => ({
      id,
      name: id,
      price: 1000,
      imageUrl: "",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    });
    const local = [
      ...DEFAULT_SIG_INVENTORY.map((x) => ({ ...x })),
      ...Array.from({ length: 12 }, (_, i) => makeSig(`sig_extra_${i}`)),
    ];
    const remote = local.slice(0, 10);
    expect(
      shouldPreferLocalSigInventoryOverIncoming(local, remote, {
        localUpdatedAt: 1000,
        incomingUpdatedAt: 5000,
      })
    ).toBe(false);
  });

  it("detects saved member sig presets", () => {
    expect(hasSigSalesMemberPresets({})).toBe(false);
    expect(hasSigSalesMemberPresets({ m1: [] })).toBe(false);
    expect(hasSigSalesMemberPresets({ m1: ["sig_a"] })).toBe(true);
  });

  it("pickMemberRosterPreferNewer keeps newer local add over older server roster", () => {
    const localMembers: Member[] = [
      { id: "m1", name: "쟈키", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "사기", account: 0, toon: 0, contribution: 0 },
    ];
    const serverMembers: Member[] = [
      { id: "m1", name: "쟈키", account: 1000, toon: 0, contribution: 1000 },
    ];
    const picked = pickMemberRosterPreferNewer(
      { members: localMembers, updatedAt: 200 },
      { members: serverMembers, updatedAt: 100 }
    );
    expect(picked.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("pickMemberRosterPreferNewer keeps local superset even when server stamp is newer", () => {
    const localMembers: Member[] = [
      { id: "m1", name: "쟈키", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "사기", account: 0, toon: 0, contribution: 0 },
    ];
    const serverMembers: Member[] = [
      { id: "m1", name: "쟈키", account: 0, toon: 0, contribution: 0 },
    ];
    const picked = pickMemberRosterPreferNewer(
      { members: localMembers, updatedAt: 100 },
      { members: serverMembers, updatedAt: 200 }
    );
    /** 멤버 추가분(상위집합)은 stamp보다 우선 — 테마 PATCH가 추가를 지우지 않게 */
    expect(picked.map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("pickMemberRosterPreferNewer yields to much-newer shorter remote (other-device delete)", () => {
    const localMembers: Member[] = [
      { id: "m1", name: "쟈키", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "사기", account: 0, toon: 0, contribution: 0 },
    ];
    const serverMembers: Member[] = [
      { id: "m1", name: "쟈키", account: 0, toon: 0, contribution: 0 },
    ];
    const picked = pickMemberRosterPreferNewer(
      { members: localMembers, updatedAt: 100 },
      { members: serverMembers, updatedAt: 100 + 120_000 + 1 }
    );
    expect(picked.map((m) => m.id)).toEqual(["m1"]);
  });

  it("isMemberRosterStrictSuperset detects added member", () => {
    expect(
      isMemberRosterStrictSuperset(
        [
          { id: "m1", name: "a", account: 0, toon: 0, contribution: 0 },
          { id: "m2", name: "b", account: 0, toon: 0, contribution: 0 },
        ],
        [{ id: "m1", name: "a", account: 0, toon: 0, contribution: 0 }]
      )
    ).toBe(true);
    expect(
      isMemberRosterStrictSuperset(
        [{ id: "m1", name: "a", account: 0, toon: 0, contribution: 0 }],
        [
          { id: "m1", name: "a", account: 0, toon: 0, contribution: 0 },
          { id: "m2", name: "b", account: 0, toon: 0, contribution: 0 },
        ]
      )
    ).toBe(false);
  });

  it("mergeServerSaveApiBodies keeps membersAuthoritative roster over later theme patch", () => {
    const prev = JSON.stringify({
      updatedAt: 200,
      membersAuthoritative: true,
      membersRosterUpdatedAt: 200,
      members: [
        { id: "m1", name: "쟈키", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "사기", account: 0, toon: 0, contribution: 0 },
      ],
      overlaySettings: { a: 1 },
    });
    const next = JSON.stringify({
      updatedAt: 201,
      members: [{ id: "m1", name: "쟈키", account: 0, toon: 0, contribution: 0 }],
      overlaySettings: { a: 2 },
    });
    const merged = JSON.parse(mergeServerSaveApiBodies(prev, next)) as {
      membersAuthoritative?: boolean;
      membersRosterUpdatedAt?: number;
      members: Member[];
      overlaySettings: { a: number };
    };
    expect(merged.membersAuthoritative).toBe(true);
    expect(merged.members.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(merged.membersRosterUpdatedAt).toBe(200);
    expect(merged.overlaySettings.a).toBe(2);
  });

  it("appStatePayloadForApi highSocietySettingsOnly sends territoryLogs without donors/members", () => {
    const state = {
      ...defaultState(),
      updatedAt: 2000,
      donors: [
        { id: "d1", name: "후원", amount: 10000, memberId: "m1", at: 1, target: "account" as const },
      ],
      members: [{ id: "m1", name: "멤버", account: 10000, toon: 0, contribution: 10000 }],
      highSocietySettings: { enabled: true, fieldCm: 400, startCmPerMember: 100 },
      territoryLogs: [
        {
          id: "tl1",
          memberId: "m1",
          delta: 1 as const,
          amount: 50,
          at: 100,
          pushDir: "right" as const,
        },
      ],
      donationSyncMode: "highSociety" as const,
    } as AppState;
    const payload = appStatePayloadForApi(state, "finalent", {
      omitDonationFields: true,
      highSocietySettingsOnly: true,
    }) as Record<string, unknown>;
    expect(payload.donors).toBeUndefined();
    expect(payload.members).toBeUndefined();
    expect(payload.highSocietySettings).toBeTruthy();
    expect(payload.territoryLogs).toEqual(state.territoryLogs);
    expect(payload.donationSyncMode).toBe("highSociety");
  });

  it("omitDonationFields payload keeps highSocietySettings so server can treat as HS-only", () => {
    const state = {
      ...defaultState(),
      updatedAt: 2000,
      donors: [
        { id: "d1", name: "후원", amount: 10000, memberId: "m1", at: 1, target: "account" as const },
      ],
      members: [{ id: "m1", name: "멤버", account: 0, toon: 0, contribution: 0 }],
      highSocietySettings: { enabled: true, fieldCm: 400, startCmPerMember: 100 },
      territoryLogs: [],
    } as AppState;
    const payload = appStatePayloadForApi(state, "finalent", {
      omitDonationFields: true,
    }) as Record<string, unknown>;
    expect(payload.donors).toBeUndefined();
    expect(payload.highSocietySettings).toBeTruthy();
  });

  it("mergeBroadcastSessionPreservingDonations keeps session donors when patch is empty", () => {
    const existing = {
      ...defaultState(),
      donors: [
        { id: "d1", name: "익명", amount: 50000, memberId: "m1", at: 1, target: "account" as const },
      ],
      members: [{ id: "m1", name: "자기", account: 50000, toon: 0, contribution: 50000 }],
    } as AppState;
    const patch = {
      ...existing,
      donors: [],
      members: [{ id: "m1", name: "자기", account: 0, toon: 0, contribution: 0 }],
      territoryLogs: [{ id: "tl1", memberId: "m1", delta: 1 as const, amount: 10, at: 2 }],
      updatedAt: Date.now(),
    } as AppState;
    const merged = mergeBroadcastSessionPreservingDonations(existing, patch);
    expect(merged.donors).toHaveLength(1);
    expect(merged.members[0]?.account).toBe(50000);
    expect(merged.territoryLogs).toEqual(patch.territoryLogs);
  });

  it("appStatePayloadForApi slims membersAuthoritative+omitDonationFields body", () => {
    const state = {
      ...defaultState(),
      updatedAt: 1000,
      membersRosterUpdatedAt: 1000,
      members: [
        { id: "m1", name: "쟈키", account: 100, toon: 0, contribution: 0 },
        { id: "m2", name: "신규", account: 0, toon: 0, contribution: 0 },
      ],
      sigInventory: Array.from({ length: 40 }, (_, i) => ({
        id: `sig_${i}`,
        name: `s${i}`,
        price: 1000,
        imageUrl: `/uploads/sigs/x/${i}.gif`,
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      })),
      overlayPresets: [{ id: "p1", name: "프리셋", settings: {} }],
    } as AppState;
    const payload = appStatePayloadForApi(state, "finalent", {
      membersAuthoritative: true,
      omitDonationFields: true,
    }) as Record<string, unknown>;
    expect(payload.membersAuthoritative).toBe(true);
    expect(Array.isArray(payload.members) && (payload.members as Member[]).map((m) => m.id)).toEqual([
      "m1",
      "m2",
    ]);
    expect(payload.sigInventory).toBeUndefined();
    expect(payload.overlayPresets).toBeUndefined();
    expect(payload.donors).toBeUndefined();
    expect(payload.membersRosterUpdatedAt).toBe(1000);
  });

  it("mergeServerSaveApiBodies does not drop zero-amount real members behind theme patch", () => {
    const prev = JSON.stringify({
      updatedAt: 100,
      overlaySettings: { theme: 1 },
    });
    const next = JSON.stringify({
      updatedAt: 101,
      members: [
        { id: "m1", name: "사기", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "수시", account: 0, toon: 0, contribution: 0 },
        { id: "m3", name: "시수", account: 0, toon: 0, contribution: 0 },
      ],
      overlaySettings: { theme: 1 },
    });
    const merged = JSON.parse(mergeServerSaveApiBodies(prev, next)) as {
      members?: Member[];
    };
    expect(merged.members?.map((m) => m.name)).toEqual(["사기", "수시", "시수"]);
  });
});
