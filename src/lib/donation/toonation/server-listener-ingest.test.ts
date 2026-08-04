import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./listener-config-store", () => ({
  readToonationListenerConfig: vi.fn(),
  writeToonationListenerConfig: vi.fn(),
  readAllEnabledToonationListenerConfigs: vi.fn(),
  clearToonationListenerConfig: vi.fn(),
}));

vi.mock("./resolve-payload", () => ({
  resolveToonationWsPayload: vi.fn(),
}));

vi.mock("../server-apply-donation", () => ({
  tryAutoApplyToonationDonationOnServer: vi.fn(),
  enqueueUnmatchedToonationDonation: vi.fn(),
}));

vi.mock("./owner-donation-remap", () => ({
  applyOwnerDonationRemapIfNeeded: vi.fn((event) => event),
  getOwnerNameCandidates: vi.fn(async () => []),
}));

import { tryAutoApplyToonationDonationOnServer } from "../server-apply-donation";
import {
  __testOnlyClearListener,
  __testOnlySetListenerConnected,
  ingestToonationWebSocketMessage,
} from "./server-listener";

const TEST_RAW = JSON.stringify({
  code: 101,
  content: {
    nickname: "익명 태호",
    amount: 10000,
    cash: "10,000",
    comment: "",
    isTest: true,
  },
});

const ACCOUNT_RAW = JSON.stringify({
  code: 101,
  content: {
    id: "reused-widget-id",
    nickname: "결제자",
    amount: 10000,
    comment: "계좌 익명 BT태호",
  },
});

describe("ingestToonationWebSocketMessage consecutive identical raw", () => {
  beforeEach(() => {
    vi.mocked(tryAutoApplyToonationDonationOnServer).mockReset();
    vi.mocked(tryAutoApplyToonationDonationOnServer).mockResolvedValue("applied");
  });

  it("applies consecutive identical test donations (후원 테스트 연속 클릭)", async () => {
    const userId = `test-consecutive-${Date.now()}`;
    const first = await ingestToonationWebSocketMessage(userId, TEST_RAW);
    const second = await ingestToonationWebSocketMessage(userId, TEST_RAW);

    expect(first).toEqual({ ok: true, outcome: "applied" });
    expect(second).toEqual({ ok: true, outcome: "applied" });
    expect(tryAutoApplyToonationDonationOnServer).toHaveBeenCalledTimes(2);
  });

  it("still dedupes identical non-test raw within 500ms (WS 재전송)", async () => {
    const userId = `test-dedupe-${Date.now()}`;
    const raw = JSON.stringify({
      code: 101,
      content: {
        id: "donation-real-99",
        nickname: "배지은",
        amount: 5000,
        comment: "피자",
      },
    });

    const first = await ingestToonationWebSocketMessage(userId, raw);
    const second = await ingestToonationWebSocketMessage(userId, raw);

    expect(first).toEqual({ ok: true, outcome: "applied" });
    expect(second).toEqual({ ok: true, outcome: "duplicate" });
    expect(tryAutoApplyToonationDonationOnServer).toHaveBeenCalledTimes(1);
  });

  it("applies consecutive identical toonation donations after dedupe window", async () => {
    const userId = `test-toon-${Date.now()}`;
    const raw = JSON.stringify({
      code: 101,
      content: {
        id: "donation-real-99",
        nickname: "익명 태호",
        amount: 10000,
        comment: "",
      },
    });

    const first = await ingestToonationWebSocketMessage(userId, raw);
    await new Promise((r) => setTimeout(r, 550));
    const second = await ingestToonationWebSocketMessage(userId, raw);

    expect(first).toEqual({ ok: true, outcome: "applied" });
    expect(second).toEqual({ ok: true, outcome: "applied" });
    expect(tryAutoApplyToonationDonationOnServer).toHaveBeenCalledTimes(2);
  });

  it("applies consecutive identical account-format donations after short dedupe window", async () => {
    const userId = `test-account-${Date.now()}`;
    const first = await ingestToonationWebSocketMessage(userId, ACCOUNT_RAW);
    await new Promise((r) => setTimeout(r, 550));
    const second = await ingestToonationWebSocketMessage(userId, ACCOUNT_RAW);

    expect(first).toEqual({ ok: true, outcome: "applied" });
    expect(second).toEqual({ ok: true, outcome: "applied" });
    expect(tryAutoApplyToonationDonationOnServer).toHaveBeenCalledTimes(2);
  });

  it("ignores browser-relay ingest while server WS is connected (재시작 직후 이중 반영 방지)", async () => {
    const userId = `test-relay-guard-${Date.now()}`;
    __testOnlySetListenerConnected(userId, true);
    try {
      const fromBrowser = await ingestToonationWebSocketMessage(
        userId,
        TEST_RAW,
        undefined,
        "browser-relay"
      );
      const fromServer = await ingestToonationWebSocketMessage(
        userId,
        TEST_RAW,
        undefined,
        "server-ws"
      );

      expect(fromBrowser).toEqual({ ok: true, outcome: "duplicate" });
      expect(fromServer).toEqual({ ok: true, outcome: "applied" });
      expect(tryAutoApplyToonationDonationOnServer).toHaveBeenCalledTimes(1);
    } finally {
      __testOnlyClearListener(userId);
    }
  });

  it("allows browser-relay ingest when server WS is disconnected", async () => {
    const userId = `test-relay-fallback-${Date.now()}`;
    __testOnlySetListenerConnected(userId, false);
    try {
      const fromBrowser = await ingestToonationWebSocketMessage(
        userId,
        TEST_RAW,
        undefined,
        "browser-relay"
      );
      expect(fromBrowser).toEqual({ ok: true, outcome: "applied" });
      expect(tryAutoApplyToonationDonationOnServer).toHaveBeenCalledTimes(1);
    } finally {
      __testOnlyClearListener(userId);
    }
  });
});
