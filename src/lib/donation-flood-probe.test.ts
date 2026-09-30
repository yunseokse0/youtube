import { describe, expect, it } from "vitest";
import { applyDonationToAppState } from "@/lib/donation/apply-donation-state";
import { donationHubIdentity } from "@/domain/dedupe/donation-hub-identity";
import type { DonationEvent } from "@/lib/donation/types";
import { defaultState, mergeDonorsForMultiTabSave } from "@/lib/state";
import type { AppState } from "@/types";

function baseState(): AppState {
  return {
    ...defaultState(),
    members: [{ id: "m1", name: "자키", account: 0, toon: 0, contribution: 0 }],
    donors: [],
  };
}

function event(partial: Partial<DonationEvent> & Pick<DonationEvent, "id" | "amount" | "at">): DonationEvent {
  return {
    provider: "toonation",
    externalId: partial.externalId || partial.id,
    donorName: partial.donorName || "유이",
    playerName: "자키",
    message: partial.message ?? "잠깐 들렀어",
    status: "queued",
    target: "toon",
    ...partial,
  };
}

function applyAll(start: AppState, events: DonationEvent[]) {
  let state = start;
  let applied = 0;
  let duplicate = 0;
  let unmatched = 0;
  for (const ev of events) {
    const result = applyDonationToAppState(state, ev);
    if (result.ok) {
      state = result.state;
      applied += 1;
    } else if (result.reason === "duplicate") duplicate += 1;
    else unmatched += 1;
  }
  const donors = state.donors || [];
  const sum = donors.reduce((acc, d) => acc + (Number(d.amount) || 0), 0);
  return { state, applied, duplicate, unmatched, rows: donors.length, sum };
}

describe("donation flood probe", () => {
  it("세 표기는 같은 허브 id이고 다른 본문은 갈라진다", () => {
    const hub = "cmumnh225030p5jbudpwtl6fi";
    expect(donationHubIdentity(`bank:sms:${hub}`)).toBe(hub);
    expect(donationHubIdentity(`bank:din:${hub}`)).toBe(hub);
    expect(donationHubIdentity(`toonation:din:${hub}`)).toBe(hub);
    expect(donationHubIdentity("bank:sms:aaaaaaaaaaaa")).not.toBe(
      donationHubIdentity("bank:sms:bbbbbbbbbbbb")
    );
  });

  it("서로 다른 허브 id 40건은 같은 시각에 몰려도 한 건도 빠지지 않는다", () => {
    const at = new Date(1_790_000_000_000).toISOString();
    const events = Array.from({ length: 40 }, (_, i) =>
      event({
        id: `toonation:din:hub${String(i).padStart(4, "0")}`,
        externalId: `hub${String(i).padStart(4, "0")}`,
        amount: 1000 + i,
        at,
        donorName: i % 2 === 0 ? "유이" : "오라",
        message: "폭주",
      })
    );
    const out = applyAll(baseState(), events);
    expect(out.applied).toBe(40);
    expect(out.duplicate).toBe(0);
    expect(out.rows).toBe(40);
    expect(out.sum).toBe(events.reduce((a, e) => a + e.amount, 0));
  });

  it("같은 id를 다시 넣으면 두 번째만 거절한다", () => {
    const ev = event({
      id: "toonation:din:same",
      externalId: "same",
      amount: 50_000,
      at: new Date(1_790_000_000_000).toISOString(),
    });
    const out = applyAll(baseState(), [ev, ev, ev]);
    expect(out.applied).toBe(1);
    expect(out.duplicate).toBe(2);
    expect(out.rows).toBe(1);
    expect(out.sum).toBe(50_000);
  });

  it("이름 금액 메시지가 같아도 id가 다르면 1초 간격 연타를 빼지 않는다", () => {
    const base = 1_790_000_000_000;
    const events = Array.from({ length: 20 }, (_, i) =>
      event({
        id: `toonation:din:seq${i}`,
        externalId: `seq${i}`,
        amount: 10_000,
        at: new Date(base + i * 1000).toISOString(),
        donorName: "유이",
        message: "같은말",
      })
    );
    const out = applyAll(baseState(), events);
    expect(out.rows).toBe(20);
    expect(out.sum).toBe(200_000);
  });

  it("한 장부에서는 폴링 다음 bank:sms가 들어와도 줄은 하나로 접힌다", () => {
    const at = new Date(1_790_684_763_053).toISOString();
    const hub = "cmumnh225030p5jbudpwtl6fi";
    const first = applyDonationToAppState(
      baseState(),
      event({
        id: `toonation:din:${hub}`,
        provider: "toonation",
        externalId: hub,
        amount: 50_000,
        at,
      })
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyDonationToAppState(
      first.state,
      event({
        id: `bank:sms:${hub}`,
        provider: "bank",
        externalId: "toonation:fmumn2hmpb499",
        amount: 50_000,
        at,
      })
    );
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe("duplicate");
    expect(first.state.donors).toHaveLength(1);
    expect(first.state.donors?.reduce((a, d) => a + d.amount, 0)).toBe(50_000);
  });

  it("bank:sms가 먼저면 같은 허브 id의 폴링 줄은 거절된다", () => {
    const at = new Date(1_790_684_763_053).toISOString();
    const hub = "cmumnh225030p5jbudpwtl6fi";
    const out = applyAll(baseState(), [
      event({
        id: `bank:sms:${hub}`,
        provider: "bank",
        externalId: "toonation:fmumn2hmpb499",
        amount: 50_000,
        at,
      }),
      event({
        id: `toonation:din:${hub}`,
        provider: "toonation",
        externalId: hub,
        amount: 50_000,
        at,
      }),
    ]);
    expect(out.applied).toBe(1);
    expect(out.duplicate).toBe(1);
    expect(out.rows).toBe(1);
    expect(out.sum).toBe(50_000);
  });

  it("폭주 중 오래된 저장은 이미 반영된 줄을 지우지 않는다", () => {
    const at = new Date(1_790_000_000_000).toISOString();
    const events = Array.from({ length: 40 }, (_, i) =>
      event({
        id: `toonation:din:keep${i}`,
        externalId: `keep${i}`,
        amount: 1000,
        at,
      })
    );
    const full = applyAll(baseState(), events).state;
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

  it("동시에 갈라진 두 장부를 합치면 같은 허브 id는 한 줄만 남는다", () => {
    const at = new Date(1_790_000_000_000).toISOString();
    const hub = "cmumnh225030p5jbudpwtl6fi";
    const left = applyAll(baseState(), [
      event({ id: "toonation:din:only-left", externalId: "only-left", amount: 3000, at }),
      event({
        id: `toonation:din:${hub}`,
        externalId: hub,
        amount: 50_000,
        at,
      }),
    ]).state;
    const right = applyAll(baseState(), [
      event({ id: "toonation:din:only-right", externalId: "only-right", amount: 7000, at }),
      event({
        id: `bank:sms:${hub}`,
        provider: "bank",
        externalId: "toonation:fmumn2hmpb499",
        amount: 50_000,
        at,
      }),
    ]).state;
    const merged = mergeDonorsForMultiTabSave(right.donors || [], left.donors, {
      incomingUpdatedAt: Date.now(),
      existingUpdatedAt: Date.now() - 1,
    });
    const hubRows = merged.filter((d) => donationHubIdentity(d.id) === hub);
    expect(hubRows).toHaveLength(1);
    expect(hubRows[0]?.amount).toBe(50_000);
    expect(merged.some((d) => d.id.includes("only-left"))).toBe(true);
    expect(merged.some((d) => d.id.includes("only-right"))).toBe(true);
    expect(merged).toHaveLength(3);
    expect(merged.reduce((a, d) => a + d.amount, 0)).toBe(60_000);
  });

  it("이미 두 줄로 들어간 같은 허브 id도 다음 병합에서 한 줄이 된다", () => {
    const at = new Date(1_790_000_000_000).toISOString();
    const hub = "cmumnh225030p5jbudpwtl6fi";
    const sms = applyAll(baseState(), [
      event({
        id: `bank:sms:${hub}`,
        provider: "bank",
        externalId: "toonation:fmumn2hmpb499",
        amount: 50_000,
        at,
      }),
    ]).state.donors?.[0];
    const poll = applyAll(baseState(), [
      event({
        id: `bank:din:${hub}`,
        provider: "bank",
        externalId: hub,
        amount: 50_000,
        at,
        target: "account",
      }),
    ]).state.donors?.[0];
    const other = applyAll(baseState(), [
      event({ id: "toonation:din:keep-other-id", externalId: "keep-other-id", amount: 1_000, at }),
    ]).state.donors?.[0];
    const newer = applyAll(baseState(), [
      event({
        id: "toonation:din:brand-new-id",
        externalId: "brand-new-id",
        amount: 2_000,
        at: new Date(1_790_000_001_000).toISOString(),
      }),
    ]).state.donors?.[0];
    expect(sms && poll && other && newer).toBeTruthy();
    const merged = mergeDonorsForMultiTabSave([newer!], [sms!, poll!, other!], {
      incomingUpdatedAt: Date.now(),
      existingUpdatedAt: Date.now() - 1,
    });
    const hubRows = merged.filter((d) => donationHubIdentity(d.id) === hub);
    expect(hubRows).toHaveLength(1);
    expect(hubRows[0]?.amount).toBe(50_000);
    expect(merged.some((d) => d.id.includes("keep-other-id"))).toBe(true);
    expect(merged.some((d) => d.id.includes("brand-new-id"))).toBe(true);
    expect(merged.reduce((a, d) => a + d.amount, 0)).toBe(53_000);
  });
});
