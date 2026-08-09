import { describe, expect, it } from "vitest";
import { applyDonationToAppState } from "../apply-donation-state";
import { parseToonationWebSocketMessage } from "./parse-event";
import {
  applyOwnerDonationRemapIfNeeded,
  normalizeOwnerNameForCompare,
} from "./owner-donation-remap";
import type { AppState } from "@/types";

function baseState(
  members: Array<{ id: string; name: string; operating?: boolean }>,
  memberPositions?: Record<string, string>
): AppState {
  return {
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      account: 0,
      toon: 0,
      contribution: 0,
      ...(m.operating ? { operating: true } : {}),
    })),
    donors: [],
    updatedAt: 1,
    ...(memberPositions ? { memberPositions } : {}),
  } as AppState;
}

describe("toonation auto-apply flow (parse → apply)", () => {
  it("text 후원 테스트 → 투네 열·운영비 자동 배치", () => {
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

    const result = applyDonationToAppState(
      baseState([
        { id: "op", name: "운영비", operating: true },
        { id: "m1", name: "BT태호" },
      ]),
      event!,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "op")?.toon).toBe(10000);
    expect(result.state.members.find((m) => m.id === "m1")?.toon).toBe(0);
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
    expect(result.state.donors?.[0]?.target).toBe("account");
  });

  it("계좌 키워드가 메시지 중간에 있어도 계좌 열 반영", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "시청자",
        amount: 15000,
        comment: "후원 계좌 익명 BT태호",
      },
    });
    const event = parseToonationWebSocketMessage(raw);
    expect(event?.target).toBe("account");
    expect(event?.donorName).toBe("익명");
    expect(event?.playerName).toBe("BT태호");

    const result = applyDonationToAppState(baseState([{ id: "m1", name: "BT태호" }]), event!, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members[0]?.account).toBe(15000);
  });

  it("채널 주인 닉=후원자 → 메시지 익명 태호 (계좌)", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "BT태호",
        amount: 10000,
        comment: "익명 태호",
      },
    });
    const parsed = parseToonationWebSocketMessage(raw)!;
    const remapped = applyOwnerDonationRemapIfNeeded(
      parsed,
      new Set([normalizeOwnerNameForCompare("BT태호")])
    );
    expect(remapped.target).toBe("account");
    expect(remapped.donorName).toBe("익명");
    expect(remapped.playerName).toBe("태호");

    const result = applyDonationToAppState(
      baseState([
        { id: "m1", name: "BT태호" },
        { id: "m2", name: "홍쓰" },
      ]),
      remapped,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "m1")?.account).toBe(10000);
    expect(result.state.members.find((m) => m.id === "m1")?.toon).toBe(0);
  });

  it("채널 주인 닉=후원자 → 메시지 익명 홍쓰 (계좌)", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "BT태호",
        amount: 10000,
        comment: "익명 홍쓰",
      },
    });
    const parsed = parseToonationWebSocketMessage(raw)!;
    expect(parsed.target).toBe("toon");
    expect(parsed.donorName).toBe("BT태호");

    const remapped = applyOwnerDonationRemapIfNeeded(
      parsed,
      new Set([normalizeOwnerNameForCompare("BT태호")])
    );
    expect(remapped.target).toBe("account");
    expect(remapped.donorName).toBe("익명");
    expect(remapped.playerName).toBe("홍쓰");

    const result = applyDonationToAppState(
      baseState([
        { id: "m1", name: "BT태호" },
        { id: "m2", name: "홍쓰" },
      ]),
      remapped,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "m2")?.account).toBe(10000);
  });

  it("일반 투네 — 알림 닉=후원자, 메시지 첫 토큰=멤버", () => {
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

  it("투네 메시지 열 = 통합알림창 comment 원문 (익명 비서)", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "Y 철수",
        amount: 100000,
        comment: "익명 비서",
      },
    });
    const event = parseToonationWebSocketMessage(raw)!;
    expect(event.message).toBe("익명 비서");
    expect(event.donorName).toBe("Y 철수");
    expect(event.target).toBe("toon");

    const result = applyDonationToAppState(
      baseState([
        { id: "m1", name: "연비서" },
        { id: "m2", name: "BT태호" },
      ]),
      event,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.donors?.[0]?.message).toBe("익명 비서");
    expect(result.state.donors?.[0]?.name).toBe("Y 철수");
    expect(result.state.donors?.[0]?.target).toBe("toon");
    expect(result.state.members.find((m) => m.id === "m1")?.toon).toBe(100000);
    expect(result.event.memberId).toBe("m1");
  });

  it("메시지 익명 홍스(오타) → 홍쓰 유사 일치", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "Y 철수",
        amount: 10000,
        comment: "익명 홍스",
        isTest: true,
      },
    });
    const event = parseToonationWebSocketMessage(raw);
    expect(event?.playerName).toBe("홍스");
    const result = applyDonationToAppState(
      baseState([
        { id: "m1", name: "홍쓰" },
        { id: "m2", name: "BT태호" },
      ]),
      event!,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "m1")?.toon).toBe(10000);
    expect(result.event.memberFuzzyMatched).toBe(true);
  });

  it("메시지 익명 지히 → 자하 초성 유사 일치", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "Y 철수",
        amount: 10000,
        comment: "익명 지히",
        isTest: true,
      },
    });
    const event = parseToonationWebSocketMessage(raw);
    expect(event?.playerName).toBe("지히");
    const result = applyDonationToAppState(
      baseState([
        { id: "m1", name: "자하" },
        { id: "m2", name: "피자" },
      ]),
      event!,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "m1")?.toon).toBe(10000);
  });

  it("투네 메시지 태호만 → BT태호 유사 일치", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "시청자",
        amount: 8000,
        comment: "태호 화이팅",
      },
    });
    const event = parseToonationWebSocketMessage(raw);
    const result = applyDonationToAppState(
      baseState([
        { id: "m1", name: "BT태호" },
        { id: "m2", name: "홍쓰" },
      ]),
      event!,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.members.find((m) => m.id === "m1")?.toon).toBe(8000);
    expect(result.event.memberAutoAssigned).toBeFalsy();
  });

  it("잘못된 멤버명 힌트 → 운영비로 자동 반영", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "시청자",
        amount: 3000,
        comment: "없는멤버 화이팅",
      },
    });
    const event = parseToonationWebSocketMessage(raw);
    const result = applyDonationToAppState(
      baseState([
        { id: "m1", name: "BT태호" },
        { id: "op", name: "운영비", operating: true },
      ]),
      event!,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.memberId).toBe("op");
    expect(result.event.memberAutoAssigned).toBe(true);
    expect(result.state.members.find((m) => m.id === "op")?.toon).toBe(3000);
  });

  it("잘못된 멤버명 힌트·운영비 없음 → 국고로 자동 반영", () => {
    const raw = JSON.stringify({
      code: 101,
      content: {
        nickname: "시청자",
        amount: 2500,
        comment: "없는멤버 화이팅",
      },
    });
    const event = parseToonationWebSocketMessage(raw);
    const result = applyDonationToAppState(
      baseState([
        { id: "m1", name: "BT태호" },
        { id: "tr", name: "국고" },
      ]),
      event!,
      []
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.memberId).toBe("tr");
    expect(result.event.memberAutoAssigned).toBe(true);
    expect(result.state.members.find((m) => m.id === "tr")?.toon).toBe(2500);
  });
});
