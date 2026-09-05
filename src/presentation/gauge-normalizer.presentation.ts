import type { MealBattleState, MealMatchSettings, DonationTableColumnsOptions } from "@/types";
import { DEFAULT_MEAL_GAUGE_EFFECTS, normalizeMealGaugeEffects } from "@/lib/meal-gauge-effects";
import { normalizeDonationTableColumnsOptions } from "@/lib/donation-table-options";

export function normalizeMealBattleState(input: unknown): MealBattleState {
  const v = input && typeof input === "object" ? (input as Partial<MealBattleState>) : {};
  const rawGaugeColors = (v as Record<string, unknown>).memberGaugeColors;
  const memberGaugeColors =
    rawGaugeColors && typeof rawGaugeColors === "object" && !Array.isArray(rawGaugeColors)
      ? Object.fromEntries(
          Object.entries(rawGaugeColors as Record<string, unknown>)
            .filter(([key, val]) => typeof key === "string" && typeof val === "string" && String(val).trim())
            .map(([key, val]) => [key, String(val).trim()])
        )
      : {};
  const otRaw = typeof v.overlayTitle === "string" ? v.overlayTitle.trim() : "";
  const cmRaw = typeof v.currentMission === "string" ? v.currentMission.trim() : "";
  const orRaw =
    typeof (v as Record<string, unknown>).overlayRulesText === "string"
      ? String((v as Record<string, unknown>).overlayRulesText).trim()
      : "";
  const totalGoal = Number.isFinite(v.totalGoal) ? Math.max(1, Math.floor(v.totalGoal as number)) : 100;
  const participantsWithGoals = Array.isArray(v.participants)
    ? v.participants
        .filter((x) => Boolean(x && typeof x === "object"))
        .map((x) => {
          const goalRaw = (x as Record<string, unknown>).goal;
          const goalNum = Number(goalRaw);
          const goal =
            goalRaw !== undefined && goalRaw !== null && Number.isFinite(goalNum) ? Math.max(1, Math.floor(goalNum)) : totalGoal;
          return {
            memberId: String((x as Record<string, unknown>).memberId || ""),
            name: String((x as Record<string, unknown>).name || ""),
            score: Math.max(0, Math.floor(Number((x as Record<string, unknown>).score || 0) || 0)),
            goal,
            color: String((x as Record<string, unknown>).color || "#60a5fa"),
            donationLinkActive: Boolean((x as Record<string, unknown>).donationLinkActive),
            donationLinkStartedAt: Number.isFinite(Number((x as Record<string, unknown>).donationLinkStartedAt))
              ? Math.max(0, Math.floor(Number((x as Record<string, unknown>).donationLinkStartedAt)))
              : undefined,
          };
        })
        .filter((x) => Boolean(x.memberId))
    : [];
  return {
    participants: participantsWithGoals,
    memberGaugeColors,
    overlayTitle: otRaw || "식사 대전",
    currentMission: cmRaw,
    overlayRulesText: orRaw,
    overlayRulesFontSize: (() => {
      const n = Number((v as Record<string, unknown>).overlayRulesFontSize);
      if (!Number.isFinite(n)) return 16;
      return Math.max(10, Math.min(36, Math.round(n)));
    })(),
    totalGoal,
    timerTheme: v.timerTheme === "neon" || v.timerTheme === "minimal" || v.timerTheme === "danger" ? v.timerTheme : "default",
    timerSize: Number.isFinite(v.timerSize) ? Math.max(16, Math.min(120, Math.floor(v.timerSize as number))) : 36,
    missionBubbleBg: String((v as Record<string, unknown>).missionBubbleBg || "#9333ea"),
    missionBubbleTextColor: String((v as Record<string, unknown>).missionBubbleTextColor || "#ffffff"),
    gaugeTrackBg: String((v as Record<string, unknown>).gaugeTrackBg || "rgba(23,23,23,0.85)"),
    gaugeTrackBorderColor: String((v as Record<string, unknown>).gaugeTrackBorderColor || "rgba(255,255,255,0.2)"),
    gaugeFillColor: String((v as Record<string, unknown>).gaugeFillColor || "#22c55e"),
    scoreTextColor: String((v as Record<string, unknown>).scoreTextColor || "#ffffff"),
    nameTagBg: String((v as Record<string, unknown>).nameTagBg || "#facc15"),
    nameTagTextColor: String((v as Record<string, unknown>).nameTagTextColor || "#000000"),
    showPanelBorder: typeof (v as Record<string, unknown>).showPanelBorder === "boolean" ? Boolean((v as Record<string, unknown>).showPanelBorder) : false,
    panelBorderColor: String((v as Record<string, unknown>).panelBorderColor || "rgba(255,255,255,0.25)"),
    showGaugeTrackBorder: typeof (v as Record<string, unknown>).showGaugeTrackBorder === "boolean"
      ? Boolean((v as Record<string, unknown>).showGaugeTrackBorder)
      : false,
    teamBattleEnabled: Boolean((v as Record<string, unknown>).teamBattleEnabled),
    scoreUsesRawDonationAmount:
      typeof (v as Record<string, unknown>).scoreUsesRawDonationAmount === "boolean"
        ? Boolean((v as Record<string, unknown>).scoreUsesRawDonationAmount)
        : Boolean((v as Record<string, unknown>).teamBattleEnabled),
    teamAName: typeof (v as Record<string, unknown>).teamAName === "string" && String((v as Record<string, unknown>).teamAName).trim()
      ? String((v as Record<string, unknown>).teamAName).trim()
      : "A팀",
    teamBName: typeof (v as Record<string, unknown>).teamBName === "string" && String((v as Record<string, unknown>).teamBName).trim()
      ? String((v as Record<string, unknown>).teamBName).trim()
      : "B팀",
    teamAGoal: Number.isFinite(Number((v as Record<string, unknown>).teamAGoal))
      ? Math.max(0, Math.floor(Number((v as Record<string, unknown>).teamAGoal)))
      : 0,
    teamBGoal: Number.isFinite(Number((v as Record<string, unknown>).teamBGoal))
      ? Math.max(0, Math.floor(Number((v as Record<string, unknown>).teamBGoal)))
      : 0,
    teamAMemberIds: Array.isArray((v as Record<string, unknown>).teamAMemberIds)
      ? ((v as Record<string, unknown>).teamAMemberIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [],
    teamBMemberIds: Array.isArray((v as Record<string, unknown>).teamBMemberIds)
      ? ((v as Record<string, unknown>).teamBMemberIds as unknown[]).map((x) => String(x)).filter(Boolean)
      : [],
    teamAColor: String((v as Record<string, unknown>).teamAColor || "#2563eb"),
    teamBColor: String((v as Record<string, unknown>).teamBColor || "#dc2626"),
    gaugeEffects: normalizeMealGaugeEffects((v as Record<string, unknown>).gaugeEffects),
    donationTableOptions: normalizeDonationTableColumnsOptions(
      (v as Record<string, unknown>).donationTableOptions as DonationTableColumnsOptions | null | undefined
    ),
  };
}

export function normalizeMealBattle(input: unknown): MealBattleState {
  return normalizeMealBattleState(input);
}

export function normalizeMealMatchState(input: unknown): MealMatchSettings {
  const s = input && typeof input === "object" ? (input as Partial<MealMatchSettings>) : {};
  return {
    isActive: Boolean(s.isActive),
    title: typeof s.title === "string" && s.title.trim() ? s.title : "식사 대전",
    mode: s.mode === "individual" ? "individual" : "team",
    targetScore: Number.isFinite(s.targetScore) ? Math.max(1, Math.floor(s.targetScore as number)) : 100,
    teamAName: typeof s.teamAName === "string" && s.teamAName.trim() ? s.teamAName : "Team A",
    teamBName: typeof s.teamBName === "string" && s.teamBName.trim() ? s.teamBName : "Team B",
    teamAMemberIds: Array.isArray(s.teamAMemberIds) ? s.teamAMemberIds.map((x) => String(x)).filter(Boolean) : [],
    teamBMemberIds: Array.isArray(s.teamBMemberIds) ? s.teamBMemberIds.map((x) => String(x)).filter(Boolean) : [],
  };
}

export function normalizeMealMatchSettings(input: unknown): MealMatchSettings {
  return normalizeMealMatchState(input);
}

export { DEFAULT_MEAL_GAUGE_EFFECTS, normalizeMealGaugeEffects };
