import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import { buildHighSocietyFieldFromAppState, normalizeHighSocietySettings } from "@/lib/high-society";
import {
  aggregateSeatPushesFromTerritoryLogs,
  createTerritoryLog,
  filterTerritoryLogsAfterReset,
  formatTerritoryLogPushDirLabel,
  mergeHighSocietyPlayerPushInputs,
  mergeTerritoryLogsFromPatch,
  mergeTerritoryLogsPreferFresher,
  resolveTerritoryLogPushDirForWrite,
  resolveTerritoryLogsResetAtForEditorMerge,
  mergeTerritoryLogsNeverShrink,
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
      formatTerritoryLogPushDirLabel(
        createTerritoryLog("subin", 1, 5, { pushDir: "right" }),
        settings,
        members
      )
    ).toBe("→ 오른쪽");
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

  it("neverShrink: longer current book replaces older session rows", () => {
    const oldSession = [
      createTerritoryLog("old", 1, 180, { now: 1000 }),
      createTerritoryLog("old", 1, 120, { now: 2000 }),
      createTerritoryLog("old", 1, 25, { now: 3000 }),
    ];
    const current = Array.from({ length: 8 }, (_, i) =>
      createTerritoryLog("a", 1, 10 + i, { now: 10_000 + i })
    );
    const merged = mergeTerritoryLogsNeverShrink(oldSession, current, { patchAuthoritative: true });
    expect(merged.map((l) => l.id).sort()).toEqual(current.map((l) => l.id).sort());
  });
});
