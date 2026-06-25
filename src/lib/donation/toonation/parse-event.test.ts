import { describe, expect, it } from "vitest";
import {
  allocateToonationExternalId,
  createUniqueToonationFallbackId,
  isToonationExcelDonationWsMessage,
  isToonationTestDonationPayload,
  isToonationYoutubeSuperChatWsMessage,
  matchSigByAmountAndMessage,
  parseToonationDonationPayload,
  parseToonationMessageBody,
  parseToonationWebSocketMessage,
  TOONATION_ALERT_TYPE_YOUTUBE_SUPERCHAT,
  TOONATION_WS_CODE_YOUTUBE_SUPERCHAT,
  unwrapToonationPayload,
} from "./parse-event";
import type { QueueSigItem } from "../types";

describe("toonation parse-event", () => {
  it("parses ws code 101 toon donation — donor from alert, optional player in message", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        id: "abc123",
        nickname: "배지은",
        amount: 5000,
        comment: "피자 감사합니다",
      },
    });
    const evt = parseToonationWebSocketMessage(raw);
    expect(evt?.donorName).toBe("배지은");
    expect(evt?.playerName).toBe("피자");
    expect(evt?.amount).toBe(5000);
    expect(evt?.target).toBe("toon");
  });

  it("toon without player in message — donor only from alert", () => {
    const evt = parseToonationDonationPayload({
      nickname: "배지은",
      amount: 10100,
      comment: "",
    });
    expect(evt?.donorName).toBe("배지은");
    expect(evt?.playerName).toBeUndefined();
    expect(evt?.target).toBe("toon");
  });

  it("account format: 계좌 후원자 플레이어", () => {
    const evt = parseToonationDonationPayload({
      nickname: "무시됨",
      amount: 5000,
      comment: "계좌 햇님 피자 후원 감사",
    });
    expect(evt?.donorName).toBe("햇님");
    expect(evt?.playerName).toBe("피자");
    expect(evt?.target).toBe("account");
  });

  it("parseToonationMessageBody account triple", () => {
    expect(parseToonationMessageBody("계좌 배지은 피자 감사", "x")).toEqual({
      donorName: "배지은",
      playerName: "피자",
      target: "account",
    });
  });

  it("parseToonationMessageBody toon uses alert donor", () => {
    expect(parseToonationMessageBody("피자 감사", "배지은")).toEqual({
      donorName: "배지은",
      playerName: "피자",
      target: "toon",
    });
    expect(parseToonationMessageBody("", "배지은")).toEqual({
      donorName: "배지은",
      playerName: "",
      target: "toon",
    });
  });

  it("unwraps nested content payloads", () => {
    const nested = {
      content: { nickName: "배지은", amount: 1000, comment: "피자" },
    };
    const flat = unwrapToonationPayload(nested);
    const evt = parseToonationDonationPayload(flat);
    expect(evt?.donorName).toBe("배지은");
    expect(evt?.playerName).toBe("피자");
    expect(evt?.amount).toBe(1000);
  });

  it("ignores non-donation ws codes", () => {
    const raw = JSON.stringify({ code: 107, content: { amount: 100 } });
    expect(parseToonationWebSocketMessage(raw)).toBeNull();
  });

  it("ignores youtube superchat alert (code 109)", () => {
    const raw = JSON.stringify({
      code: TOONATION_WS_CODE_YOUTUBE_SUPERCHAT,
      content: { nickname: "시청자", amount: 10000, comment: "슈퍼챗 메시지" },
    });
    expect(isToonationYoutubeSuperChatWsMessage(JSON.parse(raw))).toBe(true);
    expect(isToonationExcelDonationWsMessage(JSON.parse(raw))).toBe(false);
    expect(parseToonationWebSocketMessage(raw)).toBeNull();
  });

  it("ignores donation envelope with YoutubeSuperChat code_ex", () => {
    const raw = JSON.stringify({
      code: 101,
      code_ex: TOONATION_ALERT_TYPE_YOUTUBE_SUPERCHAT,
      content: { nickname: "시청자", amount: 5000, comment: "슈퍼챗" },
    });
    expect(isToonationYoutubeSuperChatWsMessage(JSON.parse(raw))).toBe(true);
    expect(parseToonationWebSocketMessage(raw)).toBeNull();
  });

  it("assigns unique fallback ids when payload has no donation id", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const evt = parseToonationDonationPayload({ nickname: "배지은", amount: 20000, comment: "" });
      expect(evt?.externalId).toBeTruthy();
      ids.add(String(evt?.externalId));
    }
    expect(ids.size).toBe(5);
  });

  it("different payloads without id get different fallback ids", () => {
    const a = parseToonationDonationPayload({ nickname: "배지은", amount: 20000, comment: "" });
    const b = parseToonationDonationPayload({ nickname: "배지은", amount: 20001, comment: "" });
    expect(a?.externalId).not.toBe(b?.externalId);
  });

  it("reuses reliable external id for real donations", () => {
    const evt = parseToonationDonationPayload({
      id: "donation-abc-99",
      nickname: "배지은",
      amount: 5000,
      comment: "피자",
    });
    expect(evt?.externalId).toBe("donation-abc-99");
    expect(evt?.id).toBe("toonation:donation-abc-99");
  });

  it("stable id for toonation admin test donations (reused id / WS retry)", () => {
    const base = {
      id: "same-test-id",
      nickname: "테스트 계정",
      amount: 20000,
      comment: "계좌 익명",
    };
    expect(isToonationTestDonationPayload(base)).toBe(true);
    const a = parseToonationDonationPayload(base);
    const b = parseToonationDonationPayload(base);
    expect(a?.donorName).toBe("익명");
    expect(a?.target).toBe("account");
    expect(a?.externalId).toBe(b?.externalId);
    expect(a?.id).toBe(b?.id);
    expect(a?.externalId).toMatch(/^test-/);
  });

  it("createUniqueToonationFallbackId never collides in a tight loop", () => {
    const ids = new Set(Array.from({ length: 20 }, () => createUniqueToonationFallbackId(20000)));
    expect(ids.size).toBe(20);
  });
});

describe("matchSigByAmountAndMessage", () => {
  const pool: QueueSigItem[] = [
    { id: "a", name: "픽션", price: 24900, isActive: true },
    { id: "b", name: "옴브리뉴", price: 25200, isActive: true },
    { id: "c", name: "MOVE", price: 24900, isActive: true },
  ];

  it("auto-matches when only one sig has the amount", () => {
    expect(matchSigByAmountAndMessage(25200, "옴브리뉴", pool)).toEqual({
      sigName: "옴브리뉴",
      isAutoMatched: true,
    });
  });

  it("uses message text when multiple sigs share price", () => {
    expect(matchSigByAmountAndMessage(24900, "픽션 부탁", pool)).toEqual({
      sigName: "픽션",
      isAutoMatched: true,
    });
  });

  it("returns first price match without auto flag when text is ambiguous", () => {
    expect(matchSigByAmountAndMessage(24900, "화이팅", pool)).toEqual({
      sigName: "픽션",
      isAutoMatched: false,
    });
  });

  it("returns undefined when no price match", () => {
    expect(matchSigByAmountAndMessage(1000, "픽션", pool)).toEqual({
      sigName: undefined,
      isAutoMatched: false,
    });
  });
});
