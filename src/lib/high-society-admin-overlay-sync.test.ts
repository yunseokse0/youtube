import { describe, expect, it } from "vitest";
import { applyHighSocietyAdminPatchToState } from "@/lib/admin-high-society-settings-patch";
import {
  appendTerritoryLogToAppState,
  buildHighSocietyFieldFromAppState,
  mergeHighSocietySettingsPreferBaseline,
  normalizeHighSocietySettings,
  placeHighSocietyPendingEndMember,
  resolveHighSocietyOverlayGaugeSeats,
  syncHighSocietyMemberWidthSnapshotInState,
} from "@/lib/high-society";
import { defaultState } from "@/lib/state";
import { createTerritoryLog } from "@/lib/territory-utils";
import type { AppState } from "@/types";

const IDS = ["yeong", "yuri", "jaki", "gwak", "reze", "pong"] as const;

function sixBoard(widths?: Record<string, number>, epoch = 1_000): AppState {
  const memberWidthCm =
    widths ??
    Object.fromEntries(IDS.map((id) => [id, 100]));
  return {
    ...defaultState(),
    members: IDS.map((id) => ({
      id,
      name: id,
      account: 0,
      toon: 0,
      contribution: 0,
      operating: false,
    })),
    highSocietySettings: normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: [...IDS],
      seatMemberIdsManual: true,
      startCmPerMember: 100,
      fieldCm: 600,
      matchMode: "individual",
      memberWidthCm,
      territorySnapshotEpochAt: epoch,
    }),
    territoryLogs: [],
  };
}

function boardById(state: AppState) {
  const field = buildHighSocietyFieldFromAppState(state);
  return {
    order: field.seats.map((s) => s.id),
    byId: Object.fromEntries(field.seats.map((s) => [s.id, s.widthCm])),
    total: field.seats.reduce((n, s) => n + s.widthCm, 0),
  };
}

function gaugeById(state: AppState) {
  const field = buildHighSocietyFieldFromAppState(state);
  const seats = resolveHighSocietyOverlayGaugeSeats(field.seats, state.highSocietySettings);
  return Object.fromEntries(seats.map((s) => [s.id, s.widthCm]));
}

/** OBS 폴링: last-good + 서버 GET */
function overlayFollow(lastGood: AppState | null, server: AppState): AppState {
  return {
    ...server,
    highSocietySettings: mergeHighSocietySettingsPreferBaseline(
      lastGood?.highSocietySettings,
      server.highSocietySettings
    ),
  };
}

function expectAdminObsSame(admin: AppState, obs: AppState) {
  expect(boardById(obs).byId).toEqual(boardById(admin).byId);
  expect(boardById(obs).order).toEqual(boardById(admin).order);
  expect(gaugeById(obs)).toEqual(gaugeById(admin));
}

describe("상류사회 관리자 저장 = OBS 표시", () => {
  it("자기 혼자 600 이후 실제 판이 바뀌면 OBS last-good이 따라간다", () => {
    let admin = sixBoard();
    admin = appendTerritoryLogToAppState(
      admin,
      createTerritoryLog("jaki", 1, 500, { pushDir: "split", now: 2_000 })
    );
    expect(boardById(admin).byId.jaki).toBe(600);

    let obs = overlayFollow(null, admin);
    expectAdminObsSame(admin, obs);

    const staleEqual = sixBoard(
      Object.fromEntries(IDS.map((id) => [id, 100])),
      1_500
    );
    obs = overlayFollow(obs, staleEqual);
    expect(boardById(obs).byId.jaki).toBe(600);

    const newerEqualNoInit = sixBoard(
      Object.fromEntries(IDS.map((id) => [id, 100])),
      99_000
    );
    obs = overlayFollow(obs, newerEqualNoInit);
    expect(boardById(obs).byId.jaki).toBe(600);

    admin = appendTerritoryLogToAppState(
      admin,
      createTerritoryLog("yeong", 1, 50, { pushDir: "left", now: 3_000 })
    );
    admin = appendTerritoryLogToAppState(
      admin,
      createTerritoryLog("reze", 1, 50, { pushDir: "split", now: 4_000 })
    );
    admin = appendTerritoryLogToAppState(
      admin,
      createTerritoryLog("pong", 1, 100, { pushDir: "right", now: 5_000 })
    );
    obs = overlayFollow(obs, admin);
    expectAdminObsSame(admin, obs);
    expect(boardById(obs).byId.jaki).not.toBe(600);
  });

  it("폭이 빠진 GET은 last-good을 유지하고, 새 epoch 판은 그대로 받는다", () => {
    const live = sixBoard({ yeong: 50, yuri: 0, jaki: 400, gwak: 0, reze: 50, pong: 100 }, 12_000);
    const missing = {
      ...live,
      highSocietySettings: normalizeHighSocietySettings({
        ...live.highSocietySettings,
        memberWidthCm: undefined,
        territorySnapshotEpochAt: 12_000,
      }),
    };
    const held = overlayFollow(live, missing);
    expect(boardById(held).byId.jaki).toBe(400);

    const next = sixBoard({ yeong: 50, yuri: 0, jaki: 400, gwak: 0, reze: 50, pong: 100 }, 13_000);
    expectAdminObsSame(next, overlayFollow(held, next));
  });

  it("자리만 바꿔도 탈락 영토를 되살리지 않고 OBS가 같은 순서를 따른다", () => {
    let admin = sixBoard({ yeong: 50, yuri: 0, jaki: 400, gwak: 0, reze: 50, pong: 100 }, 8_000);
    admin = applyHighSocietyAdminPatchToState(admin, {
      seatMemberIds: ["pong", "yeong", "yuri", "jaki", "gwak", "reze"],
      seatMemberIdsManual: true,
      territorySnapshotEpochAt: 9_000,
    });
    expect(boardById(admin).byId.yuri).toBe(0);
    expect(boardById(admin).byId.gwak).toBe(0);
    expect(boardById(admin).byId.jaki).toBe(400);

    const obs = overlayFollow(
      sixBoard({ yeong: 50, yuri: 0, jaki: 400, gwak: 0, reze: 50, pong: 100 }, 8_000),
      admin
    );
    expectAdminObsSame(admin, obs);
  });

  it("0cm가 왼쪽 벽으로 다시 생겨도 그 쪽 작은 땅을 없애지 않는다", () => {
    let admin = sixBoard(
      { yeong: 0, yuri: 50, jaki: 400, gwak: 0, reze: 50, pong: 100 },
      10_000
    );
    admin = appendTerritoryLogToAppState(
      admin,
      createTerritoryLog("yeong", 1, 50, { pushDir: "left", now: 11_000 })
    );
    const after = boardById(admin);
    expect(after.order[0]).toBe("yeong");
    expect(after.byId.yeong).toBe(50);
    expect(after.byId.yuri).toBeGreaterThan(0);

    const obs = overlayFollow(sixBoard({ yeong: 0, yuri: 50, jaki: 400, gwak: 0, reze: 50, pong: 100 }, 10_000), admin);
    expectAdminObsSame(admin, obs);
  });

  it("끝 선택 후에는 벽에 앉고 OBS도 같은 자리·같은 cm이다", () => {
    let admin = sixBoard();
    admin = appendTerritoryLogToAppState(
      admin,
      createTerritoryLog("jaki", 1, 100, { pushDir: "right", now: 2_000 })
    );
    admin = appendTerritoryLogToAppState(
      admin,
      createTerritoryLog("yuri", -1, 100, { pushDir: "right", now: 3_000 })
    );
    expect(boardById(admin).byId.yuri).toBe(0);
    admin = appendTerritoryLogToAppState(
      admin,
      createTerritoryLog("yuri", 1, 40, { now: 4_000 })
    );
    expect(admin.highSocietySettings?.pendingEndEntryMemberIds).toContain("yuri");

    let obs = overlayFollow(null, admin);
    expectAdminObsSame(admin, obs);

    const nextSeats = placeHighSocietyPendingEndMember(
      admin.highSocietySettings?.seatMemberIds || [],
      "yuri",
      "right"
    );
    admin = applyHighSocietyAdminPatchToState(admin, {
      seatMemberIds: nextSeats,
      seatMemberIdsManual: true,
      pendingEndEntryMemberIds: (admin.highSocietySettings?.pendingEndEntryMemberIds || []).filter(
        (id) => id !== "yuri"
      ),
      territorySnapshotEpochAt: 5_000,
    });
    expect(boardById(admin).order.at(-1)).toBe("yuri");
    expect(boardById(admin).byId.yuri).toBeGreaterThan(0);

    obs = overlayFollow(obs, admin);
    expectAdminObsSame(admin, obs);
  });

  it("1인 시작 cm를 바꾸면 균등 판이 저장되고 OBS도 그 판을 받는다", () => {
    const ate = sixBoard({ yeong: 0, yuri: 0, jaki: 600, gwak: 0, reze: 0, pong: 0 }, 8_000);
    let obs = overlayFollow(null, ate);
    const reset = applyHighSocietyAdminPatchToState(ate, {
      startCmPerMember: 200,
      fieldCm: 1200,
      memberWidthCm: Object.fromEntries(IDS.map((id) => [id, 200])),
      memberWidthDonationSnapshot: Object.fromEntries(IDS.map((id) => [id, 0])),
      memberTerritoryExpand: undefined,
      territorySnapshotEpochAt: 9_000,
      territoryBoardResetAt: 9_000,
    });
    expect(boardById(reset).byId.jaki).toBe(200);
    expect(boardById(reset).byId.yeong).toBe(200);
    obs = overlayFollow(obs, reset);
    expectAdminObsSame(reset, obs);
  });

  it("기록부가 있는데 스냅샷만 비면 균등 100cm로 저장하지 않는다", () => {
    let admin = sixBoard();
    admin = appendTerritoryLogToAppState(
      admin,
      createTerritoryLog("jaki", 1, 500, { pushDir: "split", now: 2_000 })
    );
    const wiped = {
      ...admin,
      highSocietySettings: normalizeHighSocietySettings({
        ...admin.highSocietySettings,
        memberWidthCm: undefined,
      }),
    };
    const synced = syncHighSocietyMemberWidthSnapshotInState(wiped);
    expect(synced.highSocietySettings?.memberWidthCm).toBeUndefined();
  });
});
