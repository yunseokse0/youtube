import { describe, expect, it } from "vitest";
import {
  buildDefaultMembersCount,
  defaultState,
  hasMeaningfulBroadcastData,
  isDefaultLikeState,
  isDefaultPlaceholderMemberList,
  membersDifferByIds,
} from "@/lib/state";
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
});
