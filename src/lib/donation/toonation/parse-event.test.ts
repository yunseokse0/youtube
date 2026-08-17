import { describe, expect, it } from "vitest";
import {
  allocateToonationExternalId,
  createUniqueToonationFallbackId,
  isReliableToonationExternalId,
  isToonationExcelDonationWsMessage,
  isToonationTestDonationPayload,
  isToonationYoutubeSuperChatWsMessage,
  matchSigByAmountAndMessage,
  parseToonationDonationPayload,
  parseToonationMessageBody,
  parseToonationWebSocketMessage,
  peekToonationWsPayload,
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

  it("account keyword anywhere in message", () => {
    expect(parseToonationMessageBody("후원 계좌 익명 BT태호", "x")).toEqual({
      donorName: "익명",
      playerName: "BT태호",
      target: "account",
    });
  });

  it("account format in nickname when message empty", () => {
    expect(parseToonationMessageBody("", "계좌 익명 BT태호")).toEqual({
      donorName: "익명",
      playerName: "BT태호",
      target: "account",
    });
  });

  it("rejects message that is only 계좌 keyword", () => {
    expect(parseToonationMessageBody("계좌", "시청자")).toEqual({
      donorName: "시청자",
      playerName: "",
      target: "toon",
    });
  });

  it("accepts account keyword variants", () => {
    expect(parseToonationMessageBody("[계좌] 햇님 피자", "x")).toEqual({
      donorName: "햇님",
      playerName: "피자",
      target: "account",
    });
    expect(parseToonationMessageBody("계좌후원 햇님 피자", "x")).toEqual({
      donorName: "햇님",
      playerName: "피자",
      target: "account",
    });
    expect(parseToonationMessageBody("계좌: 햇님 피자", "x").target).toBe("account");
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

  it("accepts other codes when donation hints exist", () => {
    const raw = JSON.stringify({
      code: 107,
      content: { amount: 10000, nickname: "후원자X", comment: "피자 감사합니다" },
    });
    const evt = parseToonationWebSocketMessage(raw);
    expect(evt).not.toBeNull();
    expect(evt?.amount).toBe(10000);
    expect(evt?.donorName).toBe("후원자X");
  });

  it("ignores amount-only message token as player name", () => {
    const parsed = parseToonationMessageBody("60,000", "시청자");
    expect(parsed.target).toBe("toon");
    expect(parsed.donorName).toBe("시청자");
    expect(parsed.playerName).toBe("");
  });

  it("accepts youtube superchat alert (code 109) for excel apply", () => {
    const raw = JSON.stringify({
      code: TOONATION_WS_CODE_YOUTUBE_SUPERCHAT,
      content: { nickname: "시청자", amount: 60000, comment: "계좌 시청자 BT태호" },
    });
    expect(isToonationYoutubeSuperChatWsMessage(JSON.parse(raw))).toBe(true);
    expect(isToonationExcelDonationWsMessage(JSON.parse(raw))).toBe(true);
    const evt = parseToonationWebSocketMessage(raw);
    expect(evt?.amount).toBe(60000);
    expect(evt?.target).toBe("account");
    expect(evt?.donorName).toBe("시청자");
    expect(evt?.playerName).toBe("BT태호");
  });

  it("accepts donation envelope with YoutubeSuperChat code_ex", () => {
    const raw = JSON.stringify({
      code: 101,
      code_ex: TOONATION_ALERT_TYPE_YOUTUBE_SUPERCHAT,
      content: { nickname: "시청자", amount: 5000, comment: "피자" },
    });
    expect(isToonationYoutubeSuperChatWsMessage(JSON.parse(raw))).toBe(true);
    expect(isToonationExcelDonationWsMessage(JSON.parse(raw))).toBe(true);
    const evt = parseToonationWebSocketMessage(raw);
    expect(evt?.amount).toBe(5000);
    expect(evt?.target).toBe("toon");
  });

  it("unique fallback id for same payload without donation id (연속 동일 금액 허용)", () => {
    const payload = { nickname: "배지은", amount: 20000, comment: "" };
    const a = parseToonationDonationPayload(payload);
    const b = parseToonationDonationPayload(payload);
    expect(a?.externalId).toBeTruthy();
    expect(b?.externalId).toBeTruthy();
    expect(a?.externalId).not.toBe(b?.externalId);
    expect(a?.id).not.toBe(b?.id);
  });

  it("unique id even when payload includes timestamp but no reliable id", () => {
    const payload = {
      nickname: "배지은",
      amount: 5000,
      comment: "피자",
      createdAt: "2026-06-04T10:00:00.000Z",
    };
    const a = parseToonationDonationPayload(payload);
    const b = parseToonationDonationPayload(payload);
    expect(a?.externalId).not.toBe(b?.externalId);
    expect(a?.id).not.toBe(b?.id);
  });

  it("different payloads without id get different fallback ids", () => {
    const a = parseToonationDonationPayload({ nickname: "배지은", amount: 20000, comment: "" });
    const b = parseToonationDonationPayload({ nickname: "배지은", amount: 20001, comment: "" });
    expect(a?.externalId).not.toBe(b?.externalId);
  });

  it("wraps reliable toonation id with unique suffix for consecutive donations", () => {
    const evt = parseToonationDonationPayload({
      id: "donation-abc-99",
      nickname: "배지은",
      amount: 5000,
      comment: "피자",
    });
    expect(evt?.externalId).toMatch(/^toon-donation-abc-99-/);
    expect(evt?.id).toBe(`toonation:${evt?.externalId}`);
  });

  it("treats fp-/test- fallback ids as non-reliable", () => {
    expect(isReliableToonationExternalId("donation-abc-99")).toBe(true);
    expect(isReliableToonationExternalId("fp-10000-abc")).toBe(false);
    expect(isReliableToonationExternalId("fp-10000-abc-t12")).toBe(false);
    expect(isReliableToonationExternalId("test-same")).toBe(false);
    expect(isReliableToonationExternalId("toon-donation-abc-99-x")).toBe(false);
    expect(isReliableToonationExternalId("1718100000000-1000-1-abc")).toBe(false);
  });

  it("same account message from different alert nicknames get different fallback ids", () => {
    const a = allocateToonationExternalId(
      { nickname: "결제자A", amount: 10000, comment: "계좌 익명 BT태호" },
      10000
    );
    const b = allocateToonationExternalId(
      { nickname: "결제자B", amount: 10000, comment: "계좌 익명 BT태호" },
      10000
    );
    expect(a).not.toBe(b);
  });

  it("test donations with reused id still get unique external ids per parse", () => {
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
    expect(a?.externalId).toMatch(/^test-/);
    expect(b?.externalId).toMatch(/^test-/);
    expect(a?.externalId).not.toBe(b?.externalId);
  });

  it("identical amount+message parses to distinct events for consecutive apply", () => {
    const payload = { nickname: "후원자", amount: 10000, comment: "계좌 익명 BT태호" };
    const a = parseToonationDonationPayload(payload);
    const b = parseToonationDonationPayload(payload);
    expect(a?.amount).toBe(10000);
    expect(b?.amount).toBe(10000);
    expect(a?.id).not.toBe(b?.id);
  });

  it("text donation test — empty message, nickname only → toon", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "익명 홍쓰",
        amount: 10000,
        cash: "10,000",
        comment: "",
        isTest: true,
      },
    });
    const evt = parseToonationWebSocketMessage(raw);
    expect(evt?.amount).toBe(10000);
    expect(evt?.target).toBe("toon");
    expect(evt?.donorName).toBe("익명 홍쓰");
    expect(evt?.playerName).toBeUndefined();
    expect(isToonationTestDonationPayload(JSON.parse(raw).content)).toBe(true);
  });

  it("stores alertbox comment as message as-is (통합알림창 하단 메시지)", () => {
    const evt = parseToonationDonationPayload({
      nickname: "Y 철수",
      amount: 100000,
      comment: "익명 비서",
    });
    expect(evt?.target).toBe("toon");
    expect(evt?.donorName).toBe("Y 철수");
    expect(evt?.playerName).toBe("비서");
    expect(evt?.message).toBe("익명 비서");
  });

  it("peekToonationWsPayload extracts content envelope", () => {
    const raw = JSON.stringify({ code: 101, content: { nickname: "a", amount: 1, isTest: true } });
    expect(peekToonationWsPayload(raw)).toEqual({ nickname: "a", amount: 1, isTest: true });
  });

  it("parses comma-separated cash amount strings", () => {
    const evt = parseToonationDonationPayload({
      nickname: "후원자",
      cash: "10,000",
      comment: "피자",
    });
    expect(evt?.amount).toBe(10000);
  });

  it("uses message token for anonymous donations without nickname", () => {
    const evt = parseToonationDonationPayload({
      isAnonymous: true,
      amount: 10000,
      comment: "익명 홍쓰",
    });
    expect(evt?.donorName).toBe("익명");
    expect(evt?.playerName).toBe("홍쓰");
  });

  it("maps Unknown nickname to 익명", () => {
    const evt = parseToonationDonationPayload({
      nickname: "Unknown",
      amount: 11000,
      comment: "후원 테스트",
    });
    expect(evt?.donorName).toBe("익명");
  });

  it("maps empty nickname to 익명", () => {
    const evt = parseToonationDonationPayload({
      amount: 1000,
      comment: "후원합니다",
    });
    expect(evt?.donorName).toBe("익명");
  });

  it("parses 익명 지히 message as player 지히", () => {
    expect(parseToonationMessageBody("익명 지히", "Y 철수")).toEqual({
      donorName: "Y 철수",
      playerName: "지히",
      target: "toon",
    });
  });

  it("account format with reused toonation id still gets unique ids (20연속 동일메시지)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const evt = parseToonationDonationPayload({
        id: "reused-widget-id",
        nickname: "결제자",
        amount: 10000,
        comment: "계좌 익명 BT태호",
      });
      expect(evt?.target).toBe("account");
      expect(evt?.externalId).toBeTruthy();
      ids.add(String(evt?.externalId));
    }
    expect(ids.size).toBe(20);
  });

  it("non-account with reused toonation id gets unique ids (연속 동일 투네 후원)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const evt = parseToonationDonationPayload({
        id: "donation-real-1",
        nickname: "배지은",
        amount: 5000,
        comment: "피자",
      });
      expect(evt?.target).toBe("toon");
      expect(evt?.externalId).toMatch(/^toon-donation-real-1-/);
      ids.add(String(evt?.externalId));
    }
    expect(ids.size).toBe(20);
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
