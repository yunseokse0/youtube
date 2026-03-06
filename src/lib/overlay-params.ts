/** 프리셋 → URL 쿼리 변환. OBS 등 별도 컨텍스트에서 API 없이 동작하도록 URL에 설정 포함 */
export type OverlayPresetLike = {
  id?: string;
  scale?: string;
  memberSize?: string;
  totalSize?: string;
  dense?: boolean;
  anchor?: string;
  sumAnchor?: string;
  sumX?: string;
  sumY?: string;
  sumFree?: boolean;
  theme?: string;
  membersTheme?: string;
  totalTheme?: string;
  goalTheme?: string;
  tickerBaseTheme?: string;
  timerTheme?: string;
  missionTheme?: string;
  showMembers?: boolean;
  showTotal?: boolean;
  showGoal?: boolean;
  goal?: string;
  goalLabel?: string;
  goalWidth?: string;
  goalAnchor?: string;
  goalCurrent?: string;
  showPersonalGoal?: boolean;
  personalGoalTheme?: string;
  personalGoalAnchor?: string;
  personalGoalLimit?: string;
  personalGoalFree?: boolean;
  personalGoalX?: string;
  personalGoalY?: string;
  tickerInMembers?: boolean;
  tickerInGoal?: boolean;
  tickerInPersonalGoal?: boolean;
  showTicker?: boolean;
  tickerAnchor?: string;
  tickerWidth?: string;
  tickerFree?: boolean;
  tickerX?: string;
  tickerY?: string;
  showTimer?: boolean;
  timerStart?: number | null;
  timerAnchor?: string;
  showMission?: boolean;
  missionAnchor?: string;
  showBottomDonors?: boolean;
  donorsSize?: string;
  donorsGap?: string;
  donorsSpeed?: string;
  donorsLimit?: string;
  donorsFormat?: string;
  donorsUnit?: string;
  donorsColor?: string;
  donorsBgColor?: string;
  donorsBgOpacity?: string;
  tickerTheme?: string;
  tickerGlow?: string;
  tickerShadow?: string;
  currencyLocale?: string;
  tableOnly?: boolean;
  confettiMilestone?: string;
  tableBgOpacity?: string;
  vertical?: boolean;
  accountColor?: string;
  toonColor?: string;
};

export function presetToParams(preset: OverlayPresetLike | null): URLSearchParams {
  const q = new URLSearchParams();
  if (!preset) return q;
  q.set("scale", preset.scale || "0.75");
  q.set("memberSize", preset.memberSize || "18");
  q.set("totalSize", preset.totalSize || "40");
  q.set("dense", String(preset.dense ?? true));
  q.set("anchor", preset.anchor || "cc");
  q.set("theme", preset.theme || "default");
  q.set("showMembers", String(preset.showMembers ?? true));
  q.set("showTotal", String(preset.showTotal ?? true));
  if (preset.sumFree) {
    q.set("sumX", preset.sumX || "50");
    q.set("sumY", preset.sumY || "90");
  } else {
    q.set("sumAnchor", preset.sumAnchor || "bc");
  }
  if (preset.showGoal) {
    q.set("showGoal", "true");
    q.set("goal", preset.goal || "0");
    q.set("goalLabel", preset.goalLabel || "목표 금액");
    q.set("goalWidth", preset.goalWidth || "400");
    q.set("goalAnchor", preset.goalAnchor || "bc");
    if (preset.goalCurrent && preset.goalCurrent.trim()) q.set("goalCurrent", preset.goalCurrent.trim());
  }
  if (preset.showPersonalGoal) q.set("showPersonalGoal", "true");
  if (preset.personalGoalTheme && preset.personalGoalTheme.trim()) q.set("personalGoalTheme", preset.personalGoalTheme.trim());
  if (preset.personalGoalFree) {
    q.set("personalGoalFree", "true");
    q.set("personalGoalX", preset.personalGoalX || "78");
    q.set("personalGoalY", preset.personalGoalY || "82");
  } else if (preset.personalGoalAnchor && preset.personalGoalAnchor.trim()) {
    q.set("personalGoalAnchor", preset.personalGoalAnchor.trim());
  }
  if (preset.personalGoalLimit && preset.personalGoalLimit.trim()) q.set("personalGoalLimit", preset.personalGoalLimit.trim());
  if (preset.tickerInMembers) q.set("tickerInMembers", "true");
  if (preset.tickerInGoal) q.set("tickerInGoal", "true");
  if (preset.tickerInPersonalGoal) q.set("tickerInPersonalGoal", "true");
  if (preset.showTicker) {
    q.set("showTicker", "true");
    if (preset.tickerFree) {
      q.set("tickerX", preset.tickerX || "50");
      q.set("tickerY", preset.tickerY || "86");
    } else if (preset.tickerAnchor) {
      q.set("tickerAnchor", preset.tickerAnchor);
    }
    if (preset.tickerWidth && preset.tickerWidth.trim()) q.set("tickerWidth", preset.tickerWidth.trim());
  }
  if (preset.showTimer && preset.timerStart) {
    q.set("showTimer", "true");
    q.set("timerStart", String(preset.timerStart));
    q.set("timerAnchor", preset.timerAnchor || "tr");
  }
  if (preset.showMission) {
    q.set("showMission", "true");
    q.set("missionAnchor", preset.missionAnchor || "bc");
  }
  if (preset.showBottomDonors) q.set("showBottomDonors", "true");
  if (preset.donorsSize && preset.donorsSize.trim()) q.set("donorsSize", preset.donorsSize.trim());
  if (preset.donorsGap && preset.donorsGap.trim()) q.set("donorsGap", preset.donorsGap.trim());
  if (preset.donorsSpeed && preset.donorsSpeed.trim()) q.set("donorsSpeed", preset.donorsSpeed.trim());
  if (preset.donorsLimit && preset.donorsLimit.trim()) q.set("donorsLimit", preset.donorsLimit.trim());
  q.set("donorsFormat", (preset.donorsFormat || "short").trim() === "full" ? "full" : "short");
  if (preset.donorsUnit && preset.donorsUnit.trim()) q.set("donorsUnit", preset.donorsUnit.trim());
  if (preset.donorsColor && preset.donorsColor.trim()) q.set("donorsColor", preset.donorsColor.trim());
  if (preset.donorsBgColor && preset.donorsBgColor.trim()) q.set("donorsBgColor", preset.donorsBgColor.trim());
  if (preset.donorsBgOpacity && preset.donorsBgOpacity.trim()) q.set("donorsBgOpacity", preset.donorsBgOpacity.trim());
  if (preset.tickerTheme && preset.tickerTheme.trim()) q.set("tickerTheme", preset.tickerTheme.trim());
  if (preset.tickerGlow && preset.tickerGlow.trim()) q.set("tickerGlow", preset.tickerGlow.trim());
  if (preset.tickerShadow && preset.tickerShadow.trim()) q.set("tickerShadow", preset.tickerShadow.trim());
  if (preset.currencyLocale && preset.currencyLocale.trim()) q.set("currencyLocale", preset.currencyLocale.trim());
  if (preset.tableOnly) q.set("tableOnly", "true");
  if (preset.confettiMilestone && preset.confettiMilestone.trim()) q.set("confettiMilestone", preset.confettiMilestone.trim());
  if (preset.tableBgOpacity && preset.tableBgOpacity.trim()) q.set("tableBgOpacity", preset.tableBgOpacity.trim());
  if (preset.accountColor && preset.accountColor.trim()) q.set("accountColor", preset.accountColor.trim());
  if (preset.toonColor && preset.toonColor.trim()) q.set("toonColor", preset.toonColor.trim());
  if (preset.vertical) q.set("vertical", "true");
  return q;
}
