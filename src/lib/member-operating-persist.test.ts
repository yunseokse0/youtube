import { describe, expect, it } from "vitest";
import { mergeStatePreservingDonorsUntilSettlementReset } from "@/lib/donation/merge-donation-apply-base";
import { mergeManualMemberFieldsFromPatch } from "@/lib/member-roster-merge";
import { defaultState } from "@/lib/state";
import type { AppState, Member } from "@/types";

const RESET_AT = Date.UTC(2026, 9, 12, 6, 36, 26);

function stateWith(members: Member[], updatedAt: number): AppState {
  return { ...defaultState(), settlementResetAt: RESET_AT, members, donors: [], updatedAt };
}

describe("멤버 카드 운영비 저장", () => {
  const server = stateWith(
    [
      { id: "m1", name: "패자", account: 0, toon: 0 },
      { id: "m2", name: "효팔", account: 0, toon: 0 },
      { id: "m3", name: "새멤버", account: 0, toon: 0 },
    ],
    RESET_AT + 1_000
  );
  const browser = stateWith(
    server.members.map((m) => (m.id === "m3" ? { ...m, operating: true } : m)),
    RESET_AT + 2_000
  );

  it("union 저장은 로스터 동점이면 서버 멤버가 이겨 운영비가 풀린다", () => {
    const merged = mergeStatePreservingDonorsUntilSettlementReset(browser, server);
    expect(merged.members.find((m) => m.id === "m3")?.operating).toBeFalsy();
  });

  it("멤버 값 우선 저장은 운영비 체크를 유지하고 금액은 서버 값을 쓴다", () => {
    const merged = mergeStatePreservingDonorsUntilSettlementReset(browser, server);
    const members = mergeManualMemberFieldsFromPatch(merged.members, browser.members);
    expect(members.find((m) => m.id === "m3")?.operating).toBe(true);
    expect(members.find((m) => m.id === "m1")?.operating).toBe(false);
    expect(members.map((m) => m.account)).toEqual([0, 0, 0]);
  });
});
