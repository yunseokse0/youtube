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
