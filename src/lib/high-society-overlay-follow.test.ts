import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import {
  appendTerritoryLogToAppState,
  buildHighSocietyFieldFromAppState,
  normalizeHighSocietySettings,
} from "@/lib/high-society";
import { createTerritoryLog } from "@/lib/territory-utils";
import type { AppState } from "@/types";

/** 오버레이 `buildHighSocietyFieldFromAppState` 경로 — 영토 기록이 늘면 게이지가 따라간다 */
describe("상류사회 오버레이 ← 영토 기록부", () => {
  function sixRealtime(): AppState {
    const ids = ["a", "b", "c", "d", "e", "f"];
    return {
      ...defaultState(),
      members: ids.map((id) => ({
        id,
        name: id.toUpperCase(),
        account: 0,
        toon: 0,
        contribution: 0,
        operating: false,
      })),
      highSocietySettings: normalizeHighSocietySettings({
        enabled: true,
        seatMemberIds: ids,
        startCmPerMember: 100,
        fieldCm: 600,
        matchMode: "individual",
        territoryUpdateMode: "realtime",
      }),
      territoryLogs: [],
    };
  }

  function widths(state: AppState) {
    const field = buildHighSocietyFieldFromAppState(state);
    return {
      byId: Object.fromEntries(field.seats.map((s) => [s.id, s.widthCm])),
      total: field.seats.reduce((n, s) => n + s.widthCm, 0),
      order: field.seats.map((s) => s.id),
    };
  }

  it("기록이 추가될 때마다 오버레이 게이지가 같은 전장에서 따라간다", () => {
    let state = sixRealtime();
    expect(widths(state).byId).toEqual({ a: 100, b: 100, c: 100, d: 100, e: 100, f: 100 });

    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { now: 1_000 }));
    expect(widths(state)).toMatchObject({
      byId: { a: 100, b: 90, c: 120, d: 90, e: 100, f: 100 },
      total: 600,
    });

    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("a", 1, 20, { pushDir: "right", now: 2_000 })
    );
    const afterA = widths(state);
    expect(afterA.total).toBe(600);
    expect(afterA.byId.a).toBe(120);
    expect(afterA.byId.b).toBe(70);
    expect(afterA.byId.c).toBe(120);

    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("f", 1, 20, { pushDir: "left", now: 3_000 })
    );
    const afterF = widths(state);
    expect(afterF.total).toBe(600);
    expect(afterF.byId.f).toBe(120);
    expect(afterF.byId.e).toBe(80);
  });

  it("실시간 모드에서는 매치 타이머가 남아 있어도 기록 반영을 막지 않는다", () => {
    let state = sixRealtime();
    state = {
      ...state,
      matchTimer: {
        remainingTime: 3_600,
        isActive: true,
        lastUpdated: Date.now(),
      } as AppState["matchTimer"],
    };
    state = appendTerritoryLogToAppState(state, createTerritoryLog("d", 1, 20, { now: 1_000 }));
    expect(state.highSocietySettings?.territoryUpdateMode).toBe("realtime");
    expect(widths(state).byId.d).toBe(120);
    expect(widths(state).total).toBe(600);
  });

  it("옛 onRoundEnd 저장값·타이머가 있어도 기록부를 그대로 반영한다", () => {
    let state = sixRealtime();
    state = {
      ...state,
      highSocietySettings: normalizeHighSocietySettings({
        ...state.highSocietySettings,
        territoryUpdateMode: "onRoundEnd",
      }),
      matchTimer: {
        remainingTime: 3_600,
        isActive: true,
        lastUpdated: Date.now(),
      } as AppState["matchTimer"],
    };
    expect(state.highSocietySettings?.territoryUpdateMode).toBe("realtime");
    state = appendTerritoryLogToAppState(state, createTerritoryLog("d", 1, 20, { now: 1_000 }));
    expect(widths(state).byId.d).toBe(120);
    expect(widths(state).total).toBe(600);
  });

  it("후원만 넣으면 게이지는 그대로고 기록부가 움직일 때만 변한다", () => {
    let state = sixRealtime();
    const equal = { a: 100, b: 100, c: 100, d: 100, e: 100, f: 100 };
    expect(widths(state).byId).toEqual(equal);
    state = {
      ...state,
      donors: [
        {
          id: "d-c-100k",
          name: "후원만",
          amount: 100_000,
          memberId: "c",
          at: 50,
          hsTerritoryExcluded: true,
        },
      ],
      members: state.members.map((m) =>
        m.id === "c" ? { ...m, account: 100_000 } : m
      ),
    };
    expect(widths(state).byId).toEqual(equal);
    state = appendTerritoryLogToAppState(state, createTerritoryLog("c", 1, 20, { now: 1_000 }));
    expect(widths(state).byId.c).toBe(120);
    expect(widths(state).total).toBe(600);
  });
});
