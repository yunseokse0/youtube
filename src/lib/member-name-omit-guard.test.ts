import { describe, expect, it } from "vitest";
import { isDefaultPlaceholderMemberList } from "@/lib/state";

/**
 * omitDonationFields 저장 시 실멤버명은 payload에 남겨야 함 — 단위로 가드 조건만 검증
 */
describe("omitDonationFields keeps meaningful member names", () => {
  it("treats custom names as non-placeholder", () => {
    expect(
      isDefaultPlaceholderMemberList([
        { id: "m1", name: "지키", account: 0, toon: 0, contribution: 0 },
        { id: "m2", name: "333", account: 0, toon: 0, contribution: 0 },
        { id: "m3", name: "444", account: 15, toon: 0, contribution: 15 },
        { id: "m4", name: "555", account: 0, toon: 0, contribution: 0 },
      ])
    ).toBe(false);
  });

  it("still detects default 멤버N slots", () => {
    expect(
      isDefaultPlaceholderMemberList([
        { id: "m1", name: "멤버1", account: 150000, toon: 0, contribution: 150000 },
        { id: "m2", name: "멤버2", account: 0, toon: 0, contribution: 0 },
      ])
    ).toBe(true);
  });
});
