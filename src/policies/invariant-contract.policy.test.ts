import { describe, it, expect } from "vitest";
import {
  InvariantContract,
  InvariantContractError,
  assertInvariants,
} from "@policies/invariant-contract.policy";
import { ERROR_CODES } from "@domain/types/error-envelope";

describe("InvariantContract", () => {
  it("TR-3.3: rosterVersion 강제 후퇴시 DIN-INVAR-001 throw or return err", () => {
    const good = { rosterVersion: 11, prevRosterVersion: 10 };
    const res1 = InvariantContract.checkAll(good, { path: "/write/good" });
    expect(res1.passed).toBe(true);
    expect(res1.violations.length).toBe(0);

    const bad = { rosterVersion: 9, prevRosterVersion: 10 };
    const res2 = InvariantContract.checkAll(bad, { path: "/write/bad" });
    expect(res2.passed).toBe(false);
    const badV = res2.violations.find((v) => v.code === ERROR_CODES.DIN_INVAR_001);
    expect(badV).toBeDefined();
    expect(badV?.rule).toBe("rosterVersion.monotonic");

    expect(() =>
      InvariantContract.checkAll(bad, { path: "/throw", throwOnViolation: true }),
    ).toThrow(InvariantContractError);

    const assertR = InvariantContract.assert(bad, { path: "assert" });
    expect(assertR.tag).toBe("err");
    expect(assertR.tag === "err" && assertR.error.code).toBe(ERROR_CODES.DIN_INVAR_001);
  });

  it("donorListVersion 단조 위반 → DIN-INVAR-002", () => {
    const bad = { donorListVersion: 4, prevDonorListVersion: 5 };
    const r = assertInvariants(bad, "/x/donors", false);
    const v = r.violations.find((x) => x.code === ERROR_CODES.DIN_INVAR_002);
    expect(v).toBeDefined();
    expect(v?.detail.prevDonorListVersion).toBe(5);
    expect(v?.detail.donorListVersion).toBe(4);
  });

  it("기여도 공식 불일치 → DIN-INVAR-003", () => {
    const mismatch = {
      donationLinks: {},
      members: [
        { id: "m1", contribution: 1000 },
        { id: "m2", contribution: 500 },
      ],
      contributionLogs: [
        { memberId: "m1", delta: 3000 },
        { memberId: "m2", delta: 500 },
      ],
    };
    const r = assertInvariants(mismatch, "/contrib");
    const v = r.violations.find((x) => x.code === ERROR_CODES.DIN_INVAR_003);
    expect(v).toBeDefined();
    expect(v?.detail.memberContribSum).toBe(1500);
    expect(v?.detail.logSum).toBe(3500);
  });

  it("기여도 일치 + version 모두 ok → 통과", () => {
    const perfect = {
      rosterVersion: 5,
      prevRosterVersion: 5,
      donorListVersion: 12,
      prevDonorListVersion: 10,
      donationLinks: {},
      members: [
        { id: "m1", contribution: 2000 },
        { id: "m2", contribution: 1500 },
      ],
      contributionLogs: [
        { memberId: "m1", delta: 2000 },
        { memberId: "m2", delta: 1500 },
      ],
    };
    const r = assertInvariants(perfect, "/good");
    expect(r.passed).toBe(true);
    expect(r.violations.length).toBe(0);
  });

  it("필드 누락 state는 skip (null/undefined 안전)", () => {
    const r1 = assertInvariants(null, "/null");
    expect(r1.passed).toBe(true);

    const r2 = assertInvariants({ rosterVersion: 3 }, "/noPrev");
    expect(r2.passed).toBe(true);
  });
});
