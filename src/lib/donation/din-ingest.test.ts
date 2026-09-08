import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  handleDinDonationIngest,
  parseApplyExcelFromRequest,
  sanitizeDonationEventFromIngestBody,
} from "./din-ingest";
import type { DonationEvent } from "./types";

vi.mock("./player-donation-alert", () => ({
  enrichDonationEventWithSigMatch: vi.fn(async (_userId: string, event: DonationEvent) => ({
    ...event,
    matchedSigName: "TEST_SIG",
  })),
  broadcastPlayerDonationAlert: vi.fn(async () => undefined),
}));

vi.mock("./server-apply-donation", () => ({
  tryAutoApplyToonationDonationOnServer: vi.fn(async () => "applied" as const),
  enqueueUnmatchedToonationDonation: vi.fn(async () => true),
}));

vi.mock("@/lib/toona-hub-session", () => ({
  readToonaHubSession: vi.fn(async () => null),
  appendToonaHubDonationLog: vi.fn(async () => undefined),
}));

import {
  broadcastPlayerDonationAlert,
  enrichDonationEventWithSigMatch,
} from "./player-donation-alert";
import {
  enqueueUnmatchedToonationDonation,
  tryAutoApplyToonationDonationOnServer,
} from "./server-apply-donation";

describe("sanitizeDonationEventFromIngestBody", () => {
  it("parses account bank event from DIN", () => {
    const event = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:abc",
      provider: "bank",
      externalId: "bank:hash123",
      donorName: "홍길동",
      playerName: "엑셀",
      amount: 50000,
      message: "계좌 홍길동 엑셀",
      target: "account",
      at: "2026-06-04T05:32:00.000Z",
      status: "queued",
    });
    expect(event).toMatchObject({
      id: "bank:sms:abc",
      provider: "bank",
      donorName: "홍길동",
      playerName: "엑셀",
      amount: 50000,
      target: "account",
    });
  });

  it("parses contributionPoints and formula weights from DIN ingest", () => {
    const event = sanitizeDonationEventFromIngestBody({
      externalId: "ext:1",
      donorName: "박자기",
      amount: 10_000,
      target: "toon",
      contributionPoints: 1_000,
      accountWeightPct: 10,
      toonWeightPct: 10,
    });
    expect(event).toMatchObject({
      donorName: "박자기",
      amount: 10_000,
      target: "toon",
      contributionPoints: 1_000,
      contributionFormula: { accountWeightPct: 10, toonWeightPct: 10 },
    });
  });

  it("rejects missing required fields", () => {
    expect(sanitizeDonationEventFromIngestBody({ donorName: "a" })).toBeNull();
    expect(sanitizeDonationEventFromIngestBody({ donorName: "a", externalId: "x", amount: 0 })).toBeNull();
  });
});

describe("parseApplyExcelFromRequest", () => {
  it("returns false when applyExcel=false", () => {
    const req = new Request("http://localhost/api/donations/ingest?u=din&applyExcel=false");
    expect(parseApplyExcelFromRequest(req)).toBe(false);
  });

  it("returns true when param omitted (scenario B)", () => {
    const req = new Request("http://localhost/api/donations/ingest?u=din");
    expect(parseApplyExcelFromRequest(req)).toBe(true);
  });
});

describe("sanitizeDonationEventFromIngestBody Fix⑲ C Donor 패턴", () => {
  it("동일 donor만 30건 bucket → donorName = 'XXX 후원 30회 (총 OOO원)' 포맷 + aggregatedCount=30 보존", () => {
    const perAmount = 1_000;
    const count = 30;
    const total = perAmount * count;
    const eventIds = Array.from({ length: count }, (_, i) => `raw-${i}-${i}`);
    const raw = {
      id: `agg:bucket1:${count}`,
      externalId: "bucket-agg-1",
      aggregatedCount: count,
      aggregatedEventIds: eventIds,
      aggregatedDonors: ["자키"],
      aggregatedMessages: Array(count).fill("화이팅!"),
      donorName: "자키 외 29명",
      amount: total,
      message: "화이팅! / 화이팅! / 화이팅!",
      at: new Date().toISOString(),
      firstAt: new Date(Date.now() - 3000).toISOString(),
      provider: "bank",
      target: "account",
      status: "queued",
    };
    const ev = sanitizeDonationEventFromIngestBody(raw);
    expect(ev).not.toBeNull();
    expect(ev!.donorName).toBe(`자키 후원 30회 (총 ${total.toLocaleString()}원)`);
    expect(ev!.aggregatedCount).toBe(count);
    expect(ev!.aggregatedDonors).toEqual(["자키"]);
    expect(ev!.aggregatedEventIds).toHaveLength(count);
    expect(ev!.amount).toBe(total);
    expect(ev!.firstAt).toBeTruthy();
  });

  it("서로 다른 donor 3명 bucket → donorName 원래 '첫이름 외 2명' 유지", () => {
    const raw = {
      id: "agg:b2:3",
      externalId: "b2",
      aggregatedCount: 3,
      aggregatedDonors: ["모드소린", "수박", "홀리몰리"],
      donorName: "모드소린 외 2명",
      amount: 15_000,
      at: new Date().toISOString(),
      provider: "bank",
      target: "account",
      status: "queued",
    };
    const ev = sanitizeDonationEventFromIngestBody(raw);
    expect(ev!.donorName).toBe("모드소린 외 2명");
    expect(ev!.aggregatedCount).toBe(3);
    expect(ev!.aggregatedDonors).toEqual(["모드소린", "수박", "홀리몰리"]);
  });

  it("단일 이벤트 aggregatedCount 생략 → aggregatedCount undefined (기존 호환 유지)", () => {
    const ev = sanitizeDonationEventFromIngestBody({
      id: "bank:sms:singleton",
      externalId: "s1",
      donorName: "싱글",
      amount: 5000,
      at: new Date().toISOString(),
      provider: "bank",
      target: "account",
      status: "queued",
    });
    expect(ev!.aggregatedCount).toBeUndefined();
    expect(ev!.donorName).toBe("싱글");
  });
});

describe("handleDinDonationIngest Fix⑲ 개별 Alert 발송", () => {
  const makeCEvent = (count = 30) => {
    const per = 1_000;
    return {
      id: `agg:bx:${count}`,
      provider: "bank" as const,
      externalId: `bx-${count}`,
      donorName: `자키 후원 ${count}회 (총 ${(per * count).toLocaleString()}원)`,
      amount: per * count,
      target: "account" as const,
      at: new Date().toISOString(),
      firstAt: new Date(Date.now() - 3000).toISOString(),
      status: "queued" as const,
      aggregatedCount: count,
      aggregatedDonors: ["자키"],
      aggregatedMessages: Array.from({ length: count }, (_, i) => `메시지${i}`),
      aggregatedEventIds: Array.from({ length: count }, (_, i) => `id-${i}`),
    } satisfies DonationEvent;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(enrichDonationEventWithSigMatch).mockImplementation(async (_uid, ev) => ({ ...ev }));
  });

  it(`aggregatedCount=30 → broadcastPlayerDonationAlert 총 30회 호출 (Fix⑲-1 개별 Alert 누락 해소)`, async () => {
    await handleDinDonationIngest("din", makeCEvent(30), false);
    expect(broadcastPlayerDonationAlert).toHaveBeenCalledTimes(30);
  });

  it(`aggregatedCount=100 → 총 100회 + 개별 amount 합계 = 원래 bucket 총합 (100,000원 정확도 0오차)`, async () => {
    const per = 1_000;
    const count = 100;
    const total = per * count;
    const ev = {
      ...makeCEvent(count),
      amount: total,
    };
    await handleDinDonationIngest("din", ev, false);
    expect(broadcastPlayerDonationAlert).toHaveBeenCalledTimes(count);
    const allCalls = vi.mocked(broadcastPlayerDonationAlert).mock.calls;
    const sumOfAlertAmounts = allCalls.reduce((s, call) => {
      const payloadE = call[1] as DonationEvent;
      return s + Math.round(Number(payloadE.amount || 0));
    }, 0);
    expect(sumOfAlertAmounts).toBe(total);
  });

  it("applyExcel=true에서도 개별 Alert 30회 정상 발송 (excel + alert 동시 모드)", async () => {
    vi.mocked(tryAutoApplyToonationDonationOnServer).mockResolvedValueOnce("applied");
    await handleDinDonationIngest("din", makeCEvent(30), true);
    expect(tryAutoApplyToonationDonationOnServer).toHaveBeenCalledTimes(1);
    expect(broadcastPlayerDonationAlert).toHaveBeenCalledTimes(30);
  });

  it("aggregatedCount 없는 일반 이벤트 → Alert 1회만 (기존 회귀 없음)", async () => {
    const normal: DonationEvent = {
      id: "bank:normal",
      provider: "bank",
      externalId: "n1",
      donorName: "일반인",
      amount: 7777,
      at: new Date().toISOString(),
      status: "queued",
    };
    await handleDinDonationIngest("din", normal, false);
    expect(broadcastPlayerDonationAlert).toHaveBeenCalledTimes(1);
  });
});

describe("handleDinDonationIngest", () => {
  const sample: DonationEvent = {
    id: "bank:sms:1",
    provider: "bank",
    externalId: "ext:1",
    donorName: "테스트",
    playerName: "엑셀",
    amount: 1000,
    target: "account",
    at: new Date().toISOString(),
    status: "queued",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("alert-only path skips excel apply", async () => {
    const result = await handleDinDonationIngest("din", sample, false);
    expect(result).toMatchObject({ ok: true, applied: false, alert: true, mode: "alert_only" });
    expect(enrichDonationEventWithSigMatch).toHaveBeenCalled();
    expect(broadcastPlayerDonationAlert).toHaveBeenCalled();
    expect(tryAutoApplyToonationDonationOnServer).not.toHaveBeenCalled();
  });

  it("excel path applies to state", async () => {
    const result = await handleDinDonationIngest("din", sample, true);
    expect(result).toMatchObject({ ok: true, applied: true, mode: "excel" });
    expect(tryAutoApplyToonationDonationOnServer).toHaveBeenCalledWith("din", sample);
  });

  it("excel path queues unmatched", async () => {
    vi.mocked(tryAutoApplyToonationDonationOnServer).mockResolvedValueOnce("not_applied");
    const result = await handleDinDonationIngest("din", sample, true);
    expect(result).toMatchObject({ ok: true, applied: false, queued: true });
    expect(enqueueUnmatchedToonationDonation).toHaveBeenCalled();
  });
});
