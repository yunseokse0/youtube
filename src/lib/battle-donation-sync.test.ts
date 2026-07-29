import { describe, expect, it } from "vitest";
import { recalculateMealParticipantScoresFromDonors } from "./battle-donation-sync";
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
});
