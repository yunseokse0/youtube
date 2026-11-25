import { describe, it, expect } from "vitest";
import {
  applyOverlayDonationDisplayTotals,
  resolveOverlayContributionSource,
} from "@/lib/overlay-donation-aggregate";
import { resolveMemberContributionTotal } from "@/domain/sync/sync-repair-1pass";
import { resolveDonationAggregateFromAt } from "@/lib/overlay-params";
import type { AppState, Donor, Member } from "@/types";

describe("오버레이 후원 집계 기준 시점(donationAggregateFromAt) 및 9,643,000 점 치솟는 버그 방지 검증", () => {
  const members: Member[] = [
    { id: "m_seoyuha", name: "서유하", contribution: 9643000, account: 9643000, toon: 0 },
    { id: "m_jina", name: "진아", contribution: 0, account: 0, toon: 0 },
    { id: "m_surin", name: "수린", contribution: 193500, account: 193500, toon: 0 },
  ];

  // 18:00 (1795597200000) 기준
  const cutoff18 = 1795597200000;

  const donors: Donor[] = [
    // 18시 이전 서유하의 9,643,000원 누적 후원
    {
      id: "don_seoyuha_old",
      name: "서유하팬",
      amount: 9643000,
      memberId: "m_seoyuha",
      at: cutoff18 - 3600000, // 17:00
      target: "account",
    },
    // 18시 이전 수린의 193,500원 후원
    {
      id: "don_surin_old",
      name: "고모",
      amount: 193500,
      memberId: "m_surin",
      at: cutoff18 - 1800000, // 17:30
      target: "account",
    },
    // 18시 이후 진아의 26,000원 후원
    {
      id: "don_jina_new",
      name: "비비",
      amount: 26000,
      memberId: "m_jina",
      at: cutoff18 + 1577000, // 18:26:17
      target: "account",
    },
  ];

  const state: AppState = {
    members,
    donors,
    contributionFormula: { accountPct: 100, toonPct: 100 },
  };

  it("1. 18시 이후 필터 적용 시, 18시 이후 후원이 없는 서유하의 기여도는 0이어야 하며 기존 9,643,000원이 나오면 안 된다", () => {
    // A. 18시 이후 후원 소스 분리 검증
    const source = resolveOverlayContributionSource(state, {
      fromAt: cutoff18,
    });

    expect(source.donors.length).toBe(1);
    expect(source.donors[0]?.id).toBe("don_jina_new");

    // B. 서유하의 18시 이후 기여도 계산 -> 0
    const seoyuhaPoints = resolveMemberContributionTotal("m_seoyuha", {
      donors: source.donors,
      contributionLogs: [],
      contributionFormula: state.contributionFormula,
    });
    expect(seoyuhaPoints).toBe(0);

    // C. 진아의 18시 이후 기여도 계산 -> 26,000
    const jinaPoints = resolveMemberContributionTotal("m_jina", {
      donors: source.donors,
      contributionLogs: [],
      contributionFormula: state.contributionFormula,
    });
    expect(jinaPoints).toBe(26000);

    // D. applyOverlayDonationDisplayTotals 검증
    const result = applyOverlayDonationDisplayTotals(state, {
      fromAt: cutoff18,
    });

    const mSeoyuha = result.members?.find((m) => m.id === "m_seoyuha");
    const mJina = result.members?.find((m) => m.id === "m_jina");
    const mSurin = result.members?.find((m) => m.id === "m_surin");

    expect(mSeoyuha?.contribution).toBe(0); // 9,643,000이 아닌 0!
    expect(mSeoyuha?.account).toBe(0);
    expect(mJina?.contribution).toBe(26000);
    expect(mJina?.account).toBe(26000);
    expect(mSurin?.contribution).toBe(0);
    expect(mSurin?.account).toBe(0);
  });

  it("2. 책정 OFF (fromAt = -1) 시 모든 멤버의 기여도가 0으로 고정된다", () => {
    const result = applyOverlayDonationDisplayTotals(state, {
      fromAt: -1,
    });

    for (const m of result.members || []) {
      expect(m.contribution).toBe(0);
      expect(m.account).toBe(0);
      expect(m.toon).toBe(0);
    }
  });

  it("3. resolveDonationAggregateFromAt 은 off, 숫자, 빈 값을 정확히 파싱한다", () => {
    const spOff = new URLSearchParams("donationAggregateFromAt=off");
    expect(resolveDonationAggregateFromAt(spOff, null, { ready: true })).toBe(-1);

    const spNum = new URLSearchParams(`donationAggregateFromAt=${cutoff18}`);
    expect(resolveDonationAggregateFromAt(spNum, null, { ready: true })).toBe(cutoff18);

    const spEmpty = new URLSearchParams("");
    expect(resolveDonationAggregateFromAt(spEmpty, null, { ready: true })).toBeNull();
  });
});
