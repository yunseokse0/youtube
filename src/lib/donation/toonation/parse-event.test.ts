import { describe, expect, it } from "vitest";
import {
  parseToonationDonationPayload,
  parseToonationMessageBody,
  parseToonationWebSocketMessage,
  unwrapToonationPayload,
} from "./parse-event";

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
});
