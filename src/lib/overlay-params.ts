/** 프리셋 → URL 쿼리 변환. OBS 등 별도 컨텍스트에서 API 없이 동작하도록 URL에 설정 포함 */
export type OverlayPresetLike = {
  id?: string;
  scale?: string;
  memberSize?: string;
  totalSize?: string;
  layout?: "center-fixed" | "center";
  zoomMode?: "follow" | "invert" | "neutral";
  dense?: boolean;
  anchor?: string;
  tableFree?: boolean;
  tableX?: string;
  tableY?: string;
  autoFont?: boolean;
  compact?: boolean;
  tight?: boolean;
  lockWidth?: boolean;
  nameGrow?: boolean;
  nameCh?: string;
  tableMarginTop?: string;
  tableMarginRight?: string;
  tableMarginBottom?: string;
  tableMarginLeft?: string;
  autoFit?: "none" | "width" | "height" | "contain" | "cover";
  autoFitPin?: "cc" | "tl" | "tr" | "bl" | "br" | "tc" | "bc" | "cl" | "cr";
  box?: "full" | "tight";
  noCrop?: boolean;
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
  totalMode?: "total" | "contribution";
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
  timerShowHours?: boolean;
  timerFontColor?: string;
  timerBgColor?: string;
  timerBorderColor?: string;
  timerBgOpacity?: string;
  timerScale?: string;
  showMission?: boolean;
  missionAnchor?: string;
  missionWidth?: string;
  missionDuration?: string;
  missionBgOpacity?: string;
  missionBgColor?: string;
  missionItemColor?: string;
  missionTitleColor?: string;
  missionFontSize?: string;
  missionTitleText?: string;
  missionTitleEffect?: string;
  missionEffect?: string;
  missionEffectHotOnly?: string;
  missionDisplayMode?: string;
  missionVisibleCount?: string;
  missionSpeed?: string;
  missionGapSize?: string;
  host?: string;
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
  if (preset.layout === "center-fixed" || preset.layout === "center") q.set("layout", "center-fixed");
  if (preset.zoomMode && preset.zoomMode !== "follow") q.set("zoomMode", preset.zoomMode);
  q.set("dense", String(preset.dense ?? true));
  if (preset.tableFree) {
    q.set("tableFree", "true");
    q.set("tableX", preset.tableX || "50");
    q.set("tableY", preset.tableY || "50");
  } else {
    q.set("anchor", preset.anchor || "cc");
  }
  if (preset.autoFont) q.set("autoFont", "true");
  if (preset.compact) q.set("compact", "true");
  if (preset.tight) q.set("tight", "true");
  if (preset.lockWidth) q.set("lockWidth", "true");
  if (preset.nameGrow === false) q.set("nameGrow", "false");
  if (preset.nameCh && preset.nameCh.trim()) q.set("nameCh", preset.nameCh.trim());
  if (preset.tableMarginTop && preset.tableMarginTop.trim()) q.set("tableMarginTop", preset.tableMarginTop.trim());
  if (preset.tableMarginRight && preset.tableMarginRight.trim()) q.set("tableMarginRight", preset.tableMarginRight.trim());
  if (preset.tableMarginBottom && preset.tableMarginBottom.trim()) q.set("tableMarginBottom", preset.tableMarginBottom.trim());
  if (preset.tableMarginLeft && preset.tableMarginLeft.trim()) q.set("tableMarginLeft", preset.tableMarginLeft.trim());
  if (preset.autoFit && preset.autoFit !== "none") q.set("autoFit", preset.autoFit);
  if (preset.autoFitPin && preset.autoFitPin !== "cc") q.set("fitPin", preset.autoFitPin);
  if (preset.box && preset.box !== "full") q.set("box", preset.box);
  if (preset.noCrop === false) q.set("noCrop", "false");
  q.set("theme", preset.theme || "default");
  if (preset.membersTheme && preset.membersTheme !== "auto") q.set("membersTheme", preset.membersTheme);
  if (preset.totalTheme && preset.totalTheme !== "auto") q.set("totalTheme", preset.totalTheme);
  if (preset.goalTheme && preset.goalTheme !== "auto") q.set("goalTheme", preset.goalTheme);
  if (preset.tickerBaseTheme && preset.tickerBaseTheme !== "auto") q.set("tickerBaseTheme", preset.tickerBaseTheme);
  if (preset.timerTheme && preset.timerTheme !== "auto") q.set("timerTheme", preset.timerTheme);
  if (preset.missionTheme && preset.missionTheme !== "auto") q.set("missionTheme", preset.missionTheme);
  q.set("showMembers", String(preset.showMembers ?? true));
  q.set("showTotal", String(preset.showTotal ?? true));
  if (preset.totalMode === "contribution") q.set("totalMode", "contribution");
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
    if (preset.timerShowHours) q.set("timerShowHours", "true");
    if (preset.timerFontColor && preset.timerFontColor.trim()) q.set("timerFontColor", preset.timerFontColor.trim());
    if (preset.timerBgColor && preset.timerBgColor.trim()) q.set("timerBgColor", preset.timerBgColor.trim());
    if (preset.timerBorderColor && preset.timerBorderColor.trim()) q.set("timerBorderColor", preset.timerBorderColor.trim());
    if (preset.timerBgOpacity && preset.timerBgOpacity.trim()) q.set("timerBgOpacity", preset.timerBgOpacity.trim());
    if (preset.timerScale && preset.timerScale.trim()) q.set("timerScale", preset.timerScale.trim());
  }
  if (preset.showMission) {
    q.set("showMission", "true");
    if (preset.missionAnchor && preset.missionAnchor.trim()) q.set("missionAnchor", preset.missionAnchor);
    if (preset.missionWidth && preset.missionWidth.trim()) q.set("missionWidth", preset.missionWidth.trim());
    if (preset.missionDuration && preset.missionDuration.trim()) q.set("missionDuration", preset.missionDuration.trim());
    q.set("missionBgOpacity", (preset.missionBgOpacity && preset.missionBgOpacity.trim()) ? preset.missionBgOpacity.trim() : "85");
    if (preset.missionBgColor && preset.missionBgColor.trim()) q.set("missionBgColor", preset.missionBgColor.trim());
    if (preset.missionItemColor && preset.missionItemColor.trim()) q.set("missionItemColor", preset.missionItemColor.trim());
    if (preset.missionTitleColor && preset.missionTitleColor.trim()) q.set("missionTitleColor", preset.missionTitleColor.trim());
    if (preset.missionFontSize && preset.missionFontSize.trim()) q.set("missionFontSize", preset.missionFontSize.trim());
    if (preset.missionTitleText && preset.missionTitleText.trim()) q.set("missionTitleText", preset.missionTitleText.trim());
    if (preset.missionTitleEffect && preset.missionTitleEffect.trim()) q.set("missionTitleEffect", preset.missionTitleEffect.trim());
    if (preset.missionEffect && preset.missionEffect.trim()) q.set("missionEffect", preset.missionEffect.trim());
    if (preset.missionEffectHotOnly && preset.missionEffectHotOnly.trim()) q.set("missionEffectHotOnly", preset.missionEffectHotOnly.trim());
    if (preset.missionDisplayMode && preset.missionDisplayMode.trim()) q.set("displayMode", preset.missionDisplayMode.trim());
    if (preset.missionVisibleCount && preset.missionVisibleCount.trim()) q.set("visibleCount", preset.missionVisibleCount.trim());
    if (preset.missionSpeed && preset.missionSpeed.trim()) q.set("missionSpeed", preset.missionSpeed.trim());
    if (preset.missionGapSize && preset.missionGapSize.trim()) q.set("gapSize", preset.missionGapSize.trim());
  }
  if (preset.showBottomDonors) q.set("showBottomDonors", "true");
  if (preset.donorsSize && preset.donorsSize.trim()) q.set("donorsSize", preset.donorsSize.trim());
  if (preset.donorsGap && preset.donorsGap.trim()) q.set("donorsGap", preset.donorsGap.trim());
  q.set("donorsSpeed", (preset.donorsSpeed && preset.donorsSpeed.trim()) ? preset.donorsSpeed.trim() : "60");
  if (preset.donorsLimit && preset.donorsLimit.trim()) q.set("donorsLimit", preset.donorsLimit.trim());
  q.set("donorsFormat", (preset.donorsFormat || "short").trim() === "full" ? "full" : "short");
  if (preset.donorsUnit && preset.donorsUnit.trim()) q.set("donorsUnit", preset.donorsUnit.trim());
  if (preset.donorsColor && preset.donorsColor.trim()) q.set("donorsColor", preset.donorsColor.trim());
  if (preset.donorsBgColor && preset.donorsBgColor.trim()) q.set("donorsBgColor", preset.donorsBgColor.trim());
  q.set("donorsBgOpacity", (preset.donorsBgOpacity && preset.donorsBgOpacity.trim()) ? preset.donorsBgOpacity.trim() : "0");
  if (preset.tickerTheme && preset.tickerTheme.trim()) q.set("tickerTheme", preset.tickerTheme.trim());
  q.set("tickerGlow", (preset.tickerGlow && preset.tickerGlow.trim()) ? preset.tickerGlow.trim() : "45");
  q.set("tickerShadow", (preset.tickerShadow && preset.tickerShadow.trim()) ? preset.tickerShadow.trim() : "35");
  q.set("currencyLocale", (preset.currencyLocale && preset.currencyLocale.trim()) ? preset.currencyLocale.trim() : "ko-KR");
  if (preset.tableOnly) q.set("tableOnly", "true");
  if (preset.confettiMilestone && preset.confettiMilestone.trim()) q.set("confettiMilestone", preset.confettiMilestone.trim());
  q.set("tableBgOpacity", (preset.tableBgOpacity && preset.tableBgOpacity.trim()) ? preset.tableBgOpacity.trim() : "100");
  if (preset.accountColor && preset.accountColor.trim()) q.set("accountColor", preset.accountColor.trim());
  if (preset.toonColor && preset.toonColor.trim()) q.set("toonColor", preset.toonColor.trim());
  if (preset.vertical) q.set("vertical", "true");
  if (preset.host && preset.host.trim()) q.set("host", preset.host.trim());
  return q;
}
