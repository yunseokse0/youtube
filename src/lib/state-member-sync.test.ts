import { describe, expect, it } from "vitest";
import {
  buildDefaultMembersCount,
  defaultState,
  hasExpandedSigInventory,
  hasMeaningfulBroadcastData,
  hasSigSalesMemberPresets,
  isDefaultLikeState,
  isDefaultPlaceholderMemberList,
  isShrunkToDefaultSigInventory,
  membersDifferByIds,
  shouldPreferLocalSigInventoryOverIncoming,
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
    expect(isDefaultLikeState(defaultState())).toBe(true);
    expect(membersDifferByIds(one.members, defaultState().members)).toBe(true);
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
});
