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
      updatedAt: 2000,
      members: [
        { id: "m1", name: "사기", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "히치", account: 0, toon: 0, contribution: 0 },
      ],
      donors: [] as ReturnType<typeof defaultState>["donors"],
    };
    const remote = {
      ...defaultState(),
      updatedAt: 1000,
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

  it("does not let stale OBS last-good names override newer server rename", () => {
    const staleObs = {
      ...defaultState(),
      updatedAt: 1000,
      members: [
        { id: "m1", name: "멤버1", account: 150000, toon: 0, contribution: 150000 },
        { id: "m2", name: "멤버2", account: 0, toon: 0, contribution: 0 },
        { id: "m3", name: "옛이름", account: 0, toon: 0, contribution: 0 },
        { id: "m4", name: "멤버4", account: 0, toon: 0, contribution: 0 },
      ],
    };
    /** 실명 1개라도 있으면 meaningful roster */
    const staleWithReal = {
      ...staleObs,
      members: [
        { id: "m1", name: "옛이름", account: 150000, toon: 0, contribution: 150000 },
        { id: "m2", name: "히치", account: 0, toon: 0, contribution: 0 },
        { id: "m3", name: "사기", account: 0, toon: 0, contribution: 0 },
        { id: "m4", name: "지키", account: 0, toon: 0, contribution: 0 },
      ],
    };
    const serverRenamed = {
      ...defaultState(),
      updatedAt: 5000,
      members: [
        { id: "m1", name: "지키", account: 150000, toon: 0, contribution: 150000 },
        { id: "m2", name: "333", account: 0, toon: 0, contribution: 0 },
        { id: "m3", name: "홍쓰", account: 0, toon: 0, contribution: 0 },
        { id: "m4", name: "신규", account: 0, toon: 0, contribution: 0 },
      ],
    };
    const merged = mergeLocalMemberIdentityOntoRemote(serverRenamed, staleWithReal);
    expect(merged.members.map((m) => m.name)).toEqual(["지키", "333", "홍쓰", "신규"]);
  });

  it("keeps just-renamed local names when local updatedAt is newer", () => {
    const local = {
      ...defaultState(),
      updatedAt: 9000,
      members: [
        { id: "m1", name: "지키", account: 150000, toon: 0, contribution: 150000 },
        { id: "m2", name: "333", account: 0, toon: 0, contribution: 0 },
      ],
    };
    const remote = {
      ...defaultState(),
      updatedAt: 8000,
      members: [
        { id: "m1", name: "옛이름", account: 150000, toon: 0, contribution: 150000 },
        { id: "m2", name: "구이름", account: 0, toon: 0, contribution: 0 },
      ],
    };
    const merged = mergeLocalMemberIdentityOntoRemote(remote, local);
    expect(merged.members[0]?.name).toBe("지키");
    expect(merged.members[1]?.name).toBe("333");
  });
});
