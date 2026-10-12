import { describe, expect, it } from "vitest";
import { dropRebumpedPreResetDonors } from "@/lib/settlement-rebump-guard";
import {
  defaultState,
  rebumpDonorsPastSettlementReset,
  rebumpOnlyPostResetDonors,
} from "@/lib/state";
import type { AppState, Donor } from "@/types";

const RESET_AT = Date.UTC(2026, 9, 12, 6, 36, 26, 61);
const MIN = 60_000;

function donor(id: string, at: number, amount = 10_000): Donor {
  return { id, name: id, amount, memberId: "m1", at, target: "toon" } as Donor;
}

function state(donors: Donor[], resetAt = RESET_AT): AppState {
  return { ...defaultState(), settlementResetAt: resetAt, donors };
}

describe("rebumpOnlyPostResetDonors", () => {
  it("리셋 이전 행은 버리고 리셋 이후였던 행만 남긴다", () => {
    const old1 = donor("old1", RESET_AT - 30 * MIN);
    const old2 = donor("old2", RESET_AT - 5 * MIN);
    const fresh = donor("fresh", RESET_AT + 15 * MIN);
    const out = rebumpOnlyPostResetDonors([old1, old2, fresh], [old1, old2, fresh], RESET_AT);
    expect(out.map((d) => d.id)).toEqual(["fresh"]);
    expect(out[0]?.at).toBe(fresh.at);
  });

  it("보정으로 리셋 전 시각이 된 리셋 이후 행은 rebump 해 살린다", () => {
    const fresh = donor("fresh", RESET_AT + 2 * MIN);
    const repaired = { ...fresh, at: RESET_AT - MIN };
    const out = rebumpOnlyPostResetDonors([fresh], [repaired], RESET_AT);
    expect(out).toHaveLength(1);
    expect(Number(out[0]?.at)).toBeGreaterThanOrEqual(RESET_AT);
  });
});

describe("dropRebumpedPreResetDonors", () => {
  it("옛 탭이 리셋 직후로 rebump 해 보낸 구 후원 412건을 뺀다", () => {
    const testDonation = donor("test", RESET_AT + 15 * MIN);
    const server = state([testDonation]);
    const oldRows = Array.from({ length: 412 }, (_, i) =>
      donor(`old${i}`, RESET_AT - (i + 1) * MIN)
    );
    const rebumped = rebumpDonorsPastSettlementReset(oldRows, RESET_AT);
    const incoming = state([testDonation, ...rebumped]);
    const out = dropRebumpedPreResetDonors(incoming, server);
    expect(out.dropped).toBe(412);
    expect((out.state.donors || []).map((d) => d.id)).toEqual(["test"]);
  });

  it("서버에 이미 있는 행과 리셋 뒤 실제 후원은 그대로 둔다", () => {
    const justAfter = donor("justAfter", RESET_AT + 3);
    const later = donor("later", RESET_AT + 5 * MIN);
    const server = state([justAfter]);
    const out = dropRebumpedPreResetDonors(state([justAfter, later]), server);
    expect(out.dropped).toBe(0);
    expect((out.state.donors || []).map((d) => d.id)).toEqual(["justAfter", "later"]);
  });

  it("정산 리셋 기록이 없으면 아무것도 빼지 않는다", () => {
    const server = state([], 0);
    const incoming = state([donor("a", Date.now())], 0);
    expect(dropRebumpedPreResetDonors(incoming, server).dropped).toBe(0);
  });
});
