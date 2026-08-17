import type { DonorRankingsTheme, SigItem } from "@/types";
import { appendExcelRankTop3Params } from "@/lib/excel-rank-top3-style";
import { mergeDonationTablePresetFields } from "@/lib/donation-table-options";
import { normalizeTableFontFamily, type TableFontFamilyId } from "@/lib/table-font-style";
import { isDefaultTimerFontFamily, normalizeTimerFontFamily } from "@/lib/timer-font-style";
import {
  normalizeGoalBarAnimation,
  resolveGoalBarFillColor,
  resolveGoalBarFontFamilyCss,
  resolveGoalBarTrackBg,
  type GoalBarAnimationMode,
} from "@/lib/goal-bar-style";
import { sanitizeOverlayEmbedMediaUrl } from "@/lib/gif-url";

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
  /** 통합 오버레이 — 식사 대전 팀 금액차 3열 보드 */
  showTeamBattle?: boolean;
  teamBattleAnchor?: string;
  goal?: string;
  /** 후원 초기화 시 복원할 목표(백오피스·자동 상향 스냅샷) */
  goalBaseline?: string;
  /** 목표 100% 달성 시 자동 상향 증가폭(원). 비우면 200만 원 */
  goalIncreaseStep?: string;
  goalLabel?: string;
  goalWidth?: string;
  goalAnchor?: string;
  goalCurrent?: string;
  goalOpacity?: string;
  goalOpacityText?: boolean;
  goalTextColor?: string;
  goalFontSize?: string;
  goalTextOutlineColor?: string;
  goalTextOutlineWidth?: string;
  /** 목표 막대 트랙(배경)색 */
  goalBarBgColor?: string;
  /** 목표 게이지(채움)색 — 그라데이션 기준색 */
  goalBarFillColor?: string;
  /** 목표 글꼴 — tableFontFamily 와 동일 id */
  goalFontFamily?: string;
  /** 목표 글자 굵기(400~900). 비우면 900 */
  goalFontWeight?: string;
  /** 게이지 애니메이션: off | pulse | sweep | both */
  goalBarAnimation?: string;
  /** 목표 막대 트랙 배경 GIF/JPG URL */
  goalBarGifUrl?: string;
  goalBarGifOpacity?: string;
  goalBarGifBrightness?: string;
  /** OBS 선명 렌더링 — geometricPrecision + stroke 유지 + 외곽 blur 축소 */
  overlayTextSharpRender?: boolean;
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
  timerFontFamily?: string;
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
  tableBgGifUrl?: string;
  tableBgGifOpacity?: string;
  tableBgGifBrightness?: string;
  /** 엑셀표 PNG 장식 프레임(투명 중앙). 표 바깥 absolute 오버레이 */
  tableFrameUrl?: string;
  tableFrameOpacity?: string;
  /** 프레임 안쪽 여백(px). 비우면 32 */
  tableFrameInset?: string;
  /** 엑셀표 시트 배경색(#rrggbb). 비우면 테마 기본 */
  tableBgColor?: string;
  /** 엑셀표 헤더(상단) 배경색. 비우면 테마 기본 */
  tableHeaderBgColor?: string;
  /** 엑셀표 헤더(상단) 글자색. 비우면 테마 기본 */
  tableHeaderTextColor?: string;
  /** 엑셀표 외곽·헤더·총합 구분선 색(#rrggbb). 비우면 테마 기본 */
  tableLineColor?: string;
  totalLineVisible?: boolean;
  /** 엑셀표 선 전체(가로·세로·외곽). 기본 true */
  tableGridLines?: boolean;
  /** 엑셀표 열 구분 세로선 (기본 true). tableGridLines=false 이면 무시 */
  tableVerticalLines?: boolean;
  vertical?: boolean;
  accountColor?: string;
  toonColor?: string;
  tableTextColor?: string;
  /** 엑셀표 맨 아래「총합」행 글자색. 비우면 테마 자동(본문색과 별도) */
  totalTextColor?: string;
  tableTextOutlineColor?: string;
  tableTextOutlineWidth?: string;
  /** 헤더 글자 외곽선 — 비우면 본문(tableTextOutline*)과 동일 */
  tableHeaderTextOutlineColor?: string;
  tableHeaderTextOutlineWidth?: string;
  tableFontWeight?: string;
  /** 엑셀표 글꼴: auto | mono | sans | pretendard | gothic | serif */
  tableFontFamily?: string;
  showCombinedColumn?: boolean;
  showContributionColumn?: boolean;
  showRestroomColumn?: boolean;
  showContributionSum?: boolean;
  showTableSumRow?: boolean;
  accountHeaderLabel?: string;
  toonHeaderLabel?: string;
  restroomHeaderLabel?: string;
  /** 엑셀표 1~3위 강조: off | emoji | bg | both */
  rankTop3Mode?: string;
  rankTop3Effect?: string;
  /** 순위 숫자 표기: hash(#1) | plain(1) | suffix(1위) */
  rankLabelFormat?: string;
  rank1Bg?: string;
  rank2Bg?: string;
  rank3Bg?: string;
  rank1Mark?: string;
  rank2Mark?: string;
  rank3Mark?: string;
  rank1Effect?: string;
  rank2Effect?: string;
  rank3Effect?: string;
  rank1TextColor?: string;
  rank2TextColor?: string;
  rank3TextColor?: string;
  rank1TextColorAlt?: string;
  rank2TextColorAlt?: string;
  rank3TextColorAlt?: string;
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
    q.set("goalLabel", preset.goalLabel || "후원");
    q.set("goalWidth", preset.goalWidth || "400");
    q.set("goalAnchor", preset.goalAnchor || "bc");
    if (preset.goalCurrent && preset.goalCurrent.trim()) q.set("goalCurrent", preset.goalCurrent.trim());
    if (preset.goalOpacity && preset.goalOpacity.trim()) q.set("goalOpacity", preset.goalOpacity.trim());
    if (preset.goalOpacityText) q.set("goalOpacityText", "true");
  }
  if (preset.showTeamBattle) {
    q.set("showTeamBattle", "true");
    q.set("teamBattleAnchor", preset.teamBattleAnchor || "tc");
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
    if (preset.timerFontFamily && preset.timerFontFamily.trim()) q.set("timerFontFamily", preset.timerFontFamily.trim());
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
  if (preset.tableBgGifUrl && preset.tableBgGifUrl.trim()) q.set("tableBgGifUrl", preset.tableBgGifUrl.trim());
  if (preset.tableBgGifOpacity && preset.tableBgGifOpacity.trim()) q.set("tableBgGifOpacity", preset.tableBgGifOpacity.trim());
  if (preset.tableBgGifBrightness && preset.tableBgGifBrightness.trim()) q.set("tableBgGifBrightness", preset.tableBgGifBrightness.trim());
  const tableFrameUrl = sanitizeOverlayEmbedMediaUrl(preset.tableFrameUrl || "");
  if (tableFrameUrl) q.set("tableFrameUrl", tableFrameUrl);
  if (preset.tableFrameOpacity && preset.tableFrameOpacity.trim()) q.set("tableFrameOpacity", preset.tableFrameOpacity.trim());
  if (preset.tableFrameInset && preset.tableFrameInset.trim()) q.set("tableFrameInset", preset.tableFrameInset.trim());
  const tableBgColor = normalizeGoalHexColor((preset.tableBgColor || "").trim());
  if (tableBgColor) q.set("tableBgColor", tableBgColor);
  const tableHeaderBgColor = normalizeGoalHexColor((preset.tableHeaderBgColor || "").trim());
  if (tableHeaderBgColor) q.set("tableHeaderBgColor", tableHeaderBgColor);
  const tableHeaderTextColor = normalizeGoalHexColor((preset.tableHeaderTextColor || "").trim());
  if (tableHeaderTextColor) q.set("tableHeaderTextColor", tableHeaderTextColor);
  const tableLineColor = normalizeGoalHexColor((preset.tableLineColor || "").trim());
  if (tableLineColor) q.set("tableLineColor", tableLineColor);
  if (preset.totalLineVisible) q.set("totalLineVisible", "true");
  if (preset.tableGridLines === false) q.set("tableGridLines", "false");
  if (preset.tableVerticalLines === false) q.set("tableVerticalLines", "false");
  if (preset.accountColor && preset.accountColor.trim()) q.set("accountColor", preset.accountColor.trim());
  if (preset.toonColor && preset.toonColor.trim()) q.set("toonColor", preset.toonColor.trim());
  if (preset.tableTextColor && preset.tableTextColor.trim()) q.set("tableTextColor", preset.tableTextColor.trim());
  const totalTextColor = normalizeGoalHexColor((preset.totalTextColor || "").trim());
  if (totalTextColor) q.set("totalTextColor", totalTextColor);
  const tableOutlineColor = normalizeGoalHexColor((preset.tableTextOutlineColor || "").trim());
  if (tableOutlineColor) q.set("tableTextOutlineColor", tableOutlineColor);
  const tableOutlineW = (preset.tableTextOutlineWidth || "").trim();
  if (tableOutlineW) {
    const w = Math.max(0, Math.min(3, parseFloat(tableOutlineW) || 0));
    q.set("tableTextOutlineWidth", String(w));
  }
  const tableHeaderOutlineColor = normalizeGoalHexColor((preset.tableHeaderTextOutlineColor || "").trim());
  if (tableHeaderOutlineColor) q.set("tableHeaderTextOutlineColor", tableHeaderOutlineColor);
  const tableHeaderOutlineW = (preset.tableHeaderTextOutlineWidth || "").trim();
  if (tableHeaderOutlineW) {
    const w = Math.max(0, Math.min(3, parseFloat(tableHeaderOutlineW) || 0));
    q.set("tableHeaderTextOutlineWidth", String(w));
  }
  const tableWeightRaw = (preset.tableFontWeight || "").trim();
  if (tableWeightRaw) {
    const fw = parseInt(tableWeightRaw, 10);
    if (Number.isFinite(fw)) q.set("tableFontWeight", String(Math.max(400, Math.min(900, fw))));
  }
  const tableFontFamily = normalizeTableFontFamily((preset.tableFontFamily || "").trim());
  if (tableFontFamily !== "auto") q.set("tableFontFamily", tableFontFamily);
  if (preset.showCombinedColumn === false) q.set("showCombinedColumn", "false");
  if (preset.showContributionColumn === false) q.set("showContributionColumn", "false");
  if (preset.showRestroomColumn === false) q.set("showRestroomColumn", "false");
  else q.set("showRestroomColumn", "true");
  if (preset.showContributionSum === false) q.set("showContributionSum", "false");
  if (preset.showTableSumRow === false) q.set("showTableSumRow", "false");
  if (preset.accountHeaderLabel && preset.accountHeaderLabel.trim()) q.set("accountHeaderLabel", preset.accountHeaderLabel.trim());
  if (preset.toonHeaderLabel && preset.toonHeaderLabel.trim()) q.set("toonHeaderLabel", preset.toonHeaderLabel.trim());
  if (preset.restroomHeaderLabel && preset.restroomHeaderLabel.trim()) q.set("restroomHeaderLabel", preset.restroomHeaderLabel.trim());
  appendExcelRankTop3Params(q, preset);
  if (preset.vertical) q.set("vertical", "true");
  if (preset.host && preset.host.trim()) q.set("host", preset.host.trim());
  /** showGoal 여부와 무관 — live 프리셋·URL에 목표 글자색 항상 포함 */
  appendGoalBarStyleParams(q, preset);
  if (preset.overlayTextSharpRender === false) q.set("textSharp", "0");
  else if (preset.overlayTextSharpRender) q.set("textSharp", "1");
  return q;
}

/** OBS·Prism URL에 넣을 프리셋 시각 파라미터(goal·goalCurrent 제외 — 목표는 /api/state 동기) */
/** OBS/Prism URL에 넣지 않음 — 시각 옵션은 `p=` 프리셋(`/api/state`)에서 로드 */
const PRESET_BROADCAST_SKIP_KEYS = new Set([
  "goal",
  "goalCurrent",
  "theme",
  "membersTheme",
  "totalTheme",
  "goalTheme",
  "tickerBaseTheme",
  "timerTheme",
  "missionTheme",
  "scale",
  "memberSize",
  "totalSize",
  "donorsSize",
  "tableBgOpacity",
  "tableBgGifUrl",
  "tableBgGifOpacity",
  "tableBgGifBrightness",
  "tableFrameUrl",
  "tableFrameOpacity",
  "tableFrameInset",
  "tableBgColor",
  "tableHeaderBgColor",
  "tableHeaderTextColor",
  "tableLineColor",
  "tableGridLines",
  "tableVerticalLines",
  "donorsFormat",
  "currencyLocale",
  "accountHeaderLabel",
  "toonHeaderLabel",
  "restroomHeaderLabel",
  "accountColor",
  "toonColor",
  "tableTextColor",
  "totalTextColor",
  "tableTextOutlineColor",
  "tableTextOutlineWidth",
  "tableHeaderTextOutlineColor",
  "tableHeaderTextOutlineWidth",
  "tableFontWeight",
  "tableFontFamily",
  "showCombinedColumn",
  "showContributionColumn",
  "showRestroomColumn",
  "showContributionSum",
  "showTableSumRow",
  "rankTop3Mode",
  "rankTop3Effect",
  "rankLabelFormat",
  "rank1Effect",
  "rank2Effect",
  "rank3Effect",
  "rank1TextColor",
  "rank2TextColor",
  "rank3TextColor",
  "rank1TextColorAlt",
  "rank2TextColorAlt",
  "rank3TextColorAlt",
  "rank1Bg",
  "rank2Bg",
  "rank3Bg",
  "rank1Mark",
  "rank2Mark",
  "rank3Mark",
  "goalTextColor",
  "goalFontSize",
  "goalTextOutlineColor",
  "goalTextOutlineWidth",
  "goalBarBgColor",
  "goalBarFillColor",
  "goalFontFamily",
  "goalFontWeight",
  "goalBarAnimation",
  "goalBarGifUrl",
  "goalBarGifOpacity",
  "goalBarGifBrightness",
  "textSharp",
  "goalOpacity",
  "goalOpacityText",
  "tickerGlow",
  "tickerShadow",
  "tickerTheme",
  "layout",
  "dense",
  "tableFree",
  "tableX",
  "tableY",
  "anchor",
  "sumAnchor",
  "autoFont",
  "compact",
  "tight",
  "nameGrow",
  "personalGoalTheme",
  "personalGoalAnchor",
  "personalGoalLimit",
  "personalGoalFree",
  "personalGoalX",
  "personalGoalY",
  "donorsGap",
  "donorsSpeed",
  "donorsLimit",
  "donorsBgOpacity",
  "donorsColor",
  "donorsBgColor",
  "donorsUnit",
  "showMembers",
  "showTotal",
  "showGoal",
  "showTeamBattle",
  "teamBattleAnchor",
  "showTicker",
  "showTimer",
  "showMission",
  "showPersonalGoal",
  "showBottomDonors",
  "tableOnly",
  "goalLabel",
  "goalWidth",
  "goalAnchor",
]);

/**
 * OBS/Prism용 짧은 쿼리 — 프리셋·스타일은 `p`+`u`로 `/api/state`에서 로드.
 * (구버전 긴 URL도 계속 동작; 신규 복사는 이 형태)
 */
export function buildCompactBroadcastOverlayParams(opts: {
  presetId: string;
  userId: string;
  host?: string;
  vertical?: boolean;
  demo?: boolean;
}): URLSearchParams {
  const q = new URLSearchParams();
  q.set("p", opts.presetId);
  q.set("u", opts.userId);
  if (opts.host) q.set("host", opts.host);
  if (opts.vertical) q.set("vertical", "true");
  if (opts.demo) q.set("demo", "true");
  return q;
}

/**
 * 오버레이가 `/api/state` 프리셋을 읽은 뒤에는 URL에 박힌 예전 스타일보다 프리셋을 우선한다.
 * (관리자에서 색·크기 변경 시 URL 재복사·OBS 소스 재등록 없이 실시간 반영)
 */
/**
 * 관리자 미리보기 iframe: 테마·글자크기 등 시각 옵션은 localStorage 프리셋으로 핫리로드.
 * URL에 넣으면 src가 바뀌며 iframe이 리마운트되어 멤버/금액 동기화가 끊긴다.
 */
export const ADMIN_PREVIEW_HOT_RELOAD_PARAM_KEYS = [
  "theme",
  "membersTheme",
  "totalTheme",
  "goalTheme",
  "tickerBaseTheme",
  "timerTheme",
  "missionTheme",
  "scale",
  "memberSize",
  "totalSize",
  "donorsSize",
  "tableBgOpacity",
  "tableBgGifUrl",
  "tableBgGifOpacity",
  "tableBgGifBrightness",
  "tableFrameUrl",
  "tableFrameOpacity",
  "tableFrameInset",
  "tableBgColor",
  "tableHeaderBgColor",
  "tableHeaderTextColor",
  "tableLineColor",
  "tableGridLines",
  "tableVerticalLines",
  "donorsFormat",
  "currencyLocale",
  "accountHeaderLabel",
  "toonHeaderLabel",
  "restroomHeaderLabel",
  "accountColor",
  "toonColor",
  "tableTextColor",
  "totalTextColor",
  "tableTextOutlineColor",
  "tableTextOutlineWidth",
  "tableHeaderTextOutlineColor",
  "tableHeaderTextOutlineWidth",
  "tableFontWeight",
  "tableFontFamily",
  "showCombinedColumn",
  "showContributionColumn",
  "showRestroomColumn",
  "showContributionSum",
  "showTableSumRow",
  "rankTop3Mode",
  "rankTop3Effect",
  "rankLabelFormat",
  "rank1Effect",
  "rank2Effect",
  "rank3Effect",
  "rank1TextColor",
  "rank2TextColor",
  "rank3TextColor",
  "rank1TextColorAlt",
  "rank2TextColorAlt",
  "rank3TextColorAlt",
  "rank1Bg",
  "rank2Bg",
  "rank3Bg",
  "rank1Mark",
  "rank2Mark",
  "rank3Mark",
  "goalTextColor",
  "goalFontSize",
  "goalTextOutlineColor",
  "goalTextOutlineWidth",
  "goalBarBgColor",
  "goalBarFillColor",
  "goalFontFamily",
  "goalFontWeight",
  "goalBarAnimation",
  "goalBarGifUrl",
  "goalBarGifOpacity",
  "goalBarGifBrightness",
  "textSharp",
  "goalOpacity",
  "goalOpacityText",
  "tickerGlow",
  "tickerShadow",
  "tickerTheme",
  /** 레이아웃·표시 옵션도 URL에 넣으면 iframe 리마운트 → 초기 화면 깜빡임 */
  "compact",
  "tight",
  "dense",
  "autoFont",
  "lockWidth",
  "nameGrow",
  "nameCh",
  "layout",
  "zoomMode",
  "anchor",
  "tableFree",
  "tableX",
  "tableY",
  "tableMarginTop",
  "tableMarginRight",
  "tableMarginBottom",
  "tableMarginLeft",
  "box",
  "noCrop",
  "autoFit",
  "fitPin",
  "showMembers",
  "showTotal",
  "showGoal",
  "showTeamBattle",
  "teamBattleAnchor",
  "showTicker",
  "showTimer",
  "showMission",
  "showPersonalGoal",
  "totalMode",
  "totalLineVisible",
  "tableGridLines",
  "tableVerticalLines",
  "goal",
  "goalLabel",
  "goalWidth",
  "goalAnchor",
  "goalCurrent",
  "donorsGap",
  "donorsSpeed",
  "donorsLimit",
  "donorsUnit",
  "donorsColor",
  "donorsBgColor",
  "donorsBgOpacity",
  "confettiMilestone",
  "personalGoalTheme",
  "personalGoalAnchor",
  "personalGoalLimit",
  "personalGoalFree",
  "personalGoalX",
  "personalGoalY",
  "sumAnchor",
  "sumFree",
  "sumX",
  "sumY",
  "tickerAnchor",
  "tickerWidth",
  "tickerFree",
  "tickerX",
  "tickerY",
  "tickerInMembers",
  "tickerInGoal",
  "tickerInPersonalGoal",
  "timerAnchor",
  "timerShowHours",
  "timerFontFamily",
  "timerFontColor",
  "timerBgColor",
  "timerBorderColor",
  "timerBgOpacity",
  "timerScale",
  "missionAnchor",
  "missionWidth",
  "missionDuration",
] as const;

/** 관리자 미리보기 URL에서 핫리로드 시각 파라미터를 제거해 iframe 리마운트를 막는다. */
export function stripAdminPreviewHotReloadParams(q: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(q.toString());
  for (const key of ADMIN_PREVIEW_HOT_RELOAD_PARAM_KEYS) {
    next.delete(key);
  }
  return next;
}

/**
 * 동일 id 프리셋은 local(방금 저장)을 우선 — 관리자 테마 변경이 remote 스냅샷보다 먼저 보이게.
 */
export function mergeOverlayPresetsPreferLocal(
  remote: OverlayPresetLike[],
  local: OverlayPresetLike[]
): OverlayPresetLike[] {
  if (!local.length) return remote.slice();
  if (!remote.length) return local.slice();
  const localById = new Map(
    local
      .filter((p) => p && typeof p.id === "string" && p.id)
      .map((p) => [String(p.id), p] as const)
  );
  const seen = new Set<string>();
  const merged: OverlayPresetLike[] = [];
  for (const p of remote) {
    const id = p && typeof p.id === "string" ? p.id : "";
    if (id && localById.has(id)) {
      merged.push(localById.get(id)!);
      seen.add(id);
    } else {
      merged.push(p);
      if (id) seen.add(id);
    }
  }
  for (const p of local) {
    const id = p && typeof p.id === "string" ? p.id : "";
    if (id && !seen.has(id)) {
      merged.push(p);
      seen.add(id);
    }
  }
  return merged;
}

/**
 * OBS·Prism 방송 — 서버(`/api/state`) 프리셋 우선. 브라우저 LS에 남은 예전 색·테마가 덮지 않게.
 */
export function mergeOverlayPresetsPreferRemote(
  remote: OverlayPresetLike[],
  local: OverlayPresetLike[]
): OverlayPresetLike[] {
  if (!remote.length) return local.slice();
  if (!local.length) return remote.slice();
  const remoteById = new Map(
    remote
      .filter((p) => p && typeof p.id === "string" && p.id)
      .map((p) => [String(p.id), p] as const)
  );
  const seen = new Set<string>();
  const merged: OverlayPresetLike[] = [];
  for (const p of local) {
    const id = p && typeof p.id === "string" ? p.id : "";
    if (id && remoteById.has(id)) {
      const remotePreset = remoteById.get(id)!;
      merged.push(mergeDonationTablePresetFields(remotePreset, p));
      seen.add(id);
    } else {
      merged.push(p);
      if (id) seen.add(id);
    }
  }
  for (const p of remote) {
    const id = p && typeof p.id === "string" ? p.id : "";
    if (id && !seen.has(id)) {
      merged.push(p);
      seen.add(id);
    }
  }
  return merged;
}

/** 관리자 iframe 미리보기는 LS 핫리로드, OBS 방송 URL은 서버 프리셋 우선.
 * `broadcastMatch=1` 이면 미리보기도 서버 프리셋(OBS와 동일)을 씀. */
export function shouldPreferLocalOverlayPresets(searchParams?: SearchParamsLike): boolean {
  try {
    const sp =
      searchParams ||
      (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null);
    if (sp && String(sp.get("broadcastMatch") || "").trim() === "1") return false;
  } catch {
    /* ignore */
  }
  if (isAdminDashboardPreviewEmbed()) return true;
  if (isEmbeddedInSameOriginAdminFrame()) return true;
  if (searchParams && isOverlayBroadcastHost(searchParams)) return false;
  return true;
}

/** 테마·표 색만 기본인지 — 1~3위 효과·외곽선 등 시각 옵션은 별개로 본다 */
export function isDefaultLikeOverlayThemeFields(preset: unknown): boolean {
  if (!preset || typeof preset !== "object") return true;
  const p = preset as Record<string, unknown>;
  if (String(p.theme || "default") !== "default") return false;
  if (String(p.membersTheme || "auto") !== "auto") return false;
  if (String(p.totalTheme || "auto") !== "auto") return false;
  const colorKeys = [
    "tableBgColor",
    "tableHeaderBgColor",
    "tableHeaderTextColor",
    "tableLineColor",
    "accountColor",
    "toonColor",
    "tableBgGifUrl",
    "tableTextColor",
    "tableTextOutlineColor",
  ];
  return !colorKeys.some((k) => typeof p[k] === "string" && String(p[k]).trim());
}

const OVERLAY_THEME_FALLBACK_KEYS = [
  "theme",
  "membersTheme",
  "totalTheme",
  "goalTheme",
  "tickerBaseTheme",
  "timerTheme",
  "missionTheme",
  "tableBgColor",
  "tableHeaderBgColor",
  "tableHeaderTextColor",
  "tableLineColor",
  "accountColor",
  "toonColor",
  "tableBgGifUrl",
  "tableTextColor",
  "tableBgOpacity",
] as const;

/** 서버 테마가 기본일 때만 local 테마·표색을 얹음 — 1~3위/외곽선 등 서버 설정은 유지 */
export function mergeOverlayPresetThemeFallbackFromLocal<T extends OverlayPresetLike>(
  remotePreset: T,
  localPreset: T | undefined
): T {
  if (!localPreset || !isDefaultLikeOverlayThemeFields(remotePreset)) return remotePreset;
  if (isDefaultLikeOverlayThemeFields(localPreset)) return remotePreset;
  const next: Record<string, unknown> = { ...remotePreset };
  for (const key of OVERLAY_THEME_FALLBACK_KEYS) {
    const lv = (localPreset as Record<string, unknown>)[key];
    if (lv === undefined || lv === null) continue;
    if (typeof lv === "string" && !String(lv).trim()) continue;
    next[key] = lv;
  }
  return next as T;
}

export function mergeOverlayPresetsForOverlayView(
  remote: OverlayPresetLike[],
  local: OverlayPresetLike[],
  searchParams?: SearchParamsLike
): OverlayPresetLike[] {
  if (shouldPreferLocalOverlayPresets(searchParams)) {
    return mergeOverlayPresetsPreferLocal(remote, local);
  }
  /** OBS: 서버 프리셋이 정본. 테마만 서버가 기본일 때 local 로 보강(설정 변경이 로컬 옛 테마에 막히지 않게). */
  const remotePreferred = mergeOverlayPresetsPreferRemote(remote, local);
  if (!local.length) return remotePreferred;
  const localById = new Map(
    local
      .filter((p) => p && typeof p.id === "string" && p.id)
      .map((p) => [String(p.id), p] as const)
  );
  return remotePreferred.map((p) => {
    const id = p && typeof p.id === "string" ? p.id : "";
    return mergeOverlayPresetThemeFallbackFromLocal(p, id ? localById.get(id) : undefined);
  });
}

export const OVERLAY_LIVE_PRESET_STYLE_KEYS = new Set([
  "goalTextColor",
  "goalFontSize",
  "goalTextOutlineColor",
  "goalTextOutlineWidth",
  "goalBarBgColor",
  "goalBarFillColor",
  "goalFontFamily",
  "goalFontWeight",
  "goalBarAnimation",
  "goalBarGifUrl",
  "goalBarGifOpacity",
  "goalBarGifBrightness",
  "textSharp",
  "goalOpacity",
  "goalOpacityText",
  "goalLabel",
  "goalWidth",
  "scale",
  "memberSize",
  "totalSize",
  "donorsFormat",
  "currencyLocale",
  "tableTextColor",
  "tableTextOutlineColor",
  "tableTextOutlineWidth",
  "tableHeaderTextOutlineColor",
  "tableHeaderTextOutlineWidth",
  "tableFontWeight",
  "tableFontFamily",
  "accountColor",
  "toonColor",
  "tableBgOpacity",
  "tableBgGifOpacity",
  "tableBgGifBrightness",
  "tableFrameOpacity",
  "tableFrameInset",
  "tableBgColor",
  "tableHeaderBgColor",
  "tableHeaderTextColor",
  "tableLineColor",
  /** 타이머 색·스타일 — OBS URL 스테일 방지 */
  "timerFontFamily",
  "timerFontColor",
  "timerBgColor",
  "timerBorderColor",
  "timerBgOpacity",
  "timerScale",
  "timerShowHours",
  /** 테마도 프리셋 우선 — URL 스테일/미리보기 핫리로드와 맞춤 */
  "theme",
  "membersTheme",
  "totalTheme",
  /** 1~3위·선명·열 옵션 — 컴팩트 OBS URL에 없어도 ready 후 프리셋 반영 */
  "textSharp",
  "rankTop3Mode",
  "rankTop3Effect",
  "rankLabelFormat",
  "rank1Effect",
  "rank2Effect",
  "rank3Effect",
  "rank1TextColor",
  "rank2TextColor",
  "rank3TextColor",
  "rank1TextColorAlt",
  "rank2TextColorAlt",
  "rank3TextColorAlt",
  "rank1Bg",
  "rank2Bg",
  "rank3Bg",
  "rank1Mark",
  "rank2Mark",
  "rank3Mark",
]);

/** presetToParams에 비어 있으면 URL에 넣지 않는 키 — ready 후 URL 스테일 무시(테마·글꼴 자동) */
const PRESET_EMPTY_USES_THEME_DEFAULT_KEYS = new Set([
  "tableFontFamily",
  "tableBgColor",
  "tableHeaderBgColor",
  "tableHeaderTextColor",
  "tableLineColor",
  "tableTextColor",
  "tableTextOutlineColor",
  "tableTextOutlineWidth",
  "tableHeaderTextOutlineColor",
  "tableHeaderTextOutlineWidth",
  "tableFontWeight",
  "accountColor",
  "toonColor",
  "membersTheme",
  "totalTheme",
  "goalTextColor",
  "goalFontSize",
  "goalTextOutlineColor",
  "goalTextOutlineWidth",
  "goalBarBgColor",
  "goalBarFillColor",
  "goalFontFamily",
  "goalFontWeight",
]);

const GOAL_HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;

/** 후원 목표 글자색 — `#` 없이 입력해도 허용 */
export function normalizeGoalHexColor(raw: string): string | null {
  const s = String(raw || "").trim();
  if (GOAL_HEX_COLOR_RE.test(s)) return s;
  const bare = s.replace(/^#/, "");
  if (/^[0-9a-fA-F]{3,8}$/.test(bare)) return `#${bare}`;
  return null;
}

/**
 * `/api/state` 프리셋이 준비되면 URL에 박힌 예전 스타일보다 프리셋 우선(OBS `host` 유무와 무관).
 */
/** 타이머 색·스케일 — ready 후 빈 프리셋이면 URL 스테일을 쓰지 않음 */
const TIMER_OVERLAY_LIVE_STYLE_KEYS = new Set([
  "timerFontFamily",
  "timerFontColor",
  "timerBgColor",
  "timerBorderColor",
  "timerBgOpacity",
  "timerScale",
  "timerShowHours",
]);

export function resolveLivePresetStyleParam(
  key: string,
  rawSp: SearchParamsLike,
  presetParams: URLSearchParams,
  opts: { ready: boolean }
): string | null {
  const fromPreset = presetParams.get(key);
  if (
    opts.ready &&
    OVERLAY_LIVE_PRESET_STYLE_KEYS.has(key) &&
    fromPreset !== null &&
    fromPreset !== ""
  ) {
    return fromPreset;
  }
  /** 테마·글꼴 자동(프리셋 빈 값) — OBS·구 URL 스테일 무시 */
  if (
    opts.ready &&
    PRESET_EMPTY_USES_THEME_DEFAULT_KEYS.has(key) &&
    (fromPreset === null || fromPreset === "")
  ) {
    return null;
  }
  /** 타이머 색만: 프리셋이 비어 있으면 OBS URL에 남은 #ffffff 등을 무시 → timerDisplayStyles 사용 */
  if (opts.ready && TIMER_OVERLAY_LIVE_STYLE_KEYS.has(key)) {
    return null;
  }
  const direct = rawSp.get(key);
  if (direct !== null && direct !== "") return direct;
  return fromPreset;
}

export type ResolvedTimerOverlayStyle = {
  fontFamily: string;
  fontColor?: string;
  bgColor?: string;
  borderColor?: string;
  outlineColor?: string;
  outlineWidth: number;
  bgOpacity: number;
  scalePercent: number;
  showHours: boolean;
};

type TimerStyleFromStateLike = {
  showHours?: boolean;
  fontFamily?: string;
  fontColor?: string;
  bgColor?: string;
  borderColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  bgOpacity?: number;
  scalePercent?: number;
};

function pickTimerPresetOrParam(
  paramKey: string,
  presetKey: keyof OverlayPresetLike,
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  if (opts.ready && preset) {
    const fromPreset = String(preset[presetKey] ?? "").trim();
    if (fromPreset) return fromPreset;
    /** ready 이후 프리셋이 비면 URL 스테일(#ffffff 등)을 쓰지 않고 timerDisplayStyles 로 넘김 */
    return "";
  }
  const merged = resolveLivePresetStyleParam(
    paramKey,
    rawSp,
    presetToParams(preset),
    opts
  );
  return (merged || "").trim();
}

/** 타이머 오버레이 색·스타일 — 프리셋 → (ready 전 URL) → `timerDisplayStyles` 순 */
export function resolveTimerOverlayStyle(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  stateStyle: TimerStyleFromStateLike | null | undefined,
  opts: { ready: boolean; timerOnlyDefaultShowHours?: boolean }
): ResolvedTimerOverlayStyle {
  const fontColor =
    pickTimerPresetOrParam("timerFontColor", "timerFontColor", rawSp, preset, opts) ||
    (stateStyle?.fontColor || "").trim() ||
    undefined;
  const bgColor =
    pickTimerPresetOrParam("timerBgColor", "timerBgColor", rawSp, preset, opts) ||
    (stateStyle?.bgColor || "").trim() ||
    undefined;
  const borderColor =
    pickTimerPresetOrParam("timerBorderColor", "timerBorderColor", rawSp, preset, opts) ||
    (stateStyle?.borderColor || "").trim() ||
    undefined;
  const outlineColor =
    (rawSp.get("timerOutlineColor") || "").trim() ||
    (stateStyle?.outlineColor || "").trim() ||
    undefined;

  const outlineWidthRaw = (rawSp.get("timerOutlineWidth") || "").trim();
  const outlineWidth = outlineWidthRaw
    ? (() => {
        const n = parseFloat(outlineWidthRaw);
        return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : (stateStyle?.outlineWidth ?? 0.8);
      })()
    : (stateStyle?.outlineWidth ?? 0.8);

  const bgOpacityRaw = pickTimerPresetOrParam("timerBgOpacity", "timerBgOpacity", rawSp, preset, opts);
  const bgOpacity = bgOpacityRaw
    ? (() => {
        const n = parseInt(bgOpacityRaw, 10);
        return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : (stateStyle?.bgOpacity ?? 40);
      })()
    : (stateStyle?.bgOpacity ?? 40);

  const scaleRaw = pickTimerPresetOrParam("timerScale", "timerScale", rawSp, preset, opts);
  const scalePercent = scaleRaw
    ? (() => {
        const n = parseInt(scaleRaw, 10);
        return Number.isFinite(n) ? Math.max(50, Math.min(250, n)) : (stateStyle?.scalePercent ?? 100);
      })()
    : (stateStyle?.scalePercent ?? 100);

  const showHoursRaw = pickTimerPresetOrParam("timerShowHours", "timerShowHours", rawSp, preset, opts);
  /**
   * 표시 형식(시:분:초): 타이머 제어(`timerDisplayStyles`)가 정본.
   * 프리셋/URL에 남은 timerShowHours 가 관리자 실시간 토글을 덮지 않게 함.
   */
  const showHours =
    typeof stateStyle?.showHours === "boolean"
      ? stateStyle.showHours
      : showHoursRaw
        ? showHoursRaw.toLowerCase() === "true"
        : !opts.timerOnlyDefaultShowHours;

  /**
   * 글꼴: 타이머 제어(`timerDisplayStyles`)가 정본.
   * 프리셋에 남은 mono/구 값이 개구 등 최신 선택을 덮지 않게 함.
   */
  const stateFontRaw = (stateStyle?.fontFamily || "").trim();
  const stateFont = stateFontRaw ? normalizeTimerFontFamily(stateFontRaw) : null;
  const presetOrUrlFont = pickTimerPresetOrParam(
    "timerFontFamily",
    "timerFontFamily",
    rawSp,
    preset,
    opts
  );
  const fontFamilyRaw =
    (stateFont && !isDefaultTimerFontFamily(stateFont) ? stateFont : "") ||
    presetOrUrlFont ||
    stateFont ||
    "mono";

  return {
    fontFamily: normalizeTimerFontFamily(fontFamilyRaw),
    fontColor,
    bgColor,
    borderColor,
    outlineColor,
    outlineWidth,
    bgOpacity,
    scalePercent,
    showHours,
  };
}

export function timerOverlayStyleHasCustomColors(style: ResolvedTimerOverlayStyle): boolean {
  return Boolean(
    style.fontColor ||
      style.bgColor ||
      style.borderColor ||
      (style.outlineColor && style.outlineColor.trim())
  );
}

export function resolveGoalTextColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  if (opts.ready && preset) {
    const fromPreset = normalizeGoalHexColor(String(preset.goalTextColor || "").trim());
    if (fromPreset) return fromPreset;
  }
  const merged = resolveLivePresetStyleParam(
    "goalTextColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeGoalHexColor(merged || "") || "#6b2d4a";
}

export function resolveGoalFontSizePx(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number | undefined {
  const raw = resolveLivePresetStyleParam("goalFontSize", rawSp, presetToParams(preset), opts) || "";
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? Math.max(10, Math.min(48, n)) : undefined;
}

export function resolveGoalTextOutlineColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string | undefined {
  const merged = resolveLivePresetStyleParam(
    "goalTextOutlineColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  const hex = normalizeGoalHexColor(merged || "");
  return hex || undefined;
}

export function resolveGoalTextOutlineWidthPx(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number | undefined {
  const raw =
    resolveLivePresetStyleParam("goalTextOutlineWidth", rawSp, presetToParams(preset), opts) || "";
  if (!raw.trim()) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(3, n));
}

export function resolveGoalBarBgColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  if (opts.ready && preset) {
    const fromPreset = normalizeGoalHexColor(String(preset.goalBarBgColor || "").trim());
    if (fromPreset) return fromPreset;
  }
  const merged = resolveLivePresetStyleParam(
    "goalBarBgColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return resolveGoalBarTrackBg(merged || "");
}

export function resolveGoalBarFillColorParam(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  if (opts.ready && preset) {
    const fromPreset = normalizeGoalHexColor(String(preset.goalBarFillColor || "").trim());
    if (fromPreset) return fromPreset;
  }
  const merged = resolveLivePresetStyleParam(
    "goalBarFillColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return resolveGoalBarFillColor(merged || "");
}

export function resolveGoalFontFamilyCss(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string | null {
  if (opts.ready && preset?.goalFontFamily) {
    const fromPreset = resolveGoalBarFontFamilyCss(preset.goalFontFamily);
    if (fromPreset) return fromPreset;
  }
  const merged = resolveLivePresetStyleParam(
    "goalFontFamily",
    rawSp,
    presetToParams(preset),
    opts
  );
  return resolveGoalBarFontFamilyCss(merged);
}

export function resolveGoalBarAnimationMode(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): GoalBarAnimationMode {
  if (opts.ready && preset?.goalBarAnimation) {
    return normalizeGoalBarAnimation(preset.goalBarAnimation);
  }
  const merged = resolveLivePresetStyleParam(
    "goalBarAnimation",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeGoalBarAnimation(merged || "both");
}

export function resolveGoalBarGifUrl(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  if (opts.ready && preset?.goalBarGifUrl) {
    const fromPreset = sanitizeOverlayEmbedMediaUrl(preset.goalBarGifUrl);
    if (fromPreset) return fromPreset;
  }
  const merged = resolveLivePresetStyleParam(
    "goalBarGifUrl",
    rawSp,
    presetToParams(preset),
    opts
  );
  return sanitizeOverlayEmbedMediaUrl(merged || "");
}

export function resolveGoalBarGifOpacity(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number {
  if (opts.ready && preset?.goalBarGifOpacity) {
    const n = parseInt(String(preset.goalBarGifOpacity).trim(), 10);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  const merged = resolveLivePresetStyleParam(
    "goalBarGifOpacity",
    rawSp,
    presetToParams(preset),
    opts
  );
  const raw = String(merged || "").trim();
  if (!raw) return 45;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 45;
}

export function resolveGoalBarGifBrightness(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number {
  if (opts.ready && preset?.goalBarGifBrightness) {
    const n = parseInt(String(preset.goalBarGifBrightness).trim(), 10);
    if (Number.isFinite(n)) return Math.max(40, Math.min(200, n));
  }
  const merged = resolveLivePresetStyleParam(
    "goalBarGifBrightness",
    rawSp,
    presetToParams(preset),
    opts
  );
  const raw = String(merged || "").trim();
  if (!raw) return 100;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(40, Math.min(200, n)) : 100;
}

export function resolveTableFrameUrl(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  if (opts.ready && preset?.tableFrameUrl) {
    const fromPreset = sanitizeOverlayEmbedMediaUrl(preset.tableFrameUrl);
    if (fromPreset) return fromPreset;
  }
  const merged = resolveLivePresetStyleParam(
    "tableFrameUrl",
    rawSp,
    presetToParams(preset),
    opts
  );
  return sanitizeOverlayEmbedMediaUrl(merged || "");
}

export function resolveTableFrameOpacity(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number {
  if (opts.ready && preset?.tableFrameOpacity) {
    const n = parseInt(String(preset.tableFrameOpacity).trim(), 10);
    if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  }
  const merged = resolveLivePresetStyleParam(
    "tableFrameOpacity",
    rawSp,
    presetToParams(preset),
    opts
  );
  const raw = String(merged || "").trim();
  if (!raw) return 100;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
}

export function resolveTableFrameInsetPx(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number {
  if (opts.ready && preset?.tableFrameInset) {
    const n = parseInt(String(preset.tableFrameInset).trim(), 10);
    if (Number.isFinite(n)) return Math.max(0, Math.min(120, n));
  }
  const merged = resolveLivePresetStyleParam(
    "tableFrameInset",
    rawSp,
    presetToParams(preset),
    opts
  );
  const raw = String(merged || "").trim();
  if (!raw) return 32;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, Math.min(120, n)) : 32;
}

export function resolveOverlayTextSharpRender(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean; defaultSharpOnBroadcast?: boolean }
): boolean {
  const merged = resolveLivePresetStyleParam(
    "textSharp",
    rawSp,
    presetToParams(preset),
    opts
  );
  const v = String(merged || "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  if (v === "1" || v === "true" || v === "yes") return true;
  if (opts.ready && preset?.overlayTextSharpRender === false) return false;
  if (opts.ready && preset?.overlayTextSharpRender) return true;
  return Boolean(opts.defaultSharpOnBroadcast);
}

/** OBS·Prism 방송 URL — 관리자 iframe 미리보기도 동일하게 선명 모드(프리뷰↔OBS 불일치 방지) */
export function shouldDefaultSharpRenderOnBroadcastHost(
  searchParams?: SearchParamsLike
): boolean {
  return Boolean(searchParams && isOverlayBroadcastHost(searchParams));
}

export function resolveGoalFontWeight(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number | undefined {
  const raw = resolveLivePresetStyleParam("goalFontWeight", rawSp, presetToParams(preset), opts) || "";
  if (!raw.trim()) {
    if (opts.ready && preset?.goalFontWeight) {
      const fromPreset = parseInt(String(preset.goalFontWeight), 10);
      if (Number.isFinite(fromPreset)) return Math.max(400, Math.min(900, fromPreset));
    }
    return undefined;
  }
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(400, Math.min(900, n)) : undefined;
}

export function resolveTableTextColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  const merged = resolveLivePresetStyleParam(
    "tableTextColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeGoalHexColor(merged || "") || "";
}

/** 엑셀표 총합 행 글자색. 비우면 테마 자동 */
export function resolveTotalTextColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  const merged = resolveLivePresetStyleParam(
    "totalTextColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeGoalHexColor(merged || "") || "";
}

/** 엑셀표 시트 배경색. 비우면 테마 기본 RGB 사용 */
export function resolveTableBgColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  const merged = resolveLivePresetStyleParam(
    "tableBgColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeGoalHexColor(merged || "") || "";
}

/** 엑셀표 헤더(상단) 배경색. 비우면 테마 accent / 방송 기본 */
export function resolveTableHeaderBgColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  const merged = resolveLivePresetStyleParam(
    "tableHeaderBgColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeGoalHexColor(merged || "") || "";
}

/** 엑셀표 헤더(상단) 글자색. 비우면 테마 accent / 방송 기본 */
export function resolveTableHeaderTextColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  const merged = resolveLivePresetStyleParam(
    "tableHeaderTextColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeGoalHexColor(merged || "") || "";
}

/** 엑셀표 외곽·헤더·총합 구분선 색. 비우면 테마 accent / 방송 기본 */
export function resolveTableLineColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string {
  const merged = resolveLivePresetStyleParam(
    "tableLineColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeGoalHexColor(merged || "") || "";
}

/** 엑셀표 선 전체(가로·세로·외곽) — 기본 ON. false/0/off 이면 전부 숨김 */
export function resolveTableGridLines(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): boolean {
  if (opts.ready && preset && typeof preset.tableGridLines === "boolean") {
    return preset.tableGridLines;
  }
  const merged = resolveLivePresetStyleParam(
    "tableGridLines",
    rawSp,
    presetToParams(preset),
    opts
  );
  const v = String(merged || "").trim().toLowerCase();
  if (v === "false" || v === "0" || v === "off" || v === "no") return false;
  if (v === "true" || v === "1" || v === "on" || v === "yes") return true;
  return true;
}

/** 엑셀표 열 구분 세로선 — 기본 ON. false/0/off 이면 가로선·외곽만 */
export function resolveTableVerticalLines(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): boolean {
  if (opts.ready && preset && typeof preset.tableVerticalLines === "boolean") {
    return preset.tableVerticalLines;
  }
  const merged = resolveLivePresetStyleParam(
    "tableVerticalLines",
    rawSp,
    presetToParams(preset),
    opts
  );
  const v = String(merged || "").trim().toLowerCase();
  if (v === "false" || v === "0" || v === "off" || v === "no") return false;
  if (v === "true" || v === "1" || v === "on" || v === "yes") return true;
  return true;
}

export function resolveTableTextOutlineColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string | undefined {
  const merged = resolveLivePresetStyleParam(
    "tableTextOutlineColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  const hex = normalizeGoalHexColor(merged || "");
  return hex || undefined;
}

export function resolveTableTextOutlineWidthPx(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number | undefined {
  const raw =
    resolveLivePresetStyleParam("tableTextOutlineWidth", rawSp, presetToParams(preset), opts) || "";
  if (!raw.trim()) return undefined;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(3, n));
}

export function resolveTableHeaderTextOutlineColor(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): string | undefined {
  const merged = resolveLivePresetStyleParam(
    "tableHeaderTextOutlineColor",
    rawSp,
    presetToParams(preset),
    opts
  );
  const headerHex = normalizeGoalHexColor(merged || "");
  if (headerHex) return headerHex;
  return resolveTableTextOutlineColor(rawSp, preset, opts);
}

export function resolveTableHeaderTextOutlineWidthPx(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number | undefined {
  const raw = resolveLivePresetStyleParam(
    "tableHeaderTextOutlineWidth",
    rawSp,
    presetToParams(preset),
    opts
  );
  if (raw !== null && raw.trim() !== "") {
    const n = parseFloat(raw);
    if (Number.isFinite(n)) return Math.max(0, Math.min(3, n));
  }
  return resolveTableTextOutlineWidthPx(rawSp, preset, opts);
}

/** 엑셀표 글자 굵기(400~900). 미설정 시 800 */
export function resolveTableFontWeight(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): number {
  const raw =
    resolveLivePresetStyleParam("tableFontWeight", rawSp, presetToParams(preset), opts) || "";
  if (!raw.trim()) return 800;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 800;
  return Math.max(400, Math.min(900, n));
}

/** 엑셀표 글꼴 패밀리 */
export function resolveTableFontFamilyId(
  rawSp: SearchParamsLike,
  preset: OverlayPresetLike | null,
  opts: { ready: boolean }
): TableFontFamilyId {
  if (opts.ready && preset) {
    return normalizeTableFontFamily(preset.tableFontFamily || "");
  }
  const merged = resolveLivePresetStyleParam(
    "tableFontFamily",
    rawSp,
    presetToParams(preset),
    opts
  );
  return normalizeTableFontFamily(merged);
}

/** 후원 목표 막대 글자색·폰트(px) — OBS URL·프리셋 공통 */
export function appendGoalBarStyleParams(target: URLSearchParams, preset: OverlayPresetLike): void {
  const goalTextColor = normalizeGoalHexColor((preset.goalTextColor || "").trim());
  if (goalTextColor) target.set("goalTextColor", goalTextColor);
  const goalFontRaw = (preset.goalFontSize || "").trim();
  if (goalFontRaw) {
    const gfs = Math.max(10, Math.min(48, parseInt(goalFontRaw, 10) || 0));
    if (gfs > 0) target.set("goalFontSize", String(gfs));
  }
  const goalOutlineColor = normalizeGoalHexColor((preset.goalTextOutlineColor || "").trim());
  if (goalOutlineColor) target.set("goalTextOutlineColor", goalOutlineColor);
  const outlineW = (preset.goalTextOutlineWidth || "").trim();
  if (outlineW) {
    const w = Math.max(0, Math.min(3, parseFloat(outlineW) || 0));
    target.set("goalTextOutlineWidth", String(w));
  }
  const goalBarBg = normalizeGoalHexColor((preset.goalBarBgColor || "").trim());
  if (goalBarBg) target.set("goalBarBgColor", goalBarBg);
  const goalBarFill = normalizeGoalHexColor((preset.goalBarFillColor || "").trim());
  if (goalBarFill) target.set("goalBarFillColor", goalBarFill);
  const goalFontFamily = normalizeTableFontFamily((preset.goalFontFamily || "").trim());
  if (goalFontFamily !== "auto") target.set("goalFontFamily", goalFontFamily);
  const goalBarAnim = normalizeGoalBarAnimation(preset.goalBarAnimation || "");
  if (goalBarAnim !== "both") target.set("goalBarAnimation", goalBarAnim);
  const goalBarGifUrl = sanitizeOverlayEmbedMediaUrl(preset.goalBarGifUrl || "");
  if (goalBarGifUrl) target.set("goalBarGifUrl", goalBarGifUrl);
  if (preset.goalBarGifOpacity && preset.goalBarGifOpacity.trim()) {
    target.set("goalBarGifOpacity", preset.goalBarGifOpacity.trim());
  }
  if (preset.goalBarGifBrightness && preset.goalBarGifBrightness.trim()) {
    target.set("goalBarGifBrightness", preset.goalBarGifBrightness.trim());
  }
  const goalFwRaw = (preset.goalFontWeight || "").trim();
  if (goalFwRaw) {
    const fw = parseInt(goalFwRaw, 10);
    if (Number.isFinite(fw)) target.set("goalFontWeight", String(Math.max(400, Math.min(900, fw))));
  }
}

/** 후원순위 테마 → 쿼리 (레거시/디버그용). OBS URL에는 쓰지 말고 관리자 저장값을 사용하세요. */
export function donorRankingsThemeToSearchParams(theme: DonorRankingsTheme): URLSearchParams {
  const q = new URLSearchParams();
  q.set("top", String(theme.top));
  if (theme.titleText.trim()) q.set("title", theme.titleText.trim());
  q.set("titleSize", String(theme.titleSize));
  q.set("rowSize", String(theme.rowSize));
  q.set("rankSize", String(theme.rankSize));
  q.set("overlayOpacity", String(theme.overlayOpacity));
  if (theme.bg.trim()) q.set("bg", theme.bg.trim());
  if (theme.panelBg.trim()) q.set("panelBg", theme.panelBg.trim());
  if (theme.borderColor.trim()) q.set("border", theme.borderColor.trim());
  if (theme.headerAccountBg.trim()) q.set("headerAccountBg", theme.headerAccountBg.trim());
  if (theme.headerToonBg.trim()) q.set("headerToonBg", theme.headerToonBg.trim());
  if (theme.rankColor.trim()) q.set("rankColor", theme.rankColor.trim());
  if (theme.nameColor.trim()) q.set("nameColor", theme.nameColor.trim());
  if (theme.amountColor.trim()) q.set("amountColor", theme.amountColor.trim());
  if (theme.titleColor.trim()) q.set("titleColor", theme.titleColor.trim());
  if (theme.outlineColor.trim()) q.set("outline", theme.outlineColor.trim());
  if (theme.outlineWidth != null && Number.isFinite(theme.outlineWidth)) {
    q.set("outlineWidth", String(Math.max(0, Math.min(3, theme.outlineWidth))));
  }
  if (theme.zoomPct != null && Number.isFinite(theme.zoomPct)) {
    q.set("zoomPct", String(Math.max(30, Math.min(300, Math.floor(theme.zoomPct)))));
  }
  return q;
}

/** OBS용 짧은 후원순위 URL (?u=&host=obs[,&test=true]) */
export function buildDonorRankingsObsSearchParams(opts: {
  userId: string;
  test?: boolean;
}): URLSearchParams {
  const q = new URLSearchParams();
  q.set("u", opts.userId);
  q.set("host", "obs");
  if (opts.test) q.set("test", "true");
  return q;
}

export function mergePresetBroadcastVisualParams(
  target: URLSearchParams,
  preset: OverlayPresetLike | null
): void {
  const pp = presetToParams(preset);
  pp.forEach((value, key) => {
    if (PRESET_BROADCAST_SKIP_KEYS.has(key)) return;
    if (value !== "") target.set(key, value);
  });
}

type SearchParamsLike = {
  get(name: string): string | null;
};

/** 인벤 `imageUrl` 의 `/uploads/sigs/<uid>/` 에서 이미지 소유 계정 추론(OBS `u=` 오타 시 복구) */
export function inferSigUploadUserIdFromInventory(
  inventory: SigItem[] | undefined,
  fallback: string
): string {
  if (!inventory?.length) return fallback;
  const counts = new Map<string, number>();
  for (const item of inventory) {
    const m = String(item.imageUrl || "").match(/\/uploads\/sigs\/([a-zA-Z0-9_-]{1,64})\//i);
    if (m?.[1]) counts.set(m[1]!, (counts.get(m[1]!) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [uid, n] of counts) {
    if (n > bestN) {
      best = uid;
      bestN = n;
    }
  }
  return best || fallback;
}

/** OBS 수동 판매 전용 URL — middleware rewrite 후에도 브라우저 주소는 이 경로 */
export function isSigSalesManualOverlayPath(): boolean {
  if (typeof window === "undefined") return false;
  const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
  return path === "/overlay/sig-sales-manual" || path.startsWith("/overlay/sig-sales-manual/");
}

/** OBS·프리즘 브라우저 소스 (`host=obs` 등) */
export function isOverlayBroadcastHost(searchParams: SearchParamsLike): boolean {
  const h = String(searchParams.get("host") || "").trim().toLowerCase();
  return h === "obs" || h === "prism" || h === "external";
}

export function getOverlayUserIdFromSearchParams(
  searchParams: SearchParamsLike,
  fallback = ""
): string {
  /** `n=`·`id=`·`a=` 레거시·오타 호환 */
  const userId =
    searchParams.get("u") ||
    searchParams.get("user") ||
    searchParams.get("n") ||
    searchParams.get("id") ||
    searchParams.get("a");
  /** finalent 기본 폴백 금지 — u= 없으면 타계정(finalent) 실데이터가 노출됨 */
  return (userId || "").trim() || fallback;
}

/** 관리자·오버레이 URL용. 로그인 id 만 사용 (finalent 폴백으로 타계정 유출 방지) */
export function resolveScopedOverlayUserId(
  userId: string | null | undefined,
  ...fallbacks: Array<string | null | undefined>
): string {
  for (const cand of [userId, ...fallbacks]) {
    const id = String(cand || "").trim();
    if (id && id !== "undefined" && id !== "null") return id;
  }
  return "";
}

/** OBS 프리셋 등에서 `memberId=null` 문자열이 들어오면 필터가 깨지므로 무시 */
export function getOverlayMemberFilterIdFromSearchParams(searchParams: SearchParamsLike): string {
  const raw = (searchParams.get("memberId") || searchParams.get("member") || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (lower === "null" || lower === "undefined" || lower === "none" || lower === "-" || lower === "nil") {
    return "";
  }
  return raw;
}

import {
  isOverlayToolsHubPath,
  shouldUseOverlayScrollableShell,
} from "@/lib/overlay-shell-layout";

export { isOverlayToolsHubPath, shouldUseOverlayScrollableShell };

/** 관리자 대시보드 안 `<iframe>` 미리보기 — 과다 `/api/state`·SSE로 동기화가 막히는 것을 줄이기 위한 플래그 */
export function isAdminDashboardPreviewEmbed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("adminPreviewEmbed") === "1";
  } catch {
    return false;
  }
}

/**
 * 동일 오리진에서 `/admin`이 `<iframe src="/overlay...">`로 넣은 경우.
 * `adminPreviewEmbed=1`이 빠진 구 URL·캐시 번들에서도 `/api/events`·연쇄 GET이 겹치지 않게 한다.
 */
export function isEmbeddedInSameOriginAdminFrame(): boolean {
  if (typeof window === "undefined") return false;
  if (window.parent === window) return false;
  try {
    if (window.parent.location.origin !== window.location.origin) return false;
    const p = window.parent.location.pathname || "";
    return p.startsWith("/admin");
  } catch {
    return false;
  }
}

export const OVERLAY_POLL_MS_QUERY = "overlayPollMs";

/** OBS·Prism 방송용 URL에 넣으면 안 되는 미리보기·데모 쿼리 */
const OVERLAY_PREVIEW_ONLY_PARAMS = [
  "hubPreview",
  "adminPreviewEmbed",
  "demo",
  "snap",
  "snapKey",
  "_verify",
] as const;

export function stripPreviewOnlyOverlaySearchParams(params: URLSearchParams): void {
  for (const key of OVERLAY_PREVIEW_ONLY_PARAMS) {
    params.delete(key);
  }
}

/** @deprecated 오버레이 화면 안내 배너 제거 — 항상 빈 배열 */
export function getOverlayBroadcastConfigWarnings(_search?: string): string[] {
  return [];
}

/** 방송·OBS용 URL에서 주기 폴링·미리보기 쿼리 제거(관리자 복사·북마크 정리) */
export function sanitizeBroadcastOverlayUrl(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = raw.startsWith("http://") || raw.startsWith("https://") ? new URL(raw) : new URL(raw, base);
    parsed.searchParams.delete(OVERLAY_POLL_MS_QUERY);
    stripPreviewOnlyOverlaySearchParams(parsed.searchParams);
    if (raw.startsWith("http://") || raw.startsWith("https://")) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    let out = raw
      .replace(/([?&])overlayPollMs=[^&]*&?/gi, "$1")
      .replace(/([?&])hubPreview=[^&]*&?/gi, "$1")
      .replace(/([?&])adminPreviewEmbed=[^&]*&?/gi, "$1")
      .replace(/([?&])demo=[^&]*&?/gi, "$1")
      .replace(/[?&]$/, "")
      .replace(/\?&/, "?");
    return out;
  }
}

/**
 * @deprecated OverlayBroadcastHygiene 가 `router.replace` 로 처리. 직접 `history.replaceState` 는 App Router 오류 유발.
 */
export function stripOverlayPollMsFromBrowserLocation(): void {
  /* noop — 레이아웃 OverlayBroadcastHygiene 사용 */
}

/**
 * OBS·Prism·외부 방송 호스트 — SSE 정책과 별개로 주기 폴링·즉시 동기화 대상.
 * `host=obs|prism|external`
 * 관리자 미리보기 iframe(`adminPreviewEmbed`)은 제외 — LS·핫리로드가 막히면 테마/설정이 안 바뀐다.
 */
export function isExternalOverlayBroadcastHost(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("adminPreviewEmbed") === "1" || sp.get("hubPreview") === "1") return false;
    const h = sp.get("host")?.trim().toLowerCase();
    return h === "prism" || h === "obs" || h === "external";
  } catch {
    return false;
  }
}

/**
 * OBS 방송 소스(`host=obs`)는 브라우저 소스마다 SSE를 열면 `/api/events`·GET이 겹쳐 3번째 소스부터
 * 타임아웃·빈 화면이 나기 쉽다. 폴링만으로 동기화(각 오버레이 기본 1.5~2.5s).
 * 디버그: `?overlayAllowSse=1`
 */
export function shouldSkipOverlaySseForObsBroadcast(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("overlayAllowSse") === "1") return false;
    /** 관리자 미리보기는 LS 핫리로드 — OBS SSE 스킵 정책에서 제외 */
    if (sp.get("adminPreviewEmbed") === "1" || sp.get("hubPreview") === "1") return false;
    /** prism 도 SSE 중복·레이스로 엑셀표만 갱신 누락되기 쉬움 — 폴링(forceFull)만 사용 */
    const host = sp.get("host")?.trim().toLowerCase();
    return host === "obs" || host === "prism" || host === "external";
  } catch {
    return false;
  }
}

/** 미리보기 iframe·데모 허브 등에서 SSE 생략. 디버그 시 `?overlayAllowSse=1`로 다시 켤 수 있음. */
export function shouldSuppressOverlaySseConnection(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("overlayAllowSse") === "1") return false;
    if (shouldSkipOverlaySseForObsBroadcast()) return true;
    if (isOverlayToolsHubPath(window.location.pathname)) return true;
    if (sp.get("hubPreview") === "1") return true;
    if (sp.get("demo") === "true") return true;
    if (sp.has("snap") || sp.has("snapKey")) return true;
    if (sp.has("_verify")) return true;
  } catch {
    /* noop */
  }
  return isAdminDashboardPreviewEmbed() || isEmbeddedInSameOriginAdminFrame();
}

/**
 * 관리자 iframe `src`에만 붙입니다. OBS·방송용으로 복사하는 URL에는 넣지 마세요.
 * 상대 경로(`/overlay/...`)도 처리합니다.
 */
export function appendAdminPreviewEmbedToOverlayUrl(url: string): string {
  const u = String(url || "").trim();
  if (!u) return u;
  try {
    const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const parsed = u.startsWith("http://") || u.startsWith("https://") ? new URL(u) : new URL(u, base);
    if (parsed.searchParams.get("adminPreviewEmbed") === "1") {
      return u.startsWith("http://") || u.startsWith("https://") ? u : `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    parsed.searchParams.set("adminPreviewEmbed", "1");
    parsed.searchParams.set("hubPreview", "1");
    if (!parsed.searchParams.has("scalePct")) parsed.searchParams.set("scalePct", "100");
    if (u.startsWith("http://") || u.startsWith("https://")) return parsed.toString();
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    const extra = "adminPreviewEmbed=1&hubPreview=1&scalePct=100";
    return u.includes("adminPreviewEmbed=1") ? u : `${u}${u.includes("?") ? "&" : "?"}${extra}`;
  }
}
