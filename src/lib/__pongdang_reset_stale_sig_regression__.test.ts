import { describe, it, expect } from "vitest";
import {
  collectDay777SigContributionByMember,
  collectAppearedSigCredits,
  resolveDay777SigCreditFallbackMemberId,
  applyOverlayDonationDisplayTotals,
} from "./overlay-donation-aggregate";
import type { AppState, Donor, Member } from "@/types";

describe("Reproduction of 서유하 9,643,000 bug", () => {
  const atCutoff = new Date("2026-11-25T20:08:00+09:00").getTime();
  const atOldManual = new Date("2026-11-25T01:00:00+09:00").getTime(); // 19 hours before cutoff!

  const members: Member[] = [
    { id: "m1", name: "자키", contribution: 0 },
    { id: "m2", name: "진아", contribution: 0 },
    { id: "m_seoyuha", name: "서유하", contribution: 0 },
  ];

  // 12 old manual sigs totaling 9,543,000 with NO memberId
  const oldManualSigs = [
    { id: "s1", name: "Rubis", price: 96000, memberId: "" },
    { id: "s2", name: "Royal VIP", price: 5000000, memberId: "" },
    { id: "s3", name: "상사화", price: 400000, memberId: "" },
    { id: "s4", name: "핫해", price: 33500, memberId: "" },
    { id: "s5", name: "바람피면 디지는거야", price: 44000, memberId: "" },
    { id: "s6", name: "바밤바", price: 55500, memberId: "" },
    { id: "s7", name: "Love me", price: 99000, memberId: "" },
    { id: "s8", name: "STAY", price: 180000, memberId: "" },
    { id: "s9", name: "Love Is Gone", price: 1500000, memberId: "" },
    { id: "s10", name: "라라리라라", price: 76000, memberId: "" },
    { id: "s11", name: "디스코테카", price: 59000, memberId: "" },
    { id: "s12", name: "VVIP", price: 2000000, memberId: "" },
  ];

  // After 20:08 cutoff, 서유하 receives 2 donations of 50,000 (total 100,000)
  const donorsAfterCutoff: Donor[] = [
    {
      id: "d1",
      at: atCutoff + 60000,
      name: "쵸빈",
      memberId: "m_seoyuha",
      amount: 50000,
      sigPrice: 50000,
      message: "유하",
    },
    {
      id: "d2",
      at: atCutoff + 70000,
      name: "쵸빈",
      memberId: "m_seoyuha",
      amount: 50000,
      sigPrice: 50000,
      message: "유하",
    },
  ];

  const state: AppState = {
    members,
    donors: donorsAfterCutoff,
    overlaySettings: {
      sigSalesManualBroadcastV1: {
        phase: "LANDED",
        startedAt: atOldManual,
        selectedSigs: oldManualSigs,
        oneShotResult: { id: "sig_one_shot", name: "한방 시그", price: 9543000 },
        overlayReloadNonce: 1,
      },
    } as any,
  };

  it("verifies the fix: 서유하 gets only 100,000 after 20:08 cutoff instead of 9,643,000!", () => {
    const oldTotal = oldManualSigs.reduce((sum, s) => sum + s.price, 0);
    expect(oldTotal).toBe(9543000);

    const sigMap = collectDay777SigContributionByMember(state, atCutoff);
    expect(sigMap.get("m_seoyuha")).toBe(100000);

    const appliedState = applyOverlayDonationDisplayTotals(state, {
      fromAt: atCutoff,
      day777Calc: true,
    });
    const seoyuha = appliedState.members.find((m) => m.id === "m_seoyuha");
    expect(seoyuha?.contribution).toBe(100000);
  });

  it("verifies unassigned sigs without a 777 shot never fall back to single donor", () => {
    // If multiple members exist, but only one received a normal donation (no 777 shot)
    const fallbackId = resolveDay777SigCreditFallbackMemberId(donorsAfterCutoff, null, members);
    expect(fallbackId).toBe("");
  });
});
