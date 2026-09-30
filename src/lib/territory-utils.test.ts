import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import { buildHighSocietyFieldFromAppState, normalizeHighSocietySettings } from "@/lib/high-society";
import {
  aggregateSeatPushesFromTerritoryLogs,
  createTerritoryLog,
  filterTerritoryLogsAfterReset,
  formatTerritoryLogActorLabel,
  formatTerritoryLogPushDirLabel,
  mergeHighSocietyPlayerPushInputs,
  mergeTerritoryLogsFromPatch,
  mergeTerritoryLogsPreferFresher,
  resolveTerritoryLogPushDirForWrite,
  resolveTerritoryLogsResetAtForEditorMerge,
  mergeTerritoryLogsNeverShrink,
  mergeOverlayTerritoryLogs,
} from "@/lib/territory-utils";

describe("territory-utils", () => {
  it("aggregates manual territory logs per seat", () => {
    const settings = defaultState().highSocietySettings!;
    const seatPlayers = [
      { id: "a", name: "A" },
      { id: "b", name: "B" },
      { id: "c", name: "C" },
      { id: "d", name: "D" },
    ];
    const logs = [
      createTerritoryLog("b", 1, 10, { pushDir: "right" }),
      createTerritoryLog("b", -1, 3, { pushDir: "right" }),
    ];
    const pushes = aggregateSeatPushesFromTerritoryLogs({ seatPlayers, logs, settings });
    const b = pushes.find((p) => p.id === "b");
    expect(b?.expandRightCm).toBe(7);
    expect(b?.expandLeftCm).toBe(0);
  });

  it("merges donor pushes with manual log pushes", () => {
    const merged = mergeHighSocietyPlayerPushInputs(
      [{ id: "m1", name: "A", expandLeftCm: 5, expandRightCm: 0, donationWon: 10000 }],
      [{ id: "m1", name: "A", expandLeftCm: 0, expandRightCm: 3, donationWon: 0 }]
    );
    expect(merged[0]?.expandLeftCm).toBe(5);
    expect(merged[0]?.expandRightCm).toBe(3);
  });

  it("resolveTerritoryLogPushDirForWrite stores end-seat fixed direction", () => {
    const settings = normalizeHighSocietySettings({ defaultMiddlePush: "left" });
    expect(
      resolveTerritoryLogPushDirForWrite({
        seatRole: { canChoosePush: false, expandDir: "left" },
        chosen: "system",
        settings,
      })
    ).toBe("left");
    expect(
      resolveTerritoryLogPushDirForWrite({
        seatRole: { canChoosePush: false, expandDir: "right" },
        chosen: "system",
        settings,
      })
    ).toBe("right");
    expect(
      resolveTerritoryLogPushDirForWrite({
        seatRole: { canChoosePush: true, expandDir: "both", index: 1 },
        chosen: "system",
        settings,
      })
    ).toBe("split");
  });

  it("formatTerritoryLogPushDirLabel shows implicit end direction for legacy logs", () => {
    const members = [
      { id: "subin", name: "수빈", account: 0, toon: 0, operating: false },
      { id: "jaki", name: "자키", account: 0, toon: 0, operating: false },
      { id: "jisu", name: "지수", account: 0, toon: 0, operating: false },
    ];
    const settings = normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["subin", "jaki", "jisu"],
      defaultMiddlePush: "left",
    });
    const log = createTerritoryLog("jisu", 1, 105);
    expect(formatTerritoryLogPushDirLabel(log, settings, members)).toBe("← 왼쪽");
    expect(
      formatTerritoryLogPushDirLabel(createTerritoryLog("jaki", 1, 20), settings, members)
    ).toBe("↔ 양분");
    expect(
      formatTerritoryLogPushDirLabel(
        createTerritoryLog("subin", 1, 5, { pushDir: "right" }),
        settings,
        members
      )
    ).toBe("→ 오른쪽");
  });

  it("개인전 기록부는 팀 로그를 멤버 이름으로 보여 주고 팀전만 [팀] 라벨을 쓴다", () => {
    const members = [
      { id: "jaki", name: "자키" },
      { id: "nana", name: "나나" },
      { id: "kim", name: "김라라" },
    ];
    const teams = [{ id: "ta", name: "TEAM A(자키,나나,김라라)" }];
    const assignments = { jaki: "ta", nana: "ta", kim: "ta" };
    const teamLog = createTerritoryLog("jaki", 1, 50, { teamId: "ta" });
    const personLog = createTerritoryLog("jaki", 1, 10);
    const opts = { teams, members, memberTeamAssignments: assignments };
    expect(formatTerritoryLogActorLabel(teamLog, { ...opts, matchMode: "team" })).toBe(
      "[TEAM A(자키,나나,김라라)] 팀"
    );
    expect(formatTerritoryLogActorLabel(teamLog, { ...opts, matchMode: "individual" })).toBe(
      "자키·나나·김라라"
    );
    expect(formatTerritoryLogActorLabel(personLog, { ...opts, matchMode: "individual" })).toBe("자키");
  });

  it("배치도에서 바꾼 영토 이름은 기록부 멤버 칸에 그대로 나온다", () => {
    const members = [{ id: "jaki", name: "자키" }];
    const personLog = createTerritoryLog("jaki", 1, 10);
    expect(
      formatTerritoryLogActorLabel(personLog, {
        matchMode: "individual",
        members,
        territoryLabelByMemberId: { jaki: "자키땅" },
      })
    ).toBe("자키땅");
    expect(
      formatTerritoryLogActorLabel(personLog, {
        matchMode: "individual",
        members,
      })
    ).toBe("자키");
  });

  it("buildHighSocietyFieldFromAppState includes territory logs", () => {
    const base = defaultState();
    const state = {
      ...base,
      members: [
        { id: "m1", name: "A", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "B", account: 0, toon: 0, contribution: 0 },
        { id: "m3", name: "C", account: 0, toon: 0, contribution: 0 },
        { id: "m4", name: "D", account: 0, toon: 0, contribution: 0 },
      ],
      highSocietySettings: {
        ...base.highSocietySettings!,
        enabled: true,
        seatMemberIds: ["m1", "m2", "m3", "m4"],
        seatMemberIdsManual: true,
      },
      donors: [],
      territoryLogs: [createTerritoryLog("m2", 1, 15, { pushDir: "right" })],
    };
    const field = buildHighSocietyFieldFromAppState(state);
    const b = field.seats.find((s) => s.id === "m2");
    expect(b?.widthCm).toBeGreaterThan(100);
  });

  it("mergeTerritoryLogsFromPatch applies subset deletion only with tombstone", () => {
    const a = createTerritoryLog("a", 1, 10);
    const b = createTerritoryLog("b", 1, 20);
    const merged = mergeTerritoryLogsFromPatch([a, b], [a], { deletedIds: [b.id] });
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(a.id);
  });

  it("stale shorter patch does not drop a newer concurrent log", () => {
    const a = createTerritoryLog("a", 1, 20, { now: 1000 });
    const b = createTerritoryLog("b", 1, 20, { now: 2000 });
    const c = createTerritoryLog("c", 1, 20, { now: 3000 });
    const merged = mergeTerritoryLogsFromPatch([a, b, c], [a, b], {
      baseUpdatedAt: 3000,
      patchUpdatedAt: 2000,
    });
    expect(merged.map((l) => l.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("newer shorter patch without tombstone does not drop the extra log", () => {
    const a = createTerritoryLog("a", 1, 20, { now: 1000 });
    const b = createTerritoryLog("b", 1, 20, { now: 2000 });
    const c = createTerritoryLog("c", 1, 20, { now: 3000 });
    const merged = mergeTerritoryLogsFromPatch([a, b, c], [a, b], {
      baseUpdatedAt: 3000,
      patchUpdatedAt: 4000,
    });
    expect(merged.map((l) => l.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("newer subset patch with tombstone deletes that log", () => {
    const a = createTerritoryLog("a", 1, 20, { now: 1000 });
    const b = createTerritoryLog("b", 1, 20, { now: 2000 });
    const c = createTerritoryLog("c", 1, 20, { now: 3000 });
    const merged = mergeTerritoryLogsFromPatch([a, b, c], [a, b], {
      baseUpdatedAt: 3000,
      patchUpdatedAt: 4000,
      deletedIds: [c.id],
    });
    expect(merged).toHaveLength(2);
    expect(merged.map((l) => l.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("newer stale longer patch does not resurrect a deleted log", () => {
    const a = createTerritoryLog("a", 1, 20, { now: 1000 });
    const b = createTerritoryLog("b", 1, 20, { now: 2000 });
    const c = createTerritoryLog("c", 1, 20, { now: 3000 });
    const merged = mergeTerritoryLogsFromPatch([a, b], [a, b, c], {
      baseUpdatedAt: 8000,
      patchUpdatedAt: 9000,
    });
    expect(merged.map((l) => l.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("reset empty base does not resurrect older logs even if patch timestamp is newer", () => {
    const oldA = createTerritoryLog("a", 1, 20, { now: 1000 });
    const oldB = createTerritoryLog("b", 1, 25, { now: 2000 });
    const merged = mergeTerritoryLogsFromPatch([], [oldA, oldB], {
      baseUpdatedAt: 10_000,
      patchUpdatedAt: 12_000,
    });
    expect(merged).toEqual([]);
  });

  it("empty local reset does not union older remote logs", () => {
    const oldA = createTerritoryLog("a", 1, 100, { now: 1000 });
    const merged = mergeTerritoryLogsPreferFresher([], [oldA], {
      localUpdatedAt: 50_000,
      remoteUpdatedAt: 40_000,
    });
    expect(merged).toEqual([]);
  });

  it("자리 변경처럼 빈 원격·더 큰 updatedAt 만으로는 로컬 기록부를 지우지 않는다", () => {
    const a = createTerritoryLog("a", 1, 80, { now: 1000 });
    const b = createTerritoryLog("b", 1, 40, { now: 2000 });
    const merged = mergeTerritoryLogsPreferFresher([a, b], [], {
      localUpdatedAt: 4000,
      remoteUpdatedAt: 5000,
      territoryLogsResetAt: 0,
    });
    expect(merged.map((l) => l.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("editor merge resetAt does not use a higher remote stamp to drop local rows", () => {
    expect(
      resolveTerritoryLogsResetAtForEditorMerge({
        localResetAt: 10,
        remoteResetAt: 50_000,
        remoteLogsEmpty: false,
      })
    ).toBe(10);
    expect(
      resolveTerritoryLogsResetAtForEditorMerge({
        localResetAt: 10,
        remoteResetAt: 50_000,
        remoteLogsEmpty: true,
      })
    ).toBe(50_000);
  });

  it("filterTerritoryLogsAfterReset keeps only post-reset logs", () => {
    const oldA = createTerritoryLog("a", 1, 100, { now: 1000 });
    const newA = createTerritoryLog("a", 1, 180, { now: 60_000 });
    expect(filterTerritoryLogsAfterReset([oldA, newA], 50_000).map((l) => l.id)).toEqual([newA.id]);
  });

  it("short 1-row patch does not wipe the rest of the logbook", () => {
    const a = createTerritoryLog("a", 1, 25, { now: 1000 });
    const b = createTerritoryLog("a", 1, 180, { now: 2000 });
    const c = createTerritoryLog("a", 1, 35, { now: 3000 });
    const d = createTerritoryLog("b", 1, 30, { now: 4000 });
    const e = createTerritoryLog("b", 1, 50, { now: 5000 });
    const merged = mergeTerritoryLogsFromPatch([a, b, c, d, e], [a], {
      baseUpdatedAt: 1000,
      patchUpdatedAt: 9000,
    });
    expect(merged).toHaveLength(5);
  });

  it("deletedTerritoryLogIds removes only those logs", () => {
    const a = createTerritoryLog("a", 1, 25, { now: 1000 });
    const b = createTerritoryLog("a", 1, 300, { now: 2000 });
    const c = createTerritoryLog("b", 1, 50, { now: 3000 });
    const merged = mergeTerritoryLogsFromPatch([a, b, c], [a, c], {
      baseUpdatedAt: 1000,
      patchUpdatedAt: 4000,
      deletedIds: [b.id],
    });
    expect(merged.map((l) => l.id).sort()).toEqual([a.id, c.id].sort());
  });

  it("preferFresher does not replace many logs with a single newer local row", () => {
    const a = createTerritoryLog("a", 1, 25, { now: 1000 });
    const b = createTerritoryLog("a", 1, 180, { now: 2000 });
    const c = createTerritoryLog("b", 1, 50, { now: 3000 });
    const merged = mergeTerritoryLogsPreferFresher([a], [a, b, c], {
      localUpdatedAt: 9000,
      remoteUpdatedAt: 3000,
    });
    expect(merged.map((l) => l.id).sort()).toEqual([a.id, b.id, c.id].sort());
  });

  it("preferFresher keeps older rows when a newer 2-row snapshot arrives without tombstone", () => {
    const a = createTerritoryLog("a", 1, 80, { now: 1000 });
    const b = createTerritoryLog("a", 1, 40, { now: 2000 });
    const c = createTerritoryLog("b", 1, 50, { now: 3000 });
    const d = createTerritoryLog("a", 1, 10, { now: 4000 });
    const merged = mergeTerritoryLogsPreferFresher([a, b, c, d], [c, d], {
      localUpdatedAt: 4000,
      remoteUpdatedAt: 5000,
    });
    expect(merged.map((l) => l.id).sort()).toEqual([a.id, b.id, c.id, d.id].sort());
  });

  it("neverShrink: growing 11 then stale 10 does not drop the last row", () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      createTerritoryLog("a", 1, (i + 1) * 5, { now: 1000 + i })
    );
    const grown = mergeTerritoryLogsNeverShrink(rows.slice(0, 10), rows, { patchAuthoritative: true });
    expect(grown).toHaveLength(11);
    const stale = mergeTerritoryLogsNeverShrink(rows, rows.slice(0, 10), { patchAuthoritative: true });
    expect(stale).toHaveLength(11);
    expect(stale.map((l) => l.id).sort()).toEqual(rows.map((l) => l.id).sort());
  });

  it("neverShrink: 초기화 전에는 다른 목록이 와도 기존 기록을 지우지 않는다", () => {
    const oldSession = [
      createTerritoryLog("old", 1, 180, { now: 1000 }),
      createTerritoryLog("old", 1, 120, { now: 2000 }),
      createTerritoryLog("old", 1, 25, { now: 3000 }),
    ];
    const current = Array.from({ length: 8 }, (_, i) =>
      createTerritoryLog("a", 1, 10 + i, { now: 10_000 + i })
    );
    const merged = mergeTerritoryLogsNeverShrink(oldSession, current, { patchAuthoritative: true });
    expect(merged.map((l) => l.id).sort()).toEqual(
      [...oldSession, ...current].map((l) => l.id).sort()
    );
    const first = createTerritoryLog("pong", 1, 100, { now: 5_000 });
    const second = createTerritoryLog("pong", 1, 100, { now: 6_000 });
    const raced = mergeTerritoryLogsNeverShrink([first], [second], { patchAuthoritative: true });
    expect(raced.map((l) => l.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("overlay merge keeps last-good when incoming is empty without a reset stamp", () => {
    const a = createTerritoryLog("a", 1, 80, { now: 1_000 });
    const merged = mergeOverlayTerritoryLogs({
      lastGoodLogs: [a],
      incomingLogs: [],
      incomingHasKey: true,
      lastGoodResetAt: 0,
      incomingResetAt: 0,
    });
    expect(merged.map((l) => l.id)).toEqual([a.id]);
  });

  it("overlay merge does not resurrect stale logs after a newer empty reset", () => {
    const stale = [
      createTerritoryLog("a", 1, 80, { now: 1_000 }),
      createTerritoryLog("b", 1, 40, { now: 2_000 }),
    ];
    const merged = mergeOverlayTerritoryLogs({
      lastGoodLogs: [],
      incomingLogs: stale,
      incomingHasKey: true,
      lastGoodResetAt: 9_000,
      incomingResetAt: 0,
    });
    expect(merged).toEqual([]);
  });

  it("overlay merge keeps a newly added log when last-good is shorter", () => {
    const older = createTerritoryLog("a", 1, 20, { now: 1_000 });
    const newer = createTerritoryLog("b", 1, 50, { now: 2_000 });
    const merged = mergeOverlayTerritoryLogs({
      lastGoodLogs: [older],
      incomingLogs: [older, newer],
      incomingHasKey: true,
      lastGoodResetAt: 0,
      incomingResetAt: 0,
    });
    expect(merged.map((l) => l.id).sort()).toEqual([older.id, newer.id].sort());
  });
});
