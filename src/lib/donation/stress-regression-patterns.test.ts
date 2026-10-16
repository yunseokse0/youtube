import { describe, expect, it } from "vitest";
import { donationHubIdentity } from "@/domain/dedupe/donation-hub-identity";
import { isHighSocietySettingsOnlyPatch } from "@/domain/guards/zero-wipe-guard";
import { applyDonationToAppState, syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import { foldIngestEventsIntoState, shouldDiscardIngestEventForReset } from "@/lib/din-ingest-batch-fold";
import { applyGroupSplitDonationToAppState } from "@/lib/donation/group-split-donation";
import { applySettlementResetToState } from "@/lib/settlement-reset-apply";
import { defaultState, mergeDonorsForMultiTabSave } from "@/lib/state";
import { memberDonationRankingTotal } from "@/lib/utils";
import type { DonationEvent } from "@/lib/donation/types";
import type { AppState } from "@/types";

function base(): AppState {
  return {
    ...defaultState(),
    members: [
      { id: "m1", name: "자키", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "수린", account: 0, toon: 0, contribution: 0 },
      { id: "m3", name: "신연서", account: 0, toon: 0, contribution: 0 },
    ],
    donors: [],
  };
}

function ev(partial: Partial<DonationEvent> & Pick<DonationEvent, "id" | "amount" | "at">): DonationEvent {
  return {
    provider: "toonation",
    externalId: partial.externalId || partial.id,
    donorName: partial.donorName || "유이",
    playerName: "자키",
    memberId: partial.memberId || "m1",
    message: partial.message ?? "응원",
    status: "queued",
    target: partial.target ?? "toon",
    ...partial,
  };
}

function applyAll(start: AppState, events: DonationEvent[]) {
  let state = start;
  let applied = 0;
  let duplicate = 0;
  let unmatched = 0;
  for (const event of events) {
    const result = applyDonationToAppState(state, event);
    if (result.ok) {
      state = result.state;
      applied += 1;
    } else if (result.reason === "duplicate") duplicate += 1;
    else unmatched += 1;
  }
  const donors = state.donors || [];
  return {
    state,
    applied,
    duplicate,
    unmatched,
    rows: donors.length,
    sum: donors.reduce((acc, d) => acc + (Number(d.amount) || 0), 0),
  };
}

describe("후원 스트레스 회귀 — 기존 문제", () => {
  it("허브 id 표기가 달라도 한 줄로 접힌다 (sms/din 중복)", () => {
    const hub = "cmumnh225030p5jbudpwtl6fi";
    const at = new Date(1_790_700_000_000).toISOString();
    const out = applyAll(base(), [
      ev({ id: `toonation:din:${hub}`, externalId: hub, amount: 50_000, at }),
      ev({
        id: `bank:sms:${hub}`,
        provider: "bank",
        externalId: "toonation:fmumn2hmpb499",
        amount: 50_000,
        at,
        target: "account",
      }),
    ]);
    expect(donationHubIdentity(`toonation:din:${hub}`)).toBe(hub);
    expect(out.applied).toBe(1);
    expect(out.duplicate).toBe(1);
    expect(out.rows).toBe(1);
    expect(out.sum).toBe(50_000);
  });

  it("서로 다른 허브 40건은 같은 시각 폭주여도 빠지지 않는다", () => {
    const at = new Date(1_790_700_100_000).toISOString();
    const events = Array.from({ length: 40 }, (_, i) =>
      ev({
        id: `toonation:din:hub${String(i).padStart(4, "0")}`,
        externalId: `hub${String(i).padStart(4, "0")}`,
        amount: 1000 + i,
        at,
        donorName: i % 2 === 0 ? "유이" : "오라",
      })
    );
    const out = applyAll(base(), events);
    expect(out.applied).toBe(40);
    expect(out.duplicate).toBe(0);
    expect(out.rows).toBe(40);
    expect(out.sum).toBe(events.reduce((a, e) => a + e.amount, 0));
  });

  it("이름·금액·메시지가 같아도 id가 다르면 1초 연타를 합치지 않는다", () => {
    const t0 = 1_790_700_200_000;
    const events = Array.from({ length: 20 }, (_, i) =>
      ev({
        id: `toonation:din:seq${i}`,
        externalId: `seq${i}`,
        amount: 10_000,
        at: new Date(t0 + i * 1000).toISOString(),
        donorName: "유이",
        message: "같은말",
      })
    );
    const out = applyAll(base(), events);
    expect(out.rows).toBe(20);
    expect(out.sum).toBe(200_000);
  });

  it("오래된 탭 저장이 이미 반영된 후원을 지우지 않는다", () => {
    const at = new Date(1_790_700_300_000).toISOString();
    const events = Array.from({ length: 40 }, (_, i) =>
      ev({
        id: `toonation:din:keep${i}`,
        externalId: `keep${i}`,
        amount: 1000,
        at,
      })
    );
    const full = applyAll(base(), events).state;
    const stale = {
      ...full,
      donors: (full.donors || []).slice(0, 25),
      updatedAt: Number(full.updatedAt || 0) - 1000,
    };
    const merged = mergeDonorsForMultiTabSave(stale.donors || [], full.donors, {
      incomingUpdatedAt: stale.updatedAt,
      existingUpdatedAt: full.updatedAt,
    });
    expect(merged).toHaveLength(40);
  });

  it("정산 리셋은 후원만 비우고 영토 cm·기록은 남긴다", () => {
    const prev: AppState = {
      ...base(),
      donors: [{ id: "d1", name: "후원", amount: 50_000, memberId: "m1", at: 1500, target: "toon" }],
      members: [{ id: "m1", name: "자키", account: 0, toon: 50_000, contribution: 50_000 }],
      territoryLogs: [{ id: "t1", memberId: "m1", amount: 80, delta: 1, at: 3000 }],
      highSocietySettings: {
        ...defaultState().highSocietySettings!,
        memberWidthCm: { m1: 180, m2: 20 },
        territoryLogsResetAt: 1000,
      },
    };
    const next = applySettlementResetToState(prev, { mode: "keep", resetAt: 9000 });
    expect(next.donors).toHaveLength(0);
    expect(next.territoryLogs).toEqual(prev.territoryLogs);
    expect(next.highSocietySettings?.memberWidthCm).toEqual({ m1: 180, m2: 20 });
    expect(next.highSocietySettings?.territoryLogsResetAt).toBe(1000);
  });

  it("정산 리셋 stamp 이전 ingest는 장부에 넣지 않는다", () => {
    const resetAt = 5_000;
    expect(shouldDiscardIngestEventForReset(ev({ id: "bank:din:old", amount: 1000, at: new Date(1_000).toISOString() }), resetAt, 0)).toBe(true);
    expect(shouldDiscardIngestEventForReset(ev({ id: "bank:din:new", amount: 1000, at: new Date(6_000).toISOString() }), resetAt, 0)).toBe(false);
  });
});

describe("후원 스트레스 회귀 — 사이드 이펙트", () => {
  it("상류사회 설정만 PATCH하면 후원 권위 저장이 아니다", () => {
    expect(
      isHighSocietySettingsOnlyPatch({
        highSocietySettingsInPatch: true,
        territoryLogsInPatch: false,
        donorsInPatch: false,
        membersAuthoritative: false,
        settlementReset: false,
        donationInitReset: false,
      })
    ).toBe(true);
    expect(
      isHighSocietySettingsOnlyPatch({
        highSocietySettingsInPatch: true,
        donorsInPatch: true,
        membersAuthoritative: false,
        settlementReset: false,
        donationInitReset: false,
      })
    ).toBe(false);
  });

  it("멤버를 지워도 후원 원장은 남고 남은 멤버 합만 재계산한다", () => {
    const state = applyAll(base(), [
      ev({
        id: "toonation:din:a",
        amount: 10_000,
        at: new Date(1).toISOString(),
        memberId: "m1",
        playerName: "자키",
        manualAssignMemberId: "m1",
      }),
      ev({
        id: "toonation:din:b",
        amount: 20_000,
        at: new Date(2).toISOString(),
        memberId: "m2",
        playerName: "수린",
        manualAssignMemberId: "m2",
      }),
    ]).state;
    const after = syncMemberTotalsFromDonors({
      ...state,
      members: (state.members || []).filter((m) => m.id !== "m2"),
    });
    expect(after.donors.map((d) => d.id).sort()).toEqual(["toonation:din:a", "toonation:din:b"]);
    expect(after.members.find((m) => m.id === "m1")?.toon).toBe(10_000);
    expect(after.members.find((m) => m.id === "m2")).toBeUndefined();
  });

  it("리셋 뒤 옛 탭 기여도는 후원이 없으면 0으로 맞춘다", () => {
    const rich: AppState = {
      ...base(),
      donors: [{ id: "d1", name: "후원", amount: 50_000, memberId: "m1", at: 1500, target: "toon" }],
      members: [{ id: "m1", name: "자키", account: 0, toon: 50_000, contribution: 50_000 }],
    };
    const reset = applySettlementResetToState(rich, { mode: "keep", resetAt: 9000 });
    const stale = reset.members.map((m) => ({ ...m, contribution: 2_147_908, toon: 50_000 }));
    const synced = syncMemberTotalsFromDonors({ ...reset, members: stale });
    expect(synced.members.every((m) => m.contribution === 0 && m.toon === 0)).toBe(true);
  });

  it("엑셀 순위 100원 버림은 저장 금액과 별개다", () => {
    const member = { id: "m1", name: "자키", account: 199, toon: 99, contribution: 298 };
    expect(memberDonationRankingTotal(member)).toBe(100);
    expect(member.account + member.toon).toBe(298);
  });
});

describe("후원 스트레스 회귀 — 새 패턴", () => {
  it("같은 닉·같은 시각이라도 계좌와 투네는 다른 id면 둘 다 남는다", () => {
    const at = new Date(1_790_800_000_000).toISOString();
    const out = applyAll(base(), [
      ev({
        id: "bank:din:acct1",
        provider: "bank",
        externalId: "acct1",
        amount: 55_000,
        at,
        donorName: "집사소린",
        target: "account",
      }),
      ev({
        id: "toonation:din:toon1",
        externalId: "toon1",
        amount: 77_000,
        at,
        donorName: "집사소린",
        target: "toon",
      }),
    ]);
    expect(out.applied).toBe(2);
    expect(out.rows).toBe(2);
    expect(out.sum).toBe(132_000);
    const m1 = out.state.members.find((m) => m.id === "m1");
    expect(m1?.account).toBe(55_000);
    expect(m1?.toon).toBe(77_000);
  });

  it("리셋 이후 시각의 새 ingest만 접히고 과거 40건은 버려진다", () => {
    const resetAt = 1_790_900_000_000;
    const oldOnes = Array.from({ length: 40 }, (_, i) =>
      ev({
        id: `bank:din:old${i}`,
        provider: "bank",
        externalId: `old${i}`,
        amount: 1000,
        at: new Date(resetAt - 60_000 + i).toISOString(),
        target: "account",
      })
    );
    const fresh = ev({
      id: "bank:din:fresh",
      provider: "bank",
      externalId: "fresh",
      amount: 9_000,
      at: new Date(resetAt + 1).toISOString(),
      target: "account",
    });
    const start = { ...base(), settlementResetAt: resetAt };
    const folded = foldIngestEventsIntoState(start, [...oldOnes, fresh]);
    expect(folded.state.donors).toHaveLength(1);
    expect(folded.state.donors[0]?.id).toContain("fresh");
    expect(folded.applied).toHaveLength(1);
    expect(folded.discardedReset).toBe(40);
  });

  it("1ms 간격 100건 unique id는 전량 반영된다", () => {
    const t0 = 1_791_000_000_000;
    const events = Array.from({ length: 100 }, (_, i) =>
      ev({
        id: `toonation:din:ms${i}`,
        externalId: `ms${i}`,
        amount: 1000 + (i % 7) * 100,
        at: new Date(t0 + i).toISOString(),
        memberId: i % 3 === 0 ? "m1" : i % 3 === 1 ? "m2" : "m3",
        donorName: `닉${i % 11}`,
        target: i % 2 === 0 ? "toon" : "account",
      })
    );
    const out = applyAll(base(), events);
    expect(out.applied).toBe(100);
    expect(out.duplicate).toBe(0);
    expect(out.rows).toBe(100);
    expect(out.sum).toBe(events.reduce((a, e) => a + e.amount, 0));
    const totals = out.state.members.reduce((a, m) => a + m.account + m.toon, 0);
    expect(totals).toBe(out.sum);
  });

  it("단체짠은 몫을 나누고 원금 합이 같다", () => {
    const applied = applyGroupSplitDonationToAppState(base(), {
      id: "toonation:group-1",
      provider: "toonation",
      externalId: "group-1",
      donorName: "단체후원",
      amount: 100_001,
      at: new Date().toISOString(),
      target: "toon",
      status: "queued",
      memberId: "m1",
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const partSum = applied.donors.reduce((s, d) => s + d.amount, 0);
    expect(partSum).toBe(100_001);
    expect(applied.donors).toHaveLength(3);
  });

  it("집계 버킷 한 줄과 고유 건은 섞여도 각각 남는다", () => {
    const at = new Date().toISOString();
    const out = applyAll(base(), [
      ev({
        id: "agg:bucket1:30",
        provider: "bank",
        externalId: "bucket-agg-1",
        amount: 30_000,
        at,
        target: "account",
        aggregatedCount: 30,
        donorName: "자키 후원 30회 (총 30,000원)",
      }),
      ev({
        id: "bank:din:unique-after-bucket",
        provider: "bank",
        externalId: "unique-after-bucket",
        amount: 1_000,
        at,
        target: "account",
      }),
    ]);
    expect(out.rows).toBe(2);
    expect(out.sum).toBe(31_000);
  });
});
