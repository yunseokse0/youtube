import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import {
  appendTerritoryLogToAppState,
  buildHighSocietyFieldFromAppState,
  normalizeHighSocietySettings,
} from "@/lib/high-society";
import { createTerritoryLog } from "@/lib/territory-utils";
import {
  applyDonationToAppState,
  revertDonationFromAppState,
} from "@/lib/donation/apply-donation-state";
import { foldIngestEventsIntoState } from "@/lib/din-ingest-batch-fold";
import { mergeDonationReplaceForPersist } from "@/lib/donation/merge-donation-apply-base";
import {
  projectStateForGetPick,
  revisionForStatePick,
  STATE_PICK_OVERLAY,
  STATE_PICK_OVERLAY_DONORS,
} from "@/lib/state-api-pick";
import { computeSettlement } from "@/lib/settlement-utils";
import type { DonationEvent } from "@/lib/donation/types";
import type { AppState } from "@/types";

function membersFour() {
  return [
    { id: "a", name: "자기", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "b", name: "수빈", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "c", name: "지수", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "d", name: "시우", account: 0, toon: 0, contribution: 0, operating: false },
  ];
}

function membersSix() {
  return [
    { id: "a", name: "자키", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "b", name: "나나", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "c", name: "김라라", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "d", name: "오하린", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "e", name: "하루", account: 0, toon: 0, contribution: 0, operating: false },
    { id: "f", name: "진다율", account: 0, toon: 0, contribution: 0, operating: false },
  ];
}

function hsState(): AppState {
  return {
    ...defaultState(),
    members: membersFour(),
    donors: [],
    donationSyncMode: "highSociety",
    highSocietySettings: normalizeHighSocietySettings({
      enabled: true,
      seatMemberIds: ["a", "b", "c", "d"],
      startCmPerMember: 100,
      fieldCm: 400,
      matchMode: "individual",
      territoryUpdateMode: "realtime",
    }),
    territoryLogs: [],
  };
}

function withLogs(state: AppState): AppState {
  let next = appendTerritoryLogToAppState(
    state,
    createTerritoryLog("a", 1, 100, { pushDir: "right", now: 1_000 })
  );
  next = appendTerritoryLogToAppState(next, createTerritoryLog("b", 1, 20, { now: 2_000 }));
  return next;
}

function fieldSig(state: AppState) {
  const field = buildHighSocietyFieldFromAppState(state);
  return {
    ids: field.seats.map((s) => s.id),
    widths: field.seats.map((s) => s.widthCm),
    total: field.seats.reduce((n, s) => n + s.widthCm, 0),
    alive: field.seats.filter((s) => !s.eliminated).map((s) => s.id),
    logs: (state.territoryLogs || []).map((l) => l.id),
  };
}

function evt(id: string, memberId: string, extra?: Partial<DonationEvent>): DonationEvent {
  return {
    id,
    provider: "toonation",
    externalId: id.replace(/^[^:]+:/, ""),
    donorName: `시청자_${id.slice(-4)}`,
    playerName: membersFour().find((m) => m.id === memberId)?.name,
    amount: 10_000,
    at: new Date(10_000).toISOString(),
    status: "queued",
    target: "toon",
    memberId,
    manualAssignMemberId: memberId,
    ...extra,
  };
}

describe("상류사회 × 후원 반영 (게이지는 기록부, 후원은 정산·명단)", () => {
  it("후원이 들어와도 영토 기록·0cm 재진입 자리는 그대로다", () => {
    const before = withLogs(hsState());
    const sigBefore = fieldSig(before);
    expect(sigBefore.alive[0]).toBe("b");
    expect(sigBefore.total).toBe(400);

    const applied = applyDonationToAppState(before, evt("toonation:hs-1", "a"));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const after = applied.state;
    const sigAfter = fieldSig(after);

    expect(sigAfter).toEqual(sigBefore);
    expect(after.highSocietySettings?.memberWidthCm).toEqual(before.highSocietySettings?.memberWidthCm);
    expect(after.highSocietySettings?.territorySnapshotEpochAt).toBe(
      before.highSocietySettings?.territorySnapshotEpochAt
    );
    expect(after.donors).toHaveLength(1);
    expect(after.donors?.[0]?.hsTerritoryExcluded).toBe(true);
    expect(after.members.find((m) => m.id === "a")?.toon).toBe(10_000);
    expect(after.territoryLogs).toHaveLength(2);
  });

  it("1만원 아닌 금액도 후원 명단에 남고 게이지는 안 움직인다", () => {
    const before = withLogs(hsState());
    const sigBefore = fieldSig(before);
    const applied = applyDonationToAppState(
      before,
      evt("toonation:odd", "b", { amount: 13_000 })
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(fieldSig(applied.state)).toEqual(sigBefore);
    expect(applied.state.donors?.[0]?.amount).toBe(13_000);
    expect(applied.state.members.find((m) => m.id === "b")?.toon).toBe(13_000);
  });

  it("방향이 붙은 후원도 게이지를 밀지 않는다", () => {
    const before = withLogs(hsState());
    const sigBefore = fieldSig(before);
    const applied = applyDonationToAppState(
      before,
      evt("toonation:dir", "c", { hsPushDir: "left", amount: 200_000 })
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(fieldSig(applied.state)).toEqual(sigBefore);
    expect(applied.state.donors?.[0]?.hsPushDir).toBe("left");
  });

  it("연사 ingest 묶음은 후원만 합치고 기록부는 유지한다", () => {
    const before = withLogs(hsState());
    const sigBefore = fieldSig(before);
    const folded = foldIngestEventsIntoState(before, [
      evt("bank:din:a", "a", {
        provider: "bank",
        target: "account",
        at: new Date(11_000).toISOString(),
      }),
      evt("bank:din:a", "a", {
        provider: "bank",
        target: "account",
        at: new Date(11_000).toISOString(),
      }),
      evt("bank:din:b", "b", {
        provider: "bank",
        target: "account",
        at: new Date(12_000).toISOString(),
        amount: 20_000,
      }),
    ]);
    expect(folded.applied).toHaveLength(2);
    expect(folded.duplicates).toBe(1);
    expect(fieldSig(folded.state)).toEqual(sigBefore);
    expect(folded.state.members.find((m) => m.id === "a")?.account).toBe(10_000);
    expect(folded.state.members.find((m) => m.id === "b")?.account).toBe(20_000);
    expect(folded.state.territoryLogs).toHaveLength(2);
  });

  it("후원 삭제(제외) 후에도 게이지와 기록부는 남는다", () => {
    const before = withLogs(hsState());
    const applied = applyDonationToAppState(before, evt("toonation:del", "d"));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const sigMid = fieldSig(applied.state);
    const reverted = revertDonationFromAppState(applied.state, "toonation:del");
    expect(reverted).not.toBeNull();
    expect(fieldSig(reverted!)).toEqual(sigMid);
    expect(reverted!.territoryLogs).toHaveLength(2);
    expect(reverted!.members.find((m) => m.id === "d")?.toon).toBe(0);
    expect(reverted!.donors?.some((d) => d.id === "toonation:del" && d.donationExcluded)).toBe(true);
  });

  it("이름 없는 후원은 자동 배치되어도 기록부는 그대로고, 중복은 거절된다", () => {
    const before = withLogs(hsState());
    const sigBefore = fieldSig(before);
    const miss = applyDonationToAppState(before, {
      id: "bank:noname",
      provider: "bank",
      externalId: "noname",
      donorName: "익명",
      amount: 10_000,
      at: new Date(10_000).toISOString(),
      status: "queued",
      target: "account",
    });
    expect(miss.ok).toBe(true);
    if (!miss.ok) return;
    expect(fieldSig(miss.state)).toEqual(sigBefore);
    expect(miss.state.donors).toHaveLength(1);
    expect(miss.state.donors?.[0]?.memberAutoAssigned).toBe(true);

    const dupFirst = applyDonationToAppState(before, evt("toonation:dup", "a"));
    expect(dupFirst.ok).toBe(true);
    if (!dupFirst.ok) return;
    const dupSecond = applyDonationToAppState(dupFirst.state, evt("toonation:dup", "a"));
    expect(dupSecond.ok).toBe(false);
    expect(fieldSig(dupFirst.state)).toEqual(sigBefore);
    expect(dupFirst.state.donors).toHaveLength(1);
  });

  it("오버레이 pick은 후원 이후에도 기록부와 후원 명단을 같이 보낸다", () => {
    const before = withLogs(hsState());
    const applied = applyDonationToAppState(before, evt("toonation:obs", "a"));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const overlay = projectStateForGetPick(applied.state, STATE_PICK_OVERLAY) as Record<
      string,
      unknown
    >;
    const donorsPick = projectStateForGetPick(
      applied.state,
      STATE_PICK_OVERLAY_DONORS
    ) as Record<string, unknown>;
    expect(overlay.territoryLogs).toEqual(applied.state.territoryLogs);
    expect(overlay.donors).toBeUndefined();
    expect(donorsPick.territoryLogs).toEqual(applied.state.territoryLogs);
    expect(donorsPick.donors).toEqual(applied.state.donors);
    expect(revisionForStatePick(applied.state, STATE_PICK_OVERLAY)).toBeGreaterThanOrEqual(
      Number(applied.state.territoryLogs?.[1]?.at || 0)
    );
  });

  it("정산표는 상류사회 중 들어온 후원 금액을 포함한다", () => {
    const before = withLogs(hsState());
    const applied = applyDonationToAppState(
      before,
      evt("toonation:set", "a", { amount: 100_000, target: "account" })
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const sheet = computeSettlement(applied.state.members, 0.7, 0.6);
    const rowA = sheet.members.find((m) => m.memberId === "a");
    expect(rowA?.account).toBe(100_000);
    expect(fieldSig(applied.state).total).toBe(400);
  });

  it("저장 병합이 짧은 leftover 기록부로 게이지를 되돌리지 않는다", () => {
    const live = withLogs(hsState());
    const applied = applyDonationToAppState(live, evt("toonation:merge", "a"));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const leftover: AppState = {
      ...applied.state,
      territoryLogs: applied.state.territoryLogs?.slice(0, 1) || [],
      updatedAt: Number(applied.state.updatedAt || 0) + 1,
    };
    const merged = mergeDonationReplaceForPersist(leftover, applied.state);
    expect(merged.territoryLogs?.map((l) => l.id)).toEqual(
      applied.state.territoryLogs?.map((l) => l.id)
    );
    expect(fieldSig(merged).alive[0]).toBe("b");
    expect(merged.donors?.some((d) => d.id === "toonation:merge")).toBe(true);
  });

  it("투네 이름 매칭만으로 들어와도 게이지는 기록부 그대로다", () => {
    const before = withLogs(hsState());
    const sigBefore = fieldSig(before);
    const applied = applyDonationToAppState(before, {
      id: "toonation:name",
      provider: "toonation",
      externalId: "name",
      donorName: "시청자",
      playerName: "수빈",
      amount: 20_000,
      at: new Date(10_000).toISOString(),
      status: "queued",
      target: "toon",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(fieldSig(applied.state)).toEqual(sigBefore);
    expect(applied.state.members.find((m) => m.id === "b")?.toon).toBe(20_000);
    expect(applied.state.donors?.[0]?.hsTerritoryExcluded).toBe(true);
  });

  it("영토 일시정지 중에도 후원은 쌓이고 게이지는 그대로다", () => {
    let state = withLogs(hsState());
    state = {
      ...state,
      highSocietySettings: normalizeHighSocietySettings({
        ...state.highSocietySettings,
        territoryPaused: true,
        territoryPausedAt: 9_000,
      }),
    };
    const sigBefore = fieldSig(state);
    const applied = applyDonationToAppState(state, evt("toonation:pause", "c"));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(fieldSig(applied.state)).toEqual(sigBefore);
    expect(applied.state.members.find((m) => m.id === "c")?.toon).toBe(10_000);
    expect(applied.state.highSocietySettings?.territoryPaused).toBe(true);
  });
});

describe("상류사회 개인전 6인 × 후원", () => {
  function hsSix(): AppState {
    const ids = membersSix().map((m) => m.id);
    return {
      ...defaultState(),
      members: membersSix(),
      donors: [],
      donationSyncMode: "highSociety",
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

  it("6인 게이지에 후원이 들어와도 영토는 그대로고 정산 금액만 쌓인다", () => {
    let state = hsSix();
    state = appendTerritoryLogToAppState(
      state,
      createTerritoryLog("c", 1, 20, { now: 1_000 })
    );
    const before = buildHighSocietyFieldFromAppState(state);
    expect(before.playerCount).toBe(6);
    expect(before.seats.reduce((n, s) => n + s.widthCm, 0)).toBe(600);

    const applied = applyDonationToAppState(state, {
      id: "toonation:six-1",
      provider: "toonation",
      externalId: "six-1",
      donorName: "시청자",
      playerName: "하루",
      amount: 100_000,
      at: new Date(10_000).toISOString(),
      status: "queued",
      target: "toon",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const after = buildHighSocietyFieldFromAppState(applied.state);
    expect(after.seats.map((s) => s.widthCm)).toEqual(before.seats.map((s) => s.widthCm));
    expect(applied.state.members.find((m) => m.id === "e")?.toon).toBe(100_000);
    expect(applied.state.donors?.[0]?.hsTerritoryExcluded).toBe(true);
    const sheet = computeSettlement(applied.state.members, 0.7, 0.6);
    expect(sheet.members.find((m) => m.memberId === "e")?.toon).toBe(100_000);
  });
});
