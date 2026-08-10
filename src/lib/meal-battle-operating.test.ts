import { describe, expect, it } from "vitest";
import { ensureMealBattleParticipantRow } from "./meal-battle-donation";
import type { Member } from "@/types";

const palette = ["#60a5fa"];

describe("ensureMealBattleParticipantRow excludes operating", () => {
  it("does not add operating-flag member", () => {
    const member = { id: "op", name: "운영비", operating: true } as Pick<
      Member,
      "id" | "name" | "operating" | "realName"
    >;
    const next = ensureMealBattleParticipantRow(undefined, member, palette);
    expect(next).toEqual([]);
  });

  it("does not add member whose position is 운영비", () => {
    const member = { id: "x", name: "홍길동", operating: false } as Pick<
      Member,
      "id" | "name" | "operating" | "realName"
    >;
    const next = ensureMealBattleParticipantRow(undefined, member, palette, { x: "운영비" });
    expect(next).toEqual([]);
  });

  it("adds normal members", () => {
    const member = { id: "a", name: "태호", operating: false } as Pick<
      Member,
      "id" | "name" | "operating" | "realName"
    >;
    const next = ensureMealBattleParticipantRow(undefined, member, palette);
    expect(next).toHaveLength(1);
    expect(next[0]?.memberId).toBe("a");
  });
});
