import { describe, expect, it } from "vitest";
import { applyDonationToAppState } from "../apply-donation-state";
import { parseToonationWebSocketMessage } from "./parse-event";
import type { AppState } from "@/types";

function baseState(members: Array<{ id: string; name: string }>): AppState {
  return {
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      account: 0,
      toon: 0,
      contribution: 0,
    })),
    donors: [],
    updatedAt: 1,
  } as AppState;
}

describe("toonation auto-apply flow (parse → apply)", () => {
  it("text 후원 테스트 → 투네 열·첫 멤버 자동 배치", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "익명 홍쓰",
        amount: 10000,
        comment: "",
        isTest: true,
      },
    });
    const event = parseToonationWebSocketMessage(raw);
    expect(event).not.toBeNull();
    expect(event?.target).toBe("toon");

    const result = applyDonationToAppState(baseState([{ id: "m1", name: "BT태호" }]), event!, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.toon).toBe(10000);
    expect(result.state.members[0]?.account).toBe(0);
    expect(result.state.donors?.[0]?.target).toBe("toon");
    expect(result.event.memberAutoAssigned).toBe(true);
  });

  it("계좌 포맷 WS → 계좌 열 반영", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "결제자",
        amount: 20000,
        comment: "계좌 익명 BT태호",
      },
    });
    const event = parseToonationWebSocketMessage(raw);
    expect(event?.target).toBe("account");

    const result = applyDonationToAppState(baseState([{ id: "m1", name: "BT태호" }]), event!, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.account).toBe(20000);
    expect(result.state.members[0]?.toon).toBe(0);
  });

  it("메시지에 멤버명 포함 → 해당 멤버 투네 반영", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "시청자",
        amount: 5000,
        comment: "BT태호 화이팅",
      },
    });
    const event = parseToonationWebSocketMessage(raw);
    const result = applyDonationToAppState(
      baseState([
        { id: "m1", name: "BT태호" },
        { id: "m2", name: "다른멤버" },
      ]),
      event!,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "m1")?.toon).toBe(5000);
    expect(result.event.memberAutoAssigned).toBeFalsy();
  });
});
