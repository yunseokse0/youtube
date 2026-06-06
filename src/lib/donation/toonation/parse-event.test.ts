import { describe, expect, it } from "vitest";
import {
  parseToonationDonationPayload,
  parseToonationWebSocketMessage,
  unwrapToonationPayload,
} from "./parse-event";

describe("toonation parse-event", () => {
  it("parses ws code 101 donation message", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        id: "abc123",
        nickname: "후원자",
        amount: 5000,
        comment: "화이팅",
      },
    });
    const evt = parseToonationWebSocketMessage(raw);
    expect(evt?.donorName).toBe("후원자");
    expect(evt?.amount).toBe(5000);
    expect(evt?.message).toBe("화이팅");
    expect(evt?.id).toBe("toonation:abc123");
  });

  it("unwraps nested content payloads", () => {
    const nested = {
      content: { nickName: "닉", amount: 1000, comment: "메시지" },
    };
    const flat = unwrapToonationPayload(nested);
    const evt = parseToonationDonationPayload(flat);
    expect(evt?.donorName).toBe("닉");
    expect(evt?.amount).toBe(1000);
  });

  it("ignores non-donation ws codes", () => {
    const raw = JSON.stringify({ code: 107, content: { amount: 100 } });
    expect(parseToonationWebSocketMessage(raw)).toBeNull();
  });
});
