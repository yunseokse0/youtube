import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import {
  mergeLocalMemberIdentityOntoRemote,
  shouldAvoidOverwritingLocalStateWithRemote,
} from "@/lib/state";

describe("mergeLocalMemberIdentityOntoRemote", () => {
  it("keeps local custom names on richer remote placeholder roster", () => {
    const local = {
      ...defaultState(),
      members: [
        { id: "m1", name: "사기", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "히치", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [] as ReturnType<typeof defaultState>["donors"],
    };
    const remote = {
      ...defaultState(),
      members: [
        { id: "m1", name: "멤버1", account: 250000, toon: 0, contribution: 250000 },
        { id: "m2", name: "멤버2", account: 200000, toon: 0, contribution: 200000 },
      ],
      donors: [
        { id: "d1", name: "a", amount: 250000, memberId: "m1", at: 1, target: "account" as const },
        { id: "d2", name: "b", amount: 200000, memberId: "m2", at: 2, target: "account" as const },
      ],
    };
    const merged = mergeLocalMemberIdentityOntoRemote(remote, local);
    expect(merged.members[0]?.name).toBe("사기");
    expect(merged.members[1]?.name).toBe("히치");
    expect(merged.members[0]?.account).toBe(250000);
    expect(shouldAvoidOverwritingLocalStateWithRemote(local, remote)).toBe(false);
  });
});
