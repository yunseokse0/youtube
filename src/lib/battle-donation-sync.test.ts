import { describe, expect, it } from "vitest";
import {
  applyMealBattleDonationsFromTime,
  formatMealBattleFromAtInput,
  parseMealBattleFromAtInput,
  recalculateMealParticipantScoresFromDonors,
  resetMealBattleDonationUi,
} from "./battle-donation-sync";
import type { Donor, MealBattleState } from "@/types";

describe("recalculateMealParticipantScoresFromDonors", () => {
  it("sums raw donation amounts when team battle uses raw score", () => {
    const mealBattle: MealBattleState = {
      participants: [
        {
          memberId: "m1",
          name: "A",
          score: 0,
          goal: 100,
          color: "#f00",
          donationLinkActive: true,
          donationLinkStartedAt: 1,
        },
      ],
      memberGaugeColors: {},
      overlayTitle: "식사 대전",
      currentMission: "",
      totalGoal: 100,
      timerTheme: "default",
      timerSize: 36,
      missionBubbleBg: "#9333ea",
      missionBubbleTextColor: "#ffffff",
      gaugeTrackBg: "#111",
      gaugeTrackBorderColor: "#333",
      gaugeFillColor: "#22c55e",
      scoreTextColor: "#fff",
      nameTagBg: "#ff0",
      nameTagTextColor: "#000",
      showPanelBorder: false,
      panelBorderColor: "#fff",
      showGaugeTrackBorder: false,
      teamBattleEnabled: true,
      teamAName: "A",
      teamBName: "B",
      teamAGoal: 0,
      teamBGoal: 0,
      teamAMemberIds: [],
      teamBMemberIds: [],
      teamAColor: "#2563eb",
      teamBColor: "#dc2626",
      gaugeEffects: {
        critical: true,
        floatingScore: true,
        rankUp: true,
        timerTension: true,
        gaugeMotion: true,
      },
    };
    const donors: Donor[] = [
      { id: "d1", name: "x", amount: 50_000, memberId: "m1", at: 2_000, target: "toon" },
      { id: "d2", name: "y", amount: 141_000, memberId: "m1", at: 3_000, target: "account" },
    ];
    const out = recalculateMealParticipantScoresFromDonors(mealBattle, donors);
    expect(out[0]?.score).toBe(191_000);
  });

  it("reset ignores donations before the stamp and keeps later ones", () => {
    const mealBattle: MealBattleState = {
      participants: [
        {
          memberId: "m1",
          name: "A",
          score: 191_000,
          goal: 100,
          color: "#f00",
          donationLinkActive: true,
          donationLinkStartedAt: 1,
        },
        {
          memberId: "m2",
          name: "B",
          score: 40_000,
          goal: 100,
          color: "#00f",
          donationLinkActive: false,
          donationLinkStartedAt: 1,
        },
      ],
      memberGaugeColors: {},
      overlayTitle: "식사 대전",
      currentMission: "",
      totalGoal: 100,
      timerTheme: "default",
      timerSize: 36,
      missionBubbleBg: "#9333ea",
      missionBubbleTextColor: "#ffffff",
      gaugeTrackBg: "#111",
      gaugeTrackBorderColor: "#333",
      gaugeFillColor: "#22c55e",
      scoreTextColor: "#fff",
      nameTagBg: "#ff0",
      nameTagTextColor: "#000",
      showPanelBorder: false,
      panelBorderColor: "#fff",
      showGaugeTrackBorder: false,
      teamBattleEnabled: true,
      teamAName: "A",
      teamBName: "B",
      teamAGoal: 0,
      teamBGoal: 0,
      teamAMemberIds: ["m1"],
      teamBMemberIds: ["m2"],
      teamAColor: "#2563eb",
      teamBColor: "#dc2626",
      gaugeEffects: {
        critical: true,
        floatingScore: true,
        rankUp: true,
        timerTension: true,
        gaugeMotion: true,
      },
    };
    const resetAt = 10_000;
    const reset = resetMealBattleDonationUi(mealBattle, resetAt);
    expect(reset.participants[0]?.score).toBe(0);
    expect(reset.participants[0]?.donationLinkStartedAt).toBe(resetAt);
    expect(reset.participants[1]?.score).toBe(0);
    expect(reset.participants[1]?.donationLinkStartedAt).toBe(1);
    const donors: Donor[] = [
      { id: "old", name: "x", amount: 191_000, memberId: "m1", at: 5_000, target: "toon" },
      { id: "next", name: "y", amount: 3_000, memberId: "m1", at: 11_000, target: "account" },
    ];
    const out = recalculateMealParticipantScoresFromDonors(reset, donors);
    expect(out[0]?.score).toBe(3_000);
    expect(out[1]?.score).toBe(0);
  });

  it("applies only later donations for the chosen members", () => {
    const fromAt = 10_000;
    const applied = applyMealBattleDonationsFromTime(
      {
        participants: [
          {
            memberId: "m1",
            name: "A",
            score: 191_000,
            goal: 100,
            color: "#f00",
            donationLinkActive: false,
            donationLinkStartedAt: 1,
          },
          {
            memberId: "m2",
            name: "B",
            score: 40_000,
            goal: 100,
            color: "#00f",
            donationLinkActive: false,
            donationLinkStartedAt: 1,
          },
        ],
        memberGaugeColors: {},
        overlayTitle: "식사 대전",
        currentMission: "",
        totalGoal: 100,
        timerTheme: "default",
        timerSize: 36,
        missionBubbleBg: "#9333ea",
        missionBubbleTextColor: "#ffffff",
        gaugeTrackBg: "#111",
        gaugeTrackBorderColor: "#333",
        gaugeFillColor: "#22c55e",
        scoreTextColor: "#fff",
        nameTagBg: "#ff0",
        nameTagTextColor: "#000",
        showPanelBorder: false,
        panelBorderColor: "#fff",
        showGaugeTrackBorder: false,
        teamBattleEnabled: true,
        teamAName: "A",
        teamBName: "B",
        teamAGoal: 0,
        teamBGoal: 0,
        teamAMemberIds: ["m1"],
        teamBMemberIds: ["m2"],
        teamAColor: "#2563eb",
        teamBColor: "#dc2626",
        gaugeEffects: {
          critical: true,
          floatingScore: true,
          rankUp: true,
          timerTension: true,
          gaugeMotion: true,
        },
      },
      [
        { id: "old", name: "x", amount: 191_000, memberId: "m1", at: 5_000, target: "toon" },
        { id: "next", name: "y", amount: 3_000, memberId: "m1", at: 11_000, target: "account" },
        { id: "b", name: "z", amount: 50_000, memberId: "m2", at: 12_000, target: "toon" },
      ],
      { fromAt, memberIds: ["m1"] }
    );
    expect(applied.participants[0]?.donationLinkActive).toBe(true);
    expect(applied.participants[0]?.donationLinkStartedAt).toBe(fromAt);
    expect(applied.participants[0]?.score).toBe(3_000);
    expect(applied.participants[1]?.score).toBe(40_000);
    expect(applied.participants[1]?.donationLinkActive).toBe(false);
  });

  it("round-trips the datetime-local input", () => {
    const ms = Date.parse("2026-10-07T09:26:00.000Z");
    expect(parseMealBattleFromAtInput(formatMealBattleFromAtInput(ms))).toBe(ms);
  });
});
