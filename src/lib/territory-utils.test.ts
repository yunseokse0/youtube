import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import { buildHighSocietyFieldFromAppState, normalizeHighSocietySettings } from "@/lib/high-society";
import {
  aggregateSeatPushesFromTerritoryLogs,
  createTerritoryLog,
  formatTerritoryLogPushDirLabel,
  mergeHighSocietyPlayerPushInputs,
  mergeTerritoryLogsFromPatch,
  resolveTerritoryLogPushDirForWrite,
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

  it("mergeTerritoryLogsFromPatch applies subset deletion", () => {
    const a = createTerritoryLog("a", 1, 10);
    const b = createTerritoryLog("b", 1, 20);
    const merged = mergeTerritoryLogsFromPatch([a, b], [a]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe(a.id);
  });
});
