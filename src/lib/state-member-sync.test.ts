import { describe, expect, it } from "vitest";
import {
  buildDefaultMembersCount,
  defaultState,
  hasExpandedSigInventory,
  hasMeaningfulBroadcastData,
  hasMeaningfulMemberRoster,
  hasSigSalesMemberPresets,
  isDefaultLikeState,
  isDefaultPlaceholderMemberList,
  isShrunkToDefaultSigInventory,
  membersDifferByIds,
  isMemberRosterStrictSuperset,
  pickMemberRosterPreferNewer,
  mergeServerSaveApiBodies,
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
      members: Member[];
      overlaySettings: { a: number };
    };
    expect(merged.membersAuthoritative).toBe(true);
    expect(merged.members.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(merged.overlaySettings.a).toBe(2);
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
