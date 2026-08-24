"use client";
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { createPortal, flushSync } from "react-dom";
import MemberRow from "@/components/MemberRow";
import DonationTableOptionCheckboxes from "@/components/admin/DonationTableOptionCheckboxes";
import {
  buildSettlementUiOptionsFromForm,
  normalizeSettlementUiOptions,
  readLegacySettlementUiOptionsFromLocalStorage,
} from "@/lib/admin-client-settings";
import {
  clampBrowserPersistOptionsForServerAuthority,
  isServerAuthoritativeBroadcastState,
} from "@/lib/server-authoritative-broadcast-state";
import { notifyBroadcastStateLocalUpdated, notifyOverlayPresetsLocalUpdated, notifyAdminPreviewDonorsUpdated, ADMIN_PREVIEW_DONORS_REQUEST, overlayUserIdsMatch } from "@/lib/broadcast-state-local-sync";
import { APP_BRAND_NAME, adminHeaderTitle } from "@/lib/app-branding";
import Toast from "@/components/Toast";
import {
  AppState,
  Member,
  Donor,
  DonorTarget,
  defaultState,
  buildDefaultMembersCount,
  loadState,
  saveState,
  saveStateAsync,
  isServerSaveBusy,
  cacheBroadcastStateSnapshot,
  saveOverlayPresetsPatchAsync,
  saveObsTextRegistryAsync,
  saveGeneralTimerPatchAsync,
  saveMatchTimerPatchAsync,
  saveVisualSettingsPatchAsync,
  loadStateFromApi,
  saveMissionsBackup,
  loadMissionsBackup,
  isDefaultLikeState,
  isAccidentalEmptyRosterState,
  shouldBlockAccidentalEmptyOverwrite,
  isDefaultPlaceholderMemberList,
  membersDifferByIds,
  isMemberRosterStrictSuperset,
  pickMemberRosterPreferNewer,
  hasMeaningfulBroadcastData,
  hasMeaningfulMemberRoster,
  hasExpandedSigInventory,
  hasSigSalesMemberPresets,
  isShrunkToDefaultSigInventory,
  isDefaultLikeDonorRankingsTheme,
  isDefaultLikeOverlayPresets,
  BUILT_IN_DONOR_RANKINGS_PRESETS,
  isBuiltInDonorRankingsPresetId,
  shouldPreferLocalSigInventoryOverIncoming,
  shouldAvoidOverwritingLocalStateWithRemote,
  wouldShrinkDonationData,
  hasCustomTimerDisplayStyles,
  isDefaultLikeTimerDisplayStyle,
  normalizeDonorsArray,
  mergeDonorsForMultiTabSave,
  resolveRichestDonorsFromSources,
  mergeLocalMemberIdentityOntoRemote,
  donorsListContentDiffers,
  isIntentionalDonorListShrink,
  rebumpDonorsPastSettlementReset,
  applySettlementResetDonorPipeline,
  filterDonorsAfterSettlementReset,
  resolveServerDonorsForEmptyLocal,
  buildUiStateFromServerDonorPull,
  pickAuthoritativeDonorsForEmptySession,
  isEmptyBroadcastDonationSession,
  ensureMissionItems,
  appendDailyLog,
  loadDailyLogFromApi,
  parseAmount,
  formatChatLine,
  storageKey,
  dailyLogStorageKey,
  DAILY_LOG_KEY,
  overlayPresetsStorageKey,
  migrateLegacyLocalStorageKey,
  loadDailyLog,
  DailyLogEntry,
  formatManThousand,
  formatDonorsAmount,
  normalizeDonorsFormat,
  formatWonFull,
  confirmHighAmount,
  MissionItem,
  totalCombined,
  TimerState,
  normalizeDonorRankingsOverlayConfig,
  normalizeSigMatchPools,
  normalizeSigMatchParticipantIds,
  normalizeSigMatchDonationLinks,
  normalizeDonationListsOverlayConfig,
  getUnifiedSigRollingItems,
  normalizeSigRolling,
  normalizeRouletteState,
  normalizeMemberPositions,
  fitRankPositionLabelsToMemberCount,
  DONOR_RANKINGS_COMPACT_TOP_MAX,
  DONOR_RANKINGS_OUTLINE_MAX_PX,
  type OverlayConfig,
} from "@/lib/state";
import {
  buildAppStateFromDailyLogRestore,
  buildAppStateFromRestoreJson,
  buildSettlementCreationSnapshot,
  enrichSettlementSnapshotFromDailyLog,
  isFullBroadcastStateBackup,
  isOrphanedDonationState,
  pickDailyLogEntryForRestore,
  summarizeRestoreJson,
} from "@/lib/state-restore";
import {
  mergeSigMatchPreferFresherLocal,
  shouldRejectPoorerDonationRemote,
} from "@/lib/overlay-sync-signature";
import {
  applyThemeRestorePatch,
  collectThemeRestoreCandidates,
  healDonationFieldsFromLocalSnapshot,
  isThemeRestoreDismissedForCandidate,
  markThemeRestoreDismissed,
  pickBestThemeRestoreCandidate,
  shouldOfferThemeRestore,
  summarizeThemeRestoreCandidate,
  type ThemeRestoreCandidate,
} from "@/lib/theme-restore";
import {
  applyRestroomCountDelta,
  buildRestroomMemberUpdate,
  formatRestroomDisplay,
  isRestroomUnlimitedLog,
  RESTROOM_UNLIMITED,
  RESTROOM_UNLIMITED_SYMBOL,
  restroomValueAfterUndoLog,
} from "@/lib/restroom-utils";
import { createTerritoryLog, formatTerritoryLogPushDirLabel, normalizeTerritoryLogs, resolveTerritoryLogPushDirForWrite } from "@/lib/territory-utils";
import { useSSEConnection } from "@/lib/sse-client";
import { createStateUpdatedScheduler, DONOR_STATE_UPDATED_DEBOUNCE_MS, DONOR_STATE_UPDATED_MAX_WAIT_MS } from "@/lib/overlay-pull-policy";
import {
  resolveSigAdminPreviewFallbackSrc,
  resolveSigAdminPreviewSrc,
  resolveSigOverlayCardImageUrl,
  resolveSigImageUrl,
  toGithubRawSigAssetUrl,
  stripSigInventoryImagesKeepList,
  DEFAULT_SIG_SOLD_STAMP_URL,
  DEFAULT_SIG_INVENTORY,
  normalizeSigImageUrlStored,
} from "@/lib/constants";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { appendSettlementRecordAndSync, appendSigMatchIncentiveSettlementAndSync, SettlementMemberRatioOverrides } from "@/lib/settlement";
import { formatSigMatchStat, formatSigMatchManualAdjustStepLabel, getSigMatchRankings, isOperatingSettlementMember, resolveSigMatchDonationLink, resolveSigMatchManualAdjustSteps } from "@/lib/settlement-utils";
import { buildDonorTotalsByNameFromDonors } from "@/lib/donor-rankings-aggregate";
import { getEffectiveRemainingTime, mergeGeneralTimerPreferEffective, pauseTimer, resumeTimer } from "@/lib/timer-utils";
import {
  appendAdminPreviewEmbedToOverlayUrl,
  mergeOverlayPresetsPreferLocal,
  mergePresetBroadcastVisualParams,
  buildCompactBroadcastOverlayParams,
  appendGoalBarStyleParams,
  normalizeGoalHexColor,
  sanitizeBroadcastOverlayUrl,
  resolveScopedOverlayUserId,
  isTimerBackgroundHidden,
  isTimerBorderVisuallyHidden,
  isHiddenTimerDisplayStyle,
  restoreTimerBackgroundOpacity,
  type OverlayPresetLike,
} from "@/lib/overlay-params";
import { TABLE_FONT_FAMILY_OPTIONS, clampTableMemberSizePx, normalizeTableFontFamily } from "@/lib/table-font-style";
import {
  TIMER_FONT_FAMILY_OPTIONS,
  ensureTimerGoogleFontsLoaded,
  normalizeTimerFontFamily,
  resolveTimerFontFamilyCss,
} from "@/lib/timer-font-style";
import {
  TIMER_DESIGN_OPTIONS,
  normalizeTimerDesign,
  isImageFrameTimerDesign,
  resolveCircularImageTimerFontSize,
} from "@/lib/timer-design";
import { normalizeVsDesign, VS_DESIGN_OPTIONS } from "@/lib/vs-design";
import { FlipCountdownTimer } from "@/components/FlipCountdownTimer";
import { CircularImageTimer } from "@/components/CircularImageTimer";
import { LedMatrixTimer } from "@/components/LedMatrixTimer";
import { resetOverlayPresetsGoalForDonationInit } from "@/lib/goal-preset-math";
import {
  EXCEL_TABLE_FRAME_PRESETS,
  findExcelTableFramePresetByUrl,
} from "@/lib/excel-table-frame-presets";
import {
  emptyTableThemeAutoColorPatch,
  resolveTableThemeContributionPreviewHex,
  resolveTableThemeHeaderPreviewHex,
  resolveTableThemeHeaderTextPreviewHex,
  resolveTableThemeLinePreviewHex,
  resolveTableThemePanelBorderPreviewHex,
  resolveTableThemeRowStripePreviewHex,
  tableRowStripeBgFromPickerHex,
} from "@/lib/excel-member-table-theme";
import { pickSettingsPreservedAcrossSettlementReset } from "@/lib/settlement-reset-preserve";
import { planSigBulkReupload, sigBulkFilesWithoutNameMatch } from "@/lib/sig-image-bulk";
import { parseSigMetaFromFileName } from "@/lib/sig-filename-meta";
import { createSafeFilePreviewUrl, revokeSafeFilePreviewUrl } from "@/lib/safe-file-preview";
import { formatSigImageUploadFailureMessage, SIG_UPLOAD_NGINX_413_HINT } from "@/lib/sig-upload-errors";
import {
  applySigPriceExcelRows,
  buildSigInventoryFromExcelRows,
  sigInventoryToExcelRows,
} from "@/lib/sig-inventory-excel";
import { repairDiskUploadSigImagePath } from "@/lib/sig-image-mode";
import { dedupeSigInventory } from "@/lib/sig-inventory-dedup";
import { normalizeSigDedupKeyImageUrl } from "@/lib/sig-inventory-dedup";
import {
  applyMealBattleDonationToParticipants,
  ensureMealBattleParticipantRow,
  mealBattleUsesRawDonationScore,
} from "@/lib/meal-battle-donation";
import {
  enableMealBattleDonationSync,
  recalculateMealParticipantScoresFromDonors,
} from "@/lib/battle-donation-sync";
import { normalizeMealGaugeEffects } from "@/lib/meal-gauge-effects";
import { getVisibleAdminNavItems, isAdminNavSectionVisible, type AdminNavKey } from "@/app/admin/admin-nav-config";
import {
  appendObsTextInstance,
  buildObsTextOverlayUrl,
  duplicateObsTextInstance,
  formatObsTextOverlayUrlList,
  MAX_OBS_TEXT_INSTANCES,
  mergeObsTextRegistryIntoState,
  obsTextOverlayPath,
  readObsTextRegistryFromState,
  removeObsTextInstance,
} from "@/lib/obs-text-overlay";
import { buildSigSalesManualOverlayUrl } from "@/lib/sig-sales-overlay-urls";
import {
  extractToonationLinkKey,
  fetchToonationListenerStatus,
  isExampleToonationLinkKey,
  normalizeToonationAlertboxUrl,
  readToonationAlertboxFromLocal,
  readToonationOwnerFromLocal,
  readToonationSettingsUpdatedAtFromLocal,
  readToonationSocketEnabledFromLocal,
  shouldPreferLocalToonationSettingsOverServer,
  stopToonationListener,
  syncToonationListenerFromBrowser,
  toonationListenerStatusFromServer,
  verifyToonationSettingsSaved,
  maskToonationLinkKeyForDisplay,
  writeToonationSettingsToLocal,
  type ToonationListenerStatus,
} from "@/lib/donation/toonation/listener";
import {
  dedupeDonorRows,
  countableDonorTotal,
  donationQueueIdsForDonor,
  isDonorExcludedFromDonationTotals,
  isDuplicateDonationEvent,
  normalizeDonationEventId,
  revertDonationFromAppState,
  reassignDonorMemberInAppState,
  updateDonorMessageInAppState,
  syncMemberTotalsFromDonors,
} from "@/lib/donation/apply-donation-state";
import {
  donorTimestampsChanged,
  repairDonorTimestamps,
} from "@/lib/donation/repair-donor-timestamps";
import { guardMemberTotalsAgainstAccidentalZeroWipe } from "@/lib/donation/zero-wipe-guard";
import { mergeMemberRosterPreservingAmounts, mergeManualMemberFieldsFromPatch } from "@/lib/member-roster-merge";
import { mergeDonationApplyBase, enrichStateBeforeAuthoritativeDonationSave } from "@/lib/donation/merge-donation-apply-base";
import { applyBankDonationsViaApi } from "@/lib/donation/apply-bank-donation-client";
import { persistDonationStateViaApi } from "@/lib/donation/persist-donation-client";
import { applyDonationDummySeed } from "@/lib/dev/seed-donation-dummy";
import {
  formatCm,
  formatSeatWidthCm,
  normalizeZeroCmGaugeDisplay,
  normalizeHighSocietyFxSettings,
  highSocietyFxToHsFxParam,
  highSocietyAdminPreviewIframeKeySig,
  normalizeHighSocietySettings,
  mergeHighSocietyDonationLinksOnSettingsChange,
  isHighSocietyReopen,
  buildTerritoryPauseToggleSettingsPatch,
  resolveDonorsForHighSocietySettingsPatch,
  shouldMarkDonorsLocallyForHighSocietySettingsPatch,
  shouldPersistDonorsForHighSocietySettingsPatch,
  shouldApplyDonorsForHighSocietySettingsPatch,
  resolveDonationSyncModeForHighSocietySettingsChange,
  buildHighSocietySettingsPersistToast,
  type HighSocietySettingsAdminPatch,
  resolveHighSocietySeatMembers,
  isHighSocietySeatSelectionManual,
  resolveHighSocietySeatMemberIdsForEdit,
  appendHighSocietySeatMemberId,
  insertHighSocietySeatMemberIdAt,
  buildHighSocietyFieldFromAppState,
  resolveHighSocietyStartCmPerMember,
  resolveHighSocietyEffectiveFieldCm,
  reconcileHighSocietyFieldDimensions,
  resolveHighSocietySeatCountForField,
  resolveSystemMiddlePushDir,
  seatRoleForMemberId,
  fieldCmFromStartPerMember,
  startCmFromField,
  HIGH_SOCIETY_DEFAULT_FIELD_CM,
  HIGH_SOCIETY_MAX_SEATS,
  shouldBlockHighSocietyRegression,
  isMeaningfulHighSocietySettings,
  syncHighSocietyMemberWidthSnapshotInState,
  highSocietyNeedsMemberWidthSnapshotPersist,
} from "@/lib/high-society";
import { showAppToast, showServerPersistToast } from "@/lib/app-toast";
import {
  parseBulkDonationText,
  resolveBulkDonationRows,
  type ResolvedBulkDonationRow,
} from "@/lib/donation/parse-bulk-account-donations";
import { suggestMemberForDonationEvent } from "@/lib/donation/mapper";
import { processDonationEvent, type ProcessDonationResult } from "@/lib/donation/processor";
import {
  countGroupSplitParts,
  isGroupSplitPartDonor,
  isGroupSplitSourceDonor,
  normalizeGroupSplitDonationSettings,
  previewGroupSplitDonation,
  splitExistingDonorInAppState,
} from "@/lib/donation/group-split-donation";
import ToonationBrowserRelay from "@/components/ToonationBrowserRelay";
import type { ToonationRelayForwarded } from "@/components/ToonationBrowserRelay";
import type { DonationEvent, DonorAlias } from "@/lib/donation/types";
import { buildPlayerAlertPopupUrl, openPlayerAlertPopup } from "@/lib/donation/player-alert-url";
import { openAdminHighSocietyPopup, openAdminTimerPopup } from "@/lib/admin-popup-url";

/** 후원 계열 오버레이 배경 GIF 프리셋 — 외부 URL은 방송망에서 차단될 수 있음 */
const DONATION_LISTS_BG_GIF_PRESETS: { label: string; url: string }[] = [
  { label: "— 프리셋 —", url: "" },
  { label: "파스텔 반짝 (Giphy)", url: "https://media.giphy.com/media/26BRuo6sLetdllPAQ/giphy.gif" },
  { label: "하트 파티클 (Giphy)", url: "https://media2.giphy.com/media/l0MYC0LajbaPoEADu/giphy.gif" },
];
import MissionBoard from "@/components/MissionBoard";
import MissionBoardSlot from "@/components/MissionBoardSlot";
import SigSalesHybridModal, { type SigSalesHybridTab } from "@/components/admin/SigSalesHybridModal";
import SigSalesCompactCard from "@/components/admin/SigSalesCompactCard";

type OverlayPreset = {
  id: string; name: string; scale: string; memberSize: string; totalSize: string;
  layout?: "center-fixed" | "center";
  zoomMode?: "follow" | "invert" | "neutral";
  dense: boolean; anchor: string; tableFree?: boolean; tableX?: string; tableY?: string; autoFont?: boolean; compact?: boolean; tight?: boolean; lockWidth?: boolean; nameGrow?: boolean; nameCh?: string; tableMarginTop?: string; tableMarginRight?: string; tableMarginBottom?: string; tableMarginLeft?: string; autoFit?: "none" | "width" | "height" | "contain" | "cover"; autoFitPin?: "cc" | "tl" | "tr" | "bl" | "br" | "tc" | "bc" | "cl" | "cr"; box?: "full" | "tight"; noCrop?: boolean; sumAnchor: string; sumFree: boolean; sumX: string; sumY: string;
  theme: string;
  membersTheme?: string; totalTheme?: string; goalTheme?: string; tickerBaseTheme?: string; timerTheme?: string; missionTheme?: string;
  missionWidth?: string; missionDuration?: string; missionBgOpacity?: string; missionBgColor?: string; missionItemColor?: string; missionTitleColor?: string; missionTitleText?: string; missionTitleEffect?: string; missionFontSize?: string; missionEffect?: string; missionEffectHotOnly?: string; missionDisplayMode?: string; missionVisibleCount?: string; missionSpeed?: string; missionGapSize?: string;
  showMembers: boolean; showTotal: boolean;
  totalMode?: "total" | "contribution";
  showCombinedColumn?: boolean;
  showContributionColumn?: boolean;
  showRestroomColumn?: boolean;
  showContributionSum?: boolean;
  showTableSumRow?: boolean;
  accountHeaderLabel?: string;
  toonHeaderLabel?: string;
  restroomHeaderLabel?: string;
  showGoal: boolean; goal: string;
  /** 후원 초기화 시 복원할 목표(수동 저장·첫 자동 상향 직전 스냅샷). 없으면 초기화 시 goal 숫자 유지 */
  goalBaseline?: string;
  /** 목표 100% 달성 시 자동 상향 증가폭(원). 비우면 200만 원 */
  goalIncreaseStep?: string;
  goalLabel: string; goalWidth: string; goalAnchor: string; goalCurrent?: string; goalOpacity?: string; goalOpacityText?: boolean; goalTextColor?: string; goalFontSize?: string; goalFontWeight?: string; goalTextOutlineColor?: string; goalTextOutlineWidth?: string; goalBarBgColor?: string; goalBarFillColor?: string; goalBarGifUrl?: string; goalBarGifOpacity?: string; goalBarGifBrightness?: string; goalFontFamily?: string; goalBarAnimation?: string; overlayTextSharpRender?: boolean;
  showTeamBattle?: boolean; teamBattleAnchor?: string;
  showPersonalGoal?: boolean; personalGoalTheme?: string; personalGoalAnchor?: string; personalGoalLimit?: string; personalGoalFree?: boolean; personalGoalX?: string; personalGoalY?: string;
  tickerInMembers?: boolean; tickerInGoal?: boolean; tickerInPersonalGoal?: boolean;
  showTicker: boolean; tickerAnchor?: string; tickerWidth?: string; tickerFree?: boolean; tickerX?: string; tickerY?: string; showTimer: boolean; timerStart: number | null; timerAnchor: string; timerShowHours?: boolean; timerDesign?: string; timerFontFamily?: string; timerFontColor?: string; timerBgColor?: string; timerBorderColor?: string; timerOutlineColor?: string; timerOutlineWidth?: string; timerBgOpacity?: string; timerScale?: string;
  showMission: boolean; missionAnchor: string;
  showBottomDonors?: boolean; donorsSize?: string; donorsGap?: string; donorsSpeed?: string; donorsLimit?: string; donorsFormat?: string; donorsUnit?: string; donorsColor?: string; donorsBgColor?: string; donorsBgOpacity?: string; tickerTheme?: string; tickerGlow?: string; tickerShadow?: string; currencyLocale?: string; tableOnly?: boolean;
  confettiMilestone?: string; tableBgOpacity?: string; tableBgGifUrl?: string; tableBgGifOpacity?: string; tableBgGifBrightness?: string; tableFrameUrl?: string; tableFrameOpacity?: string; tableFrameInset?: string; tableFrameEnabled?: boolean; tableBgColor?: string; tableHeaderBgColor?: string; tableHeaderTextColor?: string; tableLineColor?: string; totalLineVisible?: boolean; tableGridLines?: boolean; tableVerticalLines?: boolean; vertical?: boolean; accountColor?: string; toonColor?: string; contributionColor?: string; tableRowEvenBg?: string; tableRowOddBg?: string; tablePanelBorderColor?: string; tableTextColor?: string; totalTextColor?: string; tableTextOutlineColor?: string; tableTextOutlineWidth?: string; tableHeaderTextOutlineColor?: string; tableHeaderTextOutlineWidth?: string; tableFontWeight?: string; tableFontFamily?: string; host?: string;
  rankTop3Mode?: string; rankTop3Effect?: string; rankLabelFormat?: string; rank1Bg?: string; rank2Bg?: string; rank3Bg?: string; rank1Mark?: string; rank2Mark?: string; rank3Mark?: string; rank1Effect?: string; rank2Effect?: string; rank3Effect?: string; rank1TextColor?: string; rank2TextColor?: string; rank3TextColor?: string; rank1TextColorAlt?: string; rank2TextColorAlt?: string; rank3TextColorAlt?: string;
};

/** 미션 목록이 비었을 때 미션 전광판 UI 확인용 placeholder */
const PLACEHOLDER_MISSIONS: MissionItem[] = [
  { id: "mis_ph_1", title: "예시 미션 · 셋리스트 요청", price: "2만", isHot: true },
  { id: "mis_ph_2", title: "즉흥 노래 한 곡", price: "3만" },
  { id: "mis_ph_3", title: "게임 미션 클리어 도전", price: "5만" },
];

const ONE_SHOT_SIG_ID = "sig_one_shot";
const ONE_SHOT_SIG_NAME = "한방 시그";
const MAX_SIG_UPLOAD_BYTES = 30 * 1024 * 1024;
const SIG_DUMMY_IMAGE = "/images/sigs/dummy-sig.svg";
const BROKEN_SIG_UID_PATTERN = /(_257b_2522id_2522|%257b%2522id%2522|%7b%22id%22)/i;

type SigUploadProgress = { current: number; total: number; label: string };

function SigUploadProgressPanel({
  progress,
  prominent = false,
  busy = false,
}: {
  progress: SigUploadProgress;
  prominent?: boolean;
  busy?: boolean;
}) {
  const pct = Math.min(100, Math.round((progress.current / Math.max(1, progress.total)) * 100));
  const indeterminate = progress.current <= 0;
  return (
    <div
      className={
        prominent
          ? "pointer-events-none w-[min(560px,calc(100vw-1.5rem))] rounded-xl border-2 border-indigo-300/70 bg-indigo-950/98 px-4 py-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.65)] backdrop-blur-md"
          : "rounded border border-indigo-400/45 bg-indigo-950/55 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
      }
      role="progressbar"
      aria-live="assertive"
      aria-busy={busy}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={`mb-2 flex flex-wrap items-center justify-between gap-2 ${prominent ? "text-sm" : "text-xs"} text-indigo-50`}>
        <span className="font-bold tracking-tight">{busy ? "시그 업로드 진행 중" : "시그 업로드"}</span>
        <span className="tabular-nums font-semibold text-sky-200">
          {progress.current}/{progress.total} ({pct}%)
        </span>
      </div>
      <p className={`mb-2 truncate ${prominent ? "text-xs" : "text-[11px]"} text-indigo-100/95`}>{progress.label}</p>
      <div className={`relative overflow-hidden rounded-full bg-black/50 ${prominent ? "h-4" : "h-2.5"}`}>
        {indeterminate ? (
          <div className="absolute inset-y-0 left-0 w-2/5 animate-[sigUploadIndeterminate_1.1s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-indigo-500 via-sky-400 to-indigo-500" />
        ) : (
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-sky-400 transition-[width] duration-200 ease-out"
            style={{ width: `${Math.max(pct, busy ? 2 : 0)}%` }}
          />
        )}
      </div>
    </div>
  );
}

function SigUploadProgressOverlay({
  progress,
  busy,
}: {
  progress: SigUploadProgress | null;
  busy: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || (!busy && !progress)) return null;
  const panel = progress ?? { current: 0, total: 1, label: "업로드 준비 중…" };
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[9999] flex items-start justify-center bg-black/35 px-3 pt-4 sm:pt-6">
      <SigUploadProgressPanel progress={panel} prominent busy={busy} />
    </div>,
    document.body
  );
}

function clampSigSalesMenuCount(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw || "").replace(/[^\d]/g, "") || "10", 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(5, Math.min(20, Math.floor(n)));
}

function clampSigSalesResultScalePct(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw || "").replace(/[^\d]/g, "") || "78", 10);
  if (!Number.isFinite(n)) return 78;
  return Math.max(50, Math.min(100, Math.floor(n)));
}

function isBrokenSigImageUrl(raw?: string): boolean {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return false;
  return BROKEN_SIG_UID_PATTERN.test(v);
}

function isLegacyLocalSigImageUrl(raw?: string): boolean {
  const v = String(raw || "").trim().toLowerCase();
  if (!v) return false;
  return (
    v.startsWith("/uploads/") ||
    v.startsWith("uploads/") ||
    v.includes(".onrender.com/uploads/")
  );
}

function resolveSigPreviewSrc(raw?: string, name?: string, userId?: string): string {
  if (isBrokenSigImageUrl(String(raw || "").trim())) {
    return toGithubRawSigAssetUrl(SIG_DUMMY_IMAGE) || SIG_DUMMY_IMAGE;
  }
  return resolveSigAdminPreviewSrc(raw, name, userId);
}

/** 신규 시그 폼 미리보기 — blob·업로드 URL만 사용(이름 기반 from-drive 폴백으로 기존 시그 썸네일과 혼동 방지) */
function resolveNewSigDraftPreviewSrc(
  draftBlob: string,
  uploadedUrl: string,
  userId?: string
): string {
  const blob = String(draftBlob || "").trim();
  if (blob) return blob;
  const raw = String(uploadedUrl || "").trim();
  if (!raw || isBrokenSigImageUrl(raw)) return "";
  const stored = normalizeSigImageUrlStored(repairDiskUploadSigImagePath(raw, userId));
  if (!stored || isBrokenSigImageUrl(stored)) return "";
  return stored;
}

/** 인벤토리 행 썸네일 — 해당 행 업로드 중 blob + 저장된 URL만(신규 폼 상태와 분리) */
function resolveInventorySigThumbSrc(
  imageUrl: string | undefined,
  name: string | undefined,
  rowUploadPreview: string | undefined,
  userId?: string
): string {
  const draft = String(rowUploadPreview || "").trim();
  if (draft) return draft;
  return resolveSigPreviewSrc(imageUrl, name, userId);
}

function handleSigPreviewImgError(
  e: React.SyntheticEvent<HTMLImageElement>,
  raw?: string,
  name?: string,
  userId?: string
) {
  const el = e.currentTarget;
  const fallback = resolveSigAdminPreviewFallbackSrc(raw, name, userId);
  if (fallback && el.src !== fallback) {
    el.src = fallback;
    return;
  }
  el.onerror = null;
  el.src = toGithubRawSigAssetUrl(SIG_DUMMY_IMAGE) || SIG_DUMMY_IMAGE;
}

function ClientTime({ ts }: { ts: number | string }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    try {
      const n = typeof ts === "string" ? Date.parse(ts) : ts;
      setText(new Date(n).toLocaleTimeString());
    } catch {
      setText("");
    }
  }, [ts]);
  return <span suppressHydrationWarning>{text}</span>;
}

/** 평시 동기화는 SSE `state_updated` + 디바운스. 주기 폴링은 연결 끊김 대비용만 */
const ADMIN_STATE_FALLBACK_POLL_MS = 120_000;
/** 후원자 리스트 실시간 반영 — SSE 누락 대비 가시 탭에서 짧게 폴링 */
const ADMIN_DONOR_LIVE_POLL_MS = 2_000;

/** SSE·폴링 시 불필요한 setState 연쇄(버튼·effect 재실행) 방지용 */
function adminSyncFingerprint(s: AppState): string {
  const rs = s.rouletteState;
  const inv = s.sigInventory || [];
  const memberTotal = (s.members || []).reduce(
    (sum, m) => sum + Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)),
    0
  );
  /** 멤버명만 바뀐 동기화도 setState·OBS 푸시가 스킵되지 않게 */
  const memberNameSig = (s.members || [])
    .map((m) => `${m.id}:${String(m.name || "").trim()}`)
    .sort()
    .join(",");
  const overlayPresetsForFp = Array.isArray(s.overlayPresets)
    ? (s.overlayPresets as { showGoal?: boolean; goal?: string }[])
    : [];
  const goalPreset = overlayPresetsForFp.find(
    (p) => Boolean(p.showGoal) && Number(p.goal || 0) > 0
  );
  const donorSig = (s.donors || [])
    .map((d) => `${d.id}:${d.amount}:${d.target || ""}`)
    .sort()
    .join(",");
  return [
    s.updatedAt ?? 0,
    memberTotal,
    memberNameSig,
    String(goalPreset?.goal ?? ""),
    inv.length,
    inv.map((x) => `${x.id}:${x.price}:${x.soldCount}:${x.isActive ? 1 : 0}`).join(","),
    donorSig,
    String(s.sigSoldOutStampUrl || "").trim(),
    (() => {
      const gt = s.generalTimer;
      const mt = s.matchTimer ?? s.generalTimer;
      if (!gt && !mt) return "0|0|0|0|0|0";
      return [
        `${gt?.remainingTime ?? 0}|${gt?.isActive ? 1 : 0}|${gt?.lastUpdated ?? 0}`,
        `${mt?.remainingTime ?? 0}|${mt?.isActive ? 1 : 0}|${mt?.lastUpdated ?? 0}`,
      ].join(";");
    })(),
    String(rs?.phase ?? ""),
    String(rs?.sessionId ?? ""),
    Math.floor(Number(rs?.startedAt ?? 0)),
  ].join("|");
}

export default function AdminPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ id: string; companyName: string; name?: string; remainingDays?: number | null; unlimited?: boolean } | null>(null);
  /** /api/auth/me 완료 전 — 미리보기에 가짜 '재로그인' 문구를 띄우지 않기 위함 */
  const [authReady, setAuthReady] = useState(false);
  /** 오버레이 URL·미리보기 — finalent 폴백 금지(타계정 후원 노출) */
  const overlayUserId = resolveScopedOverlayUserId(user?.id);
  const [state, setState] = useState<AppState>(() => ({
    ...defaultState(),
    /** 첫 페인트만 — hydrate로 비우거나 초기화하지 않음. 로드 중에는 플레이스홀더 UI만 가림 */
    members: [],
  }));
  const [syncStatus, setSyncStatus] = useState<"loading" | "synced" | "local" | "error">("loading");
  const stateUpdatedAtRef = useRef<number>(0);
  const stateRef = useRef<AppState>(state);
  const lastLocalPersistAtRef = useRef<number>(0);
  const syncStatusRef = useRef<"loading" | "synced" | "local" | "error">("loading");
  const pendingUnsyncedRef = useRef<boolean>(false);
  /** donorsAuthoritative 저장 직후 SSE·폴링이 빈 서버 스냅샷으로 덮어쓰지 않게 */
  const donationAuthoritativeSaveUntilRef = useRef<number>(0);
  /** 멤버 추가·삭제 직후 폴링이 옛(더 짧은) 로스터로 덮지 않게 */
  const membersAuthoritativeSaveUntilRef = useRef<number>(0);
  /** 빈 Redis 거부 후 로컬→서버 heal 연속 POST 방지 */
  const lastEmptyRemoteDonationHealAtRef = useRef<number>(0);
  /** 방금 삭제한 후원 id — richer remote 가 삭제분을 되살리지 않게 */
  const recentlyRemovedDonorIdsRef = useRef<Map<string, number>>(new Map());
  /** 일일 로그 복구 — markAuthoritativeDonationSave 이후 본문 연결 */
  const restoreDonorsFromDailyLogSnapshotRef = useRef<(() => Promise<void>) | null>(null);
  /** 테마 자동 복구 안내는 세션당 1회 */
  const themeRestorePromptedRef = useRef(false);
  /** 후원 0건·멤버 합계 잔존 시 자동 복구는 세션당 1회 */
  const autoOrphanDonorRestoreAttemptedRef = useRef(false);
  /** storage-health: 서버 donors > UI donors 불일치 자동 복구 */
  const serverDonorMismatchRestoreAttemptedRef = useRef(false);
  /** 주기 폴링에서 didPreserve로 서버에 다시 올릴 때 최소 간격 — 연속 POST·SSE 대기 완화 */
  const lastPollMergePersistAtRef = useRef<number>(0);
  /** 다른 탭·창 `storage` 반영 시 즉시 POST하면 탭 간 ping-pong으로 /api/state·/api/events 폭주 가능 */
  const lastStorageMergePersistAtRef = useRef<number>(0);
  /** `createStateUpdatedScheduler` — 다른 기기·탭에서 저장 시에만 GET 묶음 */
  const adminStateSseScheduleRef = useRef<(() => void) | null>(null);
  /** 후원 SSE·라이브 폴링용 강제 동기화 */
  const adminDonorForceSyncRef = useRef<(() => void) | null>(null);
  const fetchToonationQueueRef = useRef<(() => Promise<DonationEvent[]>) | null>(null);
  const autoProcessQueueRef = useRef<((events?: DonationEvent[]) => Promise<void>) | null>(null);
  const pushToonationLogRef = useRef<(message: string) => void>(() => {});
  const toonationQueueBaselineIdsRef = useRef<Set<string>>(new Set());
  const toonationQueueBaselineReadyRef = useRef(false);
  const toonationQueueRef = useRef<DonationEvent[]>([]);
  const toonationQueueHydratedRef = useRef(false);
  /** 동일 updatedAt 원격을 SSE·폴링이 반복 적용하지 않도록 */
  const lastAppliedRemoteUpdatedAtRef = useRef<number>(0);
  const oneShotSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const POLL_MERGE_PERSIST_MIN_MS = 6000;
  const DONOR_LOCAL_PROTECT_MS = 20_000;
  /** 시그 추가·삭제 직후 서버 GET이 로컬 변경을 덮어쓰지 않도록 보호(ms) */
  const SIG_INVENTORY_LOCAL_PROTECT_MS = 30_000;
  /** 금액/숫자 입력 중에는 원격 동기화 적용을 잠시 보류해 타이핑 값 초기화를 방지 */
  const amountInputEditingRef = useRef<boolean>(false);
  /** 합산 추가 연속 클릭 시 이전 후원을 덮어쓰지 않게 직렬화 */
  const addDonorSaveChainRef = useRef<Promise<void>>(Promise.resolve());
  const [dailyLog, setDailyLog] = useState<Record<string, DailyLogEntry[]>>({});
  const donorTimestampRepairKeyRef = useRef("");
  const [donorName, setDonorName] = useState("");
  const [donorMessage, setDonorMessage] = useState("");
  const [donorAmount, setDonorAmount] = useState("");
  const [bulkDonationText, setBulkDonationText] = useState("");
  const [bulkDonationBusy, setBulkDonationBusy] = useState(false);
  const [bulkDonationPreview, setBulkDonationPreview] = useState<ResolvedBulkDonationRow[] | null>(null);
  const [bulkDonationSkipped, setBulkDonationSkipped] = useState<
    { lineNo: number; raw: string; reason: string }[]
  >([]);
  const [bulkDonationTarget, setBulkDonationTarget] = useState<DonorTarget>("account");
  const [donorMemberId, setDonorMemberId] = useState<string | null>(null);
  const [donorTarget, setDonorTarget] = useState<DonorTarget>("account");
  const [toonationSocketEnabled, setToonationSocketEnabled] = useState(false);
  const [toonationListenerStatus, setToonationListenerStatus] = useState<ToonationListenerStatus | null>(null);
  const toonationListenerStatusRef = useRef<ToonationListenerStatus | null>(null);
  const [toonationListenerMeta, setToonationListenerMeta] = useState<{
    lastDonationAt?: number;
    lastEventAt?: number;
  }>({});
  useEffect(() => {
    toonationListenerStatusRef.current = toonationListenerStatus;
  }, [toonationListenerStatus]);
  /** 계정 로드 전·신규 계정은 빈 연동키로 시작(타 계정 LS 상속 금지) */
  const [toonationAlertboxUrl, setToonationAlertboxUrl] = useState("");
  const [toonationOwnerName, setToonationOwnerName] = useState("");
  /** 서버 리스너 설정을 읽기 전에는 POST로 덮지 않음 */
  const [toonationSettingsHydrated, setToonationSettingsHydrated] = useState(false);
  const [toonationSavePending, setToonationSavePending] = useState(false);
  const [toonationLastSavedAt, setToonationLastSavedAt] = useState<number | null>(null);
  /** persist/sync는 이 계정에 대해 hydrate가 끝난 뒤에만 수행(계정 전환 시 키 오염 방지) */
  const toonationHydratedUserIdRef = useRef<string | null>(null);
  /** hydrate fetch 도중 사용자가 연동키·주인명을 수정하면 서버 값으로 덮지 않음 */
  const toonationLocalEditedAfterRef = useRef(0);
  const toonationResolvedAlertboxUrl = useMemo(
    () => normalizeToonationAlertboxUrl(toonationAlertboxUrl.trim()),
    [toonationAlertboxUrl]
  );
  const [toonationLogs, setToonationLogs] = useState<Array<{ id: string; at: number; message: string }>>([]);
  const [storageHealth, setStorageHealth] = useState<{
    storage?: { backendHint?: string; kvError?: string | null; mysql?: boolean };
    mainState?: { donorsCount?: number; totalCombined?: number };
    donationBackup?: { donorsCount?: number; total?: number } | null;
    dailyLogLatest?: { at?: string; donorsCount?: number } | null;
    hint?: string | null;
  } | null>(null);
  const refreshStorageHealth = useCallback(async () => {
    const uid = user?.id;
    if (!uid) return;
    try {
      const r = await fetch(`/api/state/storage-health?user=${encodeURIComponent(uid)}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (!r.ok) return;
      const data = await r.json();
      if (data && typeof data === "object") setStorageHealth(data);
    } catch {
      /* noop */
    }
  }, [user?.id]);
  const [toonationQueue, setToonationQueue] = useState<DonationEvent[]>([]);
  const [unmatchedEvents, setUnmatchedEvents] = useState<DonationEvent[]>([]);
  const [unmatchedAssignMap, setUnmatchedAssignMap] = useState<Record<string, string>>({});
  const [aliasInputMap, setAliasInputMap] = useState<Record<string, string>>({});
  const [donorAliases, setDonorAliases] = useState<DonorAlias[]>([]);
  const [contributionAmount, setContributionAmount] = useState("");
  const [contributionMemberId, setContributionMemberId] = useState<string | null>(null);
  const [contributionDelta, setContributionDelta] = useState<1 | -1>(1);
  const [contributionNote, setContributionNote] = useState("");
  const [restroomAmount, setRestroomAmount] = useState("");
  const [restroomMemberId, setRestroomMemberId] = useState<string | null>(null);
  /** plus | minus | unlimited */
  const [restroomMode, setRestroomMode] = useState<"plus" | "minus" | "unlimited">("minus");
  const [territoryCm, setTerritoryCm] = useState("");
  const [territoryMemberId, setTerritoryMemberId] = useState<string | null>(null);
  const [territoryMode, setTerritoryMode] = useState<"plus" | "minus">("plus");
  const [territoryNote, setTerritoryNote] = useState("");
  const [territoryPushDir, setTerritoryPushDir] = useState<"system" | "left" | "right" | "split">("system");
  const [restroomNote, setRestroomNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [chatDraftDirty, setChatDraftDirty] = useState(false);
  const [missionTitle, setMissionTitle] = useState("");
  const [missionPrice, setMissionPrice] = useState("");
  const [missionRestoreLoading, setMissionRestoreLoading] = useState(false);
  const [newSigName, setNewSigName] = useState("");
  const [newSigPrice, setNewSigPrice] = useState("77000");
  const [newSigMaxCount, setNewSigMaxCount] = useState("1");
  const [newSigMemberId, setNewSigMemberId] = useState<string>("");
  const [newSigImageUrl, setNewSigImageUrl] = useState("");
  const [newSigPreviewUrl, setNewSigPreviewUrl] = useState("");
  const [newSigImageUploading, setNewSigImageUploading] = useState(false);
  /** 기존 시그 행에서 「이미지 업로드」 중일 때만 id별 blob 미리보기(신규 시그 폼과 분리) */
  const [sigRowUploadPreviewMap, setSigRowUploadPreviewMap] = useState<Record<string, string>>({});
  const [sigImagePreviewModal, setSigImagePreviewModal] = useState<{ src: string; name: string; rawUrl: string } | null>(null);
  /** 시그 이미지: PC 파일 선택 → 업로드 API 후 URL 반영 */
  const [sigExcelResult, setSigExcelResult] = useState("");
  /** 가격 입력은 타이핑 중 draft만 유지하고 blur/Enter에 1회 저장 */
  const [sigPriceDraftMap, setSigPriceDraftMap] = useState<Record<string, string>>({});
  const sigPriceDraftMapRef = useRef<Record<string, string>>({});
  /** 시그 롤링 업로드 결과 메시지 */
  const [sigRollingUploadMessage, setSigRollingUploadMessage] = useState("");
  /** 시그 판매 목록: 행 접기(기본 접힘 — 긴 목록 스크롤 완화) */
  const [sigInventoryRowOpen, setSigInventoryRowOpen] = useState<Record<string, boolean>>({});
  const rollingItemsForAdmin = useMemo(() => getUnifiedSigRollingItems(state), [state]);
  const legacyOnlyRollingCount = useMemo(() => {
    const invIds = new Set((state.sigInventory || []).map((x) => x.id));
    return normalizeSigRolling(state.sigRolling).items.filter((x) => !invIds.has(x.id)).length;
  }, [state.sigInventory, state.sigRolling]);
  const [sigBulkReuploadBusy, setSigBulkReuploadBusy] = useState(false);
  const [sigUploadProgress, setSigUploadProgress] = useState<SigUploadProgress | null>(null);
  const [sigSalesModalOpen, setSigSalesModalOpen] = useState(false);
  const [sigSalesModalTab, setSigSalesModalTab] = useState<SigSalesHybridTab>("inventory");
  const sigBulkReuploadInputRef = useRef<HTMLInputElement | null>(null);
  const sigRestoreJsonInputRef = useRef<HTMLInputElement | null>(null);
  const sigRestoreExcelInputRef = useRef<HTMLInputElement | null>(null);
  const openSigSalesModal = useCallback((tab: SigSalesHybridTab = "inventory") => {
    setSigSalesModalTab(tab);
    setSigSalesModalOpen(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const tab = new URLSearchParams(window.location.search).get("sigSales");
    if (tab === "wheel" || tab === "rolling" || tab === "inventory") {
      openSigSalesModal(tab);
    } else if (tab === "1" || tab === "open") {
      openSigSalesModal("inventory");
    }
  }, [openSigSalesModal]);

  const sigInventoryCount = useMemo(
    () => (state.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID).length,
    [state.sigInventory]
  );
  const sigActiveCount = useMemo(
    () => (state.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID && x.isActive).length,
    [state.sigInventory]
  );
  const beginSigBulkUploadUi = useCallback((total: number, label: string) => {
    const safeTotal = Math.max(1, total);
    flushSync(() => {
      setSigBulkReuploadBusy(true);
      setSigUploadProgress({ current: 0, total: safeTotal, label });
      setSigExcelResult(label);
      setSigOcrBanner(label);
    });
  }, []);
  /** 시그 업로드·일괄 작업 상태(목록 위 배너) */
  const [sigOcrBanner, setSigOcrBanner] = useState("");
  const [sigPresetMemberId, setSigPresetMemberId] = useState("");
  /** 회차별 금액 범위(최소/최대). 빈칸이면 해당 회차는 금액 제한 없이 남은 시그 중 랜덤(중복 없음) */
  const [rouletteSpinCount, setRouletteSpinCount] = useState("5");
  const [roulettePriceRanges, setRoulettePriceRanges] = useState<Array<{ min: string; max: string }>>(() =>
    Array.from({ length: 5 }, () => ({ min: "", max: "" }))
  );
  const [rouletteForcedSigIdsInput, setRouletteForcedSigIdsInput] = useState("");
  const [rouletteForcedSlotIds, setRouletteForcedSlotIds] = useState<string[]>(["", "", "", "", ""]);
  const [rouletteForcedOneShotImageUrl, setRouletteForcedOneShotImageUrl] = useState("");
  const forcedSigPickOptions = useMemo(
    () => (state.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID),
    [state.sigInventory]
  );
  const forcedSlotsReady = useMemo(() => {
    const ids = rouletteForcedSlotIds.map((x) => String(x || "").trim()).filter(Boolean);
    return ids.length === 5 && new Set(ids).size === 5;
  }, [rouletteForcedSlotIds]);
  const forcedSlotsAutoOneShotPrice = useMemo(() => {
    const byId = new Map(forcedSigPickOptions.map((x) => [x.id, x]));
    return rouletteForcedSlotIds.reduce((sum, id) => {
      const row = byId.get(id);
      return sum + (row ? Math.max(0, Math.floor(Number(row.price || 0))) : 0);
    }, 0);
  }, [rouletteForcedSlotIds, forcedSigPickOptions]);
  const [sigMatchNumericDraft, setSigMatchNumericDraft] = useState<{
    targetCount: string;
    incentivePerPoint: string;
    overlayTimerDurationSec: string;
    manualAddStep: string;
    manualDeductStep: string;
  }>({
    targetCount: "100",
    incentivePerPoint: "1000",
    overlayTimerDurationSec: "180",
    manualAddStep: "10000",
    manualDeductStep: "10000",
  });
  const sigMatchNumericEditingRef = useRef<Record<keyof typeof sigMatchNumericDraft, boolean>>({
    targetCount: false,
    incentivePerPoint: false,
    overlayTimerDurationSec: false,
    manualAddStep: false,
    manualDeductStep: false,
  });
  const ROULETTE_ROUND_UI_CAP = 40;
  const [rouletteResetBusy, setRouletteResetBusy] = useState(false);
  /** 회전판 돌리기/초기화 결과 — sigExcelResult(엑셀)와 분리해 버튼 바로 아래에 표시 */
  const [rouletteActionMessage, setRouletteActionMessage] = useState("");

  const { connected: adminSseConnected } = useSSEConnection((d: unknown) => {
    const o = d as {
      type?: string;
      donorRankingsUpdatedAt?: number;
      updatedAt?: number;
      donationApplied?: { donorName?: string; amount?: number; target?: string; memberName?: string };
    };
    if (o?.type === "donation_queue_updated") {
      void (async () => {
        let items: DonationEvent[] = [];
        for (let attempt = 0; attempt < 6; attempt += 1) {
          items = (await fetchToonationQueueRef.current?.()) ?? [];
          if (items.length > 0) break;
          await new Promise((resolve) => setTimeout(resolve, 30 + attempt * 25));
        }
        const serverConnected = toonationListenerStatusRef.current?.kind === "connected";
        /**
         * 서버 WS가 자동 반영 중이면 클라이언트 큐 처리는 레이스로 이중 적재됨 —
         * 서버 GET 동기화만 한다.
         */
        if (serverConnected) {
          adminDonorForceSyncRef.current?.();
          return;
        }
        if (items.length === 0) return;
        toonationQueueBaselineReadyRef.current = true;
        const baseline = toonationQueueBaselineIdsRef.current;
        const remote = await loadStateFromApi(user?.id, { forceFull: true });
        const dupBase = remote ?? stateRef.current;
        const pending = items.filter((evt) => {
          if (!baseline.has(evt.id)) baseline.add(evt.id);
          if (evt.alreadyApplied) return false;
          return !isDuplicateDonationEvent(dupBase, evt);
        });
        if (pending.length > 0) {
          void autoProcessQueueRef.current?.(pending);
        }
        adminDonorForceSyncRef.current?.();
      })();
      return;
    }
    if (o?.type !== "state_updated") return;
    const applied = o.donationApplied;
    if (applied?.donorName && Number(applied.amount) > 0) {
      const targetLabel = applied.target === "account" ? "계좌" : "투네";
      const memberSuffix = applied.memberName ? ` → ${applied.memberName}` : "";
      pushToonationLogRef.current(
        `서버 자동 반영: ${applied.donorName} ${Number(applied.amount).toLocaleString("ko-KR")}원 (${targetLabel})${memberSuffix}`
      );
    }
    /**
     * donorRankingsUpdatedAt 은 글자색·테마 변경에도 올라가므로
     * 그 자체로 후원 force sync 하면 시각 옵션 저장 직후 빈/축소 원격이 덮어쓸 수 있다.
     * 실제 후원 반영(donationApplied)일 때만 즉시 풀 동기화.
     */
    if (applied?.donorName && Number(applied.amount) > 0) {
      void applyDonorsFromServerMainStateRef.current({ silent: true }).then((ok) => {
        if (!ok) adminDonorForceSyncRef.current?.();
      });
    } else {
      adminDonorForceSyncRef.current?.();
    }
    adminStateSseScheduleRef.current?.();
  });
  const adminSseConnectedRef = useRef(adminSseConnected);
  adminSseConnectedRef.current = adminSseConnected;

  useEffect(() => {
    const s = state.sigMatchSettings || {};
    const steps = resolveSigMatchManualAdjustSteps(s);
    setSigMatchNumericDraft((prev) => ({
      targetCount: sigMatchNumericEditingRef.current.targetCount ? prev.targetCount : String(s.targetCount ?? 100),
      incentivePerPoint: sigMatchNumericEditingRef.current.incentivePerPoint ? prev.incentivePerPoint : String(s.incentivePerPoint ?? 1000),
      overlayTimerDurationSec: sigMatchNumericEditingRef.current.overlayTimerDurationSec
        ? prev.overlayTimerDurationSec
        : String(s.overlayTimerDurationSec ?? 180),
      manualAddStep: sigMatchNumericEditingRef.current.manualAddStep
        ? prev.manualAddStep
        : String(s.manualAddStep ?? steps.addStep),
      manualDeductStep: sigMatchNumericEditingRef.current.manualDeductStep
        ? prev.manualDeductStep
        : String(s.manualDeductStep ?? steps.deductStep),
    }));
  }, [state.sigMatchSettings]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const isAmountLikeEditor = (el: EventTarget | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
        const type = el instanceof HTMLInputElement ? String(el.type || "").toLowerCase() : "";
        const inputMode = el instanceof HTMLInputElement ? String(el.inputMode || "").toLowerCase() : "";
        const placeholder = el instanceof HTMLInputElement ? String(el.placeholder || "") : "";
        const hint = `${placeholder} ${el.name || ""} ${el.id || ""}`.toLowerCase();
        /** 수동 합산 폼(이름·금액·멤버) 입력 중에도 빈 Redis 적용으로 표가 0 되지 않게 */
        if (/(donor|후원자|입금액|합산)/.test(hint)) return true;
        if (el instanceof HTMLElement && el.dataset.skipAmountEditGuard === "1") return false;
        if (!(el instanceof HTMLInputElement)) return false;
        return (
          type === "number" ||
          inputMode === "numeric" ||
          inputMode === "decimal" ||
          /(amount|price|goal|ratio|tax|opacity|count|금액|가격|목표|비율|세율|개수|회전|원)/.test(hint)
        );
      }
      return false;
    };
    const refreshEditingFlag = (target?: EventTarget | null) => {
      if (isAmountLikeEditor(target ?? document.activeElement)) {
        amountInputEditingRef.current = true;
        return;
      }
      amountInputEditingRef.current = isAmountLikeEditor(document.activeElement);
    };
    const onFocusIn = (e: FocusEvent) => refreshEditingFlag(e.target);
    const onFocusOut = () => {
      window.setTimeout(() => refreshEditingFlag(), 0);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    refreshEditingFlag();
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  useEffect(() => {
    if (!sigImagePreviewModal) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSigImagePreviewModal(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sigImagePreviewModal]);

  useEffect(() => {
    sigPriceDraftMapRef.current = sigPriceDraftMap;
  }, [sigPriceDraftMap]);
  const [rouletteSpinBusy, setRouletteSpinBusy] = useState(false);
  const [donorRankingPresetName, setDonorRankingPresetName] = useState("");
  const [settlementTitle, setSettlementTitle] = useState("");
  const [accountRatioInput, setAccountRatioInput] = useState("70");
  const [toonRatioInput, setToonRatioInput] = useState("60");
  const [taxRateInput, setTaxRateInput] = useState("3.3");
  const [vatIncluded, setVatIncluded] = useState(false);
  const [taxInvoiceIssued, setTaxInvoiceIssued] = useState(false);
  const [omitTreasuryFromSettlement, setOmitTreasuryFromSettlement] = useState(false);
  const [includeTreasuryInFullStatement, setIncludeTreasuryInFullStatement] = useState(false);
  const [useMemberRatioOverrides, setUseMemberRatioOverrides] = useState(false);
  const [memberRatioInputs, setMemberRatioInputs] = useState<Record<string, { account: string; toon: string }>>({});
  const settlementUiHydratingRef = useRef(true);
  const lastPersistedSettlementUiRef = useRef("");
  const presetStorageKey = useMemo(() => overlayPresetsStorageKey(user?.id), [user?.id]);
  const displayMissions = useMemo(() => {
    const v = ensureMissionItems(state.missions);
    return v.length > 0 ? v : PLACEHOLDER_MISSIONS;
  }, [state.missions]);
  const PRESET_TEMPLATES: { name: string; preset: Partial<OverlayPreset> }[] = [
    { name: "엑셀표만", preset: { theme: "excel", showMembers: true, showTotal: true, tableOnly: true, showRestroomColumn: true } },
    { name: "방송 엑셀(계좌·투네)", preset: { theme: "excelLive", membersTheme: "excelLive", totalTheme: "excelLive", showMembers: true, showTotal: true, tableOnly: true, showCombinedColumn: false, showContributionColumn: false, showRestroomColumn: true, accountHeaderLabel: "계좌", toonHeaderLabel: "투네이션", restroomHeaderLabel: "화장실", tableBgOpacity: "85", donorsFormat: "full", tableFree: true, tableX: "3", tableY: "88", anchor: "bl" } },
    { name: "웹후원 골드 엑셀", preset: { theme: "excelGold", membersTheme: "excelGold", totalTheme: "excelGold", showMembers: true, showTotal: true, tableOnly: true, showCombinedColumn: true, showContributionColumn: true, showRestroomColumn: false, tableBgOpacity: "82", tableGridLines: false, tableVerticalLines: false, tableHeaderTextColor: "", tableTextColor: "", contributionColor: "", tablePanelBorderColor: "", tableRowEvenBg: "", tableRowOddBg: "", accountHeaderLabel: "계좌", toonHeaderLabel: "투네", tableFree: true, tableX: "50", tableY: "50", anchor: "cc" } },
    { name: "전체 통합", preset: { showMembers: true, showTotal: true } },
    { name: "표만 (엑셀)", preset: { theme: "excel", showMembers: true, showTotal: true, tableOnly: true, showRestroomColumn: true } },
    { name: "멤버 목록만", preset: { showMembers: true, showTotal: false, showBottomDonors: false, tickerInMembers: false } },
    { name: "총합만", preset: { showMembers: false, showTotal: true, totalSize: "60" } },
    { name: "목표 프로그레스바", preset: { showMembers: false, showTotal: false, showGoal: true, goal: "2000000", goalBaseline: "2000000", goalIncreaseStep: "2000000", goalLabel: "후원", goalWidth: "500" } },
    { name: "개인 골", preset: { showMembers: false, showTotal: false, showPersonalGoal: true, personalGoalAnchor: "tl" } },
    { name: "미션 전광판", preset: { showMembers: false, showTotal: false, showMission: true, missionAnchor: "bc" } },
  ];
  const managePositionInPrism = true;
  const defaultPreset = (name: string, overrides: Partial<OverlayPreset> = {}): OverlayPreset => ({
    id: `ov_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name,
    scale: "1.1", memberSize: "24", totalSize: "56", dense: true, anchor: "cc",
    layout: "center-fixed", zoomMode: "follow",
    tableFree: false, tableX: "50", tableY: "50",
    sumAnchor: "bc", sumFree: false, sumX: "50", sumY: "90", theme: "default",
    showMembers: true, showTotal: true, totalMode: "total", showGoal: false, goal: "0", goalLabel: "후원", showPersonalGoal: false, personalGoalTheme: "goalClassic", personalGoalAnchor: "tl", personalGoalLimit: "3", personalGoalFree: false, personalGoalX: "78", personalGoalY: "82",
    tickerInMembers: false, tickerInGoal: false, tickerInPersonalGoal: false,
    goalWidth: "400", goalAnchor: "bc", goalCurrent: "", goalOpacity: "", goalOpacityText: false, showTicker: false, tickerAnchor: "bc", tickerWidth: "600", tickerFree: false, tickerX: "50", tickerY: "86", showTimer: false,
    timerStart: null, timerAnchor: "tr", timerShowHours: false, timerFontFamily: "mono", timerFontColor: "", timerBgColor: "", timerBorderColor: "", timerBgOpacity: "40", timerScale: "100", showMission: false, missionAnchor: "br",
    missionWidth: "800", missionDuration: "25",
    membersTheme: "auto", totalTheme: "auto", goalTheme: "auto", tickerBaseTheme: "auto", timerTheme: "auto", missionTheme: "auto",
    showBottomDonors: false, donorsSize: "", donorsGap: "16", donorsSpeed: "60", donorsLimit: "8", donorsFormat: "short", donorsUnit: "", donorsColor: "", donorsBgColor: "", donorsBgOpacity: "0", tickerTheme: "auto", tickerGlow: "45", tickerShadow: "35", currencyLocale: "ko-KR",
    showCombinedColumn: true,
    showContributionColumn: true,
    showRestroomColumn: true,
    showContributionSum: true,
    accountHeaderLabel: "",
    toonHeaderLabel: "",
    confettiMilestone: "",
    tableBgOpacity: "",
    totalLineVisible: false,
    tableGridLines: true,
    tableVerticalLines: true,
    tableBgGifUrl: "",
    tableBgGifOpacity: "45",
    tableBgGifBrightness: "100",
    tableBgColor: "",
    tableHeaderBgColor: "",
    tableHeaderTextColor: "",
    tableLineColor: "",
    tableFontFamily: "",
    accountColor: "",
    toonColor: "",
    contributionColor: "",
    tableRowEvenBg: "",
    tableRowOddBg: "",
    tablePanelBorderColor: "",
    rankTop3Mode: "off",
    rankTop3Effect: "none",
    rankLabelFormat: "hash",
    rank1Bg: "",
    rank2Bg: "",
    rank3Bg: "",
    rank1Mark: "",
    rank2Mark: "",
    rank3Mark: "",
    ...overrides,
    goalBaseline:
      overrides.goalBaseline !== undefined && String(overrides.goalBaseline).trim() !== ""
        ? String(overrides.goalBaseline)
        : overrides.goal !== undefined
          ? String(overrides.goal)
          : "0",
    goalIncreaseStep:
      overrides.goalIncreaseStep !== undefined ? String(overrides.goalIncreaseStep) : "",
  });
  const [presets, setPresets] = useState<OverlayPreset[]>([]);
  const [presetRev, setPresetRev] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [sigMatchPreviewIframeKey, setSigMatchPreviewIframeKey] = useState(0);
  const [mealMatchPreviewIframeKey, setMealMatchPreviewIframeKey] = useState(0);
  const [battleScalePct, setBattleScalePct] = useState("100");
  /** 시그/식사 대전 오버레이 본문 max-width (%), URL contentWidthPct */
  const [battleContentWidthPct, setBattleContentWidthPct] = useState("100");
  const [sigSalesMenuCount, setSigSalesMenuCount] = useState("10");
  const [donorRankingsPreviewIframeKey, setDonorRankingsPreviewIframeKey] = useState(0);
  const [hsPreviewIframeKey, setHsPreviewIframeKey] = useState(0);
  const hsSnapshotHealBusyRef = useRef(false);
  const hsSnapshotHealSigRef = useRef("");
  /** 상류사회 1인 시작 cm — 입력 중 25 클램프에 막히지 않게 초안 문자열 유지 */
  const [hsStartCmDraft, setHsStartCmDraft] = useState<string | null>(null);
  const [obsTextPreviewIframeKey, setObsTextPreviewIframeKey] = useState(0);
  const [obsTextPreviewInstanceId, setObsTextPreviewInstanceId] = useState<string | null>(null);
  const obsTextRegistry = useMemo(() => readObsTextRegistryFromState(state), [state]);
  const obsTextPreviewId =
    obsTextPreviewInstanceId ?? obsTextRegistry.instances[0]?.id ?? "default";
  const [timerUiNow, setTimerUiNow] = useState(Date.now());
  const [timerMinuteInputs, setTimerMinuteInputs] = useState<
    Record<"generalTimer" | "matchTimer", string>
  >({
    generalTimer: "0",
    matchTimer: "0",
  });
  const [pullDistance, setPullDistance] = useState(0);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const touchStartYRef = useRef<number | null>(null);
  const timerStyleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTimerStyleSaveRef = useRef<{
    generalTimer: AppState["generalTimer"];
    timerDisplayStyles: AppState["timerDisplayStyles"];
    overlayPresets: AppState["overlayPresets"];
  } | null>(null);
  const actionConfirmRef = useRef<null | (() => void)>(null);
  const resetInProgressRef = useRef(false);
  /** 정산 리셋 직후 GET/SSE가 구 후원·금액을 되살리지 않게 */
  const settlementResetUntilRef = useRef(0);
  /** 방송 종료(정산 생성) 직후 시각 복구·빈 원격 동기화가 후원을 지우지 않게 */
  const settlementSnapshotUntilRef = useRef(0);
  const [actionSheet, setActionSheet] = useState<{ open: boolean; title: string; desc: string; confirmText: string; danger: boolean }>({
    open: false,
    title: "",
    desc: "",
    confirmText: "확인",
    danger: true,
  });
  const [resetSheetOpen, setResetSheetOpen] = useState(false);
  /** 정산「멤버 초기화」 시 생성할 멤버 슬롯 수(1~30) */
  const [resetMemberSlotCount, setResetMemberSlotCount] = useState(3);
  const [activeNav, setActiveNav] = useState<AdminNavKey>("dashboard");
  const panelCardClass = "rounded-xl border border-white/10 bg-[#252525] shadow-[0_8px_24px_rgba(0,0,0,0.28)]";
  const simpleMode = false;

  const syncOneShotSigItem = useCallback((prev: AppState): AppState => {
    const inv = prev.sigInventory || [];
    const totalAmount = inv
      .filter(
        (x) =>
          x.id !== ONE_SHOT_SIG_ID &&
          Boolean(x.isActive) &&
          Math.max(0, Number(x.soldCount || 0)) < Math.max(1, Number(x.maxCount || 1))
      )
      .reduce((sum, x) => sum + Math.max(0, Number(x.price || 0)), 0);
    const oneShot = inv.find((x) => x.id === ONE_SHOT_SIG_ID);
    if (!oneShot) {
      return {
        ...prev,
        sigInventory: [
          ...inv,
          {
            id: ONE_SHOT_SIG_ID,
            name: ONE_SHOT_SIG_NAME,
            price: totalAmount,
            imageUrl: "",
            memberId: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: false,
            isActive: true,
          },
        ],
      };
    }
    const customName = String(oneShot.name || "").trim();
    const nextOneShot = {
      ...oneShot,
      name: customName || ONE_SHOT_SIG_NAME,
      price: totalAmount,
      maxCount: 1,
      soldCount: 0,
    };
    const changed =
      oneShot.name !== nextOneShot.name ||
      oneShot.price !== nextOneShot.price ||
      oneShot.maxCount !== nextOneShot.maxCount ||
      oneShot.soldCount !== nextOneShot.soldCount;
    if (!changed) return prev;
    return {
      ...prev,
      sigInventory: inv.map((x) => (x.id === ONE_SHOT_SIG_ID ? nextOneShot : x)),
    };
  }, []);
  const navItems = useMemo(() => getVisibleAdminNavItems(), []);
  useEffect(() => {
    const keys = navItems.map((n) => n.key);
    if (keys.length === 0) return;
    setActiveNav((prev) => (keys.includes(prev) ? prev : keys[0]!));
  }, [navItems]);
  const baseThemeChoices = ["default","excel","excelLive","excelBlue","excelSlate","excelAmber","excelGold","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo","neon","neonExcel","retro","minimal","rpg","pastel","rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"];
  const overlayThemeLabel = (id: string): string => {
    const map: Record<string, string> = {
      auto: "자동(프리셋 테마)",
      default: "기본(핑크 그라데이션)",
      excel: "엑셀(녹색)",
      excelLive: "방송 엑셀(청록·줄무늬)",
      excelBlue: "엑셀(파랑)",
      excelSlate: "엑셀(슬레이트)",
      excelAmber: "엑셀(앰버)",
      excelGold: "엑셀(웹후원 골드)",
      excelRose: "엑셀(로즈)",
      excelNavy: "엑셀(네이비)",
      excelTeal: "엑셀(틸)",
      excelPurple: "엑셀(퍼플)",
      excelEmerald: "엑셀(에메랄드)",
      excelOrange: "엑셀(오렌지)",
      excelIndigo: "엑셀(인디고)",
      neon: "네온",
      neonExcel: "네온 엑셀",
      retro: "레트로",
      minimal: "미니멀",
      rpg: "RPG",
      pastel: "파스텔",
      rainbow: "레인보우",
      sunset: "선셋",
      ocean: "오션",
      forest: "포레스트",
      aurora: "오로라",
      violet: "바이올렛",
      coral: "코랄",
      mint: "민트",
      lava: "라바",
      ice: "아이스",
    };
    return map[id] || id;
  };
  const missionThemeChoices = ["auto","default","excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo","neon","neonExcel","rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice","minimal","pastel","retro","rpg"];
  const themeStyle = (id: string): React.CSSProperties => {
    const map: Record<string, React.CSSProperties> = {
      default: { background: "linear-gradient(135deg,#111,#333)" },
      minimal: { background: "linear-gradient(135deg,#0b0b0b,#1f2937)" },
      retro: { background: "linear-gradient(135deg,#7c2d12,#ca8a04)" },
      rpg: { background: "linear-gradient(135deg,#1b1b1b,#3f3f46)" },
      pastel: { background: "linear-gradient(135deg,#f5d0fe,#bfdbfe)" },
      excel: { background: "linear-gradient(135deg,#065f46,#34d399)" },
      excelLive: { background: "linear-gradient(135deg,#0c4a6e,#7eb8d4,#ffffff)" },
      excelBlue: { background: "linear-gradient(135deg,#1e3a8a,#60a5fa)" },
      excelSlate: { background: "linear-gradient(135deg,#0f172a,#334155)" },
      excelAmber: { background: "linear-gradient(135deg,#92400e,#f59e0b)" },
      excelGold: { background: "linear-gradient(135deg,#1a1408,#ffc107,#1a1408)" },
      excelRose: { background: "linear-gradient(135deg,#9f1239,#fb7185)" },
      excelNavy: { background: "linear-gradient(135deg,#0b132b,#1c2541)" },
      excelTeal: { background: "linear-gradient(135deg,#0f766e,#5eead4)" },
      excelPurple: { background: "linear-gradient(135deg,#5b21b6,#c084fc)" },
      excelEmerald: { background: "linear-gradient(135deg,#064e3b,#10b981)" },
      excelOrange: { background: "linear-gradient(135deg,#7c2d12,#fb923c)" },
      excelIndigo: { background: "linear-gradient(135deg,#3730a3,#818cf8)" },
      neon: { background: "linear-gradient(135deg,#06b6d4,#a78bfa,#f472b6)" },
      neonExcel: { background: "linear-gradient(135deg,#10b981,#22d3ee,#f472b6)" },
      rainbow: { background: "linear-gradient(90deg,#ef4444,#f59e0b,#10b981,#3b82f6,#8b5cf6)" },
      sunset: { background: "linear-gradient(135deg,#fb923c,#ef4444,#7c3aed)" },
      ocean: { background: "linear-gradient(135deg,#0ea5e9,#22d3ee,#10b981)" },
      forest: { background: "linear-gradient(135deg,#065f46,#16a34a,#22c55e)" },
      aurora: { background: "linear-gradient(135deg,#22d3ee,#a78bfa,#34d399)" },
      violet: { background: "linear-gradient(135deg,#7c3aed,#a78bfa)" },
      coral: { background: "linear-gradient(135deg,#fb7185,#f59e0b)" },
      mint: { background: "linear-gradient(135deg,#14b8a6,#a7f3d0)" },
      lava: { background: "linear-gradient(135deg,#ef4444,#f97316,#f59e0b)" },
      ice: { background: "linear-gradient(135deg,#67e8f9,#bae6fd)" },
    };
    return map[id] || map.default;
  };
  const persistState = useCallback((
    s: AppState,
    opts?: {
      donorsAuthoritative?: boolean;
      donorsReplace?: boolean;
      settlementReset?: boolean;
      omitDonationFields?: boolean;
      omitHighSocietyFields?: boolean;
      membersAuthoritative?: boolean;
      /** 후원·멤버 로스터/금액을 API에 포함할 때만 true. 미지정 시 오버레이·시그 등 비후원 저장으로 처리 */
      includeDonationFields?: boolean;
      /** 판매완료 도장을 기본(빈 URL)으로 되돌릴 때만 */
      clearSigSoldOutStamp?: boolean;
      /** 상류사회 OFF·일시정지 등 — API 에 HS 설정만 전송 */
      highSocietySettingsOnly?: boolean;
      /** 저장 완료 시 서버(MySQL) 반영 토스트 */
      persistToastLabel?: string;
    }
  ) => {
    const includeDonations =
      Boolean(opts?.includeDonationFields) ||
      Boolean(opts?.donorsAuthoritative) ||
      Boolean(opts?.settlementReset);
    const omitDonationFields = Boolean(opts?.omitDonationFields) || !includeDonations;
    const resolvedOpts = clampBrowserPersistOptionsForServerAuthority({
      ...opts,
      ...(omitDonationFields ? { omitDonationFields: true as const } : {}),
    }) as typeof opts & { omitDonationFields?: boolean };
    /** 후원·금액 변경 — 브라우저 스냅샷으로 /api/state POST 금지, 서버 donations 파이프라인만 */
    if (includeDonations && !opts?.settlementReset) {
      const now = Date.now();
      lastLocalPersistAtRef.current = now;
      pendingUnsyncedRef.current = true;
      donationAuthoritativeSaveUntilRef.current = now + 20_000;
      void persistDonationStateViaApi(
        user?.id,
        s,
        opts?.donorsReplace ? "replace" : "add"
      ).then((r) => {
        if (opts?.persistToastLabel) {
          showServerPersistToast(opts.persistToastLabel, { ok: r.ok });
        }
        if (!r.ok) {
          const offline = typeof navigator !== "undefined" && !navigator.onLine;
          setSyncStatus(offline ? "local" : "error");
          return;
        }
        stateRef.current = r.state;
        setState(r.state);
        stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, r.updatedAt || 0);
        lastAppliedRemoteUpdatedAtRef.current = r.updatedAt || 0;
        pendingUnsyncedRef.current = false;
        setSyncStatus("synced");
        try {
          cacheBroadcastStateSnapshot(r.state, user?.id);
        } catch {}
        notifyBroadcastStateLocalUpdated(user?.id, r.updatedAt);
      });
      return;
    }
    if (resolvedOpts?.membersAuthoritative) {
      membersAuthoritativeSaveUntilRef.current = Date.now() + 45_000;
    }
    /**
     * 로딩 중 플레이스홀더 로스터만 서버에 올리지 않음.
     * hydrate 미완료를 이유로 전체 저장·로스터 초기화는 하지 않는다.
     */
    if (
      !resolvedOpts.settlementReset &&
      !resolvedOpts.membersAuthoritative &&
      syncStatusRef.current === "loading" &&
      isDefaultPlaceholderMemberList(s.members)
    ) {
      return;
    }
    /** 후원 포함 저장에서만 축소 스냅샷 차단 (비후원 저장은 어차피 donors 미전송) */
    if (!resolvedOpts.settlementReset && !resolvedOpts.donorsAuthoritative && !omitDonationFields) {
      try {
        const existing = loadState(user?.id);
        if (
          existing &&
          wouldShrinkDonationData(existing, s)
        ) {
          setSigExcelResult(
            "후원·금액이 줄어든 저장은 차단했습니다. 정산/후원 초기화는 메뉴에서 직접 실행해 주세요."
          );
          /** 후원 제외하고 나머지 설정만 저장 시도 — 멤버 권위 플래그는 유지 */
          saveStateAsync(s, user?.id, {
            omitDonationFields: true,
            ...(resolvedOpts.membersAuthoritative ? { membersAuthoritative: true as const } : {}),
          }).then((r) => {
            if (resolvedOpts?.persistToastLabel) {
              showServerPersistToast(resolvedOpts.persistToastLabel, {
                ok: r.ok,
                storageFallback: r.storageFallback,
              });
            }
            if (r.ok) {
              pendingUnsyncedRef.current = false;
              setSyncStatus(r.storageFallback ? "error" : "synced");
            }
          });
          return;
        }
      } catch {}
    }
    const now = Date.now();
    lastLocalPersistAtRef.current = now;
    stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, s.updatedAt || now, now);
    pendingUnsyncedRef.current = true;
    saveStateAsync(s, user?.id, resolvedOpts).then((r) => {
      if (resolvedOpts?.persistToastLabel) {
        showServerPersistToast(resolvedOpts.persistToastLabel, {
          ok: r.ok,
          storageFallback: r.storageFallback,
        });
      }
      if (r.ok) {
        if (typeof r.serverUpdatedAt === "number" && Number.isFinite(r.serverUpdatedAt)) {
          stateUpdatedAtRef.current = r.serverUpdatedAt;
          lastAppliedRemoteUpdatedAtRef.current = r.serverUpdatedAt;
        }
        pendingUnsyncedRef.current = false;
        if (r.storageFallback) {
          setSyncStatus("error");
          setSigExcelResult(
            "서버 저장 실패 — 이 브라우저에만 반영됐습니다. 다른 PC·브라우저에는 보이지 않습니다. 네트워크·서버 연결을 확인하세요."
          );
        } else {
          setSyncStatus("synced");
        }
      } else {
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setSyncStatus(offline ? "local" : "error");
      }
    });
  }, [user?.id]);

  const syncSettlementUiFormFromOptions = useCallback(
    (opts?: import("@/types").SettlementUiOptions) => {
      settlementUiHydratingRef.current = true;
      const normalized = normalizeSettlementUiOptions(opts);
      setAccountRatioInput(normalized.accountRatioInput);
      setToonRatioInput(normalized.toonRatioInput);
      setTaxRateInput(normalized.taxRateInput);
      setVatIncluded(normalized.vatIncluded);
      setTaxInvoiceIssued(normalized.taxInvoiceIssued);
      setUseMemberRatioOverrides(normalized.useMemberRatioOverrides);
      setMemberRatioInputs(normalized.memberRatioInputs);
      setOmitTreasuryFromSettlement(normalized.omitTreasuryFromSettlement);
      setIncludeTreasuryInFullStatement(normalized.includeTreasuryInFullStatement);
      lastPersistedSettlementUiRef.current = JSON.stringify(normalized);
      settlementUiHydratingRef.current = false;
    },
    []
  );

  const hydrateSettlementUiFromAppState = useCallback(
    (appState: AppState, userId: string) => {
      if (appState.settlementUiOptions) {
        syncSettlementUiFormFromOptions(appState.settlementUiOptions);
        return;
      }
      const legacy = readLegacySettlementUiOptionsFromLocalStorage(userId);
      if (!legacy) {
        settlementUiHydratingRef.current = false;
        return;
      }
      syncSettlementUiFormFromOptions(legacy);
      const next = {
        ...stateRef.current,
        settlementUiOptions: legacy,
        updatedAt: Date.now(),
      };
      stateRef.current = next;
      void saveStateAsync(next, userId, { omitDonationFields: true });
    },
    [syncSettlementUiFormFromOptions]
  );

  const persistObsTextRegistry = useCallback(
    (registry: ReturnType<typeof readObsTextRegistryFromState>) => {
      setState((prev) => mergeObsTextRegistryIntoState(prev, registry));
      void saveObsTextRegistryAsync(registry, user?.id);
    },
    [user?.id]
  );
  const addObsTextOverlayQuick = useCallback(() => {
    const added = appendObsTextInstance(obsTextRegistry);
    if (!added) return;
    persistObsTextRegistry(added.registry);
    setObsTextPreviewInstanceId(added.instance.id);
    setObsTextPreviewIframeKey((k) => k + 1);
  }, [obsTextRegistry, persistObsTextRegistry]);
  const duplicateObsTextOverlayQuick = useCallback(
    (sourceId: string) => {
      const dup = duplicateObsTextInstance(obsTextRegistry, sourceId);
      if (!dup) return;
      persistObsTextRegistry(dup.registry);
      setObsTextPreviewInstanceId(dup.instance.id);
      setObsTextPreviewIframeKey((k) => k + 1);
    },
    [obsTextRegistry, persistObsTextRegistry]
  );
  const removeObsTextOverlayQuick = useCallback(
    (id: string) => {
      const next = removeObsTextInstance(obsTextRegistry, id);
      if (!next) return;
      persistObsTextRegistry(next);
      if (obsTextPreviewInstanceId === id) {
        setObsTextPreviewInstanceId(next.instances[0]?.id ?? null);
        setObsTextPreviewIframeKey((k) => k + 1);
      }
    },
    [obsTextRegistry, persistObsTextRegistry, obsTextPreviewInstanceId]
  );

  useEffect(() => {
    if (!user?.id) return;
    setState((prev) => {
      let changed = false;
      const sigInventory = (prev.sigInventory || []).map((item) => {
        const fixed = repairDiskUploadSigImagePath(String(item.imageUrl || ""), user.id);
        if (fixed === item.imageUrl) return item;
        changed = true;
        return { ...item, imageUrl: fixed };
      });
      if (!changed) return prev;
      const next: AppState = { ...prev, sigInventory, updatedAt: Date.now() };
      persistState(next, { omitDonationFields: true });
      return next;
    });
  }, [user?.id, persistState]);

  const donorsAmountFormat = useMemo(
    () => normalizeDonorsFormat(state.donorsFormat, "full"),
    [state.donorsFormat]
  );
  const formatDonorAmountDisplay = useCallback(
    (amount: number) =>
      donorsAmountFormat === "full"
        ? formatWonFull(amount)
        : formatDonorsAmount(amount, donorsAmountFormat),
    [donorsAmountFormat]
  );
  /** 후원 리스트 — normalize + 일괄 반영 시각 복구(id·daily log) */
  const donorListRows = useMemo(
    () => repairDonorTimestamps(normalizeDonorsArray(state.donors), { dailyLog }),
    [state.donors, dailyLog]
  );
  const applyGlobalDonorsFormat = useCallback(
    (format: "full" | "short") => {
      setState((prev) => {
        const basePresets =
          Array.isArray(prev.overlayPresets) && prev.overlayPresets.length > 0
            ? (prev.overlayPresets as OverlayPreset[])
            : presets;
        const nextPresets = basePresets.map((p) => ({ ...p, donorsFormat: format }));
        setPresets(nextPresets);
        const next: AppState = {
          ...prev,
          donorsFormat: format,
          overlayPresets: nextPresets,
          updatedAt: Date.now(),
        };
        persistState(next, { omitDonationFields: true });
        return next;
      });
    },
    [persistState, presets]
  );
  const ThemeThumbs = ({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) => (
    <div className="flex flex-wrap gap-1.5 mt-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`rounded-md border ${value === opt ? "border-emerald-400" : "border-white/10"} overflow-hidden`}
          title={opt}
          style={{ width: 48, height: 28 }}
        >
          <div className="w-full h-full" style={themeStyle(opt)} />
        </button>
      ))}
    </div>
  );
  
  const moveToSection = (key: AdminNavKey, targetId: string) => {
    setActiveNav(key);
    if (typeof window === "undefined") return;
    const el = document.getElementById(targetId);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  /** `<input type="color">`는 #rrggbb만 허용 — transparent 등은 fallback으로 표시 */
  const toColorPickerValue = (raw?: string, fallback = "#ffffff") => {
    const v = (raw || "").trim();
    const lower = v.toLowerCase();
    if (!v || lower === "transparent" || lower === "none") return fallback;
    const m = v.match(/^#([0-9a-fA-F]{6})$/);
    if (m) return `#${m[1].toLowerCase()}`;
    const rgba = v.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (rgba) {
      const toHex = (n: string) =>
        Math.max(0, Math.min(255, parseInt(n, 10)))
          .toString(16)
          .padStart(2, "0");
      return `#${toHex(rgba[1])}${toHex(rgba[2])}${toHex(rgba[3])}`;
    }
    return fallback;
  };
  const activeTableThemeId = (preset: OverlayPreset) =>
    String(
      preset.membersTheme && preset.membersTheme !== "auto"
        ? preset.membersTheme
        : preset.theme || "default"
    );
  const requestConfirm = (title: string, desc: string, onConfirm: () => void, options?: { confirmText?: string; danger?: boolean }) => {
    if (typeof window === "undefined") return;
    const isMobile = window.matchMedia("(max-width: 1023px)").matches;
    if (!isMobile) {
      const text = desc ? `${title}\n\n${desc}` : title;
      if (window.confirm(text)) onConfirm();
      return;
    }
    actionConfirmRef.current = onConfirm;
    setActionSheet({
      open: true,
      title,
      desc,
      confirmText: options?.confirmText || "확인",
      danger: options?.danger ?? true,
    });
  };
  const closeActionSheet = () => {
    actionConfirmRef.current = null;
    setActionSheet((prev) => ({ ...prev, open: false }));
  };

  useEffect(() => {
    let cancelled = false;
    const loadMe = (attempt: number) => {
      fetch("/api/auth/me", { credentials: "include" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`auth_me_${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (cancelled) return;
          if (data?.user?.id) {
            setUser(data.user);
            setAuthReady(true);
            return;
          }
          setAuthReady(true);
          router.replace("/login");
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 3) {
            window.setTimeout(() => loadMe(attempt + 1), 400 * attempt);
            return;
          }
          /** 쿠키로 /admin 은 열려 있는데 me 만 실패 — 재로그인 강제 대신 안내 */
          setAuthReady(true);
        });
    };
    loadMe(1);
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    lastPollMergePersistAtRef.current = 0;
    lastStorageMergePersistAtRef.current = 0;
    serverDonorMismatchRestoreAttemptedRef.current = false;
  }, [user?.id]);
  useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);

  const mergeIncomingStateSafely = useCallback((incoming: AppState, local: AppState): { merged: AppState; didPreserve: boolean } => {
    const remoteResetAt = Number(incoming.settlementResetAt || 0);
    const localResetAt = Number(local.settlementResetAt || 0);
    if (remoteResetAt > localResetAt) {
      /**
       * 정산 리셋 stamp 상승이어도, 원격이 멤버1… 플레이스홀더+빈 후원이면 사고성 유실.
       * (정산 생성 → /settlements 이동 → 관리자 remount hydrate 에서 실멤버가 초기화되던 회귀)
       * 라이브 폴링 applyRemoteState 와 동일 가드.
       */
      if (shouldBlockAccidentalEmptyOverwrite(local, incoming)) {
        return {
          merged: {
            ...incoming,
            ...local,
            members: local.members,
            memberPositions: normalizeMemberPositions(local.memberPositions, local.members),
            donors: normalizeDonorsArray(local.donors),
            settlementResetAt: local.settlementResetAt,
            updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
          },
          didPreserve: true,
        };
      }
      return {
        merged: {
          ...incoming,
          donors: normalizeDonorsArray(incoming.donors),
        },
        didPreserve: false,
      };
    }
    if (Date.now() < settlementResetUntilRef.current) {
      const localDonorsNorm = normalizeDonorsArray(local.donors);
      const incomingDonorsNorm = normalizeDonorsArray(incoming.donors);
      const localCleared =
        localDonorsNorm.length === 0 &&
        (totalCombined(local) === 0 ||
          local.members.every(
            (m) =>
              Math.max(0, Math.floor(Number(m.account || 0))) === 0 &&
              Math.max(0, Math.floor(Number(m.toon || 0))) === 0
          ));
      if (localCleared && (incomingDonorsNorm.length > 0 || totalCombined(incoming) > 0)) {
        /** 정산 리셋 직후에만 구 후원(at < reset) 재유입을 막음. 서버에 아직 남은 실후원은 복구 */
        const preResetDonorsOnly =
          localResetAt > 0 &&
          filterDonorsAfterSettlementReset(incomingDonorsNorm, localResetAt).length === 0;
        if (preResetDonorsOnly) {
          const restored = resolveServerDonorsForEmptyLocal({
            local,
            incomingDonors: incomingDonorsNorm,
            settlementResetAt: Math.max(localResetAt, remoteResetAt),
          });
          if (restored && restored.length > 0) {
            const rosterMembers = local.members?.length ? local.members : incoming.members;
            return {
              merged: syncMemberTotalsFromDonors({
                ...incoming,
                ...local,
                members: rosterMembers,
                memberPositions: normalizeMemberPositions(
                  local.memberPositions ?? incoming.memberPositions,
                  rosterMembers
                ),
                donors: restored,
                settlementResetAt: Math.max(localResetAt, remoteResetAt) || undefined,
                updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
              }),
              didPreserve: false,
            };
          }
          const piped = pickAuthoritativeDonorsForEmptySession(
            local,
            incomingDonorsNorm,
            undefined,
            Math.max(localResetAt, remoteResetAt)
          );
          if (piped.length > 0) {
            const rosterMembers = local.members?.length ? local.members : incoming.members;
            return {
              merged: syncMemberTotalsFromDonors({
                ...incoming,
                ...local,
                members: rosterMembers,
                memberPositions: normalizeMemberPositions(
                  local.memberPositions ?? incoming.memberPositions,
                  rosterMembers
                ),
                donors: piped,
                settlementResetAt: Math.max(localResetAt, remoteResetAt) || undefined,
                updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
              }),
              didPreserve: false,
            };
          }
          const forcedResetAt = Math.max(localResetAt, remoteResetAt);
          const forcedDonors = applySettlementResetDonorPipeline(
            rebumpDonorsPastSettlementReset(incomingDonorsNorm, forcedResetAt),
            forcedResetAt
          );
          if (forcedDonors.length > 0) {
            const rosterMembers = local.members?.length ? local.members : incoming.members;
            return {
              merged: syncMemberTotalsFromDonors({
                ...incoming,
                ...local,
                members: rosterMembers,
                memberPositions: normalizeMemberPositions(
                  local.memberPositions ?? incoming.memberPositions,
                  rosterMembers
                ),
                donors: forcedDonors,
                settlementResetAt: forcedResetAt || undefined,
                updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
              }),
              didPreserve: false,
            };
          }
          return {
            merged: {
              ...incoming,
              ...local,
              members: local.members,
              memberPositions: normalizeMemberPositions(local.memberPositions, local.members),
              donors: [],
              mealBattle: local.mealBattle ?? incoming.mealBattle,
              overlayPresets: local.overlayPresets ?? incoming.overlayPresets,
              missions: local.missions ?? incoming.missions,
              updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
            },
            didPreserve: true,
          };
        }
        const rosterMembers = local.members?.length ? local.members : incoming.members;
        return {
          merged: syncMemberTotalsFromDonors({
            ...incoming,
            members: rosterMembers,
            memberPositions: normalizeMemberPositions(
              local.memberPositions ?? incoming.memberPositions,
              rosterMembers
            ),
            donors: incomingDonorsNorm,
            mealBattle: local.mealBattle ?? incoming.mealBattle,
            overlayPresets: local.overlayPresets ?? incoming.overlayPresets,
            missions: local.missions ?? incoming.missions,
            updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
          }),
          didPreserve: false,
        };
      }
    }
    const incomingDefaultLike = isDefaultLikeState(incoming);
    const incomingPlaceholderMembers = isDefaultPlaceholderMemberList(incoming.members);
    const localHasData = hasMeaningfulBroadcastData(local);
    // 서버가 초기 멤버 슬롯(멤버1·2·3 등)만 있으면 로컬 멤버 구성을 유지한다.
    if ((incomingDefaultLike || incomingPlaceholderMembers) && localHasData) {
      const incomingDonorsNorm = normalizeDonorsArray(incoming.donors);
      const localDonorsNorm = normalizeDonorsArray(local.donors);
      let merged: AppState = {
        ...incoming,
        ...local,
        members: local.members,
        memberPositions: normalizeMemberPositions(local.memberPositions, local.members),
        updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
      };
      if (localDonorsNorm.length === 0 && incomingDonorsNorm.length > 0) {
        merged = syncMemberTotalsFromDonors({ ...merged, donors: incomingDonorsNorm });
      } else {
        merged = { ...merged, donors: normalizeDonorsArray(merged.donors) };
      }
      return {
        merged,
        didPreserve: true,
      };
    }

    /**
     * 멤버 추가·삭제 직후: 서버/다른 탭이 옛 실멤버 로스터를 주더라도
     * 로컬이 상위집합이거나 stamp가 같거나 더 최신이면 로컬 멤버 구성을 유지한다.
     * 보호창 안에서는 서버 stamp가 살짝 앞서도(테마 PATCH 등) 로컬 로스터를 지킨다.
     */
    const inMembersAuthWindow = Date.now() < membersAuthoritativeSaveUntilRef.current;
    const localAt = Number(local.updatedAt || 0);
    const incomingAt = Number(incoming.updatedAt || 0);
    const localIsSuperset =
      isMemberRosterStrictSuperset(local.members, incoming.members) &&
      (inMembersAuthWindow || localAt >= incomingAt || localAt + 120_000 >= incomingAt);
    const preferLocalMemberRoster =
      Array.isArray(incoming.members) &&
      membersDifferByIds(local.members || [], incoming.members || []) &&
      (local.members || []).length > 0 &&
      (localIsSuperset ||
        (hasMeaningfulMemberRoster(local) &&
          (localAt >= incomingAt ||
            (inMembersAuthWindow &&
              (local.members || []).length >= (incoming.members || []).length))));

    let merged: AppState = preferLocalMemberRoster
      ? {
          ...incoming,
          members: local.members,
          memberPositions: normalizeMemberPositions(local.memberPositions, local.members),
          rankPositionLabels: local.rankPositionLabels ?? incoming.rankPositionLabels,
          updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
        }
      : incoming;
    let didPreserve = preferLocalMemberRoster;
    const nameOnlyLocalNewer =
      !membersDifferByIds(local.members || [], incoming.members || []) &&
      inMembersAuthWindow &&
      (local.members || []).some((lm) => {
        const im = (incoming.members || []).find((m) => m.id === lm.id);
        return im && String(lm.name || "").trim() !== String(im.name || "").trim();
      });
    if (nameOnlyLocalNewer) {
      merged = {
        ...merged,
        members: mergeManualMemberFieldsFromPatch(merged.members || [], local.members),
        ...(normalizeDonorsArray(local.donors).length >= normalizeDonorsArray(merged.donors).length
          ? { donors: normalizeDonorsArray(local.donors) }
          : {}),
        highSocietySettings: local.highSocietySettings ?? merged.highSocietySettings,
        updatedAt: Math.max(incoming.updatedAt || 0, local.updatedAt || 0) || Date.now(),
      };
      didPreserve = true;
    }
    if (!incoming.missions?.length && local.missions?.length) {
      merged = { ...merged, missions: local.missions };
      didPreserve = true;
    }
    if (!incoming.overlayPresets?.length && local.overlayPresets?.length) {
      merged = { ...merged, overlayPresets: local.overlayPresets };
      didPreserve = true;
    }
    const incomingOverlaySettingsEmpty =
      !incoming.overlaySettings || Object.keys(incoming.overlaySettings).length === 0;
    const localOverlaySettingsHasData =
      !!local.overlaySettings && Object.keys(local.overlaySettings).length > 0;
    if (incomingOverlaySettingsEmpty && localOverlaySettingsHasData) {
      merged = { ...merged, overlaySettings: local.overlaySettings };
      didPreserve = true;
    }
    const incomingRollingItems = getUnifiedSigRollingItems(incoming);
    const localRollingItems = getUnifiedSigRollingItems(local);
    if (localRollingItems.length > 0 && incomingRollingItems.length === 0) {
      merged = {
        ...merged,
        sigRolling: local.sigRolling,
        sigRollingMeta: local.sigRollingMeta ?? {},
      };
      didPreserve = true;
    }
    /** 저장 대기·직후 편집 구간: 서버 GET이 신규 시그를 아직 안 담았을 때 목록이 사라지지 않게 */
    const recentlyEditedSig =
      Date.now() - lastLocalPersistAtRef.current < SIG_INVENTORY_LOCAL_PROTECT_MS;
    const localInv = local.sigInventory || [];
    const incomingInv = merged.sigInventory || [];
    if (pendingUnsyncedRef.current || recentlyEditedSig) {
      const incomingIdSet = new Set(incomingInv.map((x) => x.id));
      const hasLocalOnlyRows = localInv.some((x) => !incomingIdSet.has(x.id));
      const localSigIds = localInv.map((x) => x.id).join(",");
      const incomingSigIds = incomingInv.map((x) => x.id).join(",");
      if (hasLocalOnlyRows || localSigIds !== incomingSigIds) {
        merged = { ...merged, sigInventory: localInv };
        didPreserve = true;
      }
    } else if (
      shouldPreferLocalSigInventoryOverIncoming(localInv, incomingInv, {
        localUpdatedAt: local.updatedAt,
        incomingUpdatedAt: merged.updatedAt ?? incoming.updatedAt,
      })
    ) {
      /** 서버 재시작·기본 목록·구버전 탭 저장 후 GET이 줄어든 목록을 줄 때 로컬 백업 유지 */
      merged = { ...merged, sigInventory: localInv };
      didPreserve = true;
    }
    if (
      hasSigSalesMemberPresets(local.sigSalesMemberPresets) &&
      !hasSigSalesMemberPresets(merged.sigSalesMemberPresets)
    ) {
      merged = { ...merged, sigSalesMemberPresets: local.sigSalesMemberPresets };
      didPreserve = true;
    }
    /**
     * 시그 대전 수동 보정(sigMatch): 저장 직후 GET/SSE가 구 보정값으로 덮어 0원이 되지 않게.
     * 보호창에서는 로컬이 같거나 더 최신·더 풍부하면 유지, 밖에서는 updatedAt fresher 병합.
     */
    {
      const recentlyEditedSigMatch =
        pendingUnsyncedRef.current ||
        Date.now() - lastLocalPersistAtRef.current < SIG_INVENTORY_LOCAL_PROTECT_MS;
      const localSm =
        local.sigMatch && typeof local.sigMatch === "object" ? { ...local.sigMatch } : {};
      const incomingSm =
        merged.sigMatch && typeof merged.sigMatch === "object" ? { ...merged.sigMatch } : {};
      const sigMatchSame =
        Object.keys(localSm).length === Object.keys(incomingSm).length &&
        Object.keys(localSm).every(
          (k) => Number(localSm[k] || 0) === Number(incomingSm[k] || 0)
        );
      const localSigSum = Object.values(localSm).reduce(
        (s, v) => s + Math.abs(Number(v) || 0),
        0
      );
      const incomingSigSum = Object.values(incomingSm).reduce(
        (s, v) => s + Math.abs(Number(v) || 0),
        0
      );
      const localAt = Number(local.updatedAt || 0);
      const incomingAt = Number(merged.updatedAt || incoming.updatedAt || 0);
      if (recentlyEditedSigMatch && !sigMatchSame) {
        if (localAt >= incomingAt || localSigSum > incomingSigSum) {
          merged = { ...merged, sigMatch: localSm };
          didPreserve = true;
        }
      } else if (!sigMatchSame) {
        const withFresher = mergeSigMatchPreferFresherLocal(merged, local);
        if (withFresher !== merged) {
          merged = withFresher;
          didPreserve = true;
        }
      }
    }
    /** 후원순위 테마: 원격이 기본값인데 로컬이 커스텀이면 유지(테마 PATCH 경합·미저장 GET으로 리셋 방지) */
    if (
      !isDefaultLikeDonorRankingsTheme(local.donorRankingsTheme) &&
      isDefaultLikeDonorRankingsTheme(merged.donorRankingsTheme)
    ) {
      merged = { ...merged, donorRankingsTheme: local.donorRankingsTheme };
      didPreserve = true;
    }
    if (
      (pendingUnsyncedRef.current || Date.now() - lastLocalPersistAtRef.current < 8000) &&
      local.donorRankingsTheme &&
      !isDefaultLikeDonorRankingsTheme(local.donorRankingsTheme)
    ) {
      merged = { ...merged, donorRankingsTheme: local.donorRankingsTheme };
      didPreserve = true;
    }
    if (
      isDefaultLikeOverlayPresets(merged.overlayPresets) &&
      !isDefaultLikeOverlayPresets(local.overlayPresets)
    ) {
      merged = { ...merged, overlayPresets: local.overlayPresets };
      didPreserve = true;
    }
    /** 엑셀표 프리셋: 저장 직후 GET/SSE가 구 색·글꼴로 덮지 않게 로컬 우선 병합 */
    if (
      (pendingUnsyncedRef.current || Date.now() - lastLocalPersistAtRef.current < 8000) &&
      Array.isArray(local.overlayPresets) &&
      local.overlayPresets.length > 0 &&
      Array.isArray(merged.overlayPresets) &&
      merged.overlayPresets.length > 0
    ) {
      merged = {
        ...merged,
        overlayPresets: mergeOverlayPresetsPreferLocal(
          merged.overlayPresets as OverlayPresetLike[],
          local.overlayPresets as OverlayPresetLike[]
        ) as AppState["overlayPresets"],
      };
      didPreserve = true;
    }
    /** 타이머 표시 색: 원격이 기본(빈 색)인데 로컬이 커스텀이면 유지 */
    if (
      hasCustomTimerDisplayStyles(local.timerDisplayStyles) &&
      isDefaultLikeTimerDisplayStyle(merged.timerDisplayStyles?.general)
    ) {
      merged = { ...merged, timerDisplayStyles: local.timerDisplayStyles };
      didPreserve = true;
    }
    if (
      (pendingUnsyncedRef.current || Date.now() - lastLocalPersistAtRef.current < 8000) &&
      hasCustomTimerDisplayStyles(local.timerDisplayStyles)
    ) {
      merged = { ...merged, timerDisplayStyles: local.timerDisplayStyles };
      didPreserve = true;
    }
    /** 판매완료 도장: 빈 원격·업로드 직후 GET이 커스텀 URL을 지우지 않음 */
    {
      const localStamp = String(local.sigSoldOutStampUrl || "").trim();
      const mergedStamp = String(merged.sigSoldOutStampUrl || "").trim();
      const recentlyEditedStamp =
        pendingUnsyncedRef.current ||
        Date.now() - lastLocalPersistAtRef.current < SIG_INVENTORY_LOCAL_PROTECT_MS;
      if (
        localStamp &&
        (!mergedStamp || (recentlyEditedStamp && localStamp !== mergedStamp))
      ) {
        merged = { ...merged, sigSoldOutStampUrl: local.sigSoldOutStampUrl };
        didPreserve = true;
      }
    }
    /** 시그 롤링 표시 시간: 방금 저장한 로컬 값이 원격 기본/구값으로 덮이지 않게 */
    {
      const localHold = normalizeSigRolling(local.sigRolling).staticHoldMs;
      const remoteHold = normalizeSigRolling(merged.sigRolling).staticHoldMs;
      if (
        localHold > 0 &&
        localHold !== remoteHold &&
        (pendingUnsyncedRef.current || Date.now() - lastLocalPersistAtRef.current < 12000)
      ) {
        merged = {
          ...merged,
          sigRolling: {
            ...normalizeSigRolling(merged.sigRolling),
            staticHoldMs: localHold,
            fadeMs: normalizeSigRolling(local.sigRolling).fadeMs,
          },
        };
        didPreserve = true;
      }
    }
    if (
      Array.isArray(local.donorRankingsPresets) &&
      local.donorRankingsPresets.length > 0 &&
      (!Array.isArray(merged.donorRankingsPresets) || merged.donorRankingsPresets.length === 0)
    ) {
      merged = {
        ...merged,
        donorRankingsPresets: local.donorRankingsPresets,
        donorRankingsPresetId: local.donorRankingsPresetId ?? merged.donorRankingsPresetId,
      };
      didPreserve = true;
    }
    /** 상류사회: 시그 후원 연동·테마 PATCH 직후 GET/SSE가 enabled·영토 이력을 기본값으로 덮지 않게 */
    if (
      isMeaningfulHighSocietySettings(local.highSocietySettings) &&
      shouldBlockHighSocietyRegression(local.highSocietySettings, merged.highSocietySettings)
    ) {
      merged = { ...merged, highSocietySettings: local.highSocietySettings };
      didPreserve = true;
    } else if (
      (pendingUnsyncedRef.current || Date.now() - lastLocalPersistAtRef.current < 8000) &&
      isMeaningfulHighSocietySettings(local.highSocietySettings)
    ) {
      merged = { ...merged, highSocietySettings: local.highSocietySettings };
      didPreserve = true;
    }
    const localTerritoryLogs = normalizeTerritoryLogs(local.territoryLogs);
    const mergedTerritoryLogs = normalizeTerritoryLogs(merged.territoryLogs);
    const territoryLogsDiff =
      JSON.stringify(localTerritoryLogs) !== JSON.stringify(mergedTerritoryLogs);
    const localTerritoryNewer =
      Number(local.updatedAt || 0) >= Number(incoming.updatedAt || 0);
    if (
      territoryLogsDiff &&
      localTerritoryNewer &&
      (localTerritoryLogs.length > 0 ||
        localTerritoryLogs.length < mergedTerritoryLogs.length)
    ) {
      merged = { ...merged, territoryLogs: localTerritoryLogs };
      didPreserve = true;
    }
    const localDonorsNorm = normalizeDonorsArray(local.donors);
    const incomingDonorsNorm = normalizeDonorsArray(merged.donors);
    const localIdSet = new Set(localDonorsNorm.map((d) => d.id));
    const incomingIdSet = new Set(incomingDonorsNorm.map((d) => d.id));
    const remoteOnlyCount = incomingDonorsNorm.filter((d) => !localIdSet.has(d.id)).length;
    const localOnlyCount = localDonorsNorm.filter((d) => !incomingIdSet.has(d.id)).length;
    const donorsFieldDiff = donorsListContentDiffers(localDonorsNorm, incomingDonorsNorm);
    /**
     * 투네 SSE/폴링이 수동 계좌를 덮지 않게 — 정산 리셋·의도적 삭제가 아니면 항상 union.
     * (보호창 밖에서도 localOnly 수동 후원을 버리면 엑셀·리스트에서 사라짐)
     * 동일 id만 있어도 memberId·메시지 등이 다르면 union(재배치·편집 반영).
     */
    if (localOnlyCount > 0 || remoteOnlyCount > 0 || donorsFieldDiff) {
      const localDeleteShrink =
        localDonorsNorm.length < incomingDonorsNorm.length &&
        localDonorsNorm.length >= 0 &&
        isIntentionalDonorListShrink(
          localDonorsNorm,
          incomingDonorsNorm,
          Number(local.updatedAt || 0),
          Number(incoming.updatedAt || 0)
        );
      const intentionalShrink =
        remoteOnlyCount === 0 &&
        isIntentionalDonorListShrink(
          incomingDonorsNorm,
          localDonorsNorm,
          Number(incoming.updatedAt || 0),
          Number(local.updatedAt || 0)
        );
      if (localDeleteShrink) {
        merged = {
          ...merged,
          donors: localDonorsNorm,
        };
        didPreserve = true;
      } else if (intentionalShrink) {
        merged = {
          ...merged,
          donors: incomingDonorsNorm,
          members: merged.members,
        };
      } else {
        const union = mergeDonorsForMultiTabSave(incomingDonorsNorm, localDonorsNorm, {
          incomingUpdatedAt: incoming.updatedAt,
          existingUpdatedAt: local.updatedAt,
        });
        merged = {
          ...merged,
          donors: union,
        };
        if (localOnlyCount > 0) didPreserve = true;
        else if (donorsFieldDiff && local.updatedAt >= Number(incoming.updatedAt || 0)) didPreserve = true;
      }
    }
    merged = {
      ...merged,
      generalTimer: mergeGeneralTimerPreferEffective(local.generalTimer, merged.generalTimer),
      matchTimer: mergeGeneralTimerPreferEffective(
        local.matchTimer ?? local.generalTimer,
        merged.matchTimer ?? merged.generalTimer
      ),
    };
    const donorsNorm = normalizeDonorsArray(merged.donors);
    /** 폴링·테마 PATCH 직후 빈/축소 원격이 union 을 통과한 경우 최종 안전망 */
    if (
      localDonorsNorm.length > 0 &&
      donorsNorm.length === 0 &&
      remoteResetAt <= localResetAt
    ) {
      merged = syncMemberTotalsFromDonors({ ...merged, donors: localDonorsNorm });
      didPreserve = true;
    } else if (localDonorsNorm.length === 0 && donorsNorm.length === 0 && incomingDonorsNorm.length > 0) {
      const restored = resolveServerDonorsForEmptyLocal({
        local,
        incomingDonors: incomingDonorsNorm,
        settlementResetAt: Math.max(localResetAt, remoteResetAt),
      });
      if (restored && restored.length > 0) {
        merged = syncMemberTotalsFromDonors({ ...merged, donors: restored });
        didPreserve = false;
      }
    } else if (wouldShrinkDonationData(local, merged) && localDonorsNorm.length > 0) {
      const union = mergeDonorsForMultiTabSave(donorsNorm, localDonorsNorm, {
        incomingUpdatedAt: Number(merged.updatedAt ?? incoming.updatedAt ?? 0),
        existingUpdatedAt: Number(local.updatedAt || 0),
      });
      merged = syncMemberTotalsFromDonors({ ...merged, donors: union });
      didPreserve = true;
    }
    /** 원격 후원 수용 후 엑셀 금액이 로컬 멤버 합계에 묶이지 않게 donors 기준 재계산.
     * 단, 후원 없이 멤버 금액만 보존한 경우에는 sync가 0으로 되돌리지 않게 한다. */
    const preservedTotalsWithoutDonors =
      didPreserve && donorsNorm.length === 0 && totalCombined(merged) > 0;
    const synced = preservedTotalsWithoutDonors
      ? { ...merged, donors: donorsNorm }
      : syncMemberTotalsFromDonors({ ...merged, donors: donorsNorm });
    return {
      merged: guardMemberTotalsAgainstAccidentalZeroWipe(synced, local),
      didPreserve,
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    setSyncStatus("loading");
    const hydrateWatchdog = window.setTimeout(() => {
      if (!cancelled && syncStatusRef.current === "loading") {
        const offlineNow = typeof navigator !== "undefined" && !navigator.onLine;
        setSyncStatus(offlineNow ? "local" : "error");
      }
    }, 28_000);
    const offline = typeof navigator !== "undefined" && !navigator.onLine;
    let localPresets: OverlayPreset[] = [];
    try {
      const raw =
        migrateLegacyLocalStorageKey("excel-broadcast-overlay-presets", presetStorageKey) ||
        window.localStorage.getItem(presetStorageKey);
      if (raw) localPresets = JSON.parse(raw) as OverlayPreset[];
    } catch {}
    if (offline) {
      /** 오프라인: 같은 탭 세션 캐시만 조회용. 정본은 서버 — 편집은 온라인 복구 후 persistState 로 저장 */
      const sessionSnap = loadState(user.id);
      setState(sessionSnap);
      if (Array.isArray(sessionSnap.overlayPresets) && sessionSnap.overlayPresets.length > 0) {
        setPresets(sessionSnap.overlayPresets as OverlayPreset[]);
      } else if (localPresets.length > 0) {
        setPresets(localPresets);
      }
      setSyncStatus("local");
    }
    /** 서버 정본 모드: API 응답 전 로컬/세션 스냅샷으로 멤버·후원을 채우지 않음 (admin 은 보기·편집 도구) */
    // 우선 서버의 일일 로그를 소스로 사용(장치 간 일관성)
    loadDailyLogFromApi(user?.id).then((serverLog) => {
      setDailyLog(serverLog);
      try { window.localStorage.setItem(dailyLogStorageKey(user?.id), JSON.stringify(serverLog)); } catch {}
    }).catch(() => {
      setDailyLog(loadDailyLog(user?.id));
    });
    void refreshStorageHealth();
    void loadStateFromApi(user.id, { forceFull: true })
      .then((apiState) => {
      if (cancelled) return;
      try {
      /** 후원·금액·멤버는 계정 서버 정본만. admin React state 는 서버 스냅샷의 편집 뷰. */
      const fromLs = loadState(user.id);
      const fromRef = stateRef.current;
      const localMembers = pickMemberRosterPreferNewer(fromRef, fromLs);
      const localBase =
        Number(fromRef.updatedAt || 0) >= Number(fromLs.updatedAt || 0) ? fromRef : fromLs;
      const local: AppState = {
        ...localBase,
        members: localMembers,
        memberPositions: normalizeMemberPositions(
          isMemberRosterStrictSuperset(localMembers, fromLs.members)
            ? fromRef.memberPositions ?? fromLs.memberPositions
            : localBase.memberPositions,
          localMembers
        ),
        updatedAt: Math.max(Number(fromRef.updatedAt || 0), Number(fromLs.updatedAt || 0)),
      };
      if (apiState) {
        /**
         * 서버가 멤버1…/빈 후원으로 앞서 있어도 LS 실데이터를 유지하고,
         * 아래 heal 로 서버에도 다시 올려 다음 hydrate 에서 유실되지 않게 한다.
         */
        const blockedAccidentalEmpty = shouldBlockAccidentalEmptyOverwrite(local, apiState);
        const sessionDonationEmpty = isEmptyBroadcastDonationSession(local);
        const rejectPoorer =
          !sessionDonationEmpty &&
          (blockedAccidentalEmpty || shouldRejectPoorerDonationRemote(local, apiState));
        stateUpdatedAtRef.current = rejectPoorer
          ? Math.max(Number(local.updatedAt || 0), Number(apiState.updatedAt || 0))
          : apiState.updatedAt || 0;
        lastAppliedRemoteUpdatedAtRef.current = stateUpdatedAtRef.current;
        const { merged, didPreserve } = mergeIncomingStateSafely(apiState, local);
        const donationSource = rejectPoorer ? local : apiState;
        /** 후원 금액은 donationSource, 멤버 로스터는 merge(로컬 최신 추가 보존) 우선 */
        let rosterMembers = rejectPoorer
          ? pickMemberRosterPreferNewer(local, apiState)
          : pickMemberRosterPreferNewer(merged, apiState);
        /** API가 멤버1 플레이스홀더인데 LS에 실멤버가 있으면 LS 로스터 유지 */
        if (
          isDefaultPlaceholderMemberList(rosterMembers) &&
          hasMeaningfulMemberRoster(local)
        ) {
          rosterMembers = local.members;
        }
        /**
         * 새로고침 복구: LS가 서버보다 멤버가 많은 상위집합이면 stamp와 무관하게 LS 유지.
         * (추가 직후 비권한 PATCH 로 서버만 짧아진 뒤 새로고침해도 추가분 복구)
         */
        if (isMemberRosterStrictSuperset(local.members, apiState.members)) {
          rosterMembers = local.members;
        }
        const rosterFromLocal =
          hasMeaningfulMemberRoster(local) &&
          !membersDifferByIds(rosterMembers, local.members || []);
        const rosterPositions = rosterFromLocal
          ? local.memberPositions ?? merged.memberPositions ?? apiState.memberPositions
          : rejectPoorer
            ? local.memberPositions ?? merged.memberPositions ?? apiState.memberPositions
            : merged.memberPositions ?? apiState.memberPositions;
        const resetAtForDonors = Math.max(
          Number(local.settlementResetAt || 0),
          Number(apiState.settlementResetAt || 0)
        );
        const localDonorCount = normalizeDonorsArray(local.donors).length;
        const apiDonorCount = normalizeDonorsArray(apiState.donors).length;
        const preferServerDonors =
          isEmptyBroadcastDonationSession(local) || localDonorCount < apiDonorCount;
        const donorsForApply = preferServerDonors
          ? pickAuthoritativeDonorsForEmptySession(
              local,
              apiState.donors,
              merged.donors,
              resetAtForDonors
            )
          : normalizeDonorsArray(donationSource.donors);
        const donorsResolved =
          donorsForApply.length === 0 && apiDonorCount > 0
            ? normalizeDonorsArray(
                buildUiStateFromServerDonorPull(local, apiState)?.donors ?? apiState.donors
              )
            : donorsForApply;
        const rosterPayload: AppState = {
          ...merged,
          donors: donorsResolved,
          members: rosterMembers,
          memberPositions: normalizeMemberPositions(rosterPositions, rosterMembers),
          contributionLogs: rejectPoorer
            ? local.contributionLogs ?? apiState.contributionLogs
            : apiState.contributionLogs,
          restroomLogs: rejectPoorer
            ? local.restroomLogs ?? apiState.restroomLogs
            : apiState.restroomLogs,
          settlementResetAt: blockedAccidentalEmpty
            ? local.settlementResetAt
            : Math.max(
                Number(local.settlementResetAt || 0),
                Number(apiState.settlementResetAt || 0)
              ),
          sigSoldOutStampUrl:
            String(apiState.sigSoldOutStampUrl || "").trim() ||
            String(merged.sigSoldOutStampUrl || "").trim() ||
            String(local.sigSoldOutStampUrl || "").trim() ||
            "",
        };
        /** donors 비었을 때 sync 하면 멤버 합계만 0으로 깎임 — 고아 상태는 baseline 유지 */
        const toApplyBase =
          donorsResolved.length > 0
            ? syncMemberTotalsFromDonors(rosterPayload)
            : guardMemberTotalsAgainstAccidentalZeroWipe(rosterPayload, local);
        /** 타이머 제어 UI가 비어 보이면 프리셋에 저장된 색으로 채움 */
        let toApply = toApplyBase;
        if (!hasCustomTimerDisplayStyles(toApply.timerDisplayStyles)) {
          const presetWithTimer = (
            Array.isArray(toApply.overlayPresets) ? (toApply.overlayPresets as OverlayPreset[]) : []
          ).find(
            (p) =>
              p?.showTimer &&
              (String(p.timerFontColor || "").trim() ||
                String(p.timerBgColor || "").trim() ||
                String(p.timerBorderColor || "").trim() ||
                String(p.timerBgOpacity || "").trim() === "0" ||
                isHiddenTimerDisplayStyle({
                  bgColor: String(p.timerBgColor || ""),
                  borderColor: String(p.timerBorderColor || ""),
                  bgOpacity: Math.max(
                    0,
                    Math.min(100, parseInt(String(p.timerBgOpacity || "40"), 10) || 40)
                  ),
                }))
          );
          if (presetWithTimer) {
            toApply = {
              ...toApply,
              timerDisplayStyles: {
                general: {
                  showHours: Boolean(presetWithTimer.timerShowHours),
                  fontFamily: normalizeTimerFontFamily(presetWithTimer.timerFontFamily || "mono"),
                  fontColor: String(presetWithTimer.timerFontColor || ""),
                  bgColor: String(presetWithTimer.timerBgColor || ""),
                  borderColor: String(presetWithTimer.timerBorderColor || ""),
                  outlineColor: String(presetWithTimer.timerOutlineColor || ""),
                  outlineWidth: (() => {
                    const n = parseFloat(String(presetWithTimer.timerOutlineWidth ?? "0.8"));
                    return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0.8;
                  })(),
                  bgOpacity: Math.max(
                    0,
                    Math.min(100, parseInt(String(presetWithTimer.timerBgOpacity || "40"), 10) || 40)
                  ),
                  scalePercent: Math.max(
                    50,
                    Math.min(250, parseInt(String(presetWithTimer.timerScale || "100"), 10) || 100)
                  ),
                },
              },
            };
          }
        }
        /** 같은 id(m1)에서 원격 멤버1이 로컬 실명을 덮지 않게 */
        toApply = mergeLocalMemberIdentityOntoRemote(toApply, local);
        const rosterNeedsServerPush =
          hasMeaningfulMemberRoster(toApply) &&
          (membersDifferByIds(toApply.members || [], apiState.members || []) ||
            isDefaultPlaceholderMemberList(apiState.members));
        if (didPreserve && !rejectPoorer) {
          /** 테마·시그 등만 보존 — 후원 필드는 서버 값 유지(LS로 서버에 밀어 올리지 않음).
           * 멤버 추가·삭제로 로스터만 보존된 경우는 서버에도 권위적으로 올려 새로고침 유실을 막음. */
          persistState(toApply, {
            omitDonationFields: true,
            ...(rosterNeedsServerPush ? { membersAuthoritative: true } : {}),
          });
        } else if (rosterNeedsServerPush && !rejectPoorer) {
          /** API 플레이스홀더·옛 로스터를 LS 실멤버로 고친 경우 서버에 재푸시 */
          persistState(toApply, {
            omitDonationFields: true,
            membersAuthoritative: true,
          });
        }
        if (rejectPoorer) {
          /** 로컬이 서버 GET보다 풍부해 보여도 브라우저→DB 푸시 금지 — UI만 로컬 병합본 표시 */
          donationAuthoritativeSaveUntilRef.current = Date.now() + 20_000;
          lastEmptyRemoteDonationHealAtRef.current = Date.now();
        }
        const serverInv = toApply.sigInventory || [];
        if (
          !didPreserve &&
          !hasExpandedSigInventory(local.sigInventory) &&
          isShrunkToDefaultSigInventory(serverInv)
        ) {
          setSigExcelResult(
            "서버에 커스텀 시그 목록이 없습니다(기본 8개만). 기존 PC에서 관리자를 열어 동기화하거나, JSON·엑셀 백업으로 복구하세요."
          );
        }
        setState(toApply);
        if (user?.id) hydrateSettlementUiFromAppState(toApply, user.id);
        try {
          cacheBroadcastStateSnapshot(toApply, user?.id);
        } catch {}
        if (Array.isArray(toApply.overlayPresets) && toApply.overlayPresets.length > 0) {
          setPresets(toApply.overlayPresets as OverlayPreset[]);
          /** 커스텀 테마 캐시가 있어도 자동 적용하지 않음 — maybePromptThemeRestore가 사용자 확인 후 복구 */
        } else if (localPresets.length > 0) {
          const next = { ...toApply, overlayPresets: localPresets, updatedAt: Date.now() };
          setState(next);
          setPresets(localPresets);
          stateRef.current = next;
          /** 전체 persist 금지 — 테마/프리셋만 PATCH (후원·금액 유지) */
          saveOverlayPresetsPatchAsync(localPresets, user?.id, { foundation: next }).then((r) => {
            if (r.ok) setSyncStatus(r.storageFallback ? "error" : "synced");
          });
        } else {
          const first = defaultPreset("전체 통합", { showMembers: true, showTotal: true });
          const mergedPresets = { ...toApply, overlayPresets: [first] };
          setPresets([first]);
          setState(mergedPresets);
          stateRef.current = mergedPresets;
          /** 기본 프리셋은 UI·캐시에만 두고, 사용자 요청 없이 서버 전체 저장하지 않음 */
          try { window.localStorage.setItem(presetStorageKey, JSON.stringify([first])); } catch {}
        }
        setSyncStatus("synced");
      } else if (!offline) {
        if (Array.isArray(local.overlayPresets) && local.overlayPresets.length > 0) {
          setPresets(local.overlayPresets as OverlayPreset[]);
        } else if (localPresets.length > 0) {
          local.overlayPresets = localPresets;
          setPresets(localPresets);
        } else {
          const first = defaultPreset("전체 통합", { showMembers: true, showTotal: true });
          local.overlayPresets = [first];
          setPresets([first]);
          try { window.localStorage.setItem(presetStorageKey, JSON.stringify([first])); } catch {}
        }
        setState(local);
        setSyncStatus("error");
        /** 서버 로드 실패 시 LS 후원을 계정에 밀어 올리지 않음 */
        const hasMeaningfulData = hasMeaningfulBroadcastData(local);
        const hasDonationData =
          normalizeDonorsArray(local.donors).length > 0 || totalCombined(local) > 0;
        if (hasMeaningfulData && !hasDonationData) {
          saveStateAsync(local, user?.id, { omitDonationFields: true }).then((r) => {
            if (r.ok) setSyncStatus("synced");
          });
        }
      }
      } catch {
        if (!cancelled) {
          const offlineNow = typeof navigator !== "undefined" && !navigator.onLine;
          setSyncStatus(offlineNow ? "local" : "error");
        }
      }
    })
    .catch(() => {
      if (cancelled) return;
      const offlineNow = typeof navigator !== "undefined" && !navigator.onLine;
      setSyncStatus(offlineNow ? "local" : "error");
    });
    return () => {
      cancelled = true;
      window.clearTimeout(hydrateWatchdog);
    };
  }, [user?.id, persistState, mergeIncomingStateSafely, presetStorageKey, hydrateSettlementUiFromAppState, refreshStorageHealth]);

  /** 일괄 반영으로 동일 초에 찍힌 후원 시각 — id·daily log로 복구 후 서버 저장 */
  useEffect(() => {
    if (!user) return;
    if (Date.now() < settlementSnapshotUntilRef.current) return;
    /** 삭제·persist 직후 repair→saveStateAsync 가 구 서버와 union 하며 엑셀표를 0으로 만들지 않게 */
    if (Date.now() < donationAuthoritativeSaveUntilRef.current) return;
    const raw = normalizeDonorsArray(stateRef.current.donors);
    if (raw.length === 0) return;
    const logKey = Object.keys(dailyLog).sort().join("|");
    const repairKey = `${raw.length}:${logKey}`;
    if (donorTimestampRepairKeyRef.current === repairKey) return;
    donorTimestampRepairKeyRef.current = repairKey;
    const repaired = repairDonorTimestamps(raw, { dailyLog });
    if (!donorTimestampsChanged(raw, repaired)) return;
    const resetAt = Number(stateRef.current.settlementResetAt || 0);
    const rebumped = rebumpDonorsPastSettlementReset(repaired, resetAt);
    const next = syncMemberTotalsFromDonors({
      ...stateRef.current,
      donors: rebumped,
      updatedAt: Date.now(),
    });
    setState(next);
    void persistDonationStateViaApi(user.id, next, "add");
  }, [user, dailyLog, state.donors]);

  /** 후원 0건 — LS·일일 로그·서버 백업에서 자동 복구 (한 세션 1회) */
  useEffect(() => {
    if (!user) return;
    if (autoOrphanDonorRestoreAttemptedRef.current) return;
    const donorsEmpty = normalizeDonorsArray(state.donors).length === 0;
    if (!donorsEmpty) return;
    autoOrphanDonorRestoreAttemptedRef.current = true;

    const tryDailyLogRestore = async () => {
      const serverLog = await loadDailyLogFromApi(user?.id);
      const mergedLog: Record<string, DailyLogEntry[]> = {
        ...loadDailyLog(user.id),
        ...serverLog,
      };
      const entry = pickDailyLogEntryForRestore(
        mergedLog,
        new Date().toISOString().slice(0, 10)
      );
      if (!entry || !Array.isArray(entry.donors) || entry.donors.length === 0) {
        return false;
      }
      const restored = buildAppStateFromDailyLogRestore(stateRef.current, entry);
      if (!restored) return false;
      setState(restored);
      donationAuthoritativeSaveUntilRef.current = Date.now() + 20_000;
      void persistDonationStateViaApi(user.id, restored, "add").then((r) => {
        if (r.ok) {
          setState(r.state);
          stateRef.current = r.state;
          setSyncStatus("synced");
        }
      });
      setSigExcelResult(
        `후원 목록이 비어 있어 일일 로그(${entry.at})에서 ${normalizeDonorsArray(restored.donors).length}건을 자동 복구했습니다.`
      );
      return true;
    };

    void (async () => {
      if (await tryDailyLogRestore()) return;
      try {
        const res = await fetch("/api/donations/restore-backup", {
          method: "POST",
          credentials: "include",
        });
        if (res.ok) {
          const body = (await res.json()) as { donorsCount?: number; total?: number };
          const remote = await loadStateFromApi(user.id, { forceFull: true });
          if (remote) {
            const { merged } = mergeIncomingStateSafely(remote, stateRef.current);
            setState(merged);
            stateRef.current = merged;
          }
          setSigExcelResult(
            `서버 후원 백업에서 ${body.donorsCount ?? "?"}건(합계 ${(body.total ?? 0).toLocaleString("ko-KR")}원)을 자동 복구했습니다.`
          );
        }
      } catch {
        /* noop */
      }
    })();
  }, [user, state.donors, dailyLog, mergeIncomingStateSafely]);

  const applyDonorsFromServerMainStateRef = useRef<
    (opts?: { silent?: boolean }) => Promise<boolean>
  >(async () => false);

  /** 서버에 donors 가 있는데 UI·LS만 비었을 때 강제 복구 (storage-health 불일치) */
  const applyDonorsFromServerMainState = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!user) return false;
      const remote = await loadStateFromApi(user.id, { forceFull: true });
      if (!remote) return false;
      const remoteDonors = normalizeDonorsArray(remote.donors);
      if (remoteDonors.length === 0) return false;
      const next = buildUiStateFromServerDonorPull(stateRef.current, remote);
      if (!next || normalizeDonorsArray(next.donors).length === 0) return false;
      setState(next);
      stateRef.current = next;
      stateUpdatedAtRef.current = next.updatedAt || 0;
      lastAppliedRemoteUpdatedAtRef.current = next.updatedAt || 0;
      pendingUnsyncedRef.current = false;
      donationAuthoritativeSaveUntilRef.current = Date.now() + 20_000;
      try {
        cacheBroadcastStateSnapshot(next, user.id);
      } catch {}
      notifyBroadcastStateLocalUpdated(user.id, next.updatedAt);
      void refreshStorageHealth();
      if (!opts?.silent) {
        setSigExcelResult(
          `서버 후원 ${remoteDonors.length}건을 화면에 복구했습니다 (합계 ${totalCombined(next).toLocaleString("ko-KR")}원).`
        );
      }
      return true;
    },
    [user, refreshStorageHealth]
  );
  applyDonorsFromServerMainStateRef.current = applyDonorsFromServerMainState;

  useEffect(() => {
    if (!user?.id) return;
    const id = window.setInterval(() => void refreshStorageHealth(), 45_000);
    return () => window.clearInterval(id);
  }, [user?.id, refreshStorageHealth]);

  useEffect(() => {
    if (!user) return;
    const serverCount = Number(storageHealth?.mainState?.donorsCount || 0);
    const localCount = normalizeDonorsArray(state.donors).length;
    if (serverCount > 0 && localCount >= serverCount) {
      serverDonorMismatchRestoreAttemptedRef.current = false;
    }
  }, [user, storageHealth, state.donors]);

  useEffect(() => {
    if (!user) return;
    const serverCount = Number(storageHealth?.mainState?.donorsCount || 0);
    const serverTotal = Number(storageHealth?.mainState?.totalCombined || 0);
    const localCount = normalizeDonorsArray(state.donors).length;
    const localTotal = totalCombined(state);
    const countMismatch = serverCount > 0 && localCount !== serverCount;
    const totalMismatch = serverTotal > 0 && localTotal + 500 < serverTotal;
    if (!countMismatch && !totalMismatch) return;
    if (serverDonorMismatchRestoreAttemptedRef.current) return;
    serverDonorMismatchRestoreAttemptedRef.current = true;
    void applyDonorsFromServerMainState({ silent: true }).then((ok) => {
      if (ok) {
        setSigExcelResult(
          `서버 후원 ${serverCount}건·화면 ${localCount}건 불일치를 자동 복구했습니다.`
        );
        return;
      }
      serverDonorMismatchRestoreAttemptedRef.current = false;
      window.setTimeout(() => {
        if (normalizeDonorsArray(stateRef.current.donors).length >= serverCount) return;
        void applyDonorsFromServerMainState({ silent: true });
      }, 1500);
    });
  }, [user, storageHealth, state.donors, applyDonorsFromServerMainState]);

  useEffect(() => {
    const id = window.setInterval(() => setTimerUiNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  /** 만료된 활성 타이머는 한 번 정지 — 타이머만 PATCH (전체 저장으로 후원 금액 초기화 금지) */
  useEffect(() => {
    const timers: Array<{ key: "generalTimer" | "matchTimer"; timer: TimerState | undefined }> = [
      { key: "generalTimer", timer: state.generalTimer },
      { key: "matchTimer", timer: state.matchTimer ?? state.generalTimer },
    ];
    for (const { key, timer: t } of timers) {
      if (!t?.isActive) continue;
      if (getEffectiveRemainingTime(t, timerUiNow) > 0) continue;
      setState((prev) => {
        const cur = key === "generalTimer" ? prev.generalTimer : prev.matchTimer ?? prev.generalTimer;
        if (!cur?.isActive) return prev;
        if (getEffectiveRemainingTime(cur) > 0) return prev;
        const paused = pauseTimer(cur);
        const next: AppState = {
          ...prev,
          [key]: paused,
          updatedAt: Date.now(),
        };
        if (key === "generalTimer") void saveGeneralTimerPatchAsync(paused, user?.id);
        else void saveMatchTimerPatchAsync(paused, user?.id);
        return next;
      });
      break;
    }
  }, [
    timerUiNow,
    state.generalTimer?.isActive,
    state.generalTimer?.remainingTime,
    state.generalTimer?.lastUpdated,
    state.matchTimer?.isActive,
    state.matchTimer?.remainingTime,
    state.matchTimer?.lastUpdated,
    user?.id,
  ]);

  // 다른 기기·OBS 저장 반영: SSE `state_updated` → 디바운스 GET, 저주기 폴링은 폴백만.
  useEffect(() => {
    if (!user) return;
    let running = true;
    let inFlight = false;
    let pendingForceDonorSync = false;
    const refreshDonorsFromServer = () => {
      if (Date.now() - lastEmptyRemoteDonationHealAtRef.current < 500) return;
      lastEmptyRemoteDonationHealAtRef.current = Date.now();
      void applyDonorsFromServerMainState({ silent: true });
    };
    const applyRemoteState = (incomingRemote: AppState, opts?: { forceDonorMerge?: boolean }) => {
      let remote = incomingRemote;
      const remoteUpdatedAt = remote.updatedAt || 0;
      const localDonorCount = normalizeDonorsArray(stateRef.current.donors).length;
      const remoteDonorCount = normalizeDonorsArray(remote.donors).length;
      /** 서버(MySQL) donors > UI — updatedAt 같아도 실시간 반영 */
      const serverDonorAhead = remoteDonorCount > localDonorCount && remoteDonorCount > 0;
      const shouldApplyRemote =
        remoteUpdatedAt > stateUpdatedAtRef.current ||
        Boolean(opts?.forceDonorMerge) ||
        serverDonorAhead;
      if (!shouldApplyRemote) return false;
      const remoteResetAt = Number(remote.settlementResetAt || 0);
      const localResetAt = Number(stateRef.current.settlementResetAt || 0);
      /**
       * 다른 브라우저에서 사용자가 정산 리셋함(settlementResetAt 상승).
       * 단, 원격이 멤버1·2… 플레이스홀더+빈 후원이면 사고성 유실 — stamp만으로 덮지 않음.
       */
      const remoteAccidentalEmpty =
        isAccidentalEmptyRosterState(remote) &&
        (hasMeaningfulMemberRoster(stateRef.current) ||
          normalizeDonorsArray(stateRef.current.donors).length > 0 ||
          totalCombined(stateRef.current) > 0);
      const remoteSettlementWins = remoteResetAt > localResetAt && !remoteAccidentalEmpty;
      if (remoteSettlementWins) {
        settlementResetUntilRef.current = Date.now() + 30_000;
        pendingUnsyncedRef.current = false;
        donationAuthoritativeSaveUntilRef.current = 0;
      }
      if (remoteAccidentalEmpty && remoteResetAt > localResetAt) {
        refreshDonorsFromServer();
        return false;
      }
      /** 투네 SSE·서버>UI: 병합 가드 전에 DB donors 를 화면에 직접 반영 */
      if (
        !remoteSettlementWins &&
        remoteDonorCount > 0 &&
        !amountInputEditingRef.current &&
        (serverDonorAhead ||
          Boolean(opts?.forceDonorMerge) ||
          totalCombined(remote) > totalCombined(stateRef.current))
      ) {
        const pulled = buildUiStateFromServerDonorPull(stateRef.current, remote);
        const pulledDonors = normalizeDonorsArray(pulled?.donors);
        if (
          pulled &&
          (pulledDonors.length > localDonorCount ||
            (pulledDonors.length >= remoteDonorCount &&
              totalCombined(pulled) > totalCombined(stateRef.current)))
        ) {
          const themeMerged = mergeIncomingStateSafely(remote, stateRef.current);
          const next = syncMemberTotalsFromDonors({
            ...themeMerged.merged,
            donors: pulledDonors,
            members: pulled.members,
            memberPositions: pulled.memberPositions,
            donorRankingsUpdatedAt: pulled.donorRankingsUpdatedAt,
            updatedAt: Math.max(Number(remote.updatedAt || 0), Number(pulled.updatedAt || 0)),
          });
          stateRef.current = next;
          stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, next.updatedAt || 0);
          lastAppliedRemoteUpdatedAtRef.current = next.updatedAt || 0;
          pendingUnsyncedRef.current = false;
          setState(next);
          if (next.settlementUiOptions) {
            syncSettlementUiFormFromOptions(next.settlementUiOptions);
          }
          try {
            cacheBroadcastStateSnapshot(next, user?.id);
          } catch {}
          notifyBroadcastStateLocalUpdated(user?.id, next.updatedAt);
          return true;
        }
      }
      if (amountInputEditingRef.current && !remoteSettlementWins) return false;
      if (Date.now() < settlementResetUntilRef.current) {
        const localDonors = normalizeDonorsArray(stateRef.current.donors);
        const remoteDonors = normalizeDonorsArray(remote.donors);
        if (
          localDonors.length === 0 &&
          (remoteDonors.length > 0 || totalCombined(remote) > 0) &&
          !opts?.forceDonorMerge &&
          !remoteSettlementWins
        ) {
          const preResetDonorsOnly =
            localResetAt > 0 &&
            filterDonorsAfterSettlementReset(remoteDonors, localResetAt).length === 0;
          if (preResetDonorsOnly) {
            const restored = resolveServerDonorsForEmptyLocal({
              local: stateRef.current,
              incomingDonors: remoteDonors,
              settlementResetAt: Math.max(localResetAt, remoteResetAt),
            });
            if (restored && restored.length > 0) {
              remote = { ...remote, donors: restored };
            } else {
              return false;
            }
          }
        }
      }
      /**
       * 수동 합산 추가 직후 빈 Redis·forceDonorMerge 폴링이 로컬 후원을 지우지 않게.
       * (정산 리셋 remoteSettlementWins 는 위에서 이미 허용)
       */
      if (!remoteSettlementWins) {
        const nowTs = Date.now();
        for (const [id, exp] of recentlyRemovedDonorIdsRef.current) {
          if (exp < nowTs) recentlyRemovedDonorIdsRef.current.delete(id);
        }
        const removed = recentlyRemovedDonorIdsRef.current;
        const remoteDonors = normalizeDonorsArray(remote.donors);
        const localDonors = normalizeDonorsArray(stateRef.current.donors);
        const localIds = new Set(localDonors.map((d) => d.id));
        const remoteIds = new Set(remoteDonors.map((d) => d.id));
        const remoteOnlyFresh = remoteDonors.filter(
          (d) => !localIds.has(d.id) && !removed.has(d.id)
        );
        const localOnly = localDonors.filter((d) => !remoteIds.has(d.id) && !removed.has(d.id));
        /** 투네 신규 + 수동 계좌(로컬만) → 거부하지 말고 union 후 적용 */
        let remoteForGuards = remote;
        if (localOnly.length > 0 && remoteOnlyFresh.length > 0) {
          remoteForGuards =
            mergeDonationApplyBase(remote, stateRef.current) ?? remote;
        }
        const remoteSansRemoved = {
          ...remoteForGuards,
          donors: normalizeDonorsArray(remoteForGuards.donors).filter((d) => !removed.has(d.id)),
        };
        const remoteRicher =
          totalCombined(remoteSansRemoved) > totalCombined(stateRef.current) ||
          remoteOnlyFresh.length > 0;
        const inAuthoritativeWindow = Date.now() < donationAuthoritativeSaveUntilRef.current;
        const inSettlementSnapshotWindow = Date.now() < settlementSnapshotUntilRef.current;
        const inMembersAuthWindow = Date.now() < membersAuthoritativeSaveUntilRef.current;
        const localRicherThanEmptyRemote =
          localDonors.length > 0 && remoteDonors.length === 0;
        /**
         * 삭제·정본 저장 직후 — 구 SSE/폴링(삭제분·0원 멤버 포함)은 신규 투네만 예외 허용.
         * remoteRicher 여부와 무관하게 되살림을 막는다.
         */
        if ((inAuthoritativeWindow || inSettlementSnapshotWindow) && remoteOnlyFresh.length === 0) {
          return false;
        }
        /**
         * 멤버 추가 직후: 로컬이 원격의 상위집합이면 보호창·120초 grace 안에서는 거부 후 재푸시.
         * (테마/시그 PATCH·2초 폴링이 추가 멤버를 지우는 경합)
         */
        const localAt = Number(stateRef.current.updatedAt || 0);
        const remoteAt = Number(remote.updatedAt || 0);
        const localSupersetProtected =
          isMemberRosterStrictSuperset(stateRef.current.members, remote.members) &&
          (inMembersAuthWindow || localAt >= remoteAt || localAt + 120_000 >= remoteAt);
        /** 멤버 삭제 직후: 로컬이 더 짧고 원격에 삭제된 멤버가 남아 있으면 구 스냅샷 거부 */
        const localRosterDeletePending =
          inMembersAuthWindow &&
          hasMeaningfulMemberRoster(stateRef.current) &&
          isMemberRosterStrictSuperset(remote.members, stateRef.current.members) &&
          (localAt >= remoteAt || localAt + 120_000 >= remoteAt);
        if (localRosterDeletePending) {
          return false;
        }
        if (
          localSupersetProtected ||
          (inMembersAuthWindow &&
            hasMeaningfulMemberRoster(stateRef.current) &&
            Array.isArray(remote.members) &&
            membersDifferByIds(stateRef.current.members || [], remote.members || []) &&
            (stateRef.current.members || []).length >= (remote.members || []).length)
        ) {
          if (localSupersetProtected) {
            refreshDonorsFromServer();
            /**
             * 후원 없어도 멤버 로스터만 서버에 재푸시.
             * 저장 큐가 바쁠 때·짧은 쿨다운 재푸시는 연결 지연·실시간 반영 저하를 만듦.
             */
            if (
              normalizeDonorsArray(stateRef.current.donors).length === 0 &&
              (stateRef.current.members || []).length > 0 &&
              !isServerSaveBusy() &&
              !pendingUnsyncedRef.current &&
              Date.now() - lastEmptyRemoteDonationHealAtRef.current >= 8_000
            ) {
              lastEmptyRemoteDonationHealAtRef.current = Date.now();
              persistState(stateRef.current, {
                omitDonationFields: true,
                membersAuthoritative: true,
              });
            }
          }
          return false;
        }
        /** forceDonorMerge 여도 빈 원격으로 수동 입력을 초기화하지 않음 — 대신 서버에 복구 푸시 */
        if (opts?.forceDonorMerge && localRicherThanEmptyRemote && !remoteRicher) {
          refreshDonorsFromServer();
          return false;
        }
        /** 보호창 밖에서도 poorer/empty Redis 가 실후원을 시스템 삭제처럼 덮지 않음 */
        if (
          !serverDonorAhead &&
          !isEmptyBroadcastDonationSession(stateRef.current) &&
          shouldRejectPoorerDonationRemote(stateRef.current, remoteForGuards)
        ) {
          refreshDonorsFromServer();
          return false;
        }
        /** 엑셀 실멤버·금액이 빈 원격으로 덮이지 않게 (정산 리셋만 예외) */
        if (
          !serverDonorAhead &&
          !isEmptyBroadcastDonationSession(stateRef.current) &&
          shouldAvoidOverwritingLocalStateWithRemote(stateRef.current, remoteForGuards)
        ) {
          refreshDonorsFromServer();
          return false;
        }
        /** mergeIncoming 에 삭제 id 가 다시 union 되지 않게 */
        remote = remoteSansRemoved;
      }
      /** 저장 대기 중이어도 원격 신규 후원은 mergeIncoming에서 수용.
       * 다른 브라우저 정산 리셋(remoteSettlementWins)은 빈 후원이어도 반드시 적용. */
      if (!remoteSettlementWins && pendingUnsyncedRef.current && !opts?.forceDonorMerge && !serverDonorAhead) {
        const localIds = new Set((stateRef.current.donors || []).map((d) => d.id));
        const hasRemoteOnly = (remote.donors || []).some((d) => !localIds.has(d.id));
        if (!hasRemoteOnly) {
          const mergedGeneralTimer = mergeGeneralTimerPreferEffective(
            stateRef.current.generalTimer,
            remote.generalTimer
          );
          const mergedMatchTimer = mergeGeneralTimerPreferEffective(
            stateRef.current.matchTimer ?? stateRef.current.generalTimer,
            remote.matchTimer ?? remote.generalTimer
          );
          const localGeneralEff = getEffectiveRemainingTime(stateRef.current.generalTimer);
          const remoteGeneralEff = getEffectiveRemainingTime(remote.generalTimer);
          const localMatchEff = getEffectiveRemainingTime(
            stateRef.current.matchTimer ?? stateRef.current.generalTimer
          );
          const remoteMatchEff = getEffectiveRemainingTime(remote.matchTimer ?? remote.generalTimer);
          if (
            mergedGeneralTimer.remainingTime !== stateRef.current.generalTimer?.remainingTime ||
            mergedGeneralTimer.isActive !== stateRef.current.generalTimer?.isActive ||
            mergedGeneralTimer.lastUpdated !== stateRef.current.generalTimer?.lastUpdated ||
            Math.abs(localGeneralEff - remoteGeneralEff) > 1 ||
            mergedMatchTimer.remainingTime !== stateRef.current.matchTimer?.remainingTime ||
            mergedMatchTimer.isActive !== stateRef.current.matchTimer?.isActive ||
            mergedMatchTimer.lastUpdated !== stateRef.current.matchTimer?.lastUpdated ||
            Math.abs(localMatchEff - remoteMatchEff) > 1
          ) {
            const timerSynced = {
              ...stateRef.current,
              generalTimer: mergedGeneralTimer,
              matchTimer: mergedMatchTimer,
            };
            stateRef.current = timerSynced;
            setState(timerSynced);
          }
          return false;
        }
      }
      if (
        !remoteSettlementWins &&
        remoteUpdatedAt <= lastAppliedRemoteUpdatedAtRef.current &&
        !opts?.forceDonorMerge &&
        !serverDonorAhead
      ) {
        return false;
      }
      const prev = stateRef.current;
      const recentlyEditedSig =
        !remoteSettlementWins &&
        Date.now() - lastLocalPersistAtRef.current < SIG_INVENTORY_LOCAL_PROTECT_MS;
      let toApply: AppState;
      let didPreserve = false;
      if (recentlyEditedSig) {
        const mergedResult = mergeIncomingStateSafely(remote, prev);
        toApply = {
          ...mergedResult.merged,
          sigInventory: prev.sigInventory || [],
          /** 수동 보정 직후 폴링이 구 sigMatch(0)로 미리보기를 지우지 않게 */
          sigMatch: prev.sigMatch || {},
          ...(String(prev.sigSoldOutStampUrl || "").trim()
            ? { sigSoldOutStampUrl: prev.sigSoldOutStampUrl }
            : {}),
        };
        didPreserve = true;
      } else {
        const mergedResult = mergeIncomingStateSafely(remote, prev);
        toApply = mergedResult.merged;
        didPreserve = mergedResult.didPreserve;
      }
      if (remoteSettlementWins) {
        toApply = {
          ...toApply,
          settlementResetAt: remoteResetAt,
          donors: normalizeDonorsArray(remote.donors),
          members: remote.members,
          memberPositions: remote.memberPositions ?? toApply.memberPositions,
        };
        toApply = syncMemberTotalsFromDonors(toApply);
        didPreserve = false;
      } else {
        /** 로컬에서 바꾼 멤버명을 서버 후원 스냅샷에 얹고, 차이면 서버에도 즉시 푸시(OBS 반영) */
        const beforeNames = (toApply.members || []).map((m) => `${m.id}:${m.name || ""}`).join("|");
        toApply = mergeLocalMemberIdentityOntoRemote(toApply, prev);
        const afterNames = (toApply.members || []).map((m) => `${m.id}:${m.name || ""}`).join("|");
        if (beforeNames !== afterNames && hasMeaningfulMemberRoster(toApply)) {
          persistState(toApply, {
            membersAuthoritative: true,
            omitDonationFields: true,
          });
        }
      }
      /** 후원은 서버(계정) 정본 — 세션 캐시로 원격 축소본을 막지 않음 */
      if (adminSyncFingerprint(prev) === adminSyncFingerprint(toApply)) {
        lastAppliedRemoteUpdatedAtRef.current = Math.max(
          lastAppliedRemoteUpdatedAtRef.current,
          remoteUpdatedAt
        );
        stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, remoteUpdatedAt);
        return false;
      }
      if (
        didPreserve &&
        Number(toApply.settlementResetAt || 0) <= Number(prev.settlementResetAt || 0)
      ) {
        const remoteIds = new Set(normalizeDonorsArray(remote.donors).map((d) => d.id));
        const preservedLocalDonors = normalizeDonorsArray(toApply.donors).some(
          (d) => !remoteIds.has(d.id)
        );
        if (preservedLocalDonors) {
          /**
           * 투네 원격에 없는 수동 계좌를 union 했으면 omitDonation 이 아니라
           * 서버에도 올려야 다음 투네 반영이 빈 Redis 기준으로 시작하지 않음.
           */
          stateRef.current = toApply;
          refreshDonorsFromServer();
        } else {
          /** 시각·시그 보존만 서버에 올리고 후원 필드는 건드리지 않음.
           * 멤버 추가·삭제로 로스터만 보존된 경우는 권위적으로 올려 유실을 막음. */
          const rosterNeedsServerPush =
            hasMeaningfulMemberRoster(toApply) &&
            membersDifferByIds(toApply.members || [], remote.members || []);
          persistState(toApply, {
            omitDonationFields: true,
            ...(rosterNeedsServerPush ? { membersAuthoritative: true } : {}),
          });
        }
      }
      stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, remoteUpdatedAt);
      lastAppliedRemoteUpdatedAtRef.current = Math.max(
        lastAppliedRemoteUpdatedAtRef.current,
        remoteUpdatedAt
      );
      const rawDonors = normalizeDonorsArray(toApply.donors);
      const remoteDonorCountLive = normalizeDonorsArray(remote.donors).length;
      if (
        serverDonorAhead ||
        isEmptyBroadcastDonationSession(prev) ||
        rawDonors.length < remoteDonorCountLive
      ) {
        const pulled = buildUiStateFromServerDonorPull(prev, remote);
        if (pulled && normalizeDonorsArray(pulled.donors).length > 0) {
          const restoredDonors = normalizeDonorsArray(pulled.donors);
          if (restoredDonors.length > rawDonors.length || rawDonors.length === 0) {
            toApply = syncMemberTotalsFromDonors({
              ...toApply,
              donors: restoredDonors,
              members: pulled.members,
              memberPositions: pulled.memberPositions,
            });
          }
        } else {
          const resetAt = Math.max(
            Number(prev.settlementResetAt || 0),
            Number(remote.settlementResetAt || 0)
          );
          const restored = isEmptyBroadcastDonationSession(prev)
            ? pickAuthoritativeDonorsForEmptySession(prev, remote.donors, remote.donors, resetAt)
            : resolveServerDonorsForEmptyLocal({
                local: prev,
                incomingDonors: remote.donors,
                settlementResetAt: resetAt,
              }) ?? rawDonors;
          if (normalizeDonorsArray(restored).length > rawDonors.length) {
            toApply = syncMemberTotalsFromDonors({ ...toApply, donors: normalizeDonorsArray(restored) });
          }
        }
      }
      const rawDonorsFinal = normalizeDonorsArray(toApply.donors);
      if (rawDonorsFinal.length > 1) {
        const deduped = dedupeDonorRows(rawDonorsFinal);
        if (deduped.length < rawDonorsFinal.length) {
          toApply = syncMemberTotalsFromDonors({ ...toApply, donors: deduped });
        }
      }
      setState(toApply);
      if (toApply.settlementUiOptions) {
        syncSettlementUiFormFromOptions(toApply.settlementUiOptions);
      }
      if (Array.isArray(toApply.overlayPresets)) {
        const nextOverlayPresets = toApply.overlayPresets as OverlayPreset[];
        setPresets(nextOverlayPresets);
        try {
          window.localStorage.setItem(presetStorageKey, JSON.stringify(nextOverlayPresets));
          notifyOverlayPresetsLocalUpdated();
        } catch {}
      }
      try {
        cacheBroadcastStateSnapshot(toApply, user?.id);
      } catch {}
      /** 계좌 saveStateAsync 와 동일 — 미리보기 iframe·같은 탭 엑셀표가 즉시 멤버 투네/계좌 반영 */
      notifyBroadcastStateLocalUpdated(user?.id, toApply.updatedAt);
      return true;
    };
    const syncFromApi = async (opts?: { forceFull?: boolean; forceDonorMerge?: boolean }) => {
      if (!running) return;
      if (inFlight) {
        if (opts?.forceDonorMerge) pendingForceDonorSync = true;
        return;
      }
      inFlight = true;
      try {
        const since = opts?.forceFull
          ? 0
          : Math.max(stateUpdatedAtRef.current, lastAppliedRemoteUpdatedAtRef.current);
        const remote = await loadStateFromApi(user?.id, {
          ifUpdatedSince: since,
          forceFull: Boolean(opts?.forceFull),
        });
        if (!remote) {
          if (typeof navigator !== "undefined" && !navigator.onLine) setSyncStatus("local");
          else if (since > 0) setSyncStatus("synced");
          else setSyncStatus("error");
          return;
        }
        setSyncStatus("synced");
        applyRemoteState(remote, { forceDonorMerge: opts?.forceDonorMerge });
      } finally {
        inFlight = false;
        if (pendingForceDonorSync) {
          pendingForceDonorSync = false;
          void syncFromApi({ forceFull: true, forceDonorMerge: true });
        }
      }
    };
    const { schedule, cancel } = createStateUpdatedScheduler(() => {
      void syncFromApi();
    }, { debounceMs: DONOR_STATE_UPDATED_DEBOUNCE_MS, maxWaitMs: DONOR_STATE_UPDATED_MAX_WAIT_MS });
    adminStateSseScheduleRef.current = schedule;
    adminDonorForceSyncRef.current = () => {
      void applyDonorsFromServerMainState({ silent: true }).then((ok) => {
        if (!ok) void syncFromApi({ forceFull: true, forceDonorMerge: true });
      });
    };
    const onOnline = () => {
      void syncFromApi({ forceFull: true });
    };
    const onOffline = () => {
      setSyncStatus("local");
    };
    const fallbackTimer = window.setInterval(() => {
      if (adminSseConnectedRef.current) return;
      void syncFromApi();
    }, ADMIN_STATE_FALLBACK_POLL_MS);
    const donorLiveTimer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      /** since/304 — 2초마다 forceFull 하면 /api/state 가 막혀 관리자가「동기화 중」에 고착 */
      void syncFromApi({ forceDonorMerge: true });
    }, ADMIN_DONOR_LIVE_POLL_MS);
    const onVisibility = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        void syncFromApi({ forceFull: true, forceDonorMerge: true });
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      running = false;
      cancel();
      adminStateSseScheduleRef.current = null;
      adminDonorForceSyncRef.current = null;
      window.clearInterval(fallbackTimer);
      window.clearInterval(donorLiveTimer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user?.id, persistState, mergeIncomingStateSafely, syncSettlementUiFormFromOptions, applyDonorsFromServerMainState]);

  const normalizeOverlayPresetLabels = (list: OverlayPreset[]): OverlayPreset[] =>
    list.map((p) => {
      const label = String(p.accountHeaderLabel || "").trim();
      if (label === "캐쉬후원" || label === "캐시후원") {
        return { ...p, accountHeaderLabel: "계좌" };
      }
      return p;
    });

  const persistOverlayPresetsOnly = useCallback(
    (nextPresets: OverlayPreset[], foundation: AppState, settingsPatch?: Record<string, unknown>) => {
      const now = Date.now();
      lastLocalPersistAtRef.current = now;
      stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, foundation.updatedAt || now, now);
      pendingUnsyncedRef.current = true;
      saveOverlayPresetsPatchAsync(nextPresets, user?.id, {
        foundation,
        overlaySettingsPatch: settingsPatch,
      }).then((r) => {
        if (r.ok) {
          if (typeof r.serverUpdatedAt === "number" && Number.isFinite(r.serverUpdatedAt)) {
            stateUpdatedAtRef.current = r.serverUpdatedAt;
            lastAppliedRemoteUpdatedAtRef.current = r.serverUpdatedAt;
          }
          pendingUnsyncedRef.current = false;
          setSyncStatus(r.storageFallback ? "error" : "synced");
        } else {
          const offline = typeof navigator !== "undefined" && !navigator.onLine;
          setSyncStatus(offline ? "local" : "error");
        }
      });
    },
    [user?.id]
  );

  /** 후원순위·리스트 등 시각 옵션만 저장 — 후원 금액 필드 미포함 */
  const persistVisualSettings = useCallback(
    (foundation: AppState, patch: Parameters<typeof saveVisualSettingsPatchAsync>[0]) => {
      const now = Date.now();
      lastLocalPersistAtRef.current = now;
      stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, foundation.updatedAt || now, now);
      pendingUnsyncedRef.current = true;
      stateRef.current = foundation;
      saveVisualSettingsPatchAsync(patch, user?.id, foundation).then((r) => {
        if (r.ok) {
          if (typeof r.serverUpdatedAt === "number" && Number.isFinite(r.serverUpdatedAt)) {
            stateUpdatedAtRef.current = r.serverUpdatedAt;
            lastAppliedRemoteUpdatedAtRef.current = r.serverUpdatedAt;
          }
          pendingUnsyncedRef.current = false;
          setSyncStatus(r.storageFallback ? "error" : "synced");
        } else {
          const offline = typeof navigator !== "undefined" && !navigator.onLine;
          setSyncStatus(offline ? "local" : "error");
        }
      });
    },
    [user?.id]
  );

  const applyThemeRestoreFromCandidate = useCallback(
    (candidate: ThemeRestoreCandidate, opts?: { silent?: boolean }) => {
      const summary = summarizeThemeRestoreCandidate(candidate);
      if (
        !opts?.silent &&
        !window.confirm(
          `${candidate.source}에서 테마를 복구합니다.\n` +
            (summary.length ? `${summary.join("\n")}\n` : "") +
            "※ 멤버·후원 금액은 그대로 두고 테마만 되돌립니다.\n계속할까요?"
        )
      ) {
        markThemeRestoreDismissed(user?.id, candidate);
        return false;
      }
      const live = stateRef.current;
      const lsSnap = loadState(user?.id);
      /** React state가 아직 default/0원이면 LS의 실데이터를 베이스로 쓴다 */
      const liveResetAt = Number(live.settlementResetAt || 0);
      const lsResetAt = Number(lsSnap.settlementResetAt || 0);
      const liveDonors = normalizeDonorsArray(live.donors).length;
      const lsDonorsFiltered =
        liveResetAt > 0
          ? normalizeDonorsArray(lsSnap.donors).filter((d) => (d.at || 0) >= liveResetAt - 3000)
          : normalizeDonorsArray(lsSnap.donors);
      const lsDonors = lsDonorsFiltered.length;
      const preferLsDonations =
        liveResetAt <= lsResetAt &&
        (lsDonors > liveDonors || totalCombined(lsSnap) > totalCombined(live));
      const base =
        preferLsDonations
          ? {
              ...live,
              members: lsSnap.members,
              donors: lsDonorsFiltered,
              memberPositions: lsSnap.memberPositions ?? live.memberPositions,
              settlementResetAt: Math.max(liveResetAt, lsResetAt) || live.settlementResetAt || lsSnap.settlementResetAt,
            }
          : live;
      const next = applyThemeRestorePatch(base, candidate);
      if (Array.isArray(next.overlayPresets) && next.overlayPresets.length > 0) {
        setPresets(next.overlayPresets as OverlayPreset[]);
        try {
          window.localStorage.setItem(presetStorageKey, JSON.stringify(next.overlayPresets));
          notifyOverlayPresetsLocalUpdated();
        } catch {}
        persistOverlayPresetsOnly(next.overlayPresets as OverlayPreset[], next);
      }
      setState(next);
      stateRef.current = next;
      /** LS에는 테마만 얹은 실데이터 스냅샷을 기록 — 0원 전체 덮어쓰기 금지 */
      try {
        const lsSafe = applyThemeRestorePatch(lsSnap, candidate);
        cacheBroadcastStateSnapshot(lsSafe, user?.id);
      } catch {}
      setPresetRev((r) => r + 1);
      setSigExcelResult(`테마 복구 완료 (${candidate.source}): ${summary.join(" · ") || "완료"}`);
      markThemeRestoreDismissed(user?.id, candidate);
      return true;
    },
    [persistOverlayPresetsOnly, presetStorageKey, user?.id]
  );

  const healLiveDonationsFromLocal = useCallback(() => {
    void applyDonorsFromServerMainState({ silent: true });
    return false;
  }, [applyDonorsFromServerMainState]);

  const maybePromptThemeRestore = useCallback(
    (current: AppState) => {
      if (themeRestorePromptedRef.current) return;
      const best = pickBestThemeRestoreCandidate(collectThemeRestoreCandidates(user?.id));
      if (!best) return;
      if (isThemeRestoreDismissedForCandidate(user?.id, best)) {
        themeRestorePromptedRef.current = true;
        return;
      }
      if (!shouldOfferThemeRestore(current, best)) return;
      themeRestorePromptedRef.current = true;
      window.setTimeout(() => {
        /** 지연 중 상태가 바뀌었을 수 있음 — 최신 기준으로 재확인 */
        const liveNow = stateRef.current;
        if (!shouldOfferThemeRestore(liveNow, best)) {
          markThemeRestoreDismissed(user?.id, best);
          return;
        }
        if (isThemeRestoreDismissedForCandidate(user?.id, best)) return;
        const summary = summarizeThemeRestoreCandidate(best);
        const ok = window.confirm(
          "테마가 기본(핑크 그라데이션)으로 초기화된 것으로 보입니다.\n" +
            `${best.source}에서 이전 테마를 복구할까요?\n` +
            (summary.length ? `${summary.join("\n")}\n` : "") +
            "※ 멤버·후원 금액은 유지됩니다.\n" +
            "취소를 눌러도 후원 금액은 지우지 않습니다."
        );
        if (ok) {
          applyThemeRestoreFromCandidate(best, { silent: true });
        } else {
          markThemeRestoreDismissed(user?.id, best);
          healLiveDonationsFromLocal();
        }
      }, 900);
    },
    [applyThemeRestoreFromCandidate, healLiveDonationsFromLocal, user?.id]
  );

  useEffect(() => {
    if (!user || syncStatus !== "synced") return;
    maybePromptThemeRestore(stateRef.current);
  }, [user, syncStatus, maybePromptThemeRestore]);

  const savePresets = (next: OverlayPreset[]) => {
    const normalized = normalizeOverlayPresetLabels(next);
    setPresets(normalized);
    try {
      window.localStorage.setItem(presetStorageKey, JSON.stringify(normalized));
      notifyOverlayPresetsLocalUpdated();
    } catch {}
    setState((prev) => {
      const merged: AppState = { ...prev, overlayPresets: normalized, updatedAt: Date.now() };
      /** 테마·프리셋만 PATCH — members 미포함으로 멤버 유실 방지 */
      persistOverlayPresetsOnly(normalized, merged);
      return merged;
    });
  };
  // 상단바 전용 프리셋 기능 제거됨
  const addPreset = (name: string, overrides: Partial<OverlayPreset> = {}) => {
    const p = defaultPreset(name, overrides);
    savePresets([...presets, p]);
    setEditingId(p.id);
  };
  const updatePreset = (id: string, patch: Partial<OverlayPreset>) => {
    const mergedPatch = { ...patch };
    /** 상단「테마」변경 시 표에 쓰는 멤버·총합 테마도 같이 맞춤(표만 theme만 바뀌고 엑셀 테마가 남는 문제 방지) */
    if (Object.prototype.hasOwnProperty.call(patch, "theme") && patch.theme !== undefined) {
      const nextTheme = String(patch.theme || "default");
      if (patch.membersTheme === undefined) mergedPatch.membersTheme = nextTheme;
      if (patch.totalTheme === undefined) mergedPatch.totalTheme = nextTheme;
      /**
       * 수동 헤더/본문/선 색이 남아 있으면 테마(글래스·엑셀 액센트)가 안 바뀐 것처럼 보임.
       * 테마 전환 시 「테마 자동」으로 되돌려 새 테마 크롬이 즉시 프리뷰에 반영되게 함.
       */
      Object.assign(mergedPatch, emptyTableThemeAutoColorPatch());
    }
    if (mergedPatch.accountHeaderLabel !== undefined) {
      const label = String(mergedPatch.accountHeaderLabel || "").trim();
      if (label === "캐쉬후원" || label === "캐시후원") mergedPatch.accountHeaderLabel = "계좌";
    }
    if (patch.goalBaseline !== undefined) {
      mergedPatch.goalBaseline = String(patch.goalBaseline).replace(/[^\d]/g, "");
    }
    if (patch.goalIncreaseStep !== undefined) {
      mergedPatch.goalIncreaseStep = String(patch.goalIncreaseStep).replace(/[^\d]/g, "");
    }
    if (patch.goalTextColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.goalTextColor || ""));
      mergedPatch.goalTextColor = normalized || "";
    }
    if (patch.goalTextOutlineColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.goalTextOutlineColor || ""));
      mergedPatch.goalTextOutlineColor = normalized || "";
    }
    if (patch.goalTextOutlineWidth !== undefined) {
      const w = parseFloat(String(patch.goalTextOutlineWidth || "").replace(/[^\d.]/g, "") || "0");
      mergedPatch.goalTextOutlineWidth = Number.isFinite(w)
        ? String(Math.max(0, Math.min(3, w)))
        : "";
    }
    if (patch.goalBarBgColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.goalBarBgColor || ""));
      mergedPatch.goalBarBgColor = normalized || "";
    }
    if (patch.goalBarFillColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.goalBarFillColor || ""));
      mergedPatch.goalBarFillColor = normalized || "";
    }
    if (patch.goalFontFamily !== undefined) {
      mergedPatch.goalFontFamily = normalizeTableFontFamily(patch.goalFontFamily);
    }
    if (patch.goalBarAnimation !== undefined) {
      const anim = String(patch.goalBarAnimation || "").trim().toLowerCase();
      mergedPatch.goalBarAnimation =
        anim === "off" || anim === "pulse" || anim === "sweep" || anim === "both" ? anim : "both";
    }
    if (patch.goalFontWeight !== undefined) {
      const w = parseInt(String(patch.goalFontWeight || "").replace(/[^\d]/g, ""), 10);
      mergedPatch.goalFontWeight = Number.isFinite(w)
        ? String(Math.max(400, Math.min(900, w)))
        : "";
    }
    if (patch.overlayTextSharpRender !== undefined) {
      mergedPatch.overlayTextSharpRender = Boolean(patch.overlayTextSharpRender);
    }
    if (patch.tableTextOutlineColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.tableTextOutlineColor || ""));
      mergedPatch.tableTextOutlineColor = normalized || "";
    }
    if (patch.tableBgColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.tableBgColor || ""));
      mergedPatch.tableBgColor = normalized || "";
    }
    if (patch.tableHeaderBgColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.tableHeaderBgColor || ""));
      mergedPatch.tableHeaderBgColor = normalized || "";
    }
    if (patch.tableHeaderTextColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.tableHeaderTextColor || ""));
      mergedPatch.tableHeaderTextColor = normalized || "";
    }
    if (patch.tableLineColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.tableLineColor || ""));
      mergedPatch.tableLineColor = normalized || "";
    }
    if (patch.contributionColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.contributionColor || ""));
      mergedPatch.contributionColor = normalized || "";
    }
    if (patch.tablePanelBorderColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.tablePanelBorderColor || ""));
      mergedPatch.tablePanelBorderColor = normalized || "";
    }
    if (patch.tableRowEvenBg !== undefined) {
      const raw = String(patch.tableRowEvenBg || "").trim();
      mergedPatch.tableRowEvenBg =
        !raw
          ? ""
          : /^rgba?\(/i.test(raw)
            ? raw
            : tableRowStripeBgFromPickerHex(normalizeGoalHexColor(raw) || raw, 0.06);
    }
    if (patch.tableRowOddBg !== undefined) {
      const raw = String(patch.tableRowOddBg || "").trim();
      mergedPatch.tableRowOddBg =
        !raw
          ? ""
          : /^rgba?\(/i.test(raw)
            ? raw
            : tableRowStripeBgFromPickerHex(normalizeGoalHexColor(raw) || raw, 0.14);
    }
    if (patch.tableTextColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.tableTextColor || ""));
      mergedPatch.tableTextColor = normalized || "";
    }
    if (patch.totalTextColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.totalTextColor || ""));
      mergedPatch.totalTextColor = normalized || "";
    }
    if (patch.tableTextOutlineWidth !== undefined) {
      const w = parseFloat(String(patch.tableTextOutlineWidth || "").replace(/[^\d.]/g, "") || "0");
      mergedPatch.tableTextOutlineWidth = Number.isFinite(w)
        ? String(Math.max(0, Math.min(3, w)))
        : "";
    }
    if (patch.tableHeaderTextOutlineColor !== undefined) {
      const normalized = normalizeGoalHexColor(String(patch.tableHeaderTextOutlineColor || ""));
      mergedPatch.tableHeaderTextOutlineColor = normalized || "";
    }
    if (patch.tableHeaderTextOutlineWidth !== undefined) {
      const w = parseFloat(String(patch.tableHeaderTextOutlineWidth || "").replace(/[^\d.]/g, "") || "0");
      mergedPatch.tableHeaderTextOutlineWidth = Number.isFinite(w)
        ? String(Math.max(0, Math.min(3, w)))
        : "";
    }
    if (patch.tableFontWeight !== undefined) {
      const w = parseInt(String(patch.tableFontWeight || "").replace(/[^\d]/g, ""), 10);
      mergedPatch.tableFontWeight = Number.isFinite(w)
        ? String(Math.max(400, Math.min(900, w)))
        : "";
    }
    if (patch.tableFontFamily !== undefined) {
      const normalized = normalizeTableFontFamily(patch.tableFontFamily);
      mergedPatch.tableFontFamily = normalized === "auto" ? "" : normalized;
    }
    if (patch.memberSize !== undefined) {
      mergedPatch.memberSize = String(clampTableMemberSizePx(patch.memberSize, 24));
    }
    const nextPresets = normalizeOverlayPresetLabels(
      presets.map((p) => (p.id === id ? { ...p, ...mergedPatch } : p))
    );
    setPresets(nextPresets);
    try {
      window.localStorage.setItem(presetStorageKey, JSON.stringify(nextPresets));
      notifyOverlayPresetsLocalUpdated();
    } catch {}
    setState((prev: AppState) => {
      const settingsPatch = { currentPresetId: id };
      const timerColorTouched =
        mergedPatch.timerFontFamily !== undefined ||
        mergedPatch.timerFontColor !== undefined ||
        mergedPatch.timerBgColor !== undefined ||
        mergedPatch.timerBorderColor !== undefined ||
        mergedPatch.timerOutlineColor !== undefined ||
        mergedPatch.timerOutlineWidth !== undefined ||
        mergedPatch.timerBgOpacity !== undefined ||
        mergedPatch.timerScale !== undefined ||
        mergedPatch.timerShowHours !== undefined;
      const prevTimer = prev.timerDisplayStyles?.general;
      const timerDisplayStyles = timerColorTouched
        ? {
            general: {
              showHours:
                mergedPatch.timerShowHours !== undefined
                  ? Boolean(mergedPatch.timerShowHours)
                  : Boolean(prevTimer?.showHours),
              fontFamily:
                mergedPatch.timerFontFamily !== undefined
                  ? normalizeTimerFontFamily(mergedPatch.timerFontFamily)
                  : normalizeTimerFontFamily(prevTimer?.fontFamily || "mono"),
              fontColor:
                mergedPatch.timerFontColor !== undefined
                  ? String(mergedPatch.timerFontColor || "")
                  : String(prevTimer?.fontColor || ""),
              bgColor:
                mergedPatch.timerBgColor !== undefined
                  ? String(mergedPatch.timerBgColor || "")
                  : String(prevTimer?.bgColor || ""),
              borderColor:
                mergedPatch.timerBorderColor !== undefined
                  ? String(mergedPatch.timerBorderColor || "")
                  : String(prevTimer?.borderColor || ""),
              outlineColor:
                mergedPatch.timerOutlineColor !== undefined
                  ? String(mergedPatch.timerOutlineColor || "")
                  : String(prevTimer?.outlineColor || ""),
              outlineWidth:
                mergedPatch.timerOutlineWidth !== undefined
                  ? Math.max(
                      0,
                      Math.min(3, parseFloat(String(mergedPatch.timerOutlineWidth || "0.8")) || 0.8)
                    )
                  : Number(prevTimer?.outlineWidth ?? 0.8),
              bgOpacity:
                mergedPatch.timerBgOpacity !== undefined
                  ? Math.max(0, Math.min(100, parseInt(String(mergedPatch.timerBgOpacity || "40"), 10) || 40))
                  : Number(prevTimer?.bgOpacity ?? 40),
              scalePercent:
                mergedPatch.timerScale !== undefined
                  ? Math.max(50, Math.min(250, parseInt(String(mergedPatch.timerScale || "100"), 10) || 100))
                  : Number(prevTimer?.scalePercent ?? 100),
            },
          }
        : prev.timerDisplayStyles;
      const merged: AppState = {
        ...prev,
        overlayPresets: nextPresets,
        overlaySettings: { ...(prev.overlaySettings || {}), ...settingsPatch },
        ...(timerColorTouched ? { timerDisplayStyles } : {}),
        updatedAt: Date.now(),
      };
      /** 테마 변경은 프리셋만 저장 — 전체 persist 시 placeholder 멤버로 Redis/LS가 덮일 수 있음 */
      persistOverlayPresetsOnly(nextPresets, merged, settingsPatch);
      if (timerColorTouched && timerDisplayStyles) {
        void saveGeneralTimerPatchAsync(prev.generalTimer, user?.id, { timerDisplayStyles });
      }
      return merged;
    });
    setPresetRev((r) => r + 1);
  };
  const removePreset = (id: string) => {
    requestConfirm("오버레이 프리셋 삭제", "이 오버레이 프리셋을 삭제할까요?", () => {
      savePresets(presets.filter(p => p.id !== id));
      if (editingId === id) setEditingId(null);
    }, { confirmText: "삭제", danger: true });
  };
  const buildOverlayUrl = (p: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/overlay`;
    const q = buildCompactBroadcastOverlayParams({
      presetId: p.id,
      userId: overlayUserId,
    });
    return `${base}?${q.toString()}`;
  };
  /** 방송/OBS용: snap 없음 → 오버레이는 항상 `/api/state` 기준 실시간 반영 (스냅샷은 아래 프리뷰 iframe 전용) */
  const buildPrismOverlayUrl = (p: OverlayPreset, vertical: boolean): string => {
    if (typeof window === "undefined") return "";
    const isGoalOnlyPreset =
      Boolean(p.showGoal) &&
      !Boolean(p.showMembers) &&
      !Boolean(p.showTotal) &&
      !Boolean(p.showTimer) &&
      !Boolean(p.showMission) &&
      !Boolean(p.showPersonalGoal);
    if (isGoalOnlyPreset) {
      const goalOnly = new URL(`${window.location.origin}/overlay/goal`);
      goalOnly.searchParams.set("p", p.id);
      goalOnly.searchParams.set("u", overlayUserId);
      goalOnly.searchParams.set("host", "prism");
      return goalOnly.toString();
    }
    const base = `${window.location.origin}/overlay`;
    const q = buildCompactBroadcastOverlayParams({
      presetId: p.id,
      userId: overlayUserId,
      host: "prism",
      vertical: !!vertical,
    });
    return `${base}?${q.toString()}`;
  };
  const buildPrismDemoOverlayUrl = (p: OverlayPreset, vertical: boolean): string => {
    const baseUrl = buildPrismOverlayUrl(p, vertical);
    if (!baseUrl) return "";
    const u = new URL(baseUrl);
    u.searchParams.set("demo", "true");
    return u.toString();
  };
  const buildPreviewOverlayUrl = (p: OverlayPreset): string => {
    const url = buildOverlayUrl(p);
    const u = new URL(url);
    u.searchParams.set("previewGuide", "true");
    const isVertical = u.searchParams.get("vertical") === "true" || !!p.vertical;
    u.searchParams.set("renderWidth", isVertical ? "1080" : "1920");
    u.searchParams.set("renderHeight", isVertical ? "1920" : "1080");
    return u.toString();
  };
  const buildStablePreviewUrl = (p: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const isGoalOnlyPreset =
      Boolean(p.showGoal) &&
      !Boolean(p.showMembers) &&
      !Boolean(p.showTotal) &&
      !Boolean(p.showTimer) &&
      !Boolean(p.showMission) &&
      !Boolean(p.showPersonalGoal);
    if (isGoalOnlyPreset) {
      const goalOnly = new URL(`${window.location.origin}/overlay/goal`);
      goalOnly.searchParams.set("u", overlayUserId);
      goalOnly.searchParams.set("host", "prism");
      if (p.id) goalOnly.searchParams.set("p", p.id);
      goalOnly.searchParams.set("previewGuide", "true");
      return goalOnly.toString();
    }
    const base = `${window.location.origin}/overlay`;
    /**
     * 미리보기 iframe src 는 구조 키만 유지한다.
     * 시각·레이아웃 옵션을 URL에 넣으면 옵션 변경마다 리마운트되어 멤버1·2·3 초기 화면이 깜빡인다.
     * 스타일은 localStorage 프리셋(`/api/state`) 핫리로드로 반영.
     * host=prism: OBS와 동일하게 서버 금액·externalSafe 렌더(미리보기만 로컬 금액이 어긋나던 문제 방지).
     */
    const q = new URLSearchParams();
    q.set("p", p.id);
    q.set("u", overlayUserId);
    q.set("host", "prism");
    q.set("previewGuide", "true");
    if (p.tableOnly) q.set("tableOnly", "true");
    const isVertical = !!p.vertical;
    if (isVertical) q.set("vertical", "true");
    q.set("renderWidth", isVertical ? "1080" : "1920");
    q.set("renderHeight", isVertical ? "1920" : "1080");
    return `${base}?${q.toString()}`;
  };

  const getBattleScalePct = (): number => {
    const raw = battleScalePct.replace(/[^\d]/g, "");
    const n = parseInt(raw || "100", 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(50, Math.min(300, n));
  };
  const getBattleContentWidthPct = useCallback((): number => {
    const raw = battleContentWidthPct.replace(/[^\d]/g, "");
    const n = parseInt(raw || "100", 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(40, Math.min(100, n));
  }, [battleContentWidthPct]);
  const buildSigMatchLiveUrl = useCallback((): string => {
    if (typeof window === "undefined") return "";
    const uid = overlayUserId;
    const raw = battleScalePct.replace(/[^\d]/g, "");
    const n = parseInt(raw || "100", 10);
    const scalePct = Number.isFinite(n) ? Math.max(50, Math.min(300, n)) : 100;
    const q = new URLSearchParams();
    q.set("u", uid);
    q.set("host", "obs");
    q.set("scalePct", String(scalePct));
    q.set("contentWidthPct", String(getBattleContentWidthPct()));
    return `${window.location.origin}/overlay/sig-match?${q.toString()}`;
  }, [user?.id, battleScalePct, getBattleContentWidthPct]);
  const buildMealMatchLiveUrl = useCallback((): string => {
    if (typeof window === "undefined") return "";
    const uid = overlayUserId;
    const raw = battleScalePct.replace(/[^\d]/g, "");
    const n = parseInt(raw || "100", 10);
    const scalePct = Number.isFinite(n) ? Math.max(50, Math.min(300, n)) : 100;
    const q = new URLSearchParams();
    q.set("u", uid);
    q.set("host", "obs");
    q.set("scalePct", String(scalePct));
    q.set("contentWidthPct", String(getBattleContentWidthPct()));
    return `${window.location.origin}/overlay/meal-match?${q.toString()}`;
  }, [user?.id, battleScalePct, getBattleContentWidthPct]);

  const sigMatchPreviewUrlRef = useRef("");
  const [sigMatchPreviewIframeSrc, setSigMatchPreviewIframeSrc] = useState("");
  const mealMatchPreviewUrlRef = useRef("");
  const [mealMatchPreviewIframeSrc, setMealMatchPreviewIframeSrc] = useState("");
  const sigMatchPreviewBootedRef = useRef(false);
  const mealMatchPreviewBootedRef = useRef(false);
  /**
   * 대전 배율·가로폭 슬라이더마다 iframe을 즉시 리로드하면 게이지가 왔다갔다 함.
   * URL은 디바운스하고, key는 수동 새로고침에만 바꿔 미리보기를 유지한다.
   */
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = buildSigMatchLiveUrl();
    sigMatchPreviewUrlRef.current = url;
    const delay = sigMatchPreviewBootedRef.current ? 400 : 0;
    const t = window.setTimeout(() => {
      sigMatchPreviewBootedRef.current = true;
      const next = appendAdminPreviewEmbedToOverlayUrl(url);
      setSigMatchPreviewIframeSrc((prev) => (prev === next ? prev : next));
    }, delay);
    return () => window.clearTimeout(t);
  }, [buildSigMatchLiveUrl]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = buildMealMatchLiveUrl();
    mealMatchPreviewUrlRef.current = url;
    const delay = mealMatchPreviewBootedRef.current ? 400 : 0;
    const t = window.setTimeout(() => {
      mealMatchPreviewBootedRef.current = true;
      const next = appendAdminPreviewEmbedToOverlayUrl(url);
      setMealMatchPreviewIframeSrc((prev) => (prev === next ? prev : next));
    }, delay);
    return () => window.clearTimeout(t);
  }, [buildMealMatchLiveUrl]);

  const copyUrl = async (url: string, id: string) => {
    const clean = sanitizeBroadcastOverlayUrl(url);
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(clean); }
      else { const ta = document.createElement("textarea"); ta.value = clean; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); }
      setCopiedId(id); setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  };
  const rouletteUserId = overlayUserId;
  const getSigSalesMenuCount = useCallback((): number => {
    return clampSigSalesMenuCount(sigSalesMenuCount);
  }, [sigSalesMenuCount]);
  useEffect(() => {
    const persisted = clampSigSalesMenuCount(state.rouletteState?.menuCount);
    const asText = String(persisted);
    if (sigSalesMenuCount !== asText) setSigSalesMenuCount(asText);
  }, [state.rouletteState?.menuCount, sigSalesMenuCount]);
  const rouletteQuickUrls = useMemo(() => {
    /** 서버 selectedSigs를 프론트에서 항상 순차 연출하므로 단일휠 강제 파라미터는 붙이지 않는다. */
    const rsScale = clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct);
    const bundleLayoutQs = `&sigResultScalePct=${rsScale}`;
    const baseProgressPath = `/overlay/sig-sales?u=${rouletteUserId}&menuCount=${getSigSalesMenuCount()}${bundleLayoutQs}`;
    const progressPath = selectedMemberId
      ? `${baseProgressPath}&memberId=${encodeURIComponent(selectedMemberId)}`
      : baseProgressPath;
    const memberProgressPath = selectedMemberId
      ? progressPath
      : "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return {
      progressPath,
      memberProgressPath,
      progressAbs: origin ? `${origin}${progressPath}` : "",
      memberProgressAbs: origin && memberProgressPath ? `${origin}${memberProgressPath}` : "",
    };
  }, [rouletteUserId, selectedMemberId, getSigSalesMenuCount, state.rouletteState?.sigResultScalePct]);
  const rouletteQuickSummaryText = useMemo(() => {
    return `[통합 오버레이] ${rouletteQuickUrls.progressAbs}`;
  }, [rouletteQuickUrls]);
  const rouletteServerStatus = useMemo(() => {
    const rs = state.rouletteState;
    if (!rs) {
      return {
        phase: "IDLE",
        isRolling: false,
        sessionShort: "—",
        startedLabel: "—",
        nWin: 0,
        hasOneShot: false,
      };
    }
    const sid = (rs.sessionId || "").trim();
    const sessionShort = sid.length > 24 ? `${sid.slice(0, 22)}…` : sid || "—";
    const st = Number(rs.startedAt || 0);
    const startedLabel =
      st > 0
        ? new Date(st).toLocaleString("ko-KR", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          })
        : "—";
    return {
      phase: rs.phase || "IDLE",
      isRolling: Boolean(rs.isRolling),
      sessionShort,
      startedLabel,
      nWin: (rs.selectedSigs || []).length,
      hasOneShot: Boolean(rs.oneShotResult),
    };
  }, [state.rouletteState]);
  const getDonorRankingsZoomPct = (): number => {
    const raw = Number(state.donorRankingsTheme?.zoomPct);
    if (!Number.isFinite(raw)) return 100;
    return Math.max(30, Math.min(300, Math.floor(raw)));
  };
  const buildDonorRankingsUrl = (opts?: { test?: boolean; full?: boolean }): string => {
    if (typeof window === "undefined") return "";
    /** OBS URL은 짧게 — 테마·줌·색은 관리자 저장값(서버)에서 로드 */
    const q = new URLSearchParams();
    q.set("u", overlayUserId);
    q.set("host", "obs");
    if (opts?.test) q.set("test", "true");
    const path = opts?.full ? "/overlay/donor-rankings/full" : "/overlay/donor-rankings";
    return `${window.location.origin}${path}?${q.toString()}`;
  };
  const buildEmergencySnapshotUrl = (p: OverlayPreset): string => {
    if (typeof window === "undefined") return "";
    const base = `${window.location.origin}/overlay`;
    const snapObj = {
      members: state.members.map(m => ({ id: m.id, name: m.name, account: m.account, toon: m.toon, contribution: m.contribution || 0, goal: m.goal, operating: m.operating })),
      memberPositions: state.memberPositions || {},
      donors: state.donors || [],
      missions: (state as any).missions || [],
      forbiddenWords: state.forbiddenWords || [],
      goal: (() => { const n = parseInt((p.goal || "0") as any, 10); return Number.isFinite(n) ? Math.max(0, n) : 0; })(),
      goalCurrent: (() => {
        const raw = (p.goalCurrent || "") as any;
        const n = raw === "" || raw === null || raw === undefined ? null : parseInt(String(raw), 10);
        return n === null || Number.isNaN(n) ? null : Math.max(0, n);
      })(),
      updatedAt: Date.now(),
    };
    const json = JSON.stringify(snapObj);
    const b64 = btoa(encodeURIComponent(json));
    const q = new URLSearchParams();
    q.set("p", p.id);
    q.set("u", overlayUserId);
    q.set("snap", b64);
    return `${base}?${q.toString()}`;
  };

  useEffect(() => {
    setChatDraft(formatChatLine(state));
    setChatDraftDirty(false);
  }, [state]);

  useEffect(() => {
    if (pendingUnsyncedRef.current) return;
    if (Date.now() - lastLocalPersistAtRef.current < SIG_INVENTORY_LOCAL_PROTECT_MS) return;
    if (oneShotSyncTimerRef.current) {
      clearTimeout(oneShotSyncTimerRef.current);
      oneShotSyncTimerRef.current = null;
    }
    oneShotSyncTimerRef.current = setTimeout(() => {
      oneShotSyncTimerRef.current = null;
      if (pendingUnsyncedRef.current) return;
      setState((prev: AppState) => {
        const inv = prev.sigInventory || [];
        const needsClamp = inv.some(
          (x) =>
            x.id !== ONE_SHOT_SIG_ID &&
            (Number(x.maxCount || 1) !== 1 || Number(x.soldCount || 0) > 1)
        );
        const totalAmount = inv
          .filter(
            (x) =>
              x.id !== ONE_SHOT_SIG_ID &&
              Boolean(x.isActive) &&
              Math.max(0, Number(x.soldCount || 0)) < Math.max(1, Number(x.maxCount || 1))
          )
          .reduce((sum, x) => sum + Math.max(0, Number(x.price || 0)), 0);
        const oneShot = inv.find((x) => x.id === ONE_SHOT_SIG_ID);
        const needsOneShot =
          !oneShot ||
          !String(oneShot.name || "").trim() ||
          oneShot.price !== totalAmount ||
          oneShot.maxCount !== 1 ||
          oneShot.soldCount !== 0 ||
          oneShot.isRolling !== false;
        if (!needsClamp && !needsOneShot) return prev;
        const clampedInventory = needsClamp
          ? inv.map((x) => {
              if (x.id === ONE_SHOT_SIG_ID) return x;
              return { ...x, maxCount: 1, soldCount: Math.max(0, Math.min(1, Number(x.soldCount || 0))) };
            })
          : inv;
        const draft: AppState = {
          ...prev,
          sigInventory: clampedInventory,
          updatedAt: Date.now(),
        };
        const next = { ...syncOneShotSigItem(draft), updatedAt: draft.updatedAt };
        if (next === prev || adminSyncFingerprint(next) === adminSyncFingerprint(prev)) return prev;
        /** 시그 보정만 — 후원 필드는 API에서 제외 */
        persistState(next, { omitDonationFields: true });
        return next;
      });
    }, 500);
    return () => {
      if (oneShotSyncTimerRef.current) {
        clearTimeout(oneShotSyncTimerRef.current);
        oneShotSyncTimerRef.current = null;
      }
    };
  }, [state.sigInventory, persistState, syncOneShotSigItem, user?.id]);

  useEffect(() => {
    /** 저장 실패 재시도 — 후원 필드 제외(금액 초기화 방지) */
    const id = setInterval(() => {
      if (syncStatusRef.current !== "error") return;
      persistState(stateRef.current, { omitDonationFields: true });
    }, 5000);
    return () => clearInterval(id);
  }, [persistState]);

  useEffect(() => {
    if (typeof window === "undefined" || !user?.id) return;
    const key = storageKey(user.id);
    const dailyKey = dailyLogStorageKey(user.id);
    const handler = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          const incoming = JSON.parse(e.newValue) as AppState;
          const incomingUpdatedAt = incoming.updatedAt || 0;
          if (incomingUpdatedAt <= stateUpdatedAtRef.current) return;
          if (pendingUnsyncedRef.current) return;
          if (amountInputEditingRef.current) return;
          stateUpdatedAtRef.current = incomingUpdatedAt;
          setState((prev) => {
            const { merged } = mergeIncomingStateSafely(incoming, prev);
            if (adminSyncFingerprint(prev) === adminSyncFingerprint(merged)) return prev;
            return merged;
          });
        } catch {
          // ignore
        }
      } else if (e.key === dailyKey) {
        setDailyLog(loadDailyLog(user.id));
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [user?.id, persistState, mergeIncomingStateSafely]);

  useEffect(() => {
    setMemberRatioInputs((prev) => {
      const next: Record<string, { account: string; toon: string }> = {};
      for (const m of state.members) {
        next[m.id] = {
          account: prev[m.id]?.account ?? "",
          toon: prev[m.id]?.toon ?? "",
        };
      }
      return next;
    });
  }, [state.members]);

  useEffect(() => {
    if (settlementUiHydratingRef.current || !user?.id) return;
    const settlementUiOptions = buildSettlementUiOptionsFromForm({
      accountRatioInput,
      toonRatioInput,
      taxRateInput,
      vatIncluded,
      taxInvoiceIssued,
      useMemberRatioOverrides,
      memberRatioInputs,
      omitTreasuryFromSettlement,
      includeTreasuryInFullStatement,
    });
    const serialized = JSON.stringify(settlementUiOptions);
    if (serialized === lastPersistedSettlementUiRef.current) return;
    lastPersistedSettlementUiRef.current = serialized;
    const next: AppState = {
      ...stateRef.current,
      settlementUiOptions,
      updatedAt: Date.now(),
    };
    stateRef.current = next;
    persistState(next, { omitDonationFields: true });
  }, [
    user?.id,
    persistState,
    accountRatioInput,
    toonRatioInput,
    taxRateInput,
    vatIncluded,
    taxInvoiceIssued,
    useMemberRatioOverrides,
    memberRatioInputs,
    omitTreasuryFromSettlement,
    includeTreasuryInFullStatement,
  ]);

  const updateMember = (m: Member) => {
    setState((prev: AppState) => {
      let next: AppState = {
        ...prev,
        members: prev.members.map((x: Member) => (x.id === m.id ? m : x)),
        updatedAt: Date.now(),
      };
      if (normalizeDonorsArray(next.donors).length > 0) {
        next = syncMemberTotalsFromDonors(next);
      }
      persistState(next, { includeDonationFields: true });
      return next;
    });
  };

  const renameMember = (id: string, name: string) => {
    const cleaned = (name || "무명").trim() || "무명";
    setState((prev: AppState) => {
      let next: AppState = {
        ...prev,
        members: prev.members.map((x: Member) => (x.id === id ? { ...x, name: cleaned } : x)),
        updatedAt: Date.now(),
      };
      const richestDonors = resolveRichestDonorsFromSources(
        [prev.donors, stateRef.current?.donors, loadState(user?.id)?.donors],
        {
          incomingUpdatedAt: Number(next.updatedAt || 0),
          existingUpdatedAt: Number(prev.updatedAt || 0),
        }
      );
      if (richestDonors.length > 0) {
        next = {
          ...syncMemberTotalsFromDonors({ ...next, donors: richestDonors }),
          donors: richestDonors,
        };
      }
      if (next.mealBattle?.participants?.length) {
        next = {
          ...next,
          mealBattle: {
            ...next.mealBattle,
            participants: next.mealBattle.participants.map((p) =>
              p.memberId === id ? { ...p, name: cleaned } : p
            ),
          },
        };
      }
      const now = Date.now();
      next = { ...next, updatedAt: now };
      stateRef.current = next;
      stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, now);
      membersAuthoritativeSaveUntilRef.current = Date.now() + 120_000;
      pendingUnsyncedRef.current = true;
      try {
        cacheBroadcastStateSnapshot(next, user?.id);
      } catch {}
      notifyBroadcastStateLocalUpdated(user?.id, next.updatedAt);
      /**
       * 개명은 membersAuthoritative + 이름만 서버 반영.
       * donorsAuthoritative 는 불완전 React donors 로 후원 전체가 지워질 수 있음.
       */
      void saveStateAsync(next, user?.id, {
        membersAuthoritative: true,
        omitDonationFields: true,
      }).then((r) => {
        if (r.ok) {
          pendingUnsyncedRef.current = false;
          setSyncStatus(r.storageFallback ? "error" : "synced");
          if (typeof r.serverUpdatedAt === "number" && Number.isFinite(r.serverUpdatedAt)) {
            stateUpdatedAtRef.current = r.serverUpdatedAt;
            lastAppliedRemoteUpdatedAtRef.current = r.serverUpdatedAt;
          }
        } else {
          setSyncStatus(typeof navigator !== "undefined" && !navigator.onLine ? "local" : "error");
        }
      });
      return next;
    });
  };

  const resetMemberAmounts = (id: string) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        members: prev.members.map((x: Member) => (x.id === id ? { ...x, account: 0, toon: 0, contribution: 0, restroom: 0 } : x)),
      };
      persistState(next, { includeDonationFields: true });
      return next;
    });
  };

  const resetAllMembersAmounts = () => {
    requestConfirm("모든 멤버 금액 리셋", "모든 멤버의 계좌/투네/기여도/화장실을 0으로 리셋할까요?", () => {
      setState((prev: AppState) => {
        const next: AppState = {
          ...prev,
          members: prev.members.map((x: Member) => ({ ...x, account: 0, toon: 0, contribution: 0, restroom: 0 })),
        };
        persistState(next, { includeDonationFields: true });
        return next;
      });
    }, { confirmText: "리셋", danger: true });
  };

  const deleteMember = (id: string) => {
    let lsForWarn: AppState | null = null;
    try {
      lsForWarn = loadState(user?.id) ?? null;
    } catch {}
    const reactDonorsForWarn = normalizeDonorsArray(state.donors);
    const lsDonorsForWarn = normalizeDonorsArray(lsForWarn?.donors);
    const donorsForWarn = reactDonorsForWarn.length > 0 ? reactDonorsForWarn : lsDonorsForWarn;
    const target = state.members.find((m) => m.id === id);
    const donorsCount = donorsForWarn.filter((d) => d.memberId === id).length;
    const warn =
      `멤버를 삭제합니다.\n` +
      `이름: ${target?.name ?? id}\n` +
      `계좌: ${target?.account ?? 0}, 투네: ${target?.toon ?? 0}, 기여도: ${target?.contribution ?? 0}\n` +
      `연결된 후원 기록: ${donorsCount}건 (후원 기록은 유지, 엑셀표에서만 제거)\n\n` +
      `삭제 후에는 되돌릴 수 없습니다. 계속할까요?`;
    requestConfirm("멤버 삭제", warn, () => {
      setState((prev: AppState) => {
        const members = prev.members.filter((m) => m.id !== id);
        const reactDonors = normalizeDonorsArray(prev.donors);
        const refDonors = normalizeDonorsArray(stateRef.current?.donors);
        let lsDonors: Donor[] = [];
        let lsUpdatedAt = 0;
        try {
          const fromLs = loadState(user?.id);
          lsDonors = normalizeDonorsArray(fromLs?.donors);
          lsUpdatedAt = Number(fromLs?.updatedAt || 0);
        } catch {}
        /** React·ref·LS 중 가장 풍부한 donors — 불완전 목록으로 donorsReplace 금지 */
        let mergedDonors = reactDonors;
        for (const source of [refDonors, lsDonors]) {
          if (source.length === 0) continue;
          mergedDonors =
            mergedDonors.length === 0
              ? source
              : source.length > mergedDonors.length
                ? mergeDonorsForMultiTabSave(mergedDonors, source, {
                    incomingUpdatedAt: Number(prev.updatedAt || 0),
                    existingUpdatedAt: lsUpdatedAt,
                  })
                : mergeDonorsForMultiTabSave(source, mergedDonors, {
                    incomingUpdatedAt: lsUpdatedAt,
                    existingUpdatedAt: Number(prev.updatedAt || 0),
                  });
        }
        /** 후원 기록(donors)은 유지 — 로스터에서만 제거, orphan memberId 행은 합산·엑셀표에서 제외 */
        const donors = mergedDonors;
        const nextSigMatch = { ...(prev.sigMatch || {}) };
        const nextMealMatch = { ...(prev.mealMatch || {}) };
        delete nextSigMatch[id];
        delete nextMealMatch[id];
        const prevLinks = prev.sigMatchSettings?.donationLinks || {};
        const nextLinks = { ...prevLinks };
        delete nextLinks[id];
        let next: AppState = {
          ...prev,
          members,
          memberPositions: Object.fromEntries(
            Object.entries(prev.memberPositions || {}).filter(([k]) => k !== id)
          ),
          rankPositionLabels: fitRankPositionLabelsToMemberCount(
            prev.rankPositionLabels,
            members.length
          ),
          donors,
          sigMatch: nextSigMatch,
          mealMatch: nextMealMatch,
          sigMatchSettings: {
            ...prev.sigMatchSettings,
            participantMemberIds: (prev.sigMatchSettings?.participantMemberIds || []).filter((x) => x !== id),
            donationLinks: nextLinks,
            sigMatchPools: (prev.sigMatchSettings?.sigMatchPools || []).map((pool) => ({
              ...pool,
              memberIds: (pool.memberIds || []).filter((x) => x !== id),
            })),
          },
          mealBattle: {
            ...prev.mealBattle,
            participants: (prev.mealBattle?.participants || []).filter((p) => p.memberId !== id),
            memberGaugeColors: Object.fromEntries(
              Object.entries(prev.mealBattle?.memberGaugeColors || {}).filter(([k]) => k !== id)
            ),
            teamAMemberIds: (prev.mealBattle?.teamAMemberIds || []).filter((x) => x !== id),
            teamBMemberIds: (prev.mealBattle?.teamBMemberIds || []).filter((x) => x !== id),
          },
          mealMatchSettings: {
            ...prev.mealMatchSettings,
            teamAMemberIds: (prev.mealMatchSettings?.teamAMemberIds || []).filter((x) => x !== id),
            teamBMemberIds: (prev.mealMatchSettings?.teamBMemberIds || []).filter((x) => x !== id),
          },
          updatedAt: Date.now(),
        };
        next = guardMemberTotalsAgainstAccidentalZeroWipe(
          syncMemberTotalsFromDonors(next),
          prev
        );
        const now = Date.now();
        next = { ...next, updatedAt: now, membersRosterUpdatedAt: now };
        stateRef.current = next;
        stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, now);
        membersAuthoritativeSaveUntilRef.current = Date.now() + 120_000;
        pendingUnsyncedRef.current = true;
        try {
          cacheBroadcastStateSnapshot(next, user?.id);
        } catch {}
        notifyBroadcastStateLocalUpdated(user?.id, next.updatedAt);
        void saveStateAsync(next, user?.id, {
          membersAuthoritative: true,
          omitDonationFields: true,
        }).then((r) => {
          showServerPersistToast(`멤버 삭제 · ${target?.name ?? id}`, {
            ok: r.ok,
            storageFallback: r.storageFallback,
          });
          if (r.ok) {
            pendingUnsyncedRef.current = false;
            setSyncStatus(r.storageFallback ? "error" : "synced");
            if (typeof r.serverUpdatedAt === "number" && Number.isFinite(r.serverUpdatedAt)) {
              stateUpdatedAtRef.current = r.serverUpdatedAt;
              lastAppliedRemoteUpdatedAtRef.current = r.serverUpdatedAt;
            }
          } else {
            setSyncStatus(typeof navigator !== "undefined" && !navigator.onLine ? "local" : "error");
          }
        });
        return next;
      });
      if (donorMemberId === id) {
        const nextId = state.members.find((m) => m.id !== id)?.id ?? null;
        setDonorMemberId(nextId);
      }
    }, { confirmText: "삭제", danger: true });
  };

  const addMember = () => {
    const base = (newMemberName || `멤버${state.members.length + 1}`).trim();
    if (!base) return;
    const id = `m_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    setState((prev: AppState) => {
      const members = [
        ...prev.members,
        { id, name: base, account: 0, toon: 0, contribution: 0, restroom: 0 },
      ];
      const now = Date.now();
      const prevParticipants = prev.mealBattle?.participants || [];
      const mealFallbackColors = ["#f472b6", "#fb7185", "#f9a8d4", "#fda4af", "#e879f9"];
      /** 식사대전 참가자가 이미 있으면 새 멤버도 슬롯에 바로 붙임(옵트인 목록 유지) */
      const nextParticipants =
        prevParticipants.length > 0
          ? [
              ...prevParticipants,
              {
                memberId: id,
                name: base,
                score: 0,
                goal: Math.max(1, Math.floor(Number(prev.mealBattle?.totalGoal) || 0) || 100),
                color: mealFallbackColors[members.length % mealFallbackColors.length],
                donationLinkActive: true,
              },
            ]
          : prevParticipants;
      const next: AppState = {
        ...prev,
        members,
        memberPositions: { ...(prev.memberPositions || {}) },
        rankPositionLabels: fitRankPositionLabelsToMemberCount(
          prev.rankPositionLabels,
          members.length
        ),
        sigMatch: { ...(prev.sigMatch || {}), [id]: 0 },
        mealMatch: { ...(prev.mealMatch || {}), [id]: 0 },
        mealBattle: {
          ...prev.mealBattle,
          participants: nextParticipants,
        },
        updatedAt: now,
        membersRosterUpdatedAt: now,
      };
      /** 폴링·다른 탭보다 먼저 LS·ref·stamp에 올려 경합으로 멤버가 사라지지 않게 */
      stateRef.current = next;
      stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, now);
      membersAuthoritativeSaveUntilRef.current = Date.now() + 120_000;
      pendingUnsyncedRef.current = true;
      /** React donors 가 비어도 서버 donors 는 omitDonationFields 로 건드리지 않음 */
      const toPersist: AppState = next;
      try {
        cacheBroadcastStateSnapshot(toPersist, user?.id);
      } catch {}
      notifyBroadcastStateLocalUpdated(user?.id, toPersist.updatedAt);
      /** persistState 큐 경합을 피하고 멤버 권위 저장을 즉시 보냄 (후원 필드 제외) */
      void saveStateAsync(toPersist, user?.id, {
        membersAuthoritative: true,
        omitDonationFields: true,
      }).then((r) => {
        showServerPersistToast(`멤버 추가 · ${base}`, {
          ok: r.ok,
          storageFallback: r.storageFallback,
        });
        if (!r.ok) {
          setSyncStatus(typeof navigator !== "undefined" && !navigator.onLine ? "local" : "error");
          setSigExcelResult("멤버 추가를 서버에 저장하지 못했습니다. 네트워크 후 다시 추가해 주세요.");
          return;
        }
        pendingUnsyncedRef.current = false;
        setSyncStatus(r.storageFallback ? "error" : "synced");
        if (typeof r.serverUpdatedAt === "number" && Number.isFinite(r.serverUpdatedAt)) {
          stateUpdatedAtRef.current = r.serverUpdatedAt;
          lastAppliedRemoteUpdatedAtRef.current = r.serverUpdatedAt;
        }
        /** 저장 성공 후 미리보기 iframe·OBS가 SSE membersRosterUpdatedAt 으로 즉시 동기화 */
        try {
          const stamped: AppState = {
            ...toPersist,
            ...stateRef.current,
            members: stateRef.current.members,
            memberPositions: stateRef.current.memberPositions,
            rankPositionLabels: stateRef.current.rankPositionLabels,
            membersRosterUpdatedAt: Math.max(
              Number(stateRef.current.membersRosterUpdatedAt || 0),
              typeof r.serverUpdatedAt === "number" ? r.serverUpdatedAt : 0,
              Number(toPersist.updatedAt || 0)
            ),
            donors:
              normalizeDonorsArray(stateRef.current.donors).length > 0
                ? stateRef.current.donors
                : toPersist.donors,
            updatedAt: Math.max(
              Number(stateRef.current.updatedAt || 0),
              Number(toPersist.updatedAt || 0),
              typeof r.serverUpdatedAt === "number" ? r.serverUpdatedAt : Date.now()
            ),
          };
          stateRef.current = stamped;
          cacheBroadcastStateSnapshot(stamped, user?.id);
          notifyBroadcastStateLocalUpdated(user?.id, stamped.updatedAt);
        } catch {
          notifyBroadcastStateLocalUpdated(user?.id, r.serverUpdatedAt ?? Date.now());
        }
      });
      return next;
    });
    setNewMemberName("");
  };

  const updateMemberPosition = (memberId: string, position: string) => {
    setState((prev: AppState) => {
      const cleaned = (position || "").trim();
      const nextMap = { ...(prev.memberPositions || {}) };
      if (cleaned) nextMap[memberId] = cleaned;
      else delete nextMap[memberId];
      const next: AppState = { ...prev, memberPositions: nextMap };
      persistState(next, { includeDonationFields: true });
      return next;
    });
  };

  const updateMemberPositionMode = (mode: AppState["memberPositionMode"]) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        memberPositionMode: mode,
        ...(mode === "rankLinked"
          ? {
              rankPositionLabels: fitRankPositionLabelsToMemberCount(
                prev.rankPositionLabels,
                prev.members.length
              ),
            }
          : {}),
      };
      persistState(next, { includeDonationFields: true });
      return next;
    });
  };

  const updateRepresentativeMember = (memberId: string) => {
    setState((prev: AppState) => {
      const nextMap = { ...(prev.memberPositions || {}) };
      for (const m of prev.members) {
        if (nextMap[m.id] === "대표") delete nextMap[m.id];
      }
      if (memberId) nextMap[memberId] = "대표";
      const next: AppState = { ...prev, memberPositions: nextMap };
      persistState(next, { includeDonationFields: true });
      return next;
    });
  };

  const updateRankPositionLabel = (index: number, value: string) => {
    setState((prev: AppState) => {
      const labels = fitRankPositionLabelsToMemberCount(
        prev.rankPositionLabels,
        prev.members.length
      );
      if (index < 0 || index >= labels.length) return prev;
      labels[index] = value;
      const next: AppState = { ...prev, rankPositionLabels: labels };
      persistState(next, { includeDonationFields: true });
      return next;
    });
  };

  const updateSigMatchSettings = (patch: Partial<AppState["sigMatchSettings"]>) => {
    setState((prev: AppState) => {
      const valid = new Set(prev.members.map((mm) => mm.id));
      const merged: AppState["sigMatchSettings"] = {
        ...prev.sigMatchSettings,
        sigMatchPools: prev.sigMatchSettings.sigMatchPools ?? [],
        donationLinks: prev.sigMatchSettings.donationLinks ?? {},
        ...patch,
      };
      let donationSyncMode = prev.donationSyncMode || "mealBattle";
      if (patch.isActive === true) donationSyncMode = "sigMatch";
      const next: AppState = {
        ...prev,
        donationSyncMode,
        sigMatchSettings: {
          ...merged,
          sigMatchPools: normalizeSigMatchPools(merged.sigMatchPools, valid),
          participantMemberIds: normalizeSigMatchParticipantIds(merged.participantMemberIds, valid),
          donationLinks: normalizeSigMatchDonationLinks(merged.donationLinks, valid),
        },
        updatedAt: Date.now(),
      };
      /** 시그매치 설정만 — 후원 금액은 API에서 제외 */
      persistState(next, { omitDonationFields: true });
      return next;
    });
  };

  const persistSigMatchDonationLinksOnly = (next: AppState) => {
    persistState(next, { omitDonationFields: true, omitHighSocietyFields: true });
  };

  /** 시그 대전 멤버별 후원 연동 ON/OFF (엑셀 배정 donors → 시그 점수) */
  const toggleSigDonationLink = (memberId: string) => {
    setState((prev: AppState) => {
      if (!prev.members.some((m) => m.id === memberId)) return prev;
      const valid = new Set(prev.members.map((m) => m.id));
      const current = resolveSigMatchDonationLink(prev.sigMatchSettings, memberId);
      const nextActive = !current.active;
      const donationLinks = {
        ...(prev.sigMatchSettings.donationLinks || {}),
        [memberId]: nextActive
          ? current.active && Number(current.startedAt || 0) > 0
            ? { active: true, startedAt: current.startedAt }
            : { active: true, startedAt: Date.now() }
          : { active: false, startedAt: current.startedAt || undefined },
      };
      const next: AppState = {
        ...prev,
        donationSyncMode:
          nextActive && (!prev.donationSyncMode || prev.donationSyncMode === "none")
            ? "sigMatch"
            : prev.donationSyncMode,
        sigMatchSettings: {
          ...prev.sigMatchSettings,
          donationLinks: normalizeSigMatchDonationLinks(donationLinks, valid),
        },
        updatedAt: Date.now(),
      };
      persistSigMatchDonationLinksOnly(next);
      return next;
    });
  };

  const setAllSigDonationLinks = (active: boolean) => {
    setState((prev: AppState) => {
      const playable = prev.members.filter(
        (m) => !isOperatingSettlementMember(m, prev.memberPositions)
      );
      const valid = new Set(playable.map((m) => m.id));
      const ids = prev.sigMatchSettings?.participantMemberIds ?? [];
      const targets =
        ids.length > 0 ? ids.filter((id) => valid.has(id)) : playable.map((m) => m.id);
      const now = Date.now();
      const donationLinks: Record<string, { active: boolean; startedAt?: number }> = {
        ...(prev.sigMatchSettings.donationLinks || {}),
      };
      for (const id of targets) {
        const prevLink = donationLinks[id];
        donationLinks[id] = active
          ? prevLink?.active && Number(prevLink.startedAt || 0) > 0
            ? { active: true, startedAt: prevLink.startedAt }
            : { active: true, startedAt: now }
          : { active: false, startedAt: prevLink?.startedAt };
      }
      const next: AppState = {
        ...prev,
        donationSyncMode: active ? "sigMatch" : prev.donationSyncMode,
        sigMatchSettings: {
          ...prev.sigMatchSettings,
          donationLinks: normalizeSigMatchDonationLinks(donationLinks, valid),
        },
        updatedAt: Date.now(),
      };
      persistSigMatchDonationLinksOnly(next);
      return next;
    });
  };

  const setSigMatchDraftEditing = (key: keyof typeof sigMatchNumericDraft, editing: boolean) => {
    sigMatchNumericEditingRef.current[key] = editing;
  };

  const commitSigMatchTargetCountDraft = () => {
    setSigMatchDraftEditing("targetCount", false);
    const n = Number.parseInt(sigMatchNumericDraft.targetCount || "100", 10);
    const next = Number.isFinite(n) ? Math.max(1, n) : 100;
    setSigMatchNumericDraft((prev) => ({ ...prev, targetCount: String(next) }));
    updateSigMatchSettings({ targetCount: next });
  };

  const commitSigMatchIncentiveDraft = () => {
    setSigMatchDraftEditing("incentivePerPoint", false);
    const n = Number.parseInt(sigMatchNumericDraft.incentivePerPoint || "1000", 10);
    const next = Number.isFinite(n) ? Math.max(0, n) : 1000;
    setSigMatchNumericDraft((prev) => ({ ...prev, incentivePerPoint: String(next) }));
    updateSigMatchSettings({ incentivePerPoint: next });
  };

  const commitSigMatchTimerDurationDraft = () => {
    setSigMatchDraftEditing("overlayTimerDurationSec", false);
    const n = Number.parseInt(sigMatchNumericDraft.overlayTimerDurationSec || "0", 10);
    const next = Number.isFinite(n) ? Math.max(0, Math.min(86400, n)) : 0;
    setSigMatchNumericDraft((prev) => ({ ...prev, overlayTimerDurationSec: String(next) }));
    setState((prev: AppState) => {
      const valid = new Set(prev.members.map((mm) => mm.id));
      const merged: AppState["sigMatchSettings"] = {
        ...prev.sigMatchSettings,
        sigMatchPools: prev.sigMatchSettings.sigMatchPools ?? [],
        donationLinks: prev.sigMatchSettings.donationLinks ?? {},
        overlayTimerDurationSec: next,
      };
      const now = Date.now();
      /** 정지·대기 중이면 남은 시간도 설정 초와 맞춤 — OBS·백오피스 불일치 방지 */
      const syncTimer =
        !prev.matchTimer?.isActive
          ? {
              remainingTime: next,
              isActive: false,
              lastUpdated: now,
            }
          : prev.matchTimer ?? prev.generalTimer;
      const nextState: AppState = {
        ...prev,
        sigMatchSettings: {
          ...merged,
          sigMatchPools: normalizeSigMatchPools(merged.sigMatchPools, valid),
          participantMemberIds: normalizeSigMatchParticipantIds(merged.participantMemberIds, valid),
          donationLinks: normalizeSigMatchDonationLinks(merged.donationLinks, valid),
        },
        matchTimer: syncTimer,
        updatedAt: now,
      };
      persistState(nextState, { omitDonationFields: true });
      if (!prev.matchTimer?.isActive) {
        void saveMatchTimerPatchAsync(syncTimer, user?.id);
      }
      return nextState;
    });
  };

  const resolveOverlayTimerDurationSec = useCallback((): number => {
    const raw = sigMatchNumericEditingRef.current.overlayTimerDurationSec
      ? sigMatchNumericDraft.overlayTimerDurationSec
      : String(state.sigMatchSettings?.overlayTimerDurationSec ?? 180);
    const n = Number.parseInt(raw || "0", 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(86400, n)) : 0;
  }, [sigMatchNumericDraft.overlayTimerDurationSec, state.sigMatchSettings?.overlayTimerDurationSec]);

  const commitSigMatchManualAddStepDraft = () => {
    setSigMatchDraftEditing("manualAddStep", false);
    const n = Number.parseInt(sigMatchNumericDraft.manualAddStep || "1", 10);
    const next = Number.isFinite(n) ? Math.max(1, n) : 1;
    setSigMatchNumericDraft((prev) => ({ ...prev, manualAddStep: String(next) }));
    updateSigMatchSettings({ manualAddStep: next });
  };

  const commitSigMatchManualDeductStepDraft = () => {
    setSigMatchDraftEditing("manualDeductStep", false);
    const n = Number.parseInt(sigMatchNumericDraft.manualDeductStep || "1", 10);
    const next = Number.isFinite(n) ? Math.max(1, n) : 1;
    setSigMatchNumericDraft((prev) => ({ ...prev, manualDeductStep: String(next) }));
    updateSigMatchSettings({ manualDeductStep: next });
  };

  const updateMealMatchSettings = (patch: Partial<AppState["mealMatchSettings"]>) => {
    setState((prev: AppState) => {
      let next: AppState = {
        ...prev,
        mealMatchSettings: {
          ...prev.mealMatchSettings,
          ...patch,
        },
      };
      if (patch.isActive === true) {
        next = enableMealBattleDonationSync(next, { recalculateFromDonors: true });
      }
      persistState(next);
      return next;
    });
  };

  const updateDonorRankingsTheme = (patch: Partial<AppState["donorRankingsTheme"]>) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        donorRankingsTheme: {
          ...(prev.donorRankingsTheme || defaultState().donorRankingsTheme),
          ...patch,
        },
        updatedAt: Date.now(),
      };
      persistVisualSettings(next, { donorRankingsTheme: next.donorRankingsTheme });
      return next;
    });
  };

  const updateDonationListsOverlayConfig = (patch: Partial<OverlayConfig>) => {
    setState((prev: AppState) => {
      const base = normalizeDonationListsOverlayConfig(prev.donationListsOverlayConfig);
      const merged = normalizeDonationListsOverlayConfig({ ...base, ...patch });
      const next: AppState = {
        ...prev,
        donationListsOverlayConfig: merged,
        updatedAt: Date.now(),
      };
      persistVisualSettings(next, { donationListsOverlayConfig: next.donationListsOverlayConfig });
      return next;
    });
  };

  const updateDonorRankingsOverlayConfig = (patch: Partial<OverlayConfig>) => {
    setState((prev: AppState) => {
      const base = normalizeDonorRankingsOverlayConfig(prev.donorRankingsOverlayConfig);
      const next: AppState = {
        ...prev,
        donorRankingsOverlayConfig: { ...base, ...patch },
        updatedAt: Date.now(),
      };
      persistVisualSettings(next, { donorRankingsOverlayConfig: next.donorRankingsOverlayConfig });
      return next;
    });
  };

  /** 후원순위 오버레이 본문 이미지 */
  const updateDonorRankingsBodyImageConfig = (patch: Partial<OverlayConfig>) => {
    setState((prev: AppState) => {
      const base = normalizeDonorRankingsOverlayConfig(prev.donorRankingsOverlayConfig);
      const next: AppState = {
        ...prev,
        donorRankingsOverlayConfig: normalizeDonorRankingsOverlayConfig({ ...base, ...patch }),
        updatedAt: Date.now(),
      };
      persistVisualSettings(next, {
        donorRankingsOverlayConfig: next.donorRankingsOverlayConfig,
      });
      return next;
    });
  };

  const applyDonorRankingsPreset = (id: string) => {
    setState((prev: AppState) => {
      const builtIn = BUILT_IN_DONOR_RANKINGS_PRESETS.find((x) => x.id === id);
      const preset = builtIn || (prev.donorRankingsPresets || []).find((x) => x.id === id);
      if (!preset) return prev;
      const next: AppState = {
        ...prev,
        donorRankingsPresetId: id,
        donorRankingsTheme: { ...preset.theme },
        updatedAt: Date.now(),
      };
      persistVisualSettings(next, {
        donorRankingsPresetId: next.donorRankingsPresetId,
        donorRankingsTheme: next.donorRankingsTheme,
      });
      return next;
    });
  };

  const saveDonorRankingsPreset = () => {
    const name = (donorRankingPresetName || "").trim() || `후원순위 프리셋 ${(state.donorRankingsPresets?.length || 0) + 1}`;
    setState((prev: AppState) => {
      const preset = {
        id: `drp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name,
        theme: { ...(prev.donorRankingsTheme || defaultState().donorRankingsTheme) },
      };
      const next: AppState = {
        ...prev,
        donorRankingsPresets: [...(prev.donorRankingsPresets || []), preset],
        donorRankingsPresetId: preset.id,
        updatedAt: Date.now(),
      };
      persistVisualSettings(next, {
        donorRankingsPresets: next.donorRankingsPresets,
        donorRankingsPresetId: next.donorRankingsPresetId,
      });
      return next;
    });
    setDonorRankingPresetName("");
  };

  const deleteDonorRankingsPreset = (id: string) => {
    if (isBuiltInDonorRankingsPresetId(id)) return;
    setState((prev: AppState) => {
      const presets = (prev.donorRankingsPresets || []).filter((x) => x.id !== id);
      const next: AppState = {
        ...prev,
        donorRankingsPresets: presets,
        donorRankingsPresetId: prev.donorRankingsPresetId === id ? presets[0]?.id : prev.donorRankingsPresetId,
        updatedAt: Date.now(),
      };
      persistVisualSettings(next, {
        donorRankingsPresets: next.donorRankingsPresets,
        donorRankingsPresetId: next.donorRankingsPresetId,
      });
      return next;
    });
  };

  const MEAL_PARTICIPANT_COLORS = ["#60a5fa", "#f59e0b", "#22c55e", "#ef4444", "#a78bfa", "#06b6d4", "#f472b6"];

  const updateMealBattle = (patch: Partial<AppState["mealBattle"]>) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          ...patch,
        },
      };
      persistState(next);
      return next;
    });
  };

  const toggleMealParticipant = (memberId: string, checked: boolean) => {
    setState((prev: AppState) => {
      const member = prev.members.find((m) => m.id === memberId);
      if (!member) return prev;
      if (isOperatingSettlementMember(member, prev.memberPositions)) return prev;
      const existing = prev.mealBattle?.participants || [];
      const exists = existing.some((p) => p.memberId === memberId);
      let participants = existing;
      if (checked && !exists) {
        const linkStartedAt = Date.now();
        participants = [
          ...existing,
          {
            memberId,
            name: member.name,
            score: 0,
            goal: Math.max(1, Math.floor(prev.mealBattle?.totalGoal || 100)),
            color:
              prev.mealBattle?.memberGaugeColors?.[memberId] ||
              MEAL_PARTICIPANT_COLORS[existing.length % MEAL_PARTICIPANT_COLORS.length],
            donationLinkActive: true,
            donationLinkStartedAt: linkStartedAt,
          },
        ];
      } else if (!checked && exists) {
        participants = existing.filter((p) => p.memberId !== memberId);
      }
      const next: AppState = {
        ...prev,
        donationSyncMode:
          (prev.donationSyncMode === "none" || !prev.donationSyncMode) && checked
            ? "mealBattle"
            : prev.donationSyncMode || "mealBattle",
        mealBattle: {
          ...prev.mealBattle,
          participants: checked
            ? recalculateMealParticipantScoresFromDonors(
                { ...prev.mealBattle, participants },
                prev.donors
              )
            : participants,
        },
      };
      persistState(next);
      return next;
    });
  };

  const updateMealParticipant = (
    memberId: string,
    updater: (participant: AppState["mealBattle"]["participants"][number]) => AppState["mealBattle"]["participants"][number]
  ) => {
    setState((prev: AppState) => {
      const participants = (prev.mealBattle?.participants || []).map((p) => (p.memberId === memberId ? updater(p) : p));
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          participants,
        },
      };
      persistState(next);
      return next;
    });
  };

  /** 참가 체크 없이 연동만 켠 경우에도 참가자 행을 만들고, 동기화 모드를 식대전으로 맞춤 */
  const toggleMealDonationLink = (memberId: string) => {
    setState((prev: AppState) => {
      const member = prev.members.find((m) => m.id === memberId);
      if (!member) return prev;
      if (isOperatingSettlementMember(member, prev.memberPositions)) return prev;
      const withRow = ensureMealBattleParticipantRow(
        prev.mealBattle,
        member,
        MEAL_PARTICIPANT_COLORS,
        prev.memberPositions
      );
      let enabling = false;
      const participants = withRow.map((p) => {
        if (p.memberId !== memberId) return p;
        const nextActive = !p.donationLinkActive;
        if (nextActive) enabling = true;
        return {
          ...p,
          donationLinkActive: nextActive,
          donationLinkStartedAt: nextActive ? Date.now() : undefined,
        };
      });
      let next: AppState = {
        ...prev,
        donationSyncMode:
          enabling && (!prev.donationSyncMode || prev.donationSyncMode === "none")
            ? "mealBattle"
            : prev.donationSyncMode,
        mealBattle: { ...prev.mealBattle, participants },
        updatedAt: Date.now(),
      };
      if (enabling) {
        next = {
          ...next,
          mealBattle: {
            ...next.mealBattle,
            participants: recalculateMealParticipantScoresFromDonors(next.mealBattle, next.donors),
          },
        };
      }
      persistState(next);
      return next;
    });
  };

  const mergeMealMemberGaugeColor = (memberId: string, color: string) => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          memberGaugeColors: { ...(prev.mealBattle?.memberGaugeColors || {}), [memberId]: color },
        },
      };
      persistState(next);
      return next;
    });
  };

  const patchMealParticipantColor = (memberId: string, color: string) => {
    setState((prev: AppState) => {
      const participants = (prev.mealBattle?.participants || []).map((p) =>
        p.memberId === memberId ? { ...p, color } : p
      );
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          participants,
          memberGaugeColors: { ...(prev.mealBattle?.memberGaugeColors || {}), [memberId]: color },
        },
      };
      persistState(next);
      return next;
    });
  };

  const setMealBattleMemberTeam = (memberId: string, team: "" | "A" | "B") => {
    setState((prev: AppState) => {
      const member = prev.members.find((m) => m.id === memberId);
      if (member && isOperatingSettlementMember(member, prev.memberPositions)) return prev;
      const a = (prev.mealBattle?.teamAMemberIds || []).filter((id) => id !== memberId);
      const b = (prev.mealBattle?.teamBMemberIds || []).filter((id) => id !== memberId);
      const nextA = team === "A" ? [...a, memberId] : a;
      const nextB = team === "B" ? [...b, memberId] : b;
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          teamAMemberIds: nextA,
          teamBMemberIds: nextB,
        },
      };
      persistState(next);
      return next;
    });
  };

  const resetMealMatchScores = () => {
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        mealBattle: {
          ...prev.mealBattle,
          participants: (prev.mealBattle?.participants || []).map((p) => ({ ...p, score: 0 })),
        },
      };
      persistState(next);
      return next;
    });
  };

  const adjustSigMatchManual = (memberId: string, delta: number) => {
    if (!Number.isFinite(delta) || delta === 0) return;
    setState((prev: AppState) => {
      const current = prev.sigMatch?.[memberId] ?? 0;
      const nextAdjust = current + delta;
      const sigMatch = { ...(prev.sigMatch || {}) };
      if (nextAdjust === 0) delete sigMatch[memberId];
      else sigMatch[memberId] = nextAdjust;
      /** updatedAt 미상승 시 원격 병합이 구 보정값을 최신으로 오인하고 0으로 덮음 */
      const next: AppState = { ...prev, sigMatch, updatedAt: Date.now() };
      stateRef.current = next;
      persistState(next);
      return next;
    });
  };

  const setSigMatchManualAdjust = (memberId: string, value: number) => {
    if (!Number.isFinite(value)) return;
    setState((prev: AppState) => {
      const sigMatch = { ...(prev.sigMatch || {}) };
      if (value === 0) delete sigMatch[memberId];
      else sigMatch[memberId] = value;
      const next: AppState = { ...prev, sigMatch, updatedAt: Date.now() };
      stateRef.current = next;
      persistState(next);
      return next;
    });
  };

  const toggleSigRollingItem = (id: string, checked: boolean) => {
    if (id === ONE_SHOT_SIG_ID) return;
    setState((prev: AppState) => {
      const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
      if (checked) {
        const existingOrders = Object.values(meta)
          .map((x) => Number(x?.order))
          .filter((x) => Number.isFinite(x)) as number[];
        const nextOrder = existingOrders.length ? Math.max(...existingOrders) + 1 : 0;
        meta[id] = { ...(meta[id] || {}), order: meta[id]?.order ?? nextOrder };
      }
      const draft: AppState = {
        ...prev,
        sigRollingMeta: meta,
        sigInventory: (prev.sigInventory || []).map((x) => (x.id === id ? { ...x, isRolling: checked } : x)),
      };
      const next = syncOneShotSigItem(draft);
      persistState(next, { omitDonationFields: true });
      return next;
    });
  };

  const toggleSigActiveItem = (id: string, checked: boolean) => {
    setState((prev: AppState) => {
      const draft: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => (x.id === id ? { ...x, isActive: checked } : x)),
      };
      const next = syncOneShotSigItem(draft);
      persistState(next, { omitDonationFields: true });
      return next;
    });
  };

  const spinSigRoulette = async (opts?: { forceFiveOnly?: boolean }) => {
    /** 오버레이 URL의 `u=` 와 동일해야 폴링 상태가 맞음 (로그인 계정만) */
    const uid = rouletteUserId;
    setRouletteSpinBusy(true);
    setRouletteActionMessage("");
    try {
      const rs = state.rouletteState;
      if (rs) {
        const idle = (rs.phase || "IDLE") === "IDLE";
        const blockedUntilReset =
          !idle ||
          rs.isRolling ||
          (rs.selectedSigs || []).length > 0 ||
          Boolean(rs.oneShotResult);
        if (blockedUntilReset) {
          setRouletteActionMessage("이전 회전 결과를 초기화한 뒤 회전을 시작합니다…");
          try {
            const resetRes = await fetch(`/api/roulette/reset?user=${encodeURIComponent(uid)}`, {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({}),
            });
            const resetJ = (await resetRes.json().catch(() => ({}))) as { ok?: boolean; error?: string };
            if (!resetRes.ok) {
              setRouletteActionMessage(
                `회전판 초기화 실패: ${resetJ.error || resetRes.status}. 아래「회전판 초기화 (IDLE)」를 누른 뒤 다시 시도하세요.`
              );
              return;
            }
            const remoteAfterReset = await loadStateFromApi(uid);
            if (remoteAfterReset) {
              setState(remoteAfterReset);
              try {
                cacheBroadcastStateSnapshot(remoteAfterReset, uid);
              } catch {}
            }
          } catch (e) {
            setRouletteActionMessage(`회전판 초기화 오류: ${String(e)}`);
            return;
          }
        }
      }
      const n = Math.max(1, Math.min(999, parseInt(String(rouletteSpinCount || "5"), 10) || 5));
      const cap = Math.min(n, ROULETTE_ROUND_UI_CAP);
      let parts = roulettePriceRanges.slice(0, cap);
      while (parts.length < cap) parts.push({ min: "", max: "" });
      const toRange = (v: { min: string; max: string }): { min: number | null; max: number | null } | null => {
        const minRaw = String(v?.min || "").replace(/[^\d]/g, "");
        const maxRaw = String(v?.max || "").replace(/[^\d]/g, "");
        const minNum = minRaw ? Math.floor(Number.parseInt(minRaw, 10) || 0) : 0;
        const maxNum = maxRaw ? Math.floor(Number.parseInt(maxRaw, 10) || 0) : 0;
        const hasMin = minNum > 0;
        const hasMax = maxNum > 0;
        if (!hasMin && !hasMax) return null;
        const min = hasMin ? minNum : null;
        const max = hasMax ? maxNum : null;
        if (min != null && max != null && min > max) {
          return { min: max, max: min };
        }
        return { min, max };
      };
      const priceRanges: Array<{ min: number | null; max: number | null } | null> = parts.map(toRange);
      const pad = priceRanges[priceRanges.length - 1] ?? null;
      while (priceRanges.length < n) priceRanges.push(pad);
      const slotIds = rouletteForcedSlotIds.map((x) => String(x || "").trim()).filter(Boolean);
      const textIds = rouletteForcedSigIdsInput
        .split(/[\s,]+/)
        .map((x) => String(x || "").trim())
        .filter(Boolean);
      const fixedSigIds =
        slotIds.length === 5 && new Set(slotIds).size === 5
          ? slotIds
          : textIds.length === 5 && new Set(textIds).size === 5
            ? textIds
            : [];
      const useForcedCinematic = fixedSigIds.length === 5;
      if (opts?.forceFiveOnly) {
        if (!useForcedCinematic) {
          setRouletteActionMessage("강제 판매: 아래에서 서로 다른 시그 5개를 모두 선택한 뒤 「강제 5개 판매 실행」을 누르세요.");
          return;
        }
      } else if ((slotIds.length > 0 || textIds.length > 0) && !useForcedCinematic) {
        setRouletteActionMessage("강제 판매는 서로 다른 시그 5개가 필요합니다. (드롭다운 5칸 또는 ID 5개)");
        return;
      }
      const res = await fetch(`/api/roulette/spin?user=${encodeURIComponent(uid)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          useForcedCinematic
            ? {
                mode: "cinematic5",
                spinCount: 5,
                fixedSigIds,
                oneShotImageUrl: String(rouletteForcedOneShotImageUrl || "").trim() || undefined,
              }
            : { spinCount: n, priceRanges }
        ),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        round?: number;
        need?: number;
        have?: number;
        sessionId?: string;
        selectedSigs?: Array<{ id: string; name: string; price: number; imageUrl?: string }>;
        oneShot?: { id?: string; name?: string; price?: number } | null;
      };
      if (!res.ok) {
        setRouletteActionMessage(
          res.status === 401 || j.error === "unauthorized"
            ? "로그인 세션이 없거나 만료되었습니다. 새로고침 후 다시 로그인해 주세요."
            : j.error === "empty_inventory"
              ? "시그 인벤토리가 비어 있습니다."
              : j.error === "empty_price_tier"
                ? typeof j.round === "number"
                  ? `${j.round}회차: 선택한 금액대에 뽑을 시그가 없습니다.`
                  : "선택한 금액대에 남은 시그가 없습니다."
                : j.error === "empty_price_range"
                  ? typeof j.round === "number"
                    ? `${j.round}회차: 설정한 최소/최대 범위에 뽑을 시그가 없습니다.`
                    : "설정한 최소/최대 범위에 남은 시그가 없습니다."
                  : j.error === "not_enough_unique_sigs"
                    ? typeof j.need === "number" && typeof j.have === "number"
                      ? `서로 다른 시그가 부족합니다(필요 ${j.need}개 · 후보 ${j.have}개). 인벤토리를 늘리거나 뽑기 개수를 줄이세요.`
                      : "서로 다른 시그 수가 부족합니다."
                  : j.error === "invalid_fixed_sig_ids"
                    ? "강제 지정한 시그 ID 중 일부를 찾을 수 없습니다. ID 5개를 다시 확인해 주세요."
                    : `회전판 실패: ${j.error || res.status}`
        );
        return;
      }
      const remote = await loadStateFromApi(uid);
      if (remote) {
        setState(remote);
        try {
          cacheBroadcastStateSnapshot(remote, uid);
        } catch {}
      }
      if (useForcedCinematic) {
        const finishRes = await fetch(`/api/roulette/finish?user=${encodeURIComponent(uid)}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "cinematic5",
            finalPhase: "CONFIRMED",
            sessionId: String(j.sessionId || ""),
            selectedSigs: Array.isArray(j.selectedSigs) ? j.selectedSigs : undefined,
            oneShotResult: j.oneShot || undefined,
            reason: "forced5_immediate_confirm",
          }),
        });
        const finishJ = (await finishRes.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (!finishRes.ok || !finishJ.ok) {
          setRouletteActionMessage(
            `강제 5개 결과 생성은 성공했지만 판매 완료 확정이 실패했습니다: ${finishJ.error || finishRes.status}`
          );
          return;
        }
        const afterFinish = await loadStateFromApi(uid);
        if (afterFinish) {
          setState(afterFinish);
          try {
            cacheBroadcastStateSnapshot(afterFinish, uid);
          } catch {}
        }
        const forcedWinners = Array.isArray(j.selectedSigs) ? j.selectedSigs : [];
        if (forcedWinners.length > 0 && afterFinish?.rouletteState?.phase === "CONFIRMED") {
          setRouletteActionMessage(
            `강제 5개 판매 완료: ${forcedWinners.map((s) => s.name).join(", ")} · 재고·오버레이에 판매 완료 반영됨. OBS /overlay/sig-sales?u=${uid}`,
          );
        } else {
          setRouletteActionMessage(
            `강제 5개 판매 완료 처리까지 반영했습니다. 기존 판매 완료 이미지가 적용됩니다. 오버레이 /overlay/sig-sales?u=${uid} 에서 확인하세요.`,
          );
        }
        return;
      }
      const uniq = Array.from(
        new Set(
          priceRanges.map((x) => {
            if (!x) return "전체";
            const min = x.min != null ? x.min.toLocaleString("ko-KR") : "";
            const max = x.max != null ? x.max.toLocaleString("ko-KR") : "";
            if (min && max) return `${min}~${max}`;
            if (min) return `${min} 이상`;
            if (max) return `${max} 이하`;
            return "전체";
          })
        )
      );
      const priceLabel =
        uniq.length <= 1
          ? uniq[0] === "전체"
            ? " · 금액대 전체"
            : ` · 금액대 ${uniq[0]}원`
          : ` · 회차별 금액대 (${uniq.slice(0, 5).join(", ")}${uniq.length > 5 ? "…" : ""})`;
      setRouletteActionMessage(
        `회전 ${n}회 · 시그 ${n}개 당첨 확정(회전당 1개·중복 없음)${priceLabel}. 오버레이 /overlay/sig-sales (u=${uid}) 에서 확인하세요.`,
      );
    } catch (e) {
      setRouletteActionMessage(`회전판 요청 오류: ${String(e)}`);
    } finally {
      setRouletteSpinBusy(false);
    }
  };

  const resetRouletteIdle = async () => {
    const uid = rouletteUserId;
    setRouletteResetBusy(true);
    try {
      const res = await fetch(`/api/roulette/reset?user=${encodeURIComponent(uid)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearWonPool: true }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setRouletteActionMessage(`회전판 초기화 실패: ${j.error || res.status}`);
        return;
      }
      const remote = await loadStateFromApi(uid);
      if (remote) {
        setState(remote);
        try {
          cacheBroadcastStateSnapshot(remote, uid);
        } catch {}
      }
      setRouletteActionMessage(
        "회전판 상태를 IDLE로 초기화했습니다. 당첨 제외 목록도 비웠습니다. 오버레이 유령 결과가 사라집니다."
      );
    } catch (e) {
      setRouletteActionMessage(`회전판 초기화 오류: ${String(e)}`);
    } finally {
      setRouletteResetBusy(false);
    }
  };

  const adjustSigSoldCount = (id: string, delta: number) => {
    if (id === ONE_SHOT_SIG_ID) {
      setState((prev: AppState) => {
        const markSoldOut = delta > 0;
        const draft: AppState = {
          ...prev,
          sigInventory: (prev.sigInventory || []).map((x) => {
            if (x.id === ONE_SHOT_SIG_ID) return x;
            return { ...x, soldCount: markSoldOut ? Math.max(0, x.maxCount) : 0 };
          }),
        };
        const next = syncOneShotSigItem(draft);
        persistState(next);
        return next;
      });
      return;
    }
    setState((prev: AppState) => {
      const draft: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => {
          if (x.id !== id) return x;
          const soldCount = Math.max(0, Math.min(x.maxCount, (x.soldCount || 0) + delta));
          return { ...x, soldCount };
        }),
      };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
  };

  const updateSigItem = useCallback(
    (id: string, patch: Partial<AppState["sigInventory"][number]>) => {
      setState((prev: AppState) => {
        const sanitizedPatch =
          id === ONE_SHOT_SIG_ID
            ? {
                ...patch,
                /** 금액·재고는 자동 동기화. 이름·이미지·활성은 사용자가 편집 */
                price: undefined,
                maxCount: undefined,
                soldCount: undefined,
                isRolling: undefined,
              }
            : patch;
        const draft: AppState = {
          ...prev,
          sigInventory: (prev.sigInventory || []).map((x) => (x.id === id ? { ...x, ...sanitizedPatch } : x)),
          updatedAt: Date.now(),
        };
        const next = { ...syncOneShotSigItem(draft), updatedAt: draft.updatedAt };
        persistState(next);
        return next;
      });
    },
    [persistState, syncOneShotSigItem]
  );

  const commitSigPriceDraft = (id: string, fallbackPrice: number) => {
    const draftRaw = sigPriceDraftMapRef.current[id];
    if (draftRaw == null) return;
    const nextPrice = Math.max(0, Math.floor(Number(draftRaw || 0) || 0));
    setSigPriceDraftMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (nextPrice !== fallbackPrice) {
      updateSigItem(id, { price: nextPrice });
    }
  };

  const removeSigItem = (id: string) => {
    if (id === ONE_SHOT_SIG_ID) return;
    const target = (state.sigInventory || []).find((x) => x.id === id);
    const label = target?.name?.trim() || id;
    if (!confirm(`「${label}」 시그를 목록에서 삭제할까요?`)) return;
    setState((prev: AppState) => {
      const draft: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).filter((x) => x.id !== id),
        updatedAt: Date.now(),
      };
      const next = { ...syncOneShotSigItem(draft), updatedAt: draft.updatedAt };
      persistState(next);
      setSigExcelResult(`시그 삭제: ${label}`);
      return next;
    });
  };

  const addSigItem = () => {
    const name = newSigName.trim();
    if (!name) {
      setSigExcelResult("시그 이름을 입력해 주세요.");
      return;
    }
    if (newSigImageUploading) {
      setSigExcelResult("이미지 업로드 중입니다. 완료 후 시그를 추가해 주세요.");
      return;
    }
    const price = Math.max(0, Math.floor(Number(newSigPrice || 0) || 0));
    const maxCount = Math.max(1, Math.floor(Number(newSigMaxCount || 1) || 1));
    const normalizedName = name.replace(/\s+/g, "").toLowerCase();
    const imageUrlStored = normalizeUploadedSigImageUrl(newSigImageUrl.trim());
    const prev = stateRef.current;
    const duplicateIdx = (prev.sigInventory || []).findIndex(
      (x) =>
        x.id !== ONE_SHOT_SIG_ID &&
        (x.name || "").replace(/\s+/g, "").toLowerCase() === normalizedName
    );
    if (duplicateIdx >= 0) {
      setSigExcelResult(
        `이미 「${name}」 시그가 있습니다. 신규 추가는 다른 이름을 쓰거나, 아래 목록에서 해당 행의 「이미지 업로드」로 교체해 주세요.`
      );
      return;
    }
    const createdId = `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const nextInventory = [
      ...(prev.sigInventory || []),
      {
        id: createdId,
        name,
        price,
        imageUrl: imageUrlStored,
        memberId: newSigMemberId || "",
        maxCount,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const draft: AppState = {
      ...prev,
      sigInventory: nextInventory,
      updatedAt: Date.now(),
    };
    const next = { ...syncOneShotSigItem(draft), updatedAt: draft.updatedAt };
    setState(next);
    setNewSigName("");
    setNewSigPrice("77000");
    setNewSigMaxCount("1");
    setNewSigImageUrl("");
    setNewSigPreviewUrl("");
    void (async () => {
      lastLocalPersistAtRef.current = Date.now();
      pendingUnsyncedRef.current = true;
      const r = await saveStateAsync(next, user?.id);
      if (r.ok) {
        if (typeof r.serverUpdatedAt === "number" && Number.isFinite(r.serverUpdatedAt)) {
          stateUpdatedAtRef.current = r.serverUpdatedAt;
          lastAppliedRemoteUpdatedAtRef.current = r.serverUpdatedAt;
        }
        pendingUnsyncedRef.current = false;
        setSyncStatus("synced");
        setSigExcelResult(`시그 저장 완료: ${name} (${price.toLocaleString("ko-KR")}원)`);
      } else {
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setSyncStatus(offline ? "local" : "error");
        setSigExcelResult(
          offline
            ? `시그는 이 기기에만 반영됐습니다(오프라인). 연결 후 다시 「시그 추가」하거나 상단 동기화를 확인하세요.`
            : `시그는 화면에 반영됐지만 서버 저장에 실패했습니다. EC2·로그인·Redis(UPSTASH) 설정을 확인한 뒤 다시 시도하세요.`
        );
      }
    })();
  };

  const downloadSigExcelTemplate = () => {
    const rows = [
      { name: "시그1", price: 50000, maxCount: 1, memberName: "", imageUrl: SIG_DUMMY_IMAGE, isRolling: "Y" },
    ];
    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "sig_inventory");
    XLSX.writeFile(wb, "sig-inventory-template.xlsx");
  };

  const downloadSigPricesExcel = () => {
    const items = (state.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID);
    if (!items.length) {
      setSigExcelResult("다운로드할 시그가 없습니다. 먼저 시그를 추가해 주세요.");
      return;
    }
    const rows = sigInventoryToExcelRows(items, state.members || []);
    const sheet = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "sig_prices");
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    XLSX.writeFile(wb, `sig-prices-${stamp}.xlsx`);
    setSigExcelResult(`현재 시그 ${items.length}개 가격·설정을 엑셀로 저장했습니다.`);
  };

  const uploadSigPricesExcel = async (file: File | null) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const first = wb.SheetNames[0];
    if (!first) {
      setSigExcelResult("엑셀 시트가 비어 있습니다.");
      return;
    }
    const sheet = wb.Sheets[first];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (!rows.length) {
      setSigExcelResult("엑셀에 데이터 행이 없습니다.");
      return;
    }
    setState((prev: AppState) => {
      const inventory = (prev.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID);
      const { nextInventory, result } = applySigPriceExcelRows(inventory, rows, prev.members || []);
      const oneShot = (prev.sigInventory || []).find((x) => x.id === ONE_SHOT_SIG_ID);
      const merged = oneShot ? [oneShot, ...nextInventory] : nextInventory;
      const draft: AppState = { ...prev, sigInventory: merged, updatedAt: Date.now() };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      const failSuffix =
        result.notFound.length > 0
          ? ` · 미매칭 ${result.notFound.length}개: ${result.notFound.slice(0, 4).join(", ")}${result.notFound.length > 4 ? "…" : ""}`
          : "";
      const restoreHint =
        result.notFound.length >= 5 && result.updated < result.notFound.length
          ? " · 목록이 비어 있으면 「엑셀에서 시그 목록 복구」를 사용하세요."
          : "";
      setSigExcelResult(
        `가격 엑셀 반영: ${result.updated}건 업데이트, ${result.skipped}건 건너뜀${failSuffix}${restoreHint}`
      );
      return next;
    });
  };

  const clearAllSigItems = () => {
    if (!confirm("시그 목록 전체를 삭제할까요?")) return;
    setState((prev: AppState) => {
      const draft: AppState = { ...prev, sigInventory: [] };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
    setSigExcelResult("시그 목록을 전체 삭제했습니다.");
  };

  /** 시그 판매 인벤·제외 목록·멤버 프리셋·회전판·롤링 설정을 앱 기본값으로 되돌림(완판 도장 URL은 유지) */
  const resetSigInventoryToDefaults = () => {
    if (
      !confirm(
        "시그 판매 목록을 기본(한방 시그 1개)으로 되돌리고, 판매 제외·멤버 프리셋·회전판·롤링 전환 설정도 초기화합니다. 계속할까요?"
      )
    ) {
      return;
    }
    setState((prev: AppState) => {
      const draft: AppState = {
        ...prev,
        sigInventory: DEFAULT_SIG_INVENTORY.map((x) => ({ ...x })),
        sigSalesExcludedIds: [],
        sigSalesMemberPresets: {},
        sigRolling: normalizeSigRolling(null),
        sigRollingMeta: {},
        rouletteState: normalizeRouletteState(null),
        updatedAt: Date.now(),
      };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
    setSigExcelResult("시그 목록·관련 설정을 기본값으로 초기화했습니다.");
  };

  const restoreBroadcastStateFromJsonPatch = useCallback(
    (parsed: Record<string, unknown>, sourceLabel: string) => {
      const inv = Array.isArray(parsed?.sigInventory)
        ? parsed.sigInventory
        : Array.isArray(parsed)
          ? parsed
          : null;
      const full = isFullBroadcastStateBackup(parsed);
      if (!full && !inv?.length) {
        setSigExcelResult("JSON에 복구할 시그 목록 또는 전체 방송 설정이 없습니다.");
        return false;
      }
      const summary = summarizeRestoreJson(parsed);
      if (
        !window.confirm(
          `${sourceLabel}에서 방송 상태를 복구합니다.\n` +
            (summary.length ? `${summary.join(" · ")}\n` : "") +
            (full
              ? "※ 오버레이 프리셋·설정·멤버·후원 등 JSON에 있는 항목을 서버에 덮어씁니다.\n"
              : "") +
            "계속할까요?"
        )
      ) {
        return false;
      }
      setState((prev: AppState) => {
        const draft = buildAppStateFromRestoreJson(parsed, { base: prev, fullReplace: full });
        const next = syncOneShotSigItem(draft);
        persistState(next, { includeDonationFields: true });
        return next;
      });
      setSigExcelResult(`${sourceLabel} 복구·저장: ${summary.join(" · ") || "완료"}`);
      return true;
    },
    [persistState, syncOneShotSigItem]
  );

  const restoreSigInventoryFromJsonFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const text = await file.text();
        const raw = JSON.parse(text) as unknown;
        const patch: Record<string, unknown> = Array.isArray(raw) ? { sigInventory: raw } : (raw as Record<string, unknown>);
        restoreBroadcastStateFromJsonPatch(patch, "JSON 파일");
      } catch {
        setSigExcelResult("JSON 파싱 실패 또는 형식 오류");
      } finally {
        if (sigRestoreJsonInputRef.current) sigRestoreJsonInputRef.current.value = "";
      }
    },
    [restoreBroadcastStateFromJsonPatch]
  );

  const restoreSigInventoryFromExcelFile = useCallback(
    async (file: File | null) => {
      if (!file) return;
      try {
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const first = wb.SheetNames[0];
        if (!first) {
          setSigExcelResult("엑셀 시트가 비어 있습니다.");
          return;
        }
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[first], { defval: "" });
        if (!rows.length) {
          setSigExcelResult("엑셀에 데이터 행이 없습니다.");
          return;
        }
        const { inventory, skipped, duplicateNames } = buildSigInventoryFromExcelRows(
          rows,
          state.members || []
        );
        if (!inventory.length) {
          setSigExcelResult("엑셀에서 복구할 시그 행을 찾지 못했습니다.");
          return;
        }
        if (
          !window.confirm(
            `엑셀에서 시그 ${inventory.length}개로 목록을 교체합니다.\n` +
              `(가격·이미지·판매수 포함. 스킵 ${skipped}건)\n` +
              `※ 「가격 엑셀 업로드」와 달리 전체 목록을 새로 만듭니다.\n계속할까요?`
          )
        ) {
          return;
        }
        setState((prev: AppState) => {
          const draft: AppState = {
            ...prev,
            sigInventory: inventory,
            updatedAt: Date.now(),
          };
          const next = syncOneShotSigItem(draft);
          persistState(next);
          return next;
        });
        const dupSuffix =
          duplicateNames.length > 0
            ? ` · 중복 이름 ${duplicateNames.length}건 제외`
            : "";
        setSigExcelResult(`엑셀에서 시그 ${inventory.length}개 복구·저장${dupSuffix}`);
      } catch {
        setSigExcelResult("엑셀 파싱 실패 또는 형식 오류");
      } finally {
        if (sigRestoreExcelInputRef.current) sigRestoreExcelInputRef.current.value = "";
      }
    },
    [state.members, persistState, syncOneShotSigItem]
  );

  const restoreDonorsFromDailyLogSnapshot = useCallback(async () => {
    await restoreDonorsFromDailyLogSnapshotRef.current?.();
  }, []);

  const dedupeSigInventoryItems = useCallback(
    (strategy: "imageUrl" | "nameAndPrice") => {
      const label = strategy === "imageUrl" ? "이미지 URL 또는 이름" : "이름+가격";
      if (!confirm(`동일 ${label}인 시그는 목록에서 위쪽(먼저 있는) 행만 남기고 삭제합니다. 계속할까요?`)) return;
      let removed = 0;
      setState((prev: AppState) => {
        const { nextInventory, removedCount } = dedupeSigInventory(prev.sigInventory || [], strategy);
        removed = removedCount;
        if (removedCount === 0) return prev;
        const draft: AppState = { ...prev, sigInventory: nextInventory };
        const next = syncOneShotSigItem(draft);
        persistState(next);
        return next;
      });
      setSigExcelResult(removed === 0 ? "중복된 시그 행이 없습니다." : `중복 제거(${label}): ${removed}건 삭제`);
    },
    [persistState, syncOneShotSigItem]
  );

  const uploadSigExcel = async (file: File | null) => {
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const first = wb.SheetNames[0];
    if (!first) {
      setSigExcelResult("엑셀 시트가 비어 있습니다.");
      return;
    }
    const sheet = wb.Sheets[first];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (!rows.length) {
      setSigExcelResult("엑셀에 데이터 행이 없습니다.");
      return;
    }
    let added = 0;
    let skipped = 0;
    setState((prev: AppState) => {
      const existing = new Set((prev.sigInventory || []).map((x) => (x.name || "").replace(/\s+/g, "").toLowerCase()));
      const memberMap = new Map((prev.members || []).map((m) => [m.name.trim(), m.id]));
      const nextItems = [...(prev.sigInventory || [])].filter((x) => x.id !== ONE_SHOT_SIG_ID);

      for (const row of rows) {
        const name = String(row.name ?? row["이름"] ?? "").trim();
        if (!name) {
          skipped += 1;
          continue;
        }
        const key = name.replace(/\s+/g, "").toLowerCase();
        if (existing.has(key)) {
          skipped += 1;
          continue;
        }
        const price = Math.max(0, Math.floor(Number(row.price ?? row["가격"] ?? 0) || 0));
        const memberName = String(row.memberName ?? row["멤버"] ?? "").trim();
        const isRollingRaw = String(row.isRolling ?? row["노출"] ?? "Y").trim().toLowerCase();
        const imageUrl = String(row.imageUrl ?? row["이미지"] ?? "").trim();
        const rolling = isRollingRaw === "y" || isRollingRaw === "true" || isRollingRaw === "1";
        const activeCol = row.isActive ?? row["판매활성"];
        let isActive = rolling;
        if (activeCol !== undefined && activeCol !== null && String(activeCol).trim() !== "") {
          const isActiveRaw = String(activeCol).trim().toLowerCase();
          isActive = isActiveRaw === "y" || isActiveRaw === "true" || isActiveRaw === "1";
        }
        nextItems.push({
          id: `sig_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name,
          price,
          imageUrl,
          memberId: memberMap.get(memberName) || "",
          maxCount: 1,
          soldCount: 0,
          isRolling: rolling,
          isActive,
        });
        existing.add(key);
        added += 1;
      }

      const draft: AppState = { ...prev, sigInventory: nextItems };
      const next = syncOneShotSigItem(draft);
      persistState(next);
      return next;
    });
    setSigExcelResult(`엑셀 업로드 완료: ${added}개 추가, ${skipped}개 중복/무효로 건너뜀`);
  };

  type SigImageUploadResult = { url: string | null; status: number };

  const uploadSigImageFile = useCallback(async (
    file: File | null,
    options?: { silent?: boolean; /** 일괄 업로드: Supabase 미러 대기 생략(디스크 저장만 즉시 반환) */ skipMirror?: boolean }
  ): Promise<SigImageUploadResult> => {
    const silent = Boolean(options?.silent);
    const skipMirror = Boolean(options?.skipMirror);
    const notify = (message: string) => {
      if (!silent) alert(message);
    };
    if (!file) return { url: null, status: 0 };
    const mime = String(file.type || "").toLowerCase();
    const name = String(file.name || "").toLowerCase();
    const isAllowedMime = /image\/(gif|png|jpe?g|webp)/i.test(mime);
    const isAllowedExt = /\.(gif|png|jpe?g|webp)$/i.test(name);
    const isAllowed = isAllowedMime || isAllowedExt;
    if (!isAllowed) {
      notify("gif, png, jpg(jpeg), webp 파일만 업로드 가능합니다.");
      return { url: null, status: 400 };
    }
    if (file.size > MAX_SIG_UPLOAD_BYTES) {
      notify(
        `이미지 용량이 30MB를 초과합니다. (${(file.size / (1024 * 1024)).toFixed(1)}MB) 더 작은 파일을 선택해 주세요.`
      );
      return { url: null, status: 413 };
    }
    const fd = new FormData();
    fd.append("file", file);
    const uidFromQuery =
      typeof window !== "undefined"
        ? String(
            new URLSearchParams(window.location.search).get("u") ||
              new URLSearchParams(window.location.search).get("user") ||
              ""
          ).trim()
        : "";
    const uid = resolveScopedOverlayUserId(user?.id, uidFromQuery);
    let res: Response;
    try {
      const q = new URLSearchParams();
      if (uid) {
        q.set("user", uid);
        q.set("u", uid);
      }
      if (skipMirror) q.set("skipMirror", "1");
      const uploadUrl = q.toString() ? `/api/upload/sig-image?${q.toString()}` : "/api/upload/sig-image";
      res = await fetch(uploadUrl, {
        method: "POST",
        credentials: "include",
        headers: {
          ...(uid ? { "x-user-id": uid } : {}),
          ...(skipMirror ? { "x-sig-upload-skip-mirror": "1" } : {}),
        },
        body: fd,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "network_error";
      const normalized = String(msg || "").toLowerCase();
      const networkLike =
        normalized.includes("network") ||
        normalized.includes("failed to fetch") ||
        normalized.includes("load failed");
      notify(networkLike ? "이미지 업로드 실패: 네트워크 오류입니다. 인터넷 연결을 확인해 주세요." : `이미지 업로드 실패: ${msg}`);
      return { url: null, status: 0 };
    }
    const j = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      url?: string;
      error?: string;
      ephemeral?: boolean;
      storage?: string;
    };
    if (!res.ok || !j.ok || !j.url) {
      const rawError = typeof j.error === "string" && j.error.trim() ? j.error.trim() : String(res.status);
      const message =
        rawError.toLowerCase() === "file_too_large"
          ? `파일 용량이 30MB를 초과합니다. (${(file.size / (1024 * 1024)).toFixed(1)}MB)`
          : formatSigImageUploadFailureMessage(res.status, file.size, j.error);
      notify(`이미지 업로드 실패: ${message}`);
      if (!silent) {
        setSigExcelResult(`이미지 업로드 실패(${res.status}): ${rawError}`);
      }
      return { url: null, status: res.status };
    }
    if (!silent && (j.ephemeral || (j.storage === "disk" && j.url.startsWith("/uploads/")))) {
      setSigExcelResult(
        "업로드 완료. 파일은 서버 디스크(/uploads/sigs)에 저장됩니다."
      );
    }
    if (isBrokenSigImageUrl(j.url)) {
      notify("이미지 업로드 실패: 사용자 경로 파싱 오류가 발생했습니다. 다시 로그인 후 재시도해 주세요.");
      return { url: null, status: res.status };
    }
    /** IP가 바뀌어도 `/uploads/sigs/...` 상대 경로만 저장 (구 IP 절대 URL 방지) */
    const storedUrl = normalizeSigImageUrlStored(repairDiskUploadSigImagePath(j.url, uid));
    return { url: storedUrl, status: res.status };
  }, [user?.id]);

  const appendSigInventoryRows = useCallback(
    (rows: { url: string; label: string; price: number }[], options?: { persist?: boolean }) => {
      if (!rows.length) return;
      setState((prev) => {
        const existingIds = new Set((prev.sigInventory || []).map((x) => x.id));
        const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
        const currentRolling = getUnifiedSigRollingItems(prev);
        const nextInventory = [...(prev.sigInventory || [])];
        rows.forEach((row, i) => {
          let id = `sig_roll_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
          while (existingIds.has(id)) {
            id = `sig_roll_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`;
          }
          existingIds.add(id);
          nextInventory.push({
            id,
            name: row.label || "시그",
            price: Math.max(0, Math.floor(Number(row.price || 0))),
            imageUrl: row.url,
            memberId: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: true,
            isActive: true,
          });
          meta[id] = { label: row.label || "", order: currentRolling.length + i };
        });
        const next: AppState = {
          ...prev,
          sigInventory: nextInventory,
          sigRollingMeta: meta,
          updatedAt: Date.now(),
        };
        if (options?.persist !== false) persistState(next);
        return next;
      });
    },
    [persistState]
  );

  const bulkAddSigInventoryFromFiles = useCallback(
    async (files: File[], options?: { skipBusyGuard?: boolean }) => {
      if (!files.length) return;
      if (!options?.skipBusyGuard && sigBulkReuploadBusy) return;
      if (!options?.skipBusyGuard) {
        beginSigBulkUploadUi(files.length, `${files.length}개 파일 업로드 준비 중…`);
      } else {
        flushSync(() => {
          setSigUploadProgress({ current: 0, total: files.length, label: `${files.length}개 파일 업로드 준비 중…` });
        });
      }
      setSigRollingUploadMessage(`${files.length}개 파일 업로드 시작…`);
      let uploaded = 0;
      const failures: string[] = [];
      const pendingRows: { url: string; label: string; price: number }[] = [];
      let consecutive413 = 0;
      const NGINX_413_HINT = SIG_UPLOAD_NGINX_413_HINT;
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i]!;
          setSigUploadProgress({
            current: i,
            total: files.length,
            label: `업로드 중 (${i + 1}/${files.length}): ${f.name}`,
          });
          const { url, status } = await uploadSigImageFile(f, { silent: true, skipMirror: true });
          if (!url) {
            failures.push(f.name);
            if (status === 413) {
              consecutive413 += 1;
              setSigUploadProgress({
                current: i,
                total: files.length,
                label: `413 오류 (${i + 1}/${files.length}): ${f.name}`,
              });
              if (consecutive413 >= 2) {
                setSigOcrBanner(NGINX_413_HINT);
                setSigExcelResult(NGINX_413_HINT);
                break;
              }
            } else {
              consecutive413 = 0;
            }
            await new Promise((r) => setTimeout(r, 8));
            continue;
          }
          consecutive413 = 0;
          const meta = parseSigMetaFromFileName(f.name);
          pendingRows.push({
            url,
            label: meta.name || f.name.replace(/\.[^.]+$/, ""),
            price: meta.priceFromFileName ? meta.price : 0,
          });
          uploaded += 1;
          setSigUploadProgress({
            current: i + 1,
            total: files.length,
            label: `완료 (${i + 1}/${files.length}): ${meta.name}${meta.priceFromFileName ? ` · ${meta.price.toLocaleString("ko-KR")}원` : ""}`,
          });
          await new Promise((r) => setTimeout(r, 8));
        }
        if (pendingRows.length) {
          appendSigInventoryRows(pendingRows);
        }
        if (uploaded === 0) {
          const msg =
            consecutive413 > 0
              ? NGINX_413_HINT
              : `업로드 실패 (${failures.length}개). 로그인·네트워크를 확인해 주세요.`;
          setSigRollingUploadMessage(msg);
          setSigExcelResult(msg);
          setSigOcrBanner(msg);
          return;
        }
        const failSuffix =
          failures.length > 0
            ? ` · 실패 ${failures.length}개: ${failures.slice(0, 3).join(", ")}${failures.length > 3 ? "…" : ""}`
            : "";
        const summary = `${uploaded}개 시그 추가 완료${failSuffix}`;
        setSigExcelResult(summary);
        setSigRollingUploadMessage(`${summary} (${new Date().toLocaleTimeString("ko-KR")})`);
        setSigOcrBanner(summary);
        setSigUploadProgress({
          current: files.length,
          total: files.length,
          label: "업로드 완료",
        });
      } catch (e) {
        const msg = `일괄 업로드 오류: ${e instanceof Error ? e.message : String(e)}`;
        setSigExcelResult(msg);
        setSigOcrBanner(msg);
      } finally {
        setSigBulkReuploadBusy(false);
        window.setTimeout(() => setSigUploadProgress(null), 4000);
        if (sigBulkReuploadInputRef.current) sigBulkReuploadInputRef.current.value = "";
      }
    },
    [sigBulkReuploadBusy, appendSigInventoryRows, uploadSigImageFile, beginSigBulkUploadUi]
  );

  const bulkReuploadSigInventoryFromFiles = useCallback(
    async (files: FileList | File[] | null) => {
      if (sigBulkReuploadBusy) return;
      const list = Array.from(files || []).filter((f) => isSigRollingPickableFile(f));
      if (!list.length) {
        const msg = "선택한 파일에 gif/png/jpg/webp가 없습니다. 파일명 끝 확장자를 확인해 주세요.";
        setSigOcrBanner(msg);
        setSigExcelResult(msg);
        return;
      }
      beginSigBulkUploadUi(list.length, `${list.length}개 파일 선택됨 — 처리 시작…`);
      const items = (state.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID);
      const plans = planSigBulkReupload(list, items);
      const unmatchedFiles = sigBulkFilesWithoutNameMatch(list, plans);
      if (!plans.length) {
        await bulkAddSigInventoryFromFiles(list, { skipBusyGuard: true });
        return;
      }
      const ok = window.confirm(
        `시그 이미지 일괄 재업로드\n\n` +
          `선택 파일: ${list.length}개\n` +
          `기존 시그에 반영(파일명=시그 이름 일치): ${plans.length}개\n` +
          (unmatchedFiles.length > 0
            ? `이름 불일치(기존 행 변경 없음): ${unmatchedFiles.length}개 — ${unmatchedFiles
                .slice(0, 5)
                .map((f) => f.name)
                .join(", ")}${unmatchedFiles.length > 5 ? "…" : ""}\n`
            : "") +
          `\n※ 파일명이 「04클럽춤.gif」또는 「1,000,000_버터플라이.gif」(금액_이름)처럼 시그 이름과 같을 때만 해당 행이 바뀝니다.\n` +
          `금액_이름 형식이면 가격도 자동 반영됩니다.\n` +
          `계속할까요?`
      );
      if (!ok) {
        setSigBulkReuploadBusy(false);
        setSigUploadProgress(null);
        return;
      }

      setSigUploadProgress({ current: 0, total: plans.length, label: "재업로드 준비 중…" });
      let uploaded = 0;
      const failures: string[] = [];
      const inventoryPatches: Array<{ id: string; patch: Partial<AppState["sigInventory"][number]> }> = [];
      try {
        for (let i = 0; i < plans.length; i++) {
          const { file, item } = plans[i]!;
          setSigUploadProgress({
            current: i,
            total: plans.length,
            label: `재업로드 (${i + 1}/${plans.length}): ${item.name} ← ${file.name}`,
          });
          setSigOcrBanner(`일괄 재업로드 ${i + 1}/${plans.length}: ${item.name} ← ${file.name}`);
          const { url } = await uploadSigImageFile(file, { silent: true, skipMirror: true });
          if (!url) {
            failures.push(file.name);
            continue;
          }
          uploaded += 1;
          const meta = parseSigMetaFromFileName(file.name);
          inventoryPatches.push({
            id: item.id,
            patch: {
              imageUrl: url,
              isActive: true,
              isRolling: true,
              ...(meta.priceFromFileName ? { price: meta.price } : {}),
            },
          });
          setSigUploadProgress({
            current: i + 1,
            total: plans.length,
            label: `완료 (${i + 1}/${plans.length}): ${item.name}${meta.priceFromFileName ? ` · ${meta.price.toLocaleString("ko-KR")}원` : ""}`,
          });
        }
        if (inventoryPatches.length > 0) {
          setState((prev: AppState) => {
            const patchById = new Map(inventoryPatches.map((row) => [row.id, row.patch]));
            const sigInventory = (prev.sigInventory || []).map((x) => {
              const patch = patchById.get(x.id);
              return patch ? { ...x, ...patch } : x;
            });
            const draft: AppState = { ...prev, sigInventory, updatedAt: Date.now() };
            const next = syncOneShotSigItem(draft);
            persistState(next);
            return next;
          });
        }
        setSigUploadProgress({
          current: plans.length,
          total: plans.length,
          label: "재업로드 완료",
        });
        let summary =
          `일괄 재업로드 완료: 업로드 ${uploaded}/${plans.length}건` +
          (failures.length ? ` · 실패: ${failures.slice(0, 4).join(", ")}${failures.length > 4 ? "…" : ""}` : "");
        if (unmatchedFiles.length > 0) {
          const addUnmatched = window.confirm(
            `이름이 맞지 않아 기존 시그는 바꾸지 않은 파일 ${unmatchedFiles.length}개가 있습니다.\n` +
              `새 시그 행으로 추가할까요? (취소하면 무시)`
          );
          if (addUnmatched) {
            await bulkAddSigInventoryFromFiles(unmatchedFiles, { skipBusyGuard: true });
            summary += ` · 새 시그로 추가 ${unmatchedFiles.length}건`;
          } else {
            summary += ` · 이름 불일치 ${unmatchedFiles.length}건 무시`;
          }
        }
        setSigExcelResult(summary);
        setSigOcrBanner(summary);
      } finally {
        setSigBulkReuploadBusy(false);
        window.setTimeout(() => setSigUploadProgress(null), 1200);
        if (sigBulkReuploadInputRef.current) sigBulkReuploadInputRef.current.value = "";
      }
    },
    [
      sigBulkReuploadBusy,
      state.sigInventory,
      persistState,
      syncOneShotSigItem,
      uploadSigImageFile,
      bulkAddSigInventoryFromFiles,
      beginSigBulkUploadUi,
    ]
  );

  const clearSigInventoryImagesOnly = useCallback(() => {
    if (
      !window.confirm(
        "시그 인벤(판매 목록)에 붙은 이미지 URL만 기본 더미로 바꿉니다.\n롤링 수동 이미지·완판 도장은 그대로 둡니다.\n이름·가격·판매 수·멤버 지정은 유지됩니다. 계속할까요?"
      )
    ) {
      return;
    }
    setSigRowUploadPreviewMap({});
    setNewSigPreviewUrl("");
    setNewSigImageUrl("");
    setSigImagePreviewModal(null);
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        sigInventory: stripSigInventoryImagesKeepList(prev.sigInventory),
      };
      const synced = syncOneShotSigItem(next);
      persistState(synced);
      return synced;
    });
    setSigExcelResult("시그 인벤 이미지 URL만 제거했습니다. 필요 시 PC에서 선택으로 다시 올려 주세요.");
    setSigOcrBanner("");
  }, [persistState, syncOneShotSigItem]);

  const normalizeUploadedSigImageUrl = useCallback(
    (url: string) => {
      const uid = resolveScopedOverlayUserId(
        user?.id,
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("u") ||
              new URLSearchParams(window.location.search).get("user")
          : ""
      );
      if (!uid) return normalizeSigImageUrlStored(url);
      return normalizeSigImageUrlStored(repairDiskUploadSigImagePath(url, uid));
    },
    [user?.id]
  );

  const uploadSigImage = (id: string, file: File | null) => {
    if (!file || !id) return;
    void (async () => {
      let previewUrl = "";
      try {
        previewUrl = await createSafeFilePreviewUrl(file);
        if (previewUrl) {
          setSigRowUploadPreviewMap((prev) => ({ ...prev, [id]: previewUrl }));
        }
        const { url } = await uploadSigImageFile(file);
        if (!url) return;
        const storedUrl = normalizeUploadedSigImageUrl(url);
        const meta = parseSigMetaFromFileName(file.name);
        const patch =
          id === ONE_SHOT_SIG_ID
            ? { imageUrl: storedUrl }
            : {
                imageUrl: storedUrl,
                isActive: true,
                isRolling: true,
                ...(meta.priceFromFileName ? { price: meta.price } : {}),
              };
        updateSigItem(id, patch);
        if (meta.priceFromFileName && id !== ONE_SHOT_SIG_ID) {
          setSigPriceDraftMap((prev) => ({ ...prev, [id]: String(meta.price) }));
        }
        if (id === ONE_SHOT_SIG_ID) {
          setRouletteForcedOneShotImageUrl(storedUrl);
        }
      } finally {
        revokeSafeFilePreviewUrl(previewUrl);
        setSigRowUploadPreviewMap((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    })();
  };

  const uploadNewSigImage = (file: File | null) => {
    if (!file) return;
    setNewSigImageUploading(true);
    void (async () => {
      let previewUrl = "";
      try {
        previewUrl = await createSafeFilePreviewUrl(file);
        if (previewUrl) setNewSigPreviewUrl(previewUrl);
        const meta = parseSigMetaFromFileName(file.name);
        if (meta.name) {
          setNewSigName((prev) => (prev.trim() ? prev : meta.name));
        }
        if (meta.priceFromFileName) {
          setNewSigPrice(String(meta.price));
        }
        const { url } = await uploadSigImageFile(file);
        if (url) setNewSigImageUrl(normalizeUploadedSigImageUrl(url));
      } finally {
        revokeSafeFilePreviewUrl(previewUrl);
        setNewSigPreviewUrl("");
        setNewSigImageUploading(false);
      }
    })();
  };

  const updateSigSoldOutStampUrl = (url: string) => {
    const normalized = normalizeUploadedSigImageUrl(url);
    const now = Date.now();
    lastLocalPersistAtRef.current = now;
    setState((prev: AppState) => {
      const next: AppState = {
        ...prev,
        sigSoldOutStampUrl: normalized,
        updatedAt: Math.max(prev.updatedAt || 0, now),
      };
      stateRef.current = next;
      persistState(
        next,
        normalized.trim()
          ? { omitDonationFields: true }
          : { omitDonationFields: true, clearSigSoldOutStamp: true }
      );
      return next;
    });
  };

  const uploadSigSoldOutStampImage = (file: File | null) => {
    if (!file) return;
    lastLocalPersistAtRef.current = Date.now();
    pendingUnsyncedRef.current = true;
    void (async () => {
      const { url } = await uploadSigImageFile(file);
      if (!url) {
        pendingUnsyncedRef.current = false;
        return;
      }
      updateSigSoldOutStampUrl(url);
      setSigExcelResult("판매 완료 오버레이 이미지를 저장했습니다.");
    })();
  };

  const isSigRollingPickableFile = (f: File) => {
    const mime = String(f.type || "").toLowerCase();
    const name = String(f.name || "").toLowerCase();
    return /image\/(gif|png|jpe?g|webp)/i.test(mime) || /\.(gif|png|jpe?g|webp)$/i.test(name);
  };

  const addSigRollingFromFiles = async (files: FileList | null) => {
    if (sigBulkReuploadBusy) return;
    if (!files?.length) return;
    const list = Array.from(files).filter(isSigRollingPickableFile);
    if (!list.length) {
      const msg =
        "선택한 파일에 gif/png/jpg/webp가 없습니다. 폴더 선택 시 확장자(.gif 등)를 확인해 주세요.";
      setSigRollingUploadMessage(msg);
      setSigOcrBanner(msg);
      setSigExcelResult(msg);
      return;
    }
    beginSigBulkUploadUi(list.length, `${list.length}개 파일 업로드 준비…`);
    try {
      await bulkAddSigInventoryFromFiles(list, { skipBusyGuard: true });
    } catch (e) {
      const msg = `업로드 시작 실패: ${e instanceof Error ? e.message : String(e)}`;
      setSigRollingUploadMessage(msg);
      setSigOcrBanner(msg);
      setSigBulkReuploadBusy(false);
      setSigUploadProgress(null);
    }
  };

  const removeSigRollingItem = (id: string) => {
    setState((prev) => {
      const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
      delete meta[id];
      const next = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => (x.id === id ? { ...x, isRolling: false } : x)),
        sigRollingMeta: meta,
      };
      persistState(next, { omitDonationFields: true });
      return next;
    });
  };

  const setSigRollingStaticHoldSeconds = (seconds: number) => {
    const sec = Math.max(1, Math.min(120, Math.round(Number(seconds) || 5)));
    const ms = sec * 1000;
    setState((prev) => {
      const sr = normalizeSigRolling(prev.sigRolling);
      if (sr.staticHoldMs === ms) return prev;
      const next = { ...prev, sigRolling: { ...sr, staticHoldMs: ms } };
      persistVisualSettings(next, { sigRolling: next.sigRolling });
      return next;
    });
  };

  const renameSigRollingItem = (id: string, value: string) => {
    const nextName = String(value || "");
    setState((prev) => {
      const hasInventory = (prev.sigInventory || []).some((x) => x.id === id);
      if (hasInventory) {
        const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
        const cur = meta[id] || {};
        meta[id] = { ...cur, label: nextName };
        const next = {
          ...prev,
          sigInventory: (prev.sigInventory || []).map((x) => (x.id === id ? { ...x, name: nextName } : x)),
          sigRollingMeta: meta,
        };
        persistState(next, { omitDonationFields: true });
        return next;
      }
      const sr = normalizeSigRolling(prev.sigRolling);
      const next = {
        ...prev,
        sigRolling: {
          ...sr,
          items: sr.items.map((x) => (x.id === id ? { ...x, label: nextName } : x)),
        },
      };
      persistVisualSettings(next, { sigRolling: next.sigRolling });
      return next;
    });
  };

  const replaceSigRollingItemImage = (id: string, file: File | null) => {
    if (!file) return;
    void (async () => {
      const { url } = await uploadSigImageFile(file);
      if (!url) return;
      setState((prev) => {
        const hasInventory = (prev.sigInventory || []).some((x) => x.id === id);
        if (hasInventory) {
          const next = {
            ...prev,
            sigInventory: (prev.sigInventory || []).map((x) =>
              x.id === id ? { ...x, imageUrl: url, isRolling: true, isActive: true } : x
            ),
          };
          persistState(next, { omitDonationFields: true });
          return next;
        }
        const sr = normalizeSigRolling(prev.sigRolling);
        const next = {
          ...prev,
          sigRolling: {
            ...sr,
            items: sr.items.map((x) => (x.id === id ? { ...x, url } : x)),
          },
        };
        persistVisualSettings(next, { sigRolling: next.sigRolling });
        return next;
      });
      setSigRollingUploadMessage(`이미지 교체 완료: ${id}`);
    })();
  };

  const convertLegacyRollingToSigInventory = (id: string) => {
    setState((prev) => {
      if ((prev.sigInventory || []).some((x) => x.id === id)) return prev;
      const sr = normalizeSigRolling(prev.sigRolling);
      const legacy = sr.items.find((x) => x.id === id);
      if (!legacy) return prev;
      const rows = getUnifiedSigRollingItems(prev);
      const order = Math.max(0, rows.findIndex((x) => x.id === id));
      const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
      const cur = meta[id] || {};
      meta[id] = { ...cur, label: legacy.label || cur.label || "", order: cur.order ?? order };
      const next = {
        ...prev,
        sigInventory: [
          ...(prev.sigInventory || []),
          {
            id,
            name: legacy.label || "롤링 시그",
            price: 0,
            imageUrl: legacy.url,
            memberId: "",
            maxCount: 1,
            soldCount: 0,
            isRolling: true,
            isActive: true,
          },
        ],
        sigRolling: { ...sr, items: sr.items.filter((x) => x.id !== id) },
        sigRollingMeta: meta,
      };
      persistState(next, { omitDonationFields: true });
      return next;
    });
  };

  const convertAllLegacyRollingToSigInventory = () => {
    setState((prev) => {
      const sr = normalizeSigRolling(prev.sigRolling);
      if (!sr.items.length) return prev;
      const invIds = new Set((prev.sigInventory || []).map((x) => x.id));
      const rows = getUnifiedSigRollingItems(prev);
      const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
      const nextInventory = [...(prev.sigInventory || [])];
      const convertedIds = new Set<string>();
      let appended = 0;

      sr.items.forEach((legacy, idx) => {
        if (!legacy?.id || !legacy?.url) return;
        if (invIds.has(legacy.id)) return;
        invIds.add(legacy.id);
        convertedIds.add(legacy.id);
        const order = Math.max(0, rows.findIndex((x) => x.id === legacy.id));
        const cur = meta[legacy.id] || {};
        meta[legacy.id] = { ...cur, label: legacy.label || cur.label || "", order: cur.order ?? order ?? rows.length + idx };
        nextInventory.push({
          id: legacy.id,
          name: legacy.label || "롤링 시그",
          price: 0,
          imageUrl: legacy.url,
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        });
        appended += 1;
      });

      if (!appended) return prev;
      const next = {
        ...prev,
        sigInventory: nextInventory,
        sigRolling: { ...sr, items: sr.items.filter((x) => !convertedIds.has(x.id)) },
        sigRollingMeta: meta,
      };
      persistState(next, { omitDonationFields: true });
      setSigRollingUploadMessage(`레거시 롤링 ${appended}개를 판매 시그로 전체 치환했습니다.`);
      return next;
    });
  };

  const moveSigRollingItem = (id: string, delta: number) => {
    setState((prev) => {
      const rows = getUnifiedSigRollingItems(prev);
      const ix = rows.findIndex((x) => x.id === id);
      if (ix < 0) return prev;
      const j = ix + delta;
      if (j < 0 || j >= rows.length) return prev;
      const items = [...rows];
      const [row] = items.splice(ix, 1);
      items.splice(j, 0, row);
      const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
      items.forEach((it, idx) => {
        const cur = meta[it.id] || {};
        meta[it.id] = { ...cur, order: idx };
      });
      const next = { ...prev, sigRollingMeta: meta };
      persistVisualSettings(next, { sigRollingMeta: meta });
      return next;
    });
  };

  const dedupeSigRollingByImageUrl = () => {
    if (!confirm("시그 롤링에서 같은 이미지 URL은 위쪽 항목만 남기고 나머지를 롤링 제외합니다. 계속할까요?")) return;
    let removedCount = 0;
    setState((prev) => {
      const rows = getUnifiedSigRollingItems(prev);
      if (rows.length < 2) return prev;

      const seen = new Set<string>();
      const duplicateIds = new Set<string>();
      for (const row of rows) {
        const key = normalizeSigDedupKeyImageUrl(row.url);
        if (seen.has(key)) {
          duplicateIds.add(row.id);
        } else {
          seen.add(key);
        }
      }
      if (!duplicateIds.size) return prev;

      removedCount = duplicateIds.size;
      const sr = normalizeSigRolling(prev.sigRolling);
      const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
      for (const id of duplicateIds) delete meta[id];

      const next = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) =>
          duplicateIds.has(x.id) ? { ...x, isRolling: false } : x
        ),
        sigRolling: { ...sr, items: sr.items.filter((x) => !duplicateIds.has(x.id)) },
        sigRollingMeta: meta,
      };
      persistState(next, { omitDonationFields: true });
      return next;
    });
    setSigRollingUploadMessage(
      removedCount > 0
        ? `시그 롤링 중복 제거 완료: ${removedCount}개를 롤링 제외했습니다.`
        : "시그 롤링 중복 항목이 없습니다."
    );
  };

  const uploadTableBgGifImage = (presetId: string, file: File | null) => {
    if (!file) return;
    void (async () => {
      const { url } = await uploadSigImageFile(file);
      if (!url) return;
      updatePreset(presetId, { tableBgGifUrl: url });
    })();
  };

  const uploadGoalBarGifImage = (presetId: string, file: File | null) => {
    if (!file) return;
    void (async () => {
      const { url } = await uploadSigImageFile(file);
      if (!url) return;
      updatePreset(presetId, { goalBarGifUrl: url });
    })();
  };

  const uploadTableFrameImage = (presetId: string, file: File | null) => {
    if (!file) return;
    void (async () => {
      const { url } = await uploadSigImageFile(file);
      if (!url) return;
      updatePreset(presetId, { tableFrameUrl: url, tableFrameEnabled: true });
    })();
  };

  const uploadDonorRankingsBodyImage = (file: File | null) => {
    if (!file) return;
    void (async () => {
      const { url } = await uploadSigImageFile(file);
      if (!url) return;
      updateDonorRankingsBodyImageConfig({
        bodyImageUrl: url,
        isBodyImageEnabled: true,
      });
    })();
  };

  const uploadDonorRankingsFrameImage = (file: File | null) => {
    if (!file) return;
    void (async () => {
      const { url } = await uploadSigImageFile(file);
      if (!url) return;
      updateDonorRankingsBodyImageConfig({
        frameUrl: url,
        isFrameEnabled: true,
      });
    })();
  };

  const toggleSigSalesExcluded = (id: string, excluded: boolean) => {
    setState((prev: AppState) => {
      const base = new Set((prev.sigSalesExcludedIds || []).map(String));
      if (excluded) base.add(id);
      else base.delete(id);
      const next: AppState = {
        ...prev,
        sigSalesExcludedIds: Array.from(base),
      };
      persistState(next);
      return next;
    });
  };

  const saveSigSalesPresetForMember = (memberId: string) => {
    if (!memberId) return;
    setState((prev: AppState) => {
      const memberSigIds = new Set(
        (prev.sigInventory || [])
          .filter((x) => x.id !== ONE_SHOT_SIG_ID && x.memberId === memberId)
          .map((x) => x.id)
      );
      const activeIds = (prev.sigInventory || [])
        .filter((x) => memberSigIds.has(x.id) && x.isActive)
        .map((x) => x.id);
      const next: AppState = {
        ...prev,
        sigSalesMemberPresets: {
          ...(prev.sigSalesMemberPresets || {}),
          [memberId]: activeIds,
        },
      };
      persistState(next);
      return next;
    });
    setSigExcelResult("멤버별 시그 판매 프리셋을 저장했습니다.");
  };

  const applySigSalesPresetForMember = (memberId: string) => {
    if (!memberId) return;
    if (!state.sigSalesMemberPresets?.[memberId]?.length) {
      setSigExcelResult("저장된 프리셋이 없습니다. 먼저 현재 설정을 저장해 주세요.");
      return;
    }
    setState((prev: AppState) => {
      const presetIds = new Set((prev.sigSalesMemberPresets?.[memberId] || []).map(String));
      const next: AppState = {
        ...prev,
        sigInventory: (prev.sigInventory || []).map((x) => {
          if (x.id === ONE_SHOT_SIG_ID) return x;
          if (x.memberId !== memberId) return { ...x, isActive: false };
          return { ...x, isActive: presetIds.has(x.id) };
        }),
      };
      persistState(next);
      return next;
    });
    setSigExcelResult("선택 멤버의 시그 판매 프리셋을 적용했습니다.");
  };

  const clearSigSalesPresetForMember = (memberId: string) => {
    if (!memberId) return;
    setState((prev: AppState) => {
      const map = { ...(prev.sigSalesMemberPresets || {}) };
      delete map[memberId];
      const next: AppState = { ...prev, sigSalesMemberPresets: map };
      persistState(next);
      return next;
    });
    setSigExcelResult("선택 멤버의 시그 판매 프리셋을 삭제했습니다.");
  };

  const applyNextSigSalesPresetMember = () => {
    const presetMemberIds = state.members
      .map((m) => m.id)
      .filter((id) => (state.sigSalesMemberPresets?.[id]?.length || 0) > 0);
    if (presetMemberIds.length === 0) {
      setSigExcelResult("저장된 멤버별 판매 프리셋이 없습니다.");
      return;
    }
    const currentIdx = presetMemberIds.indexOf(sigPresetMemberId);
    const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % presetMemberIds.length;
    const nextMemberId = presetMemberIds[nextIdx]!;
    setSigPresetMemberId(nextMemberId);
    applySigSalesPresetForMember(nextMemberId);
  };

  type AppTimerKey = "generalTimer" | "matchTimer";

  const updateMatchTimer = (key: AppTimerKey, updater: (timer: TimerState) => TimerState) => {
    setState((prev: AppState) => {
      const current =
        key === "generalTimer"
          ? prev.generalTimer
          : prev.matchTimer ?? prev.generalTimer;
      const nextTimer = updater(current);
      const next: AppState = { ...prev, [key]: nextTimer, updatedAt: Date.now() };
      if (key === "generalTimer") void saveGeneralTimerPatchAsync(nextTimer, user?.id);
      else void saveMatchTimerPatchAsync(nextTimer, user?.id);
      return next;
    });
  };

  const adjustTimerSeconds = (key: AppTimerKey, deltaSec: number) => {
    updateMatchTimer(key, (timer) => {
      const effective = getEffectiveRemainingTime(timer);
      const next = Math.max(0, effective + deltaSec);
      return {
        remainingTime: next,
        isActive: timer.isActive,
        lastUpdated: Date.now(),
      };
    });
  };

  const setTimerMinutes = (key: AppTimerKey, minutes: number) => {
    const safeMin = Math.max(0, Math.floor(minutes));
    const sec = safeMin * 60;
    updateMatchTimer(key, (timer) => {
      const now = Date.now();
      if (sec <= 0) {
        return { remainingTime: 0, isActive: false, lastUpdated: now };
      }
      return {
        remainingTime: sec,
        isActive: timer.isActive,
        lastUpdated: now,
      };
    });
  };

  const updateMatchTimerEnabled = (patch: Partial<AppState["matchTimerEnabled"]>) => {
    setState((prev: AppState) => {
      const base = prev.matchTimerEnabled || { general: true };
      const matchTimerEnabled = { ...base, ...patch };
      const next: AppState = {
        ...prev,
        matchTimerEnabled,
        updatedAt: Date.now(),
      };
      void saveGeneralTimerPatchAsync(prev.generalTimer, user?.id, { matchTimerEnabled });
      return next;
    });
  };

  /** 시그·식사 대전 오버레이 타이머 — matchTimer 전용 (generalTimer 와 분리) */
  const stopSigMatchOverlayTimerSynced = () => {
    setState((prev: AppState) => {
      const valid = new Set(prev.members.map((mm) => mm.id));
      const mergedSettings = { ...prev.sigMatchSettings, overlayTimerEndAt: null as number | null };
      const paused = pauseTimer(prev.matchTimer ?? prev.generalTimer);
      const next: AppState = {
        ...prev,
        matchTimer: paused,
        sigMatchSettings: {
          ...mergedSettings,
          sigMatchPools: normalizeSigMatchPools(mergedSettings.sigMatchPools || [], valid),
          participantMemberIds: normalizeSigMatchParticipantIds(mergedSettings.participantMemberIds || [], valid),
        },
        updatedAt: Date.now(),
      };
      void saveMatchTimerPatchAsync(paused, user?.id);
      return next;
    });
  };

  const startSigMatchOverlayTimerSynced = () => {
    const durationSec = resolveOverlayTimerDurationSec();
    const remNow = getEffectiveRemainingTime(state.matchTimer ?? state.generalTimer);
    if (remNow <= 0 && durationSec <= 0) {
      alert("먼저 타이머 시간을 1초 이상 입력해 주세요.");
      return;
    }
    if (sigMatchNumericEditingRef.current.overlayTimerDurationSec) {
      setSigMatchDraftEditing("overlayTimerDurationSec", false);
      setSigMatchNumericDraft((prev) => ({ ...prev, overlayTimerDurationSec: String(durationSec) }));
    }
    setState((prev: AppState) => {
      const rem = getEffectiveRemainingTime(prev.matchTimer ?? prev.generalTimer);
      const sec = Math.max(0, durationSec);
      if (rem <= 0 && sec <= 0) return prev;
      const valid = new Set(prev.members.map((mm) => mm.id));
      const mergedSettings = {
        ...prev.sigMatchSettings,
        overlayTimerDurationSec: sec,
        overlayTimerEndAt: null as number | null,
      };
      const baseTimer = prev.matchTimer ?? prev.generalTimer;
      /** 일시정지 후 시작 = 남은 시간 재개. 남은 시간이 0일 때만 설정 초로 새로 시작 */
      const started =
        rem > 0
          ? resumeTimer(baseTimer)
          : {
              remainingTime: sec,
              isActive: true,
              lastUpdated: Date.now(),
            };
      const next: AppState = {
        ...prev,
        matchTimer: started,
        sigMatchSettings: {
          ...mergedSettings,
          sigMatchPools: normalizeSigMatchPools(mergedSettings.sigMatchPools || [], valid),
          participantMemberIds: normalizeSigMatchParticipantIds(mergedSettings.participantMemberIds || [], valid),
        },
        updatedAt: Date.now(),
      };
      void saveMatchTimerPatchAsync(started, user?.id);
      return next;
    });
  };

  /** 설정 초로 되돌리고 정지(일시정지 후 시작과 구분) */
  const resetSigMatchOverlayTimerSynced = () => {
    const sec = resolveOverlayTimerDurationSec();
    if (sigMatchNumericEditingRef.current.overlayTimerDurationSec) {
      setSigMatchDraftEditing("overlayTimerDurationSec", false);
      setSigMatchNumericDraft((prev) => ({ ...prev, overlayTimerDurationSec: String(sec) }));
    }
    setState((prev: AppState) => {
      const valid = new Set(prev.members.map((mm) => mm.id));
      const mergedSettings = {
        ...prev.sigMatchSettings,
        overlayTimerDurationSec: sec,
        overlayTimerEndAt: null as number | null,
      };
      const reset = {
        remainingTime: sec,
        isActive: false,
        lastUpdated: Date.now(),
      };
      const next: AppState = {
        ...prev,
        matchTimer: reset,
        sigMatchSettings: {
          ...mergedSettings,
          sigMatchPools: normalizeSigMatchPools(mergedSettings.sigMatchPools || [], valid),
          participantMemberIds: normalizeSigMatchParticipantIds(mergedSettings.participantMemberIds || [], valid),
        },
        updatedAt: Date.now(),
      };
      void saveMatchTimerPatchAsync(reset, user?.id);
      return next;
    });
  };

  /** 시그·식사 대전 상단 공통: 시작/일시정지/리셋·초 설정 (matchTimer) */
  const renderBattleOverlayTimerControls = (opts?: { id?: string }) => {
    const battleTimer = state.matchTimer ?? state.generalTimer;
    const rem = getEffectiveRemainingTime(battleTimer, timerUiNow);
    const mm = Math.floor(rem / 60);
    const ss = rem % 60;
    const running = Boolean(battleTimer?.isActive && rem > 0);
    return (
      <div
        id={opts?.id}
        className="rounded-lg border border-cyan-500/35 bg-cyan-950/25 p-3 space-y-2"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-cyan-100">대전 오버레이 타이머</div>
          <div className="text-xs tabular-nums text-neutral-300">
            남은 {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")} ·{" "}
            <span className={running ? "text-emerald-300" : "text-neutral-400"}>
              {running ? "진행중" : "대기"}
            </span>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[160px_1fr] gap-2 items-center">
          <label className="block space-y-1">
            <span className="text-[11px] text-neutral-400">시간 설정 (초)</span>
            <input
              className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
              type="number"
              min={0}
              max={86400}
              data-skip-amount-edit-guard="1"
              placeholder="초(0=숨김)"
              value={sigMatchNumericDraft.overlayTimerDurationSec}
              onFocus={() => setSigMatchDraftEditing("overlayTimerDurationSec", true)}
              onChange={(e) =>
                setSigMatchNumericDraft((prev) => ({
                  ...prev,
                  overlayTimerDurationSec: e.target.value.replace(/[^\d]/g, ""),
                }))
              }
              onBlur={commitSigMatchTimerDurationDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 pt-0 md:pt-5">
            <button
              type="button"
              className={`rounded px-3 py-1.5 text-xs font-semibold ${
                running
                  ? "bg-amber-700 hover:bg-amber-600"
                  : "bg-emerald-700 hover:bg-emerald-600"
              }`}
              onClick={() =>
                running
                  ? stopSigMatchOverlayTimerSynced()
                  : startSigMatchOverlayTimerSynced()
              }
            >
              {running ? "일시정지" : "시작"}
            </button>
            <button
              type="button"
              className="rounded bg-neutral-700 px-3 py-1.5 text-xs font-semibold hover:bg-neutral-600"
              onClick={() => resetSigMatchOverlayTimerSynced()}
            >
              리셋
            </button>
            <a
              href="#timer-control-section"
              className="text-[11px] text-cyan-300/90 hover:text-cyan-200 underline-offset-2 hover:underline"
            >
              타이머 제어(±분·재개) →
            </a>
          </div>
        </div>
        <p className="text-[11px] text-neutral-500">
          시그·식사 대전·상류사회 OBS가 이 타이머(matchTimer)를 봅니다. 「타이머 제어」의 일반 타이머와 별개입니다. 위 초는 리셋·새 시작 기준이며, 정지 중 입력 후 Enter/blur 하면 남은 시간도 맞춰집니다.
        </p>
      </div>
    );
  };

  const updateTimerDisplayStyle = (key: "general", patch: Partial<AppState["timerDisplayStyles"]["general"]>) => {
    setState((prev: AppState) => {
      const baseStyles = prev.timerDisplayStyles || {
        general: { showHours: false, design: "pill", fontFamily: "mono", fontColor: "", bgColor: "", borderColor: "", outlineColor: "", outlineWidth: 0.8, bgOpacity: 40, scalePercent: 100 },
      };
      const normalizedPatch = { ...patch };
      if (patch.bgOpacity !== undefined) {
        const op = Math.max(0, Math.min(100, Math.round(Number(patch.bgOpacity))));
        normalizedPatch.bgOpacity = op;
        /** 배경 없음(transparent) 후 슬라이더 올리면 pill 이 보이도록 transparent 해제 */
        const curBg =
          patch.bgColor !== undefined
            ? String(patch.bgColor)
            : String(baseStyles[key]?.bgColor ?? "");
        const bgLower = curBg.trim().toLowerCase();
        if (op > 0 && (bgLower === "transparent" || bgLower === "none") && patch.bgColor === undefined) {
          normalizedPatch.bgColor = "";
        }
      }
      const nextGeneral = {
        ...baseStyles[key],
        ...normalizedPatch,
      };
      const timerDisplayStyles = {
        ...baseStyles,
        [key]: nextGeneral,
      };
      /** 타이머 제어 색을 오버레이 프리셋에도 반영 — 둘 중 하나만 바뀌어 기본색처럼 보이는 회귀 방지 */
      const nextPresets = normalizeOverlayPresetLabels(
        (Array.isArray(prev.overlayPresets) ? (prev.overlayPresets as OverlayPreset[]) : presets).map((p) => {
          /** 글꼴·색은 전 프리셋에 동기화 — showTimer 없는 프리셋의 구 mono 가 타이머 전용 URL을 덮지 않게 */
          return {
            ...p,
            ...(normalizedPatch.fontFamily !== undefined ? { timerFontFamily: String(normalizedPatch.fontFamily || "mono") } : {}),
            ...(normalizedPatch.fontColor !== undefined ? { timerFontColor: String(normalizedPatch.fontColor || "") } : {}),
            ...(normalizedPatch.bgColor !== undefined ? { timerBgColor: String(normalizedPatch.bgColor || "") } : {}),
            ...(normalizedPatch.borderColor !== undefined ? { timerBorderColor: String(normalizedPatch.borderColor || "") } : {}),
            ...(normalizedPatch.outlineColor !== undefined ? { timerOutlineColor: String(normalizedPatch.outlineColor || "") } : {}),
            ...(normalizedPatch.outlineWidth !== undefined ? { timerOutlineWidth: String(normalizedPatch.outlineWidth) } : {}),
            ...(normalizedPatch.bgOpacity !== undefined ? { timerBgOpacity: String(normalizedPatch.bgOpacity) } : {}),
            ...(normalizedPatch.scalePercent !== undefined ? { timerScale: String(normalizedPatch.scalePercent) } : {}),
            ...(normalizedPatch.showHours !== undefined ? { timerShowHours: Boolean(normalizedPatch.showHours) } : {}),
            ...(normalizedPatch.design !== undefined ? { timerDesign: String(normalizedPatch.design || "pill") } : {}),
          };
        })
      );
      const now = Date.now();
      const next: AppState = {
        ...prev,
        timerDisplayStyles,
        overlayPresets: nextPresets,
        updatedAt: now,
      };
      setPresets(nextPresets);
      try {
        window.localStorage.setItem(presetStorageKey, JSON.stringify(nextPresets));
        cacheBroadcastStateSnapshot(next, user?.id);
        notifyOverlayPresetsLocalUpdated();
        notifyBroadcastStateLocalUpdated(user?.id, now);
      } catch {}
      pendingTimerStyleSaveRef.current = {
        generalTimer: prev.generalTimer,
        timerDisplayStyles,
        overlayPresets: nextPresets,
      };
      if (timerStyleSaveTimerRef.current) clearTimeout(timerStyleSaveTimerRef.current);
      timerStyleSaveTimerRef.current = setTimeout(() => {
        timerStyleSaveTimerRef.current = null;
        const pending = pendingTimerStyleSaveRef.current;
        pendingTimerStyleSaveRef.current = null;
        if (!pending) return;
        void saveGeneralTimerPatchAsync(pending.generalTimer, user?.id, {
          timerDisplayStyles: pending.timerDisplayStyles,
          overlayPresets: pending.overlayPresets,
        });
      }, 100);
      return next;
    });
  };

  const addDonor = () => {
    const amount = parseAmount(donorAmount);
    if (!donorMemberId) return;
    if (!confirmHighAmount(amount)) return;
    if (amount <= 0) return;
    const target = donorTarget;
    const memberId = donorMemberId;
    const rawName = donorName;
    const rawMessage = donorMessage;
    const donorNameClean = (rawName || "무명").replace(/\s+/g, "") || "무명";
    const messageClean = String(rawMessage || "").trim();
    const hsSettingsNow = normalizeHighSocietySettings(stateRef.current.highSocietySettings);
    addDonorSaveChainRef.current = addDonorSaveChainRef.current
      .catch(() => {})
      .then(async () => {
      /** 투네 서버 반영과 동일 파이프라인 — `/api/donations/apply` */
      donationAuthoritativeSaveUntilRef.current = Date.now() + 45_000;
      pendingUnsyncedRef.current = true;
      const result = await applyBankDonationsViaApi(
        user?.id,
        [{
          donorName: donorNameClean,
          amount,
          memberId,
          target,
          ...(messageClean ? { message: messageClean } : {}),
        }],
        { target }
      );
      if (!result.ok) {
        setSyncStatus(
          typeof navigator !== "undefined" && !navigator.onLine ? "local" : "error"
        );
        pendingUnsyncedRef.current = false;
        window.alert(
          result.error === "high_society_paused"
            ? "상류사회 일시정지 중입니다.\n「영토 재개」 후 다시 합산해 주세요."
            : `합산 추가에 실패했습니다.\n(${result.error})` +
            (result.error === "persist_failed"
              ? "\n\n서버 저장 검증 오류입니다. 새로고침 후 후원 목록을 확인해 주세요."
              : "")
        );
        return;
      }
      setDonorName("");
      setDonorMessage("");
      setDonorAmount("");
      const merged = enrichStateBeforeAuthoritativeDonationSave(stateRef.current, [result.state]);
      markAuthoritativeDonationSave(
        { serverUpdatedAt: result.updatedAt },
        merged,
        { awaitingServerSave: false }
      );
      const serverAt = result.updatedAt;
      const bumped: AppState = {
        ...merged,
        updatedAt: Math.max(Number(merged.updatedAt || 0), serverAt),
        donorRankingsUpdatedAt: Math.max(
          Number(merged.donorRankingsUpdatedAt || 0),
          result.donorRankingsUpdatedAt ?? serverAt
        ),
      };
      stateRef.current = bumped;
      stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, bumped.updatedAt);
      lastAppliedRemoteUpdatedAtRef.current = Math.max(
        lastAppliedRemoteUpdatedAtRef.current,
        bumped.updatedAt
      );
      donationAuthoritativeSaveUntilRef.current = Date.now() + 45_000;
      pendingUnsyncedRef.current = false;
      try {
        cacheBroadcastStateSnapshot(bumped, user?.id);
      } catch {}
      notifyBroadcastStateLocalUpdated(user?.id, bumped.updatedAt);
      setState(bumped);
      setSyncStatus("synced");
      if (hsSettingsNow.enabled) {
        const memberName =
          (stateRef.current.members || []).find((m) => m.id === memberId)?.name || memberId;
        showAppToast(
          `합산 반영: 「${donorNameClean}」→${memberName} ${amount.toLocaleString("ko-KR")}원`
        );
      }
    });
  };

  const previewBulkDonations = () => {
    const parsed = parseBulkDonationText(bulkDonationText);
    setBulkDonationTarget(parsed.defaultTarget);
    setBulkDonationSkipped(parsed.skipped);
    const resolved = resolveBulkDonationRows(
      parsed.rows,
      stateRef.current.members || [],
      [],
      stateRef.current.memberPositions
    );
    setBulkDonationPreview(resolved);
  };

  const applyBulkDonations = () => {
    const preview =
      bulkDonationPreview ??
      resolveBulkDonationRows(
        parseBulkDonationText(bulkDonationText).rows,
        stateRef.current.members || [],
        [],
        stateRef.current.memberPositions
      );
    const matched = preview.filter((r) => r.matched && r.memberId);
    const unmatched = preview.filter((r) => !r.matched || !r.memberId);
    if (matched.length === 0) {
      window.alert("멤버에 매칭된 줄이 없습니다. 멤버 이름(태호·홍쓰 등)을 확인해 주세요.");
      return;
    }
    if (unmatched.length > 0) {
      const sample = unmatched
        .slice(0, 8)
        .map((r) => `${r.lineNo}: ${r.raw}`)
        .join("\n");
      if (
        !window.confirm(
          `매칭 ${matched.length}건만 추가합니다.\n미매칭 ${unmatched.length}건은 건너뜁니다.\n\n${sample}${
            unmatched.length > 8 ? "\n…" : ""
          }\n\n계속할까요?`
        )
      ) {
        return;
      }
    } else if (
      !window.confirm(`계좌/투네 일괄 추가 ${matched.length}건을 반영할까요?`)
    ) {
      return;
    }
    const target =
      bulkDonationPreview != null
        ? bulkDonationTarget
        : parseBulkDonationText(bulkDonationText).defaultTarget;
    setBulkDonationBusy(true);
    addDonorSaveChainRef.current = addDonorSaveChainRef.current
      .catch(() => {})
      .then(async () => {
        donationAuthoritativeSaveUntilRef.current = Date.now() + 60_000;
        pendingUnsyncedRef.current = true;
        const result = await applyBankDonationsViaApi(
          user?.id,
          matched.map((row) => ({
            donorName: row.donorName.replace(/\s+/g, "") || "무명",
            amount: row.amount,
            memberId: row.memberId!,
            target,
            ...(String(row.raw || "").trim() ? { message: String(row.raw).trim() } : {}),
          })),
          { target }
        );
        if (!result.ok) {
          setSyncStatus(
            typeof navigator !== "undefined" && !navigator.onLine ? "local" : "error"
          );
          pendingUnsyncedRef.current = false;
          window.alert(`일괄 추가 저장에 실패했습니다.\n(${result.error})`);
          return;
        }
        const merged = enrichStateBeforeAuthoritativeDonationSave(stateRef.current, [result.state]);
        markAuthoritativeDonationSave(
          { serverUpdatedAt: result.updatedAt },
          merged,
          { awaitingServerSave: false }
        );
        const serverAt = result.updatedAt;
        const bumped: AppState = {
          ...merged,
          updatedAt: Math.max(Number(merged.updatedAt || 0), serverAt),
          donorRankingsUpdatedAt: Math.max(
            Number(merged.donorRankingsUpdatedAt || 0),
            result.donorRankingsUpdatedAt ?? serverAt
          ),
        };
        stateRef.current = bumped;
        stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, bumped.updatedAt);
        lastAppliedRemoteUpdatedAtRef.current = Math.max(
          lastAppliedRemoteUpdatedAtRef.current,
          bumped.updatedAt
        );
        donationAuthoritativeSaveUntilRef.current = Date.now() + 60_000;
        pendingUnsyncedRef.current = false;
        try {
          cacheBroadcastStateSnapshot(bumped, user?.id);
        } catch {}
        notifyBroadcastStateLocalUpdated(user?.id, bumped.updatedAt);
        setState(bumped);
        setSyncStatus("synced");
        setBulkDonationText("");
        setBulkDonationPreview(null);
        setBulkDonationSkipped([]);
        window.alert(
          `일괄 추가 완료: ${result.appliedCount}건` +
            (unmatched.length > 0 ? ` (미매칭 ${unmatched.length}건 제외)` : "")
        );
      })
      .finally(() => setBulkDonationBusy(false));
  };

  const fetchUnmatchedEvents = useCallback(async () => {
    if (typeof window === "undefined") return;
    const uid = user?.id || "";
    if (!uid) return;
    try {
      const res = await fetch(`/api/donations/unmatched?u=${encodeURIComponent(uid)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as { items?: DonationEvent[] } | null;
      const items = Array.isArray(data?.items) ? data.items : [];
      setUnmatchedEvents(items);
      if (items.length > 0) {
        setUnmatchedAssignMap((prev) => {
          const next = { ...prev };
          for (const evt of items) {
            if (next[evt.id]) continue;
            const suggested = suggestMemberForDonationEvent(
              evt,
              stateRef.current.members || [],
              [],
              stateRef.current.memberPositions
            );
            if (suggested?.id) next[evt.id] = suggested.id;
          }
          return next;
        });
      }
    } catch {
      // noop
    }
  }, [user?.id]);

  const pushToonationLog = useCallback((message: string) => {
    setToonationLogs((prev) => {
      const now = Date.now();
      /** SSE 이중 브로드캐스트 등으로 같은 초·같은 문구가 연속으로 오면 1건만 남김 */
      const head = prev[0];
      if (head && head.message === message && Math.abs(now - head.at) < 2000) {
        return prev;
      }
      return [{ id: `tl_${now}_${Math.random().toString(36).slice(2, 6)}`, at: now, message }, ...prev].slice(0, 80);
    });
  }, []);

  const onBrowserRelayForwarded = useCallback(
    (info: ToonationRelayForwarded) => {
      const at = info.at || Date.now();
      if (info.ok) {
        setToonationListenerMeta((prev) => ({
          ...prev,
          lastEventAt: at,
          ...(info.outcome === "applied" || info.outcome === "applied_needs_review"
            ? { lastDonationAt: at }
            : {}),
        }));
        if (
          info.outcome === "applied" ||
          info.outcome === "applied_needs_review" ||
          info.outcome === "duplicate"
        ) {
          setToonationListenerStatus(
            info.outcome === "duplicate"
              ? { kind: "connected", message: "투네 이벤트 수신 중(브라우저 릴레이)" }
              : {
                  kind: "connected",
                  message:
                    info.outcome === "applied"
                      ? "투네 후원 수신 중(브라우저 릴레이)"
                      : "투네 반영 중(브라우저 릴레이)",
                }
          );
        }
      }
      if (!info.ok || !info.outcome) return;
      if (info.outcome === "duplicate" || info.outcome === "ignored") return;
      const label =
        info.outcome === "applied"
          ? "엑셀표 반영"
          : info.outcome === "applied_needs_review"
            ? "반영(멤버 확인)"
            : info.outcome;
      pushToonationLog(`브라우저 릴레이 · ${label}`);
    },
    [pushToonationLog]
  );

  useEffect(() => {
    pushToonationLogRef.current = pushToonationLog;
  }, [pushToonationLog]);

  const fetchDonationAliases = useCallback(async () => {
    const uid = user?.id || "";
    if (!uid) return;
    try {
      const res = await fetch(`/api/donations/aliases?u=${encodeURIComponent(uid)}`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as { items?: DonorAlias[] } | null;
      setDonorAliases(Array.isArray(data?.items) ? data.items : []);
    } catch {
      // noop
    }
  }, [user?.id]);

  const fetchToonationQueue = useCallback(async (): Promise<DonationEvent[]> => {
    const uid = user?.id || "";
    if (!uid) return [];
    try {
      const res = await fetch(`/api/donations/queue?u=${encodeURIComponent(uid)}`, { cache: "no-store" });
      if (!res.ok) return [];
      const data = (await res.json().catch(() => null)) as { items?: DonationEvent[] } | null;
      const items = Array.isArray(data?.items) ? data.items : [];
      setToonationQueue(items);
      toonationQueueHydratedRef.current = true;
      return items;
    } catch {
      return [];
    }
  }, [user?.id]);

  useEffect(() => {
    fetchToonationQueueRef.current = () => fetchToonationQueue();
  }, [fetchToonationQueue]);

  const removeQueueEvent = useCallback(async (id: string) => {
    const uid = user?.id || "";
    if (!uid || !id) return;
    await fetch(`/api/donations/queue?u=${encodeURIComponent(uid)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }, [user?.id]);

  const removeQueueEventsMatchingDonor = useCallback(
    async (donor: Donor) => {
      const uid = user?.id || "";
      if (!uid) return;
      const keys = new Set(donationQueueIdsForDonor(donor));
      if (keys.size === 0) return;
      try {
        const res = await fetch(`/api/donations/queue?u=${encodeURIComponent(uid)}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json().catch(() => null)) as { items?: DonationEvent[] } | null;
        const items = Array.isArray(data?.items) ? data.items : [];
        for (const evt of items) {
          const evtId = String(evt.id || "").trim();
          const evtBase = normalizeDonationEventId(evtId);
          if (keys.has(evtId) || keys.has(evtBase)) {
            await removeQueueEvent(evtId);
          }
        }
        await fetchToonationQueue();
      } catch {
        /* noop */
      }
    },
    [fetchToonationQueue, removeQueueEvent, user?.id]
  );

  const markAuthoritativeDonationSave = useCallback((
    saved: { serverUpdatedAt?: number },
    next: AppState,
    opts?: { replaceDonors?: boolean; awaitingServerSave?: boolean }
  ) => {
    /**
     * replaceDonors: 삭제·정본 스냅샷은 그대로 유지.
     * merge(기본): 후원 추가 시 화면 멤버 구성과 union.
     */
    if (opts?.replaceDonors) {
      const prevIds = new Set((stateRef.current.donors || []).map((d) => d.id));
      const nextIds = new Set((next.donors || []).map((d) => d.id));
      const until = Date.now() + 45_000;
      for (const id of prevIds) {
        if (!nextIds.has(id)) recentlyRemovedDonorIdsRef.current.set(id, until);
      }
    }
    const preserved = opts?.replaceDonors
      ? next
      : mergeDonationApplyBase(next, stateRef.current) ?? next;
    const ts = saved.serverUpdatedAt ?? preserved.updatedAt ?? Date.now();
    donationAuthoritativeSaveUntilRef.current = Date.now() + 20_000;
    stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, ts);
    lastAppliedRemoteUpdatedAtRef.current = Math.max(lastAppliedRemoteUpdatedAtRef.current, ts);
    lastLocalPersistAtRef.current = Date.now();
    /**
     * 서버 POST 전에 synced 로 보이면 폴링이 빈 Redis 를 허용할 수 있음.
     * 합산·삭제 등 저장 대기 중에는 pending 유지.
     */
    pendingUnsyncedRef.current = Boolean(opts?.awaitingServerSave);
    stateRef.current = preserved;
    try {
      cacheBroadcastStateSnapshot(preserved, user?.id);
    } catch {}
    notifyBroadcastStateLocalUpdated(user?.id, preserved.updatedAt);
    return preserved;
  }, [user?.id]);

  /** 삭제·나누기·재배치 — POST /api/state 대신 투네와 동일 persist 파이프라인 */
  const commitAuthoritativeDonorPersist = useCallback(
    async (
      preserved: AppState,
      opts?: { protectionMs?: number; persistToastLabel?: string }
    ): Promise<boolean> => {
      const protectionMs = opts?.protectionMs ?? 45_000;
      donationAuthoritativeSaveUntilRef.current = Date.now() + protectionMs;
      const result = await persistDonationStateViaApi(user?.id, preserved, "replace");
      if (!result.ok) {
        pendingUnsyncedRef.current = false;
        setSyncStatus(
          typeof navigator !== "undefined" && !navigator.onLine ? "local" : "error"
        );
        if (opts?.persistToastLabel) {
          showServerPersistToast(opts.persistToastLabel, { ok: false });
        }
        return false;
      }
      /** replace 저장 후 union(enrich)하면 삭제분이 서버·백업에서 되살아남 */
      const serverAt = result.updatedAt;
      const bumped = syncMemberTotalsFromDonors({
        ...result.state,
        updatedAt: Math.max(Number(result.state.updatedAt || 0), serverAt),
        donorRankingsUpdatedAt: Math.max(
          Number(result.state.donorRankingsUpdatedAt || 0),
          result.donorRankingsUpdatedAt ?? serverAt
        ),
      });
      stateRef.current = bumped;
      stateUpdatedAtRef.current = Math.max(stateUpdatedAtRef.current, bumped.updatedAt);
      lastAppliedRemoteUpdatedAtRef.current = Math.max(
        lastAppliedRemoteUpdatedAtRef.current,
        bumped.updatedAt
      );
      donationAuthoritativeSaveUntilRef.current = Date.now() + protectionMs;
      pendingUnsyncedRef.current = false;
      try {
        cacheBroadcastStateSnapshot(bumped, user?.id);
      } catch {}
      notifyBroadcastStateLocalUpdated(user?.id, bumped.updatedAt);
      setState(bumped);
      setSyncStatus("synced");
      if (opts?.persistToastLabel) {
        showServerPersistToast(opts.persistToastLabel, { ok: true });
      }
      return true;
    },
    [user?.id]
  );

  restoreDonorsFromDailyLogSnapshotRef.current = async () => {
    const serverLog = await loadDailyLogFromApi(user?.id);
    const localLog = loadDailyLog(user?.id);
    const merged: Record<string, DailyLogEntry[]> = { ...localLog, ...serverLog };
    const todayKey = new Date().toISOString().slice(0, 10);
    const latest = pickDailyLogEntryForRestore(merged, todayKey);
    if (!latest) {
      window.alert("일일 로그에 복구할 후원 스냅샷이 없습니다.");
      return;
    }
    const donorCount = Array.isArray(latest.donors) ? latest.donors.length : 0;
    const memberCount = Array.isArray(latest.members) ? latest.members.length : 0;
    if (donorCount === 0 && memberCount === 0) {
      window.alert("최근 일일 로그에 후원·멤버 데이터가 없습니다.");
      return;
    }
    const fromToday = String(latest.at || "").slice(0, 10) === todayKey;
    if (
      !window.confirm(
        `일일 로그 ${fromToday ? "오늘" : "최근"} 스냅샷(${latest.at})에서 복구합니다.\n` +
          `후원 ${donorCount}건 · 멤버 ${memberCount}명\n` +
          `서버·엑셀표·후원순위에 반영됩니다. 계속할까요?`
      )
    ) {
      return;
    }
    const prev = stateRef.current;
    const now = Date.now();
    const rebumpedDonors = rebumpDonorsPastSettlementReset(
      donorCount > 0 ? latest.donors : prev.donors,
      Number(prev.settlementResetAt || 0)
    );
    const next: AppState = syncMemberTotalsFromDonors({
      ...prev,
      ...(memberCount > 0 ? { members: latest.members } : {}),
      donors: rebumpedDonors,
      donorRankingsUpdatedAt: now,
      updatedAt: now,
    });
    const preserved = markAuthoritativeDonationSave(
      { serverUpdatedAt: next.updatedAt },
      next,
      { replaceDonors: true, awaitingServerSave: true }
    );
    setState(preserved);
    const ok = await commitAuthoritativeDonorPersist(preserved, { protectionMs: 20_000 });
    if (ok) {
      window.alert(
        `일일 로그 복구 완료: 후원 ${rebumpedDonors.length}건 · 멤버 ${
          memberCount || prev.members.length
        }명 (엑셀·후원순위 반영)`
      );
    } else {
      setSyncStatus(
        typeof navigator !== "undefined" && !navigator.onLine ? "local" : "error"
      );
      window.alert("일일 로그 복구 저장에 실패했습니다. 네트워크·동기화 상태를 확인하세요.");
    }
  };

  const applyProcessDonationResult = useCallback((result: ProcessDonationResult) => {
    if (!result.updatedState) return;
    const needsResave =
      result.status === "failed" || String(result.error || "") === "state_save_failed";
    const preserved = markAuthoritativeDonationSave(
      { serverUpdatedAt: result.updatedState.updatedAt },
      result.updatedState,
      { awaitingServerSave: needsResave }
    );
    setState(preserved);
    /** 후원 반영 직후 서버 저장 실패·누락 시 즉시 재저장 */
    if (needsResave) {
      void persistDonationStateViaApi(user?.id, preserved, "add").then((r) => {
        if (r.ok) {
          setState(r.state);
          stateRef.current = r.state;
          pendingUnsyncedRef.current = false;
          setSyncStatus("synced");
          stateUpdatedAtRef.current = r.updatedAt;
          lastAppliedRemoteUpdatedAtRef.current = r.updatedAt;
          notifyBroadcastStateLocalUpdated(user?.id, r.updatedAt);
        } else {
          setSyncStatus(
            typeof navigator !== "undefined" && !navigator.onLine ? "local" : "error"
          );
        }
      });
    }
  }, [markAuthoritativeDonationSave, user?.id]);

  const autoProcessAllQueueEvents = useCallback(async (events?: DonationEvent[]) => {
    let batch = events;
    if (!batch || batch.length === 0) {
      batch = await fetchToonationQueue();
    }
    if (batch.length === 0) return;
    let applied = 0;
    let cleared = 0;
    for (const evt of batch) {
      if (evt.alreadyApplied) {
        await removeQueueEvent(evt.id);
        cleared += 1;
        continue;
      }
      const freshState = await loadStateFromApi(user?.id, { forceFull: true });
      if (freshState && isDuplicateDonationEvent(freshState, evt)) {
        await removeQueueEvent(evt.id);
        cleared += 1;
        continue;
      }
      const result = await processDonationEvent(
        { ...evt, status: "queued" },
        user?.id,
        stateRef.current,
        { ownerName: toonationOwnerName }
      );
      applyProcessDonationResult(result);

      if (result.updatedState) {
        await removeQueueEvent(evt.id);
        applied += 1;
      } else if (result.status === "processed") {
        const verify = await loadStateFromApi(user?.id, { forceFull: true });
        if (verify && isDuplicateDonationEvent(verify, evt)) {
          await removeQueueEvent(evt.id);
          cleared += 1;
        } else {
          pushToonationLog(
            `큐 유지: ${evt.donorName} ${evt.amount.toLocaleString("ko-KR")}원 — processed 표시였으나 상태에 없음`
          );
        }
      } else if (result.status === "unmatched") {
        await removeQueueEvent(evt.id);
        const hint = String(evt.message || evt.playerName || "").trim();
        pushToonationLog(
          `미매칭: ${evt.donorName} ${evt.amount.toLocaleString("ko-KR")}원` +
            (hint ? ` — 「${hint}」` : "") +
            " → 아래 미매칭 목록에서 멤버 선택 후 「선택 멤버로 반영」"
        );
      } else if (result.status === "failed") {
        pushToonationLog(
          `반영 실패(큐 유지): ${evt.donorName} ${evt.amount.toLocaleString("ko-KR")}원 (${result.error || "unknown"})`
        );
      }
    }
    await fetchToonationQueue();
    await fetchUnmatchedEvents();
    if (applied > 0) {
      pushToonationLog(`자동 반영: ${applied}건`);
    }
    if (cleared > 0) {
      pushToonationLog(`이미 반영된 큐 ${cleared}건 정리`);
    }
  }, [
    applyProcessDonationResult,
    fetchToonationQueue,
    fetchUnmatchedEvents,
    pushToonationLog,
    removeQueueEvent,
    user?.id,
    toonationOwnerName,
  ]);

  useEffect(() => {
    autoProcessQueueRef.current = (events?: DonationEvent[]) => autoProcessAllQueueEvents(events);
  }, [autoProcessAllQueueEvents]);

  const removeUnmatchedEvent = useCallback(async (id: string) => {
    const uid = user?.id || "";
    if (!uid || !id) return;
    await fetch(`/api/donations/unmatched/resolve?u=${encodeURIComponent(uid)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
    await fetchUnmatchedEvents();
  }, [fetchUnmatchedEvents, user?.id]);

  const injectToonationTestEvent = useCallback(async () => {
    const amount = parseAmount(donorAmount || "10000");
    const name = (donorName || "투네테스트").trim();
    if (amount <= 0) return;
    const event: DonationEvent = {
      id: `toonation:test:${Date.now()}`,
      provider: "toonation",
      externalId: `manual-${Date.now()}`,
      donorName: name,
      amount,
      message: "admin-manual-test",
      at: new Date().toISOString(),
      target: "toon",
      status: "queued",
    };
    const result = await processDonationEvent(event, user?.id, stateRef.current, {
      ownerName: toonationOwnerName,
    });
    applyProcessDonationResult(result);
    await fetchUnmatchedEvents();
    setDonorAmount("");
  }, [applyProcessDonationResult, donorAmount, donorName, fetchUnmatchedEvents, toonationOwnerName, user?.id]);

  const [showDevSeedTools, setShowDevSeedTools] = useState(false);
  useEffect(() => {
    setShowDevSeedTools(/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname));
  }, []);

  const seedDevDummyDonations = useCallback(
    async (mode: "replace" | "append" = "replace") => {
      if (!showDevSeedTools) return;
      const label = mode === "replace" ? "기존 후원을 더미로 교체" : "더미를 뒤에 추가";
      if (
        !window.confirm(
          `개발용 더미 후원을 ${label}합니다.\n` +
            `· 「단체짠더미」→ 나누기 테스트\n` +
            `· 소액 더미 → 삭제 테스트\n` +
            `· 국고 멤버가 있으면 「국고더미」포함\n\n계속할까요?`
        )
      ) {
        return;
      }
      try {
        const q = new URLSearchParams();
        if (user?.id) {
          q.set("u", user.id);
          q.set("user", user.id);
        }
        const res = await fetch(`/api/dev/seed-donations?${q.toString()}`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          error?: string;
          added?: number;
          donorsCount?: number;
          state?: AppState;
          hint?: string;
        } | null;
        if (!res.ok || !data?.ok || !data.state) {
          /** API 실패 시 클라이언트 시드로 폴백 */
          const local = applyDonationDummySeed(stateRef.current, { mode });
          const preserved = markAuthoritativeDonationSave(
            { serverUpdatedAt: local.state.updatedAt },
            local.state,
            { replaceDonors: true, awaitingServerSave: true }
          );
          setState(preserved);
          const ok = await commitAuthoritativeDonorPersist(preserved);
          pendingUnsyncedRef.current = false;
          if (!ok) {
            pushToonationLog(`더미 시드 실패: ${data?.error || "save_failed"}`);
            return;
          }
          pushToonationLog(
            `더미 시드(로컬): ${local.added.length}건 · 삭제/단체짠 나누기 테스트 가능`
          );
          return;
        }
        const preserved = markAuthoritativeDonationSave(
          { serverUpdatedAt: data.state.updatedAt },
          data.state,
          { replaceDonors: true }
        );
        pendingUnsyncedRef.current = false;
        setState(preserved);
        setSyncStatus("synced");
        pushToonationLog(
          `더미 시드: ${data.added ?? 0}건 추가 · 총 ${data.donorsCount ?? 0}건` +
            (data.hint ? ` — ${data.hint}` : "")
        );
      } catch (e) {
        pushToonationLog(`더미 시드 오류: ${e instanceof Error ? e.message : "unknown"}`);
      }
    },
    [showDevSeedTools, commitAuthoritativeDonorPersist, markAuthoritativeDonationSave, pushToonationLog, user?.id]
  );

  const applyUnmatchedEvent = useCallback(async (event: DonationEvent) => {
    const selectedMemberId = unmatchedAssignMap[event.id] || donorMemberId || state.members[0]?.id || "";
    if (!selectedMemberId) return;
    const member = state.members.find((m) => m.id === selectedMemberId);
    if (!member) return;
    const displayDonorName = (aliasInputMap[event.id] || event.donorName || "").trim();
    if (!displayDonorName) return;

    const result = await processDonationEvent(
      {
        ...event,
        donorName: displayDonorName,
        manualAssignMemberId: selectedMemberId,
        target: event.target || "toon",
        status: "queued",
      },
      user?.id,
      stateRef.current,
      { ownerName: toonationOwnerName }
    );
    if (result.updatedState) {
      const preserved = markAuthoritativeDonationSave(
        { serverUpdatedAt: result.updatedState.updatedAt },
        result.updatedState
      );
      setState(preserved);
      pushToonationLog(
        `미매칭 반영: ${displayDonorName} ${event.amount.toLocaleString("ko-KR")}원 → ${member.name}`
      );
      await removeUnmatchedEvent(event.id);
    } else if (result.status === "failed") {
      pushToonationLog(`미매칭 반영 실패: ${displayDonorName} (${result.error || "unknown"})`);
    } else {
      pushToonationLog(
        `미매칭 반영 실패: ${displayDonorName} — 상태가 갱신되지 않음 (${result.status || "unknown"})`
      );
    }
  }, [
    aliasInputMap,
    donorMemberId,
    markAuthoritativeDonationSave,
    pushToonationLog,
    removeUnmatchedEvent,
    state.members,
    toonationOwnerName,
    unmatchedAssignMap,
    user?.id,
  ]);

  const applyGroupSplitFromDonor = useCallback(
    async (donor: Donor) => {
      if (String(donor.id || "").includes(":split:") || donor.groupSplit) {
        pushToonationLog("이미 분배된 하위 행입니다.");
        return;
      }
      /**
       * 빈 Redis GET 을 먼저 쓰면 화면 후원이 사라지거나 리셋 스탬프가 꼬인다.
       * 화면 stateRef 를 기준으로 LS·서버 donors 만 보강한다.
       */
      const freshState = await loadStateFromApi(user?.id, { forceFull: true });
      const localSnap = loadState(user?.id);
      const base = enrichStateBeforeAuthoritativeDonationSave(stateRef.current, [
        localSnap,
        freshState,
      ]);
      if (!normalizeDonorsArray(base.donors).some((d) => d.id === donor.id)) {
        pushToonationLog(
          `단체짠 분배 실패: ${donor.name} — 후원 행을 찾지 못함 (서버가 비어 있으면 합산 추가 후 다시 시도)`
        );
        return;
      }

      const settings = normalizeGroupSplitDonationSettings(base.groupSplitDonationSettings);
      const applied = splitExistingDonorInAppState(base, donor.id, settings);
      if (!applied.ok) {
        const err =
          applied.reason === "duplicate"
            ? "이미 단체짠 분배됨"
            : applied.reason === "no_eligible"
              ? "분배 대상 멤버 없음"
              : applied.reason === "amount_too_small"
                ? "금액이 너무 작음"
                : applied.reason === "not_found"
                  ? "후원 행을 찾지 못함"
                  : "분배할 수 없는 행";
        pushToonationLog(`단체짠 분배 실패: ${donor.name} — ${err}`);
        return;
      }

      const resetAt = Math.max(
        Number(applied.state.settlementResetAt || 0),
        Number(freshState?.settlementResetAt || 0),
        Number(stateRef.current.settlementResetAt || 0)
      );
      const rebumpedState = syncMemberTotalsFromDonors({
        ...applied.state,
        settlementResetAt: resetAt || applied.state.settlementResetAt,
        donors: rebumpDonorsPastSettlementReset(applied.state.donors, resetAt),
        donorRankingsUpdatedAt: Date.now(),
        updatedAt: Date.now(),
      });
      /** 저장 전에 보호 구간을 열어 빈 Redis 폴링이 나누기 결과를 지우지 않게 함 */
      const preserved = markAuthoritativeDonationSave(
        { serverUpdatedAt: rebumpedState.updatedAt },
        rebumpedState,
        { replaceDonors: true, awaitingServerSave: true }
      );
      setState(preserved);
      const ok = await commitAuthoritativeDonorPersist(preserved);
      if (!ok) {
        pushToonationLog("단체짠 분배: 저장 실패");
        return;
      }
      pushToonationLog(
        `단체짠: ${donor.name} ${donor.amount.toLocaleString("ko-KR")}원 → ${applied.donors.length}행 생성 (${applied.preview.sharePerMember.toLocaleString("ko-KR")}원×${applied.preview.eligibleMembers.length}명, 합계 ${donor.amount.toLocaleString("ko-KR")}원 유지)`
      );
    },
    [commitAuthoritativeDonorPersist, markAuthoritativeDonationSave, pushToonationLog, user?.id]
  );

  const saveAliasForUnmatched = useCallback(async (event: DonationEvent) => {
    const uid = user?.id || "";
    if (!uid) return;
    const selectedMemberId = unmatchedAssignMap[event.id] || donorMemberId || state.members[0]?.id || "";
    if (!selectedMemberId) return;
    const alias = (aliasInputMap[event.id] || event.donorName || "").trim();
    if (!alias) return;
    await fetch(`/api/donations/aliases?u=${encodeURIComponent(uid)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alias, memberId: selectedMemberId }),
    }).catch(() => {});
    const { invalidateDonationAliasCache } = await import("@/lib/donation/processor");
    invalidateDonationAliasCache();
    await fetchDonationAliases();
    pushToonationLog(`별칭 저장: ${alias} -> ${state.members.find((m) => m.id === selectedMemberId)?.name || selectedMemberId}`);
    await applyUnmatchedEvent(event);
  }, [
    aliasInputMap,
    applyUnmatchedEvent,
    donorMemberId,
    fetchDonationAliases,
    pushToonationLog,
    state.members,
    unmatchedAssignMap,
    user?.id,
  ]);

  const persistToonationSettings = useCallback(
    async (opts?: { socketEnabled?: boolean; skipToast?: boolean }) => {
      const uid = user?.id;
      if (!uid || !toonationSettingsHydrated) {
        showAppToast("설정을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.", { variant: "info" });
        return false;
      }
      if (toonationHydratedUserIdRef.current !== uid) return false;

      const enabled = opts?.socketEnabled ?? toonationSocketEnabled;
      const owner = toonationOwnerName.trim();
      const linkInput = toonationAlertboxUrl.trim();
      const normalized = toonationResolvedAlertboxUrl;
      const linkKey = extractToonationLinkKey(linkInput) || normalized || linkInput;

      if (linkInput && !normalized && !isExampleToonationLinkKey(linkInput)) {
        showAppToast("연동키 형식을 확인해 주세요.", { variant: "error" });
        return false;
      }
      if (enabled && !normalized) {
        showAppToast("실시간 수집 ON — 연동키를 입력해 주세요.", { variant: "error" });
        return false;
      }
      if (normalized && isExampleToonationLinkKey(normalized)) {
        showAppToast("예시 연동키는 사용할 수 없습니다.", { variant: "error" });
        return false;
      }

      if (opts?.socketEnabled !== undefined) {
        setToonationSocketEnabled(enabled);
      }

      setToonationSavePending(true);
      try {
        if (!isServerAuthoritativeBroadcastState()) {
          writeToonationSettingsToLocal(uid, {
            alertboxUrl: linkInput,
            socketEnabled: enabled,
            ownerName: owner,
          });
        }

        if (!enabled) {
          if (normalized) {
            await syncToonationListenerFromBrowser(normalized, {
              userId: uid,
              ownerName: owner,
              enabled: false,
              onStatus: setToonationListenerStatus,
            });
          } else {
            await stopToonationListener(uid);
            setToonationListenerStatus({ kind: "idle", message: "실시간 수집 꺼짐" });
          }
        } else {
          await syncToonationListenerFromBrowser(normalized!, {
            userId: uid,
            ownerName: owner,
            enabled: true,
            onStatus: setToonationListenerStatus,
          });
        }

        const status = await fetchToonationListenerStatus(uid);
        const verified = verifyToonationSettingsSaved(status, {
          linkKey,
          ownerName: owner,
          enabled,
        });
        if (!verified.ok) {
          showAppToast(verified.message, { variant: "error", durationMs: 4500 });
          return false;
        }

        setToonationLastSavedAt(Number(status?.updatedAt || Date.now()));
        if (!opts?.skipToast) {
          const keyLabel = maskToonationLinkKeyForDisplay(linkKey);
          showServerPersistToast(
            enabled
              ? `투네 연동 · 연동키 ${keyLabel} · 채널 주인명 ${owner || "(미입력)"} · 실시간 수집 ON`
              : `투네 연동 · 연동키 ${keyLabel} · 실시간 수집 OFF`,
            { ok: true }
          );
        }
        return true;
      } catch (err) {
        showAppToast(
          `투네 연동 저장 실패: ${err instanceof Error ? err.message : String(err)}`,
          { variant: "error", durationMs: 4500 }
        );
        return false;
      } finally {
        setToonationSavePending(false);
      }
    },
    [
      toonationAlertboxUrl,
      toonationOwnerName,
      toonationResolvedAlertboxUrl,
      toonationSettingsHydrated,
      toonationSocketEnabled,
      user?.id,
    ]
  );

  useEffect(() => {
    if (!user?.id) {
      toonationHydratedUserIdRef.current = null;
      setToonationSettingsHydrated(false);
      setToonationAlertboxUrl("");
      setToonationOwnerName("");
      setToonationSocketEnabled(false);
      return;
    }
    let cancelled = false;
    toonationHydratedUserIdRef.current = null;
    setToonationSettingsHydrated(false);
    toonationLocalEditedAfterRef.current = 0;
    /** 계정 전환 직후: 이전 계정 값이 화면에 남지 않게 비움 → 서버 정본만 로드 */
    if (!isServerAuthoritativeBroadcastState()) {
      setToonationAlertboxUrl(readToonationAlertboxFromLocal(user.id));
      setToonationSocketEnabled(readToonationSocketEnabledFromLocal(user.id));
      setToonationOwnerName(readToonationOwnerFromLocal(user.id));
    } else {
      setToonationAlertboxUrl("");
      setToonationSocketEnabled(false);
      setToonationOwnerName("");
    }
    const hydrateStartedAt = Date.now();
    void (async () => {
      let hydratedStatus: Awaited<ReturnType<typeof fetchToonationListenerStatus>> = null;
      try {
        hydratedStatus = await fetchToonationListenerStatus(user.id);
        if (cancelled) return;
        if (toonationLocalEditedAfterRef.current > hydrateStartedAt) return;
        const status = hydratedStatus;
        const serverUrl = String(status?.alertboxUrl || "").trim();
        const serverKey = extractToonationLinkKey(serverUrl) || serverUrl;
        if (isServerAuthoritativeBroadcastState()) {
          if (serverKey && !isExampleToonationLinkKey(serverKey)) {
            setToonationAlertboxUrl(serverKey);
            setToonationSocketEnabled(status?.enabled !== false);
            const serverOwner = String(status?.ownerName || "").trim();
            if (serverOwner) setToonationOwnerName(serverOwner);
          } else {
            const localRaw = readToonationAlertboxFromLocal(user.id);
            const localKey = extractToonationLinkKey(localRaw) || localRaw.trim();
            if (localKey && !isExampleToonationLinkKey(localKey)) {
              setToonationAlertboxUrl(localKey);
              setToonationSocketEnabled(readToonationSocketEnabledFromLocal(user.id));
              const localOwner = readToonationOwnerFromLocal(user.id);
              if (localOwner) setToonationOwnerName(localOwner);
            }
          }
          return;
        }
        const localRaw = readToonationAlertboxFromLocal(user.id);
        const localKey = extractToonationLinkKey(localRaw) || localRaw.trim();
        const localUpdatedAt = readToonationSettingsUpdatedAtFromLocal(user.id);
        const serverUpdatedAt = Number(status?.updatedAt || 0);
        const preferLocal = shouldPreferLocalToonationSettingsOverServer({
          localKey,
          serverKey,
          localUpdatedAt,
          serverUpdatedAt,
        });
        if (serverKey && !isExampleToonationLinkKey(serverKey) && !preferLocal) {
          setToonationAlertboxUrl(serverKey);
          setToonationSocketEnabled(status?.enabled !== false);
          const serverOwner = String(status?.ownerName || "").trim();
          if (serverOwner) setToonationOwnerName(serverOwner);
          if (!isServerAuthoritativeBroadcastState()) {
            writeToonationSettingsToLocal(user.id, {
              alertboxUrl: serverKey,
              socketEnabled: status?.enabled !== false,
              ownerName: serverOwner || undefined,
            });
          }
        } else if (preferLocal && localKey && !isExampleToonationLinkKey(localKey)) {
          /** 로컬 연동키가 더 최신 — 화면·LS 유지, sync effect 가 서버(Redis)를 갱신 */
          setToonationAlertboxUrl(localKey);
        }
        /** 서버 키 없음(신규 계정): 이 계정 LS만 유지(보통 ""). 공용/타 계정 키는 읽지 않음 */
      } catch {
        // 네트워크 실패 시 이 계정 LS만 유지(이미 위에서 로드)
      } finally {
        if (!cancelled) {
          toonationHydratedUserIdRef.current = user.id;
          setToonationSettingsHydrated(true);
          if (hydratedStatus?.updatedAt) {
            setToonationLastSavedAt(Number(hydratedStatus.updatedAt));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.removeItem("donationAutomation.toonation.enabled");
      window.localStorage.removeItem("donationAutomation.toonation.socketDebug");
      /** 구버전 공용 키 — 계정 간 키 오염 방지 */
      window.localStorage.removeItem("donationAutomation.toonation.alertboxUrl");
      window.localStorage.removeItem("donationAutomation.toonation.socketEnabled");
      window.localStorage.removeItem("donationAutomation.toonation.ownerName");
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    const fallback = String(user.name || user.companyName || "").trim();
    if (!fallback) return;
    setToonationOwnerName((prev) => (prev.trim() ? prev : fallback));
  }, [user?.companyName, user?.id, user?.name]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!user?.id || !toonationSettingsHydrated) return;
    if (toonationHydratedUserIdRef.current !== user.id) return;
    if (!isServerAuthoritativeBroadcastState()) {
      writeToonationSettingsToLocal(user.id, {
        alertboxUrl: toonationAlertboxUrl,
        socketEnabled: toonationSocketEnabled,
        ownerName: toonationOwnerName,
      });
    }
    try {
      window.localStorage.removeItem("donationAutomation.toonation.autoProcess");
    } catch {
      // noop
    }
  }, [toonationAlertboxUrl, toonationOwnerName, toonationSettingsHydrated, toonationSocketEnabled, user?.id]);

  useEffect(() => {
    const uid = user?.id || "";
    if (!uid || !toonationSettingsHydrated) return;
    if (toonationHydratedUserIdRef.current !== uid) return;
    void fetchToonationListenerStatus(uid)
      .then((status) => {
        if (status?.updatedAt) {
          setToonationLastSavedAt(Number(status.updatedAt));
        }
        setToonationListenerStatus(
          toonationListenerStatusFromServer(status, { socketEnabled: toonationSocketEnabled })
        );
      })
      .catch(() => {});
  }, [toonationSettingsHydrated, toonationSocketEnabled, user?.id]);

  useEffect(() => {
    const uid = user?.id || "";
    if (!uid || !toonationSocketEnabled || !toonationSettingsHydrated) return;
    const poll = window.setInterval(() => {
      void fetchToonationListenerStatus(uid)
        .then((status) => {
          setToonationListenerMeta({
            lastDonationAt: status?.lastDonationAt,
            lastEventAt: status?.lastEventAt,
          });
          setToonationListenerStatus(
            toonationListenerStatusFromServer(status, { socketEnabled: true })
          );
        })
        .catch(() => {});
    }, 8000);
    return () => window.clearInterval(poll);
  }, [toonationSettingsHydrated, toonationSocketEnabled, user?.id]);

  useEffect(() => {
    toonationQueueHydratedRef.current = false;
    toonationQueueBaselineReadyRef.current = false;
    toonationQueueBaselineIdsRef.current = new Set();
  }, [user?.id]);

  useEffect(() => {
    void fetchUnmatchedEvents();
    void fetchDonationAliases();
    void fetchToonationQueue();
  }, [fetchUnmatchedEvents, fetchDonationAliases, fetchToonationQueue]);

  useEffect(() => {
    toonationQueueRef.current = toonationQueue;
  }, [toonationQueue]);

  useEffect(() => {
    if (!toonationQueueHydratedRef.current) return;
    if (!toonationQueueBaselineReadyRef.current) {
      toonationQueueBaselineReadyRef.current = true;
    }
    const baseline = toonationQueueBaselineIdsRef.current;
    const pending: DonationEvent[] = [];
    for (const evt of toonationQueue) {
      if (!baseline.has(evt.id)) baseline.add(evt.id);
      if (evt.alreadyApplied) continue;
      if (isDuplicateDonationEvent(stateRef.current, evt)) continue;
      pending.push(evt);
    }
    if (pending.length === 0) return;
    void autoProcessAllQueueEvents(pending);
  }, [autoProcessAllQueueEvents, toonationQueue]);

  const addContribution = () => {
    const amount = parseAmount(contributionAmount);
    if (!contributionMemberId) return;
    if (amount <= 0) return;
    setState((prev: AppState) => {
      const now = Date.now();
      const log = {
        id: `cl_${now}_${Math.random().toString(36).slice(2, 6)}`,
        memberId: contributionMemberId,
        amount,
        delta: contributionDelta,
        note: contributionNote.trim(),
        at: now,
      };
      const members = prev.members.map((m: Member) => {
        if (m.id !== contributionMemberId) return m;
        const curr = Math.max(0, m.contribution || 0);
        const nextContribution = contributionDelta > 0
          ? curr + amount
          : Math.max(0, curr - amount);
        return { ...m, contribution: nextContribution };
      });
      const next: AppState = {
        ...prev,
        members,
        contributionLogs: [...(prev.contributionLogs || []), log],
      };
      persistState(next, { includeDonationFields: true });
      return next;
    });
    setContributionAmount("");
    setContributionNote("");
  };

  const applyRestroomChange = useCallback((
    memberId: string,
    delta: 1 | -1,
    amount: number,
    note = "",
  ) => {
    if (amount <= 0) return;
    setState((prev: AppState) => {
      const target = prev.members.find((m) => m.id === memberId);
      if (!target) return prev;
      const nextValue = applyRestroomCountDelta(target.restroom, delta, amount);
      const { members, log, changed } = buildRestroomMemberUpdate(
        prev.members,
        memberId,
        nextValue,
        note
      );
      if (!changed || !log) return prev;
      const next: AppState = {
        ...prev,
        members,
        restroomLogs: [...(prev.restroomLogs || []), log],
      };
      persistState(next, { includeDonationFields: true });
      return next;
    });
  }, [persistState]);

  const setMemberRestroomValue = useCallback((
    memberId: string,
    nextValue: number,
    note = "",
  ) => {
    setState((prev: AppState) => {
      const { members, log, changed } = buildRestroomMemberUpdate(
        prev.members,
        memberId,
        nextValue,
        note
      );
      if (!changed) return prev;
      const next: AppState = {
        ...prev,
        members,
        restroomLogs: log ? [...(prev.restroomLogs || []), log] : prev.restroomLogs || [],
      };
      persistState(next, { includeDonationFields: true });
      return next;
    });
  }, [persistState]);

  const addRestroomRecord = () => {
    if (!restroomMemberId) return;
    if (restroomMode === "unlimited") {
      setMemberRestroomValue(
        restroomMemberId,
        RESTROOM_UNLIMITED,
        restroomNote.trim() ? `무제한 · ${restroomNote.trim()}` : "무제한"
      );
      setRestroomAmount("");
      setRestroomNote("");
      return;
    }
    const rawAmount = restroomAmount.trim();
    if (restroomMode === "minus" && (rawAmount === "" || rawAmount === "0")) {
      setMemberRestroomValue(restroomMemberId, 0, restroomNote || "0으로 초기화");
      setRestroomAmount("");
      setRestroomNote("");
      return;
    }
    const amount = parseAmount(restroomAmount);
    if (amount <= 0) return;
    applyRestroomChange(restroomMemberId, restroomMode === "plus" ? 1 : -1, amount, restroomNote);
    setRestroomAmount("");
    setRestroomNote("");
  };

  const addTerritoryRecord = () => {
    const hsSettings = normalizeHighSocietySettings(stateRef.current.highSocietySettings);
    if (!hsSettings.enabled) {
      showAppToast("상류사회가 OFF입니다. 먼저 모드를 켜 주세요.", { variant: "info" });
      return;
    }
    if (!territoryMemberId) return;
    const seated = resolveHighSocietySeatMembers(
      stateRef.current.members || [],
      hsSettings
    );
    if (seated.length === 0) {
      showAppToast("영토 좌석이 없습니다. 오버레이 탭에서 좌석을 먼저 지정해 주세요.", {
        variant: "info",
      });
      return;
    }
    if (!seated.some((m) => m.id === territoryMemberId)) {
      showAppToast("영토 반영은 좌석에 배치된 멤버만 가능합니다.", { variant: "info" });
      return;
    }
    const cm = Math.max(0, Math.floor(parseAmount(territoryCm)));
    if (cm <= 0) return;
    const seatRole = seatRoleForMemberId(
      hsSettings,
      stateRef.current.members || [],
      territoryMemberId
    );
    const pushForLog = resolveTerritoryLogPushDirForWrite({
      seatRole,
      chosen: territoryPushDir,
      settings: hsSettings,
    });
    const log = createTerritoryLog(
      territoryMemberId,
      territoryMode === "plus" ? 1 : -1,
      cm,
      { pushDir: pushForLog, note: territoryNote }
    );
    setState((prev: AppState) => {
      let next: AppState = {
        ...prev,
        territoryLogs: [...(prev.territoryLogs || []), log],
        updatedAt: Date.now(),
      };
      next = syncHighSocietyMemberWidthSnapshotInState(next);
      persistState(next, { omitDonationFields: true });
      notifyBroadcastStateLocalUpdated(user?.id, next.updatedAt);
      return next;
    });
    setTerritoryCm("");
    setTerritoryNote("");
    showAppToast(`상류사회 영토 ${territoryMode === "plus" ? "추가" : "차감"}: ${cm}cm`);
  };

  useEffect(() => {
    if (!state.members.length) return;
    if (!donorMemberId) setDonorMemberId(state.members[0].id);
  }, [state.members, donorMemberId]);
  useEffect(() => {
    if (!state.members.length) return;
    if (!contributionMemberId) setContributionMemberId(state.members[0].id);
  }, [state.members, contributionMemberId]);
  useEffect(() => {
    if (!state.members.length) return;
    if (!restroomMemberId) setRestroomMemberId(state.members[0].id);
  }, [state.members, restroomMemberId]);
  useEffect(() => {
    if (!state.members.length) return;
    const exists = state.members.some((m) => m.id === contributionMemberId);
    if (!exists) setContributionMemberId(state.members[0].id);
  }, [state.members, contributionMemberId]);
  useEffect(() => {
    if (!state.members.length) return;
    const exists = state.members.some((m) => m.id === restroomMemberId);
    if (!exists) setRestroomMemberId(state.members[0].id);
  }, [state.members, restroomMemberId]);
  useEffect(() => {
    if (!state.members.length) return;
    const exists = state.members.some((m) => m.id === sigPresetMemberId);
    if (!exists) setSigPresetMemberId(state.members[0].id);
  }, [state.members, sigPresetMemberId]);

  const isOperatingMember = useCallback((m: Member) => {
    const position = state.memberPositions?.[m.id] || "";
    return Boolean(m.operating) || /운영비/i.test(m.name) || /운영비/i.test(position);
  }, [state.memberPositions]);
  const total = useMemo(
    () => state.members.reduce((sum, m) => sum + (m.account || 0) + (m.toon || 0), 0),
    [state.members]
  );
  const activeMemberCount = useMemo(
    () => state.members.filter((m) => !isOperatingMember(m)).length,
    [state.members, isOperatingMember]
  );
  const donationSyncMode = (state.donationSyncMode || "mealBattle") as
    | "none"
    | "mealBattle"
    | "sigMatch"
    | "sigSales"
    | "highSociety";
  const highSocietySettings = useMemo(
    () => normalizeHighSocietySettings(state.highSocietySettings),
    [state.highSocietySettings]
  );
  const hsSeatPlayers = useMemo(
    () => resolveHighSocietySeatMembers(state.members || [], highSocietySettings),
    [state.members, highSocietySettings]
  );
  useEffect(() => {
    if (!state.members.length) return;
    if (hsSeatPlayers.length === 0) return;
    const exists = hsSeatPlayers.some((m) => m.id === territoryMemberId);
    if (!territoryMemberId || !exists) setTerritoryMemberId(hsSeatPlayers[0].id);
  }, [state.members, territoryMemberId, hsSeatPlayers]);
  /** 수동 좌석(명시 목록·빈 좌석 포함) vs 자동 전원 N등분 */
  const hsSeatExplicit = isHighSocietySeatSelectionManual(highSocietySettings);
  const hsSeatedIdSet = useMemo(
    () => new Set(hsSeatPlayers.map((p) => String(p.id))),
    [hsSeatPlayers]
  );
  const hsUnseatedMembers = useMemo(
    () =>
      (state.members || []).filter(
        (m) => !m.operating && !hsSeatedIdSet.has(String(m.id))
      ),
    [state.members, hsSeatedIdSet]
  );
  const hsSeatFieldByMemberId = useMemo(() => {
    const map = new Map<string, { widthCm: number; eliminated: boolean }>();
    if (!highSocietySettings.enabled) return map;
    const field = buildHighSocietyFieldFromAppState({
      members: state.members || [],
      donors: state.donors || [],
      highSocietySettings,
      territoryLogs: state.territoryLogs || [],
    });
    for (const seat of field.seats) {
      map.set(seat.id, { widthCm: seat.widthCm, eliminated: seat.eliminated });
    }
    return map;
  }, [highSocietySettings, state.donors, state.members, state.territoryLogs]);
  const patchHighSocietySettings = useCallback(
    (patch: HighSocietySettingsAdminPatch) => {
      const resetTerritory = Boolean(patch.resetTerritory);
      const { resetTerritory: _resetTerritory, ...settingsPatchRaw } = patch;
      const prevForPause = normalizeHighSocietySettings(stateRef.current.highSocietySettings);
      let settingsPatch = { ...settingsPatchRaw };
      if (typeof patch.territoryPaused === "boolean") {
        settingsPatch = {
          ...settingsPatch,
          ...buildTerritoryPauseToggleSettingsPatch(patch, prevForPause),
        };
      }
      const wasOn = prevForPause.enabled;
      setState((prev: AppState) => {
        const prevSettings = normalizeHighSocietySettings(prev.highSocietySettings);
        let nextSettings = normalizeHighSocietySettings({
          ...prevSettings,
          ...settingsPatch,
        });
        const turningOn = !wasOn && nextSettings.enabled;
        const turningOff = wasOn && !nextSettings.enabled;
        const isFirstOn = turningOn && !isHighSocietyReopen(prevSettings);
        nextSettings = mergeHighSocietyDonationLinksOnSettingsChange({
          prevSettings,
          nextSettings,
          members: prev.members || [],
          resetTerritory,
          donors: prev.donors || [],
        });
        const hsSeatPlayersForPersist = resolveHighSocietySeatMembers(prev.members || [], nextSettings);
        const hsSeatCountForPersist = resolveHighSocietySeatCountForField(
          nextSettings,
          hsSeatPlayersForPersist.length
        );
        nextSettings = reconcileHighSocietyFieldDimensions(
          nextSettings,
          hsSeatCountForPersist,
          prev.members || []
        );
        const needsDonorPersist = shouldPersistDonorsForHighSocietySettingsPatch({
          resetTerritory,
          isFirstOn,
        });
        const needsDonorLocalMark = shouldMarkDonorsLocallyForHighSocietySettingsPatch({
          resetTerritory,
          isFirstOn,
        });
        /** 영토 일시정지·OFF·재ON 등 — React donors 를 비우거나 authoritative 저장하지 않음 */
        let donorsPatch: Donor[] | null = null;
        if (needsDonorLocalMark) {
          let fromLsDonors: Donor[] = [];
          try {
            fromLsDonors = normalizeDonorsArray(loadState(user?.id)?.donors);
          } catch {}
          const resolvedDonors = resolveDonorsForHighSocietySettingsPatch({
            prevDonorsReact: prev.donors,
            refDonors: stateRef.current?.donors,
            lsDonors: fromLsDonors,
            resetTerritory,
            isFirstOn,
          });
          if (shouldApplyDonorsForHighSocietySettingsPatch(resolvedDonors)) {
            donorsPatch = resolvedDonors;
          }
        }
        let nextDonationSyncMode = resolveDonationSyncModeForHighSocietySettingsChange({
          turningOn,
          turningOff,
          prevMode: prev.donationSyncMode,
        });
        const hasDonorsToPersist = needsDonorPersist && donorsPatch != null;
        if (hasDonorsToPersist) {
          donationAuthoritativeSaveUntilRef.current = Math.max(
            donationAuthoritativeSaveUntilRef.current,
            Date.now() + 12_000
          );
        }
        let next: AppState = {
          ...prev,
          ...(donorsPatch ? { donors: donorsPatch } : {}),
          highSocietySettings: nextSettings,
          donationSyncMode: nextDonationSyncMode,
          updatedAt: Date.now(),
        };
        if (hasDonorsToPersist) {
          next = guardMemberTotalsAgainstAccidentalZeroWipe(
            syncMemberTotalsFromDonors(next),
            prev
          );
        }
        next = syncHighSocietyMemberWidthSnapshotInState(next);
        const nextSettingsSynced = normalizeHighSocietySettings(next.highSocietySettings);
        next = { ...next, highSocietySettings: nextSettingsSynced };
        stateRef.current = next;
        try {
          const lsBase = loadState(user?.id);
          const stamped: AppState = lsBase
            ? {
                ...lsBase,
                highSocietySettings: nextSettingsSynced,
                donationSyncMode: nextDonationSyncMode,
                ...(donorsPatch ? { donors: donorsPatch } : {}),
                updatedAt: next.updatedAt,
              }
            : next;
          cacheBroadcastStateSnapshot(stamped, user?.id);
          notifyBroadcastStateLocalUpdated(user?.id, stamped.updatedAt);
        } catch {}
        const persistToastLabel =
          buildHighSocietySettingsPersistToast({
            patch,
            before: prevSettings,
            wasOn,
            after: nextSettingsSynced,
            resetTerritory,
            members: prev.members || [],
          }) ?? undefined;
        persistState(
          next,
          hasDonorsToPersist
            ? { includeDonationFields: true, persistToastLabel }
            : {
                omitDonationFields: true,
                highSocietySettingsOnly: true,
                persistToastLabel,
              }
        );
        return next;
      });
    },
    [persistState, user?.id]
  );
  /** 관리자 로컬 영토 cm — 서버·OBS 미동기화 시 자동 HS-only 저장 (실시간 모드) */
  useEffect(() => {
    if (syncStatus !== "synced") return;
    if (!highSocietySettings.enabled || highSocietySettings.territoryPaused) return;
    if (highSocietySettings.territoryUpdateMode === "onRoundEnd") return;
    if (hsSeatPlayers.length === 0) return;
    const cur = stateRef.current;
    if (!highSocietyNeedsMemberWidthSnapshotPersist(cur)) return;
    const sig = [
      ...[...hsSeatFieldByMemberId.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, v]) => `${id}:${v.widthCm}:${v.eliminated ? 1 : 0}`),
      normalizeDonorsArray(cur.donors).length,
      cur.updatedAt ?? 0,
    ].join("|");
    if (hsSnapshotHealBusyRef.current || hsSnapshotHealSigRef.current === sig) return;
    const timer = window.setTimeout(() => {
      const latest = stateRef.current;
      if (!highSocietyNeedsMemberWidthSnapshotPersist(latest)) return;
      hsSnapshotHealBusyRef.current = true;
      hsSnapshotHealSigRef.current = sig;
      const synced = syncHighSocietyMemberWidthSnapshotInState(latest);
      persistState(synced, {
        omitDonationFields: true,
        highSocietySettingsOnly: true,
      });
      window.setTimeout(() => {
        hsSnapshotHealBusyRef.current = false;
      }, 15_000);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [
    syncStatus,
    highSocietySettings.enabled,
    highSocietySettings.territoryPaused,
    highSocietySettings.territoryUpdateMode,
    hsSeatPlayers.length,
    hsSeatFieldByMemberId,
    state.donors,
    state.updatedAt,
    persistState,
  ]);
  const moveHighSocietySeat = useCallback(
    (memberId: string, dir: -1 | 1) => {
      const id = String(memberId || "").trim();
      if (!id) return;
      const members = stateRef.current.members || [];
      const settings = normalizeHighSocietySettings(stateRef.current.highSocietySettings);
      const cur = resolveHighSocietySeatMemberIdsForEdit(settings, members);
      const idx = cur.findIndex((sid) => String(sid) === id);
      if (idx < 0) return;
      const nextIdx = idx + dir;
      if (nextIdx < 0 || nextIdx >= cur.length) return;
      const swapped = cur.slice();
      const tmp = swapped[idx]!;
      swapped[idx] = swapped[nextIdx]!;
      swapped[nextIdx] = tmp;
      patchHighSocietySettings({ seatMemberIds: swapped, seatMemberIdsManual: true });
    },
    [patchHighSocietySettings]
  );
  const moveHighSocietySeatToIndex = useCallback(
    (memberId: string, targetIndex: number) => {
      const id = String(memberId || "").trim();
      if (!id) return;
      const members = stateRef.current.members || [];
      const settings = normalizeHighSocietySettings(stateRef.current.highSocietySettings);
      const cur = resolveHighSocietySeatMemberIdsForEdit(settings, members);
      const idx = cur.findIndex((sid) => String(sid) === id);
      if (idx < 0) return;
      const without = cur.filter((sid) => String(sid) !== id);
      const at = Math.max(0, Math.min(Math.floor(targetIndex), without.length));
      const next = [...without.slice(0, at), id, ...without.slice(at)];
      patchHighSocietySettings({ seatMemberIds: next, seatMemberIdsManual: true });
    },
    [patchHighSocietySettings]
  );
  const addHighSocietySeat = useCallback(
    (memberId: string, atIndex?: number) => {
      const id = String(memberId || "").trim();
      if (!id) return;
      const members = stateRef.current.members || [];
      const settings = normalizeHighSocietySettings(stateRef.current.highSocietySettings);
      const seated = resolveHighSocietySeatMembers(members, settings);
      if (seated.some((p) => p.id === id)) return;
      const cur = resolveHighSocietySeatMemberIdsForEdit(settings, members);
      if (cur.length >= HIGH_SOCIETY_MAX_SEATS) {
        showAppToast(`상류사회 좌석은 최대 ${HIGH_SOCIETY_MAX_SEATS}명입니다`, { variant: "info" });
        return;
      }
      const insertAt =
        typeof atIndex === "number" && Number.isFinite(atIndex)
          ? Math.max(0, Math.min(Math.floor(atIndex), cur.length))
          : cur.length;
      patchHighSocietySettings({
        seatMemberIds: insertHighSocietySeatMemberIdAt(cur, id, insertAt),
        seatMemberIdsManual: true,
      });
    },
    [patchHighSocietySettings]
  );
  const removeHighSocietySeat = useCallback(
    (memberId: string) => {
      const id = String(memberId || "").trim();
      if (!id) return;
      const members = stateRef.current.members || [];
      const settings = normalizeHighSocietySettings(stateRef.current.highSocietySettings);
      const cur = resolveHighSocietySeatMemberIdsForEdit(settings, members);
      const next = cur.filter((sid) => String(sid) !== id);
      patchHighSocietySettings({ seatMemberIds: next, seatMemberIdsManual: true });
    },
    [patchHighSocietySettings]
  );
  const hsSeatCountForStart = resolveHighSocietySeatCountForField(
    highSocietySettings,
    hsSeatPlayers.length
  );
  const hsStartCm = resolveHighSocietyStartCmPerMember(highSocietySettings, hsSeatCountForStart);
  const hsEffectiveFieldCm = resolveHighSocietyEffectiveFieldCm(
    highSocietySettings,
    hsSeatCountForStart
  );
  const hsPreviewIframeKeySig = useMemo(
    () => highSocietyAdminPreviewIframeKeySig(highSocietySettings),
    [highSocietySettings]
  );
  const patchHighSocietyStartCm = useCallback(
    (startCm: number) => {
      const seats = resolveHighSocietySeatCountForField(
        highSocietySettings,
        hsSeatPlayers.length || hsSeatCountForStart
      );
      const clamped = Math.max(1, Math.min(5000, Math.floor(Number(startCm) || 0)));
      setHsStartCmDraft(null);
      patchHighSocietySettings({
        startCmPerMember: clamped,
        fieldCm: fieldCmFromStartPerMember(clamped, seats),
        memberWidthCm: undefined,
        memberWidthDonationSnapshot: undefined,
        memberTerritoryExpand: undefined,
      });
    },
    [highSocietySettings, hsSeatCountForStart, hsSeatPlayers.length, patchHighSocietySettings]
  );
  const hsStartCmInputValue =
    hsStartCmDraft !== null ? hsStartCmDraft : String(Math.max(1, Math.round(hsStartCm)));
  const onHsStartCmDraftChange = useCallback((raw: string) => {
    setHsStartCmDraft(raw.replace(/[^\d]/g, "").slice(0, 5));
  }, []);
  const commitHsStartCmDraft = useCallback(() => {
    const raw = hsStartCmDraft;
    if (raw === null) return;
    const n = parseInt(raw || "0", 10);
    if (!Number.isFinite(n) || n <= 0) {
      setHsStartCmDraft(null);
      return;
    }
    patchHighSocietyStartCm(n);
  }, [hsStartCmDraft, patchHighSocietyStartCm]);
  const sigMatchDonors = state.donors || [];
  const sigMatchRanking = useMemo(
    () => getSigMatchRankings(
      sigMatchDonors,
      state.members || [],
      state.sigMatchSettings,
      state.sigMatch || {},
      state.memberPositions || {}
    ),
    [sigMatchDonors, state.members, state.sigMatchSettings, state.sigMatch, state.memberPositions]
  );
  const sigMatchManualSteps = useMemo(
    () => resolveSigMatchManualAdjustSteps(state.sigMatchSettings || defaultState().sigMatchSettings),
    [state.sigMatchSettings]
  );
  const sigMatchScoringMode = state.sigMatchSettings?.scoringMode === "amount" ? "amount" : "count";
  const sigSignatureAmountsInput = useMemo(
    () => (state.sigMatchSettings?.signatureAmounts || []).join(", "),
    [state.sigMatchSettings?.signatureAmounts]
  );
  const mealParticipants = useMemo(() => state.mealBattle?.participants || [], [state.mealBattle?.participants]);

  const toggleSigMatchActive = async () => {
    const wasActive = Boolean(state.sigMatchSettings?.isActive);
    const nextActive = !wasActive;
    if (wasActive && !nextActive) {
      const rankings = getSigMatchRankings(
        sigMatchDonors,
        state.members || [],
        state.sigMatchSettings,
        state.sigMatch || {},
        state.memberPositions || {}
      );
      const title = `${state.sigMatchSettings?.title || "시그 대전"} 인센티브 정산`;
      await appendSigMatchIncentiveSettlementAndSync(
        title,
        rankings,
        state.sigMatchSettings?.incentivePerPoint || 1000,
        user?.id
      );
      updateSigMatchSettings({ isActive: nextActive });
      return;
    }
    /** 활성화 시 참가자 후원 연동을 ON으로 맞춰 엑셀 배정 후원이 점수에 반영되게 함 */
    setState((prev: AppState) => {
      const playable = prev.members.filter(
        (m) => !isOperatingSettlementMember(m, prev.memberPositions)
      );
      const valid = new Set(playable.map((m) => m.id));
      const ids = prev.sigMatchSettings?.participantMemberIds ?? [];
      const targets =
        ids.length > 0 ? ids.filter((id) => valid.has(id)) : playable.map((m) => m.id);
      const now = Date.now();
      const donationLinks: Record<string, { active: boolean; startedAt?: number }> = {
        ...(prev.sigMatchSettings.donationLinks || {}),
      };
      for (const id of targets) {
        /** 대전 시작 시점부터 후원 집계 — 이전 연동 startedAt 은 새 라운드 기준으로 리셋 */
        donationLinks[id] = { active: true, startedAt: now };
      }
      const next: AppState = {
        ...prev,
        donationSyncMode: "sigMatch",
        sigMatchSettings: {
          ...prev.sigMatchSettings,
          isActive: true,
          sigMatchPools: normalizeSigMatchPools(prev.sigMatchSettings.sigMatchPools || [], valid),
          participantMemberIds: normalizeSigMatchParticipantIds(
            prev.sigMatchSettings.participantMemberIds || [],
            valid
          ),
          donationLinks: normalizeSigMatchDonationLinks(donationLinks, valid),
        },
        updatedAt: Date.now(),
      };
      persistState(next, { omitDonationFields: true });
      return next;
    });
  };
  const flatLogs = useMemo(() => {
    const arr: Array<{ date: string; entry: DailyLogEntry }> = [];
    Object.entries(dailyLog).forEach(([date, entries]) => {
      (entries || []).forEach((entry) => arr.push({ date, entry }));
    });
    return arr.sort((a,b)=> (a.date === b.date ? (a.entry.at < b.entry.at ? 1 : -1) : (a.date < b.date ? 1 : -1)));
  }, [dailyLog]);
  const donorTotalsByName = useMemo(
    () => buildDonorTotalsByNameFromDonors((state.donors || []) as Array<Record<string, unknown>>),
    [state.donors]
  );

  /** 후원 순위 미리보기 iframe — 누적 표와 동일 donors 스냅샷 */
  useEffect(() => {
    if (!overlayUserId) return;
    const t = window.setTimeout(() => {
      notifyAdminPreviewDonorsUpdated(overlayUserId, state.donors || [], state.updatedAt);
    }, 50);
    return () => window.clearTimeout(t);
  }, [overlayUserId, state.donors, state.updatedAt, donorRankingsPreviewIframeKey]);

  useEffect(() => {
    if (!overlayUserId) return;
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as { type?: string; userId?: string | null } | null;
      if (!data || data.type !== ADMIN_PREVIEW_DONORS_REQUEST) return;
      if (!overlayUserIdsMatch(overlayUserId, data.userId)) return;
      notifyAdminPreviewDonorsUpdated(
        overlayUserId,
        stateRef.current?.donors || [],
        stateRef.current?.updatedAt
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [overlayUserId]);

  const regenerateDraft = () => {
    setChatDraft(formatChatLine(state));
    setChatDraftDirty(false);
  };

  const onCopyDraft = async () => {
    const text = chatDraft;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      const t = setTimeout(() => setCopied(false), 1500);
      return () => clearTimeout(t);
    } catch {
      // ignore
    }
  };

  const commitSettlementReset = useCallback(
    async (next: AppState, resetPresets: OverlayPreset[]) => {
      if (resetInProgressRef.current) return;
      resetInProgressRef.current = true;
      settlementResetUntilRef.current = Date.now() + 15_000;
      const resetAt = Date.now();
      setResetSheetOpen(false);
      appendDailyLog(state, user?.id);
      loadDailyLogFromApi(user?.id)
        .then((serverLog) => {
          setDailyLog(serverLog);
          try {
            window.localStorage.setItem(dailyLogStorageKey(user?.id), JSON.stringify(serverLog));
          } catch {}
        })
        .catch(() => setDailyLog(loadDailyLog(user?.id)));
      const nextWithReset: AppState = {
        ...next,
        settlementResetAt: resetAt,
        updatedAt: resetAt,
      };
      setPresets(resetPresets);
      setState(nextWithReset);
      stateRef.current = nextWithReset;
      stateUpdatedAtRef.current = resetAt;
      lastLocalPersistAtRef.current = resetAt;
      pendingUnsyncedRef.current = true;
      try {
        cacheBroadcastStateSnapshot(nextWithReset, user?.id);
        window.localStorage.setItem(presetStorageKey, JSON.stringify(resetPresets));
      } catch {}
      const r = await saveStateAsync(nextWithReset, user?.id, { settlementReset: true });
      pendingUnsyncedRef.current = false;
      if (r.ok) {
        if (typeof r.serverUpdatedAt === "number" && Number.isFinite(r.serverUpdatedAt)) {
          stateUpdatedAtRef.current = r.serverUpdatedAt;
          lastAppliedRemoteUpdatedAtRef.current = r.serverUpdatedAt;
        }
        if (r.storageFallback) {
          setSyncStatus("error");
          setSigExcelResult(
            "정산 리셋이 이 PC에만 반영됐습니다. Redis·서버 설정을 확인한 뒤 다시 시도하세요."
          );
        } else {
          setSyncStatus("synced");
        }
      } else {
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setSyncStatus(offline ? "local" : "error");
      }
      resetInProgressRef.current = false;
    },
    [presetStorageKey, state, user?.id]
  );

  const onResetKeepMembers = () => {
    const resetPresets = resetOverlayPresetsGoalForDonationInit(state.overlayPresets) as OverlayPreset[];
    const preserved = pickSettingsPreservedAcrossSettlementReset(state);
    const next: AppState = {
      ...state,
      ...preserved,
      members: state.members.map((m) => ({ ...m, account: 0, toon: 0, contribution: 0, restroom: 0 })),
      donors: [],
      mealBattle: {
        ...state.mealBattle,
        participants: (state.mealBattle?.participants || []).map((p) => ({ ...p, score: 0 })),
      },
      overlayPresets: resetPresets,
      missions: preserved.missions || state.missions || [],
      updatedAt: Date.now(),
    };
    void commitSettlementReset(next, resetPresets);
  };
  const onResetInitMembers = () => {
    const resetPresets = resetOverlayPresetsGoalForDonationInit(state.overlayPresets) as OverlayPreset[];
    const slotN = Math.max(1, Math.min(30, Math.floor(Number(resetMemberSlotCount) || 3)));
    const ds = defaultState();
    const nextMembers = buildDefaultMembersCount(slotN);
    const nextMemberIds = new Set(nextMembers.map((m) => m.id));
    const filteredMealParticipants = (state.mealBattle?.participants || [])
      .filter((p) => nextMemberIds.has(p.memberId))
      .map((p) => ({ ...p, score: 0 }));
    const preserved = pickSettingsPreservedAcrossSettlementReset(state);
    const next: AppState = {
      ...ds,
      ...preserved,
      members: nextMembers,
      memberPositions: {},
      donors: [],
      overlayPresets: resetPresets,
      sigMatch: Object.fromEntries(
        Object.entries(state.sigMatch || {}).filter(([memberId]) => nextMemberIds.has(memberId))
      ),
      mealBattle: {
        ...state.mealBattle,
        participants: filteredMealParticipants,
        memberGaugeColors: Object.fromEntries(
          Object.entries(state.mealBattle?.memberGaugeColors || {}).filter(([memberId]) =>
            nextMemberIds.has(memberId)
          )
        ),
        teamAMemberIds: (state.mealBattle?.teamAMemberIds || []).filter((memberId) =>
          nextMemberIds.has(memberId)
        ),
        teamBMemberIds: (state.mealBattle?.teamBMemberIds || []).filter((memberId) =>
          nextMemberIds.has(memberId)
        ),
      },
      mealMatch: Object.fromEntries(
        Object.entries(state.mealMatch || {}).filter(([memberId]) => nextMemberIds.has(memberId))
      ),
      updatedAt: Date.now(),
    };
    void commitSettlementReset(next, resetPresets);
  };

  const onSnapshotNow = () => {
    appendDailyLog(state, user?.id);
    loadDailyLogFromApi(user?.id).then((serverLog) => {
      setDailyLog(serverLog);
      try { window.localStorage.setItem(dailyLogStorageKey(user?.id), JSON.stringify(serverLog)); } catch {}
    }).catch(() => setDailyLog(loadDailyLog(user?.id)));
  };
  const onFetchLatestFromServer = async () => {
    setSyncStatus("loading");
    const remote = await loadStateFromApi(user?.id, { forceFull: true });
    if (!remote) {
      setSyncStatus("error");
      if (typeof window !== "undefined") {
        window.alert(
          "서버에서 상태를 가져오지 못했습니다.\n" +
            "로그인·네트워크·Render 한도(402 등)를 확인한 뒤 다시 시도하세요.\n" +
            "로컬 내용을 서버에 올리려면 멤버 보드에서 수정 후 잠시 기다리면 자동 저장됩니다."
        );
      }
      return;
    }
    const local = stateRef.current;
    const localDonors = normalizeDonorsArray(local.donors);
    const remoteDonors = normalizeDonorsArray(remote.donors);
    if (localDonors.length === 0 && remoteDonors.length > 0) {
      const ok = await applyDonorsFromServerMainState();
      if (ok) {
        setSyncStatus("synced");
        void refreshStorageHealth();
        return;
      }
      const pulled = buildUiStateFromServerDonorPull(local, remote);
      if (pulled && normalizeDonorsArray(pulled.donors).length > 0) {
        stateUpdatedAtRef.current = pulled.updatedAt || 0;
        lastAppliedRemoteUpdatedAtRef.current = pulled.updatedAt || 0;
        pendingUnsyncedRef.current = false;
        setState(pulled);
        stateRef.current = pulled;
        cacheBroadcastStateSnapshot(pulled, user?.id);
        setSyncStatus("synced");
        void refreshStorageHealth();
        return;
      }
    }
    const { merged, didPreserve } = mergeIncomingStateSafely(remote, local);

    if (
      !didPreserve &&
      membersDifferByIds(local.members || [], remote.members || []) &&
      typeof window !== "undefined"
    ) {
      const localNames = (local.members || []).map((m) => m.name || m.id).join(", ");
      const remoteNames = (remote.members || []).map((m) => m.name || m.id).join(", ");
      const ok = window.confirm(
        `서버에 저장된 멤버 ${remote.members.length}명으로 로컬 ${local.members.length}명 설정을 덮어씁니다.\n\n` +
          `로컬: ${localNames || "(없음)"}\n` +
          `서버: ${remoteNames || "(없음)"}\n\n` +
          `로컬만 바꾼 내용은 사라질 수 있습니다. 계속할까요?`
      );
      if (!ok) {
        setSyncStatus("synced");
        return;
      }
    }

    const toApply = didPreserve ? merged : remote;
    stateUpdatedAtRef.current = toApply.updatedAt || 0;
    pendingUnsyncedRef.current = false;
    setState(toApply);
    if (didPreserve) {
      persistState(toApply, { includeDonationFields: true });
      if (typeof window !== "undefined") {
        window.alert(
          "서버 데이터가 비어 있거나 초기 멤버 슬롯(멤버1·2·3)만 있어, 현재 로컬 멤버 구성을 유지했습니다.\n" +
            "이 구성을 서버에 반영하려면 멤버 보드에서 한 번 더 저장되도록 잠시 기다리거나 금액을 살짝 수정해 보세요."
        );
      }
    }
    if (Array.isArray(toApply.overlayPresets)) {
      setPresets(toApply.overlayPresets as OverlayPreset[]);
      try { window.localStorage.setItem(presetStorageKey, JSON.stringify(toApply.overlayPresets)); } catch {}
    }
    cacheBroadcastStateSnapshot(toApply, user?.id);
    setSyncStatus("synced");
    void refreshStorageHealth();
  };
  const runPullRefresh = async () => {
    if (pullRefreshing) return;
    setPullRefreshing(true);
    await onFetchLatestFromServer();
    try {
      const serverLog = await loadDailyLogFromApi(user?.id);
      setDailyLog(serverLog);
      try { window.localStorage.setItem(dailyLogStorageKey(user?.id), JSON.stringify(serverLog)); } catch {}
    } catch {
      setDailyLog(loadDailyLog(user?.id));
    }
    window.setTimeout(() => {
      setPullRefreshing(false);
      setPullDistance(0);
    }, 240);
  };
  const handleTouchStart = (e: any) => {
    if (typeof window === "undefined") return;
    if (window.scrollY <= 0) touchStartYRef.current = e.touches?.[0]?.clientY ?? null;
  };
  const handleTouchMove = (e: any) => {
    if (typeof window === "undefined") return;
    if (touchStartYRef.current === null || window.scrollY > 0) return;
    const delta = (e.touches?.[0]?.clientY ?? 0) - touchStartYRef.current;
    if (delta <= 0) return;
    setPullDistance(Math.min(88, Math.round(delta * 0.45)));
  };
  const handleTouchEnd = () => {
    touchStartYRef.current = null;
    if (pullDistance >= 64) {
      void runPullRefresh();
      return;
    }
    setPullDistance(0);
  };
  const onDownloadLog = () => {
    const raw = JSON.stringify(loadDailyLog(user?.id), null, 2);
    const blob = new Blob([raw], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `daily-log-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
  };

  const onFinishBroadcastAndSettle = async () => {
    const accountRatioPct = Math.max(0, Math.min(100, parseFloat(accountRatioInput || "70") || 70));
    const toonRatioPct = Math.max(0, Math.min(100, parseFloat(toonRatioInput || "60") || 60));
    const taxRatePct = Math.max(0, Math.min(100, parseFloat(taxRateInput || "3.3") || 3.3));
    const accountRatio = accountRatioPct / 100;
    const toonRatio = toonRatioPct / 100;
    const taxRate = taxRatePct / 100;
    const parseOptionalPct = (value: string): number | null => {
      const trimmed = (value || "").trim();
      if (!trimmed) return null;
      const n = parseFloat(trimmed);
      if (!Number.isFinite(n)) return null;
      return Math.max(0, Math.min(100, n)) / 100;
    };
    const memberRatioOverrides: SettlementMemberRatioOverrides | undefined = useMemberRatioOverrides
      ? state.members.reduce<SettlementMemberRatioOverrides>((acc, m) => {
          const input = memberRatioInputs[m.id];
          const account = parseOptionalPct(input?.account || "");
          const toon = parseOptionalPct(input?.toon || "");
          if (account !== null || toon !== null) {
            acc[m.id] = {
              ...(account !== null ? { accountRatio: account } : {}),
              ...(toon !== null ? { toonRatio: toon } : {}),
            };
          }
          return acc;
        }, {})
      : undefined;
    const title =
      settlementTitle.trim() ||
      `${new Date().toISOString().slice(0, 10)} 정산`;
    const mergedLog: Record<string, DailyLogEntry[]> = {
      ...loadDailyLog(user?.id),
      ...dailyLog,
    };
    let snapshot = buildSettlementCreationSnapshot(stateRef.current, user?.id);
    snapshot = enrichSettlementSnapshotFromDailyLog(
      snapshot,
      mergedLog,
      new Date().toISOString().slice(0, 10)
    );
    const snapshotDonors = normalizeDonorsArray(snapshot.donors);
    if (snapshotDonors.length === 0 && totalCombined(snapshot) > 0) {
      window.alert(
        "후원 목록이 비어 있어 정산을 만들 수 없습니다.\n" +
          "「일일 로그에서 복구」 또는 서버 동기화 후 다시 시도해 주세요."
      );
      return;
    }
    settlementSnapshotUntilRef.current = Date.now() + 30_000;
    donationAuthoritativeSaveUntilRef.current = Date.now() + 30_000;
    stateRef.current = snapshot;
    setState(snapshot);
    try {
      cacheBroadcastStateSnapshot(snapshot, user?.id);
    } catch {}
    await persistDonationStateViaApi(user?.id, snapshot, "add");
    appendDailyLog(snapshot, user?.id);
    const rec = await appendSettlementRecordAndSync(
      title,
      snapshot.members,
      accountRatio,
      toonRatio,
      taxRate,
      memberRatioOverrides,
      snapshotDonors,
      user?.id,
      snapshot.memberPositions || null,
      {
        vatIncluded,
        taxInvoiceIssued,
        omitTreasuryFromSettlement,
        includeTreasuryInFullStatement,
      }
    );
    router.push(`/settlements/${rec.id}`);
  };
  const sigImageUrlIssues = (state.sigInventory || [])
    .map((item) => {
      const raw = String(item.imageUrl || "").trim();
      const isLegacyUploads = isLegacyLocalSigImageUrl(raw);
      const isBroken = isBrokenSigImageUrl(raw);
      const isEmpty = raw.length === 0;
      if (!isLegacyUploads && !isBroken && !isEmpty) return null;
      return {
        id: item.id,
        name: item.name || "(이름 없음)",
        raw,
        isLegacyUploads,
        isBroken,
        isEmpty,
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    name: string;
    raw: string;
    isLegacyUploads: boolean;
    isBroken: boolean;
    isEmpty: boolean;
  }>;
  const legacyUploadsCount = sigImageUrlIssues.filter((x) => x.isLegacyUploads).length;
  const brokenImageUrlCount = sigImageUrlIssues.filter((x) => x.isBroken).length;
  const emptyImageUrlCount = sigImageUrlIssues.filter((x) => x.isEmpty).length;

  const highSocietySeatLayoutPanel = (
    <div className="space-y-3">
      <label className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
        1인 시작 (cm)
        <input
          type="text"
          inputMode="numeric"
          className="w-28 rounded border border-white/10 bg-neutral-950 px-2 py-1 text-sm text-amber-50"
          value={hsStartCmInputValue}
          onChange={(e) => onHsStartCmDraftChange(e.target.value)}
          onBlur={() => commitHsStartCmDraft()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
        />
        <span className="text-neutral-500">
          → 전장{" "}
          <strong className="text-neutral-200">
            {hsEffectiveFieldCm.toLocaleString("ko-KR")}cm
          </strong>
          ({hsSeatCountForStart}명 기준 · OFF여도 저장값 유지)
        </span>
      </label>
      <div className="flex flex-wrap gap-1.5">
        {[100, 200, 300, 400, 500, 600].map((cm) => (
          <button
            key={`hs-overlay-start-${cm}`}
            type="button"
            className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${
              Math.round(hsStartCm) === cm
                ? "border-amber-400 bg-amber-700/80 text-white"
                : "border-white/15 bg-neutral-900 text-neutral-300 hover:border-white/30"
            }`}
            onClick={() => patchHighSocietyStartCm(cm)}
          >
            1인 {cm}cm
          </button>
        ))}
      </div>
      {!highSocietySettings.enabled ? (
        <p className="text-[10px] text-amber-200/80 leading-snug">
          상류사회 OFF — 1인 시작·전장 설정은 저장됩니다. 좌석 배치·후원 연동은 ON 후 설정하세요.
        </p>
      ) : null}
      {highSocietySettings.enabled ? (
      <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-neutral-400">
            좌석 배치(좌→右). ←→로 순서 변경 · 최대 {HIGH_SOCIETY_MAX_SEATS}명.
            {hsSeatExplicit ? (
              <>
                {" "}
                <strong className="text-amber-200/90">수동 고정</strong>
              </>
            ) : (
              <>
                {" "}
                지금은 <strong className="text-neutral-300">자동(전원 N등분)</strong>
                — 삭제/이동 시 그 배치로 고정됩니다.
              </>
            )}
            <span className="block mt-0.5 text-[10px] text-neutral-500">
              0cm 탈락 멤버는 기본적으로 게이지에서 빠집니다. 아래 「0cm 게이지 표시」에서 0cm·00cm
              노출을 켤 수 있습니다. 재진입 위치는 ←→ 또는 0cm 칩의 위치 선택 · 영토 cm 조절은
              「상류사회 · 영토 기록부」에서만 수동 반영합니다.
            </span>
          </div>
          {hsSeatExplicit ? (
            <button
              type="button"
              className="rounded px-2 py-0.5 text-[10px] font-semibold border border-white/15 bg-neutral-900 text-neutral-300 hover:border-white/30"
              onClick={() => patchHighSocietySettings({ seatMemberIds: [], seatMemberIdsManual: false })}
            >
              자동(전원)으로
            </button>
          ) : null}
        </div>
        <label className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
          <span className="text-neutral-400">0cm 게이지 표시</span>
          <select
            className="rounded border border-white/10 bg-neutral-950 px-2 py-1 text-[11px]"
            value={normalizeZeroCmGaugeDisplay(highSocietySettings.zeroCmGaugeDisplay)}
            onChange={(e) =>
              patchHighSocietySettings({
                zeroCmGaugeDisplay: normalizeZeroCmGaugeDisplay(e.target.value),
              })
            }
          >
            <option value="hidden">숨김 (기본)</option>
            <option value="0cm">게이지에 0cm 표시</option>
            <option value="00cm">게이지에 00cm 표시</option>
          </select>
          <span className="text-[10px] text-neutral-500">
            0cm·00cm 선택 시 탈락 멤버도 좌석 순서대로 얇은 칸으로 표시됩니다.
          </span>
        </label>
        {hsSeatPlayers.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {hsSeatPlayers.map((p, i) => {
              const expandHint = i === 0 ? "→만" : i === hsSeatPlayers.length - 1 ? "←만" : "↔";
              const fieldSeat = hsSeatFieldByMemberId.get(p.id);
              const eliminated = fieldSeat?.eliminated === true;
              const zeroCmDisplay = normalizeZeroCmGaugeDisplay(highSocietySettings.zeroCmGaugeDisplay);
              return (
                <div
                  key={`hs-overlay-seat-${p.id}`}
                  className={`flex items-center gap-1 rounded border px-1.5 py-1 ${
                    eliminated
                      ? "border-neutral-500/50 bg-neutral-900/80 opacity-75"
                      : "border-amber-400/50 bg-amber-900/50"
                  }`}
                >
                  <span className="min-w-[1.25rem] text-center text-[10px] font-bold text-amber-200">
                    {i + 1}
                  </span>
                  <div className="leading-tight">
                    <div className="text-[11px] font-semibold text-white">{p.name}</div>
                    <div className="text-[9px] text-amber-200/70">
                      {eliminated
                        ? `${formatSeatWidthCm(0, zeroCmDisplay)} 탈락 · ${expandHint}`
                        : fieldSeat
                          ? `${formatCm(fieldSeat.widthCm)} · ${expandHint}`
                          : expandHint}
                    </div>
                  </div>
                  <div className="ml-1 flex flex-col gap-0.5">
                    {eliminated ? (
                      <select
                        className="max-w-[5.5rem] rounded bg-neutral-950/70 px-1 py-0.5 text-[9px] text-neutral-200"
                        value={String(i)}
                        title="0cm 탈락 — 재진입 위치(좌→右)"
                        aria-label={`${p.name} 재진입 위치`}
                        onChange={(e) => {
                          const at = Number(e.target.value);
                          if (Number.isFinite(at) && at !== i) {
                            moveHighSocietySeatToIndex(p.id, at);
                          }
                        }}
                      >
                        {Array.from({ length: hsSeatPlayers.length }, (_, at) => (
                          <option key={`hs-seat-at-${p.id}-${at}`} value={String(at)}>
                            {at + 1}번 위치
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button
                      type="button"
                      className="rounded bg-neutral-950/70 px-1.5 py-0.5 text-[10px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-30"
                      disabled={i === 0}
                      title="왼쪽으로"
                      onClick={() => moveHighSocietySeat(p.id, -1)}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      className="rounded bg-neutral-950/70 px-1.5 py-0.5 text-[10px] text-neutral-200 hover:bg-neutral-800 disabled:opacity-30"
                      disabled={i >= hsSeatPlayers.length - 1}
                      title="오른쪽으로"
                      onClick={() => moveHighSocietySeat(p.id, 1)}
                    >
                      →
                    </button>
                  </div>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-950/50"
                    title="좌석에서 제거"
                    onClick={() => removeHighSocietySeat(p.id)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded border border-dashed border-white/15 bg-black/20 px-2 py-2 text-[11px] text-neutral-500">
            좌석에 멤버가 없습니다. 아래에서 추가하거나 「자동(전원)으로」를 누르세요.
          </div>
        )}
        {hsUnseatedMembers.length > 0 ? (
          <div className="space-y-1">
            <div className="text-[10px] text-neutral-500">
              좌석에 추가 — 위치(좌→右)를 고른 뒤 추가
            </div>
            <div className="flex flex-col gap-1.5">
              {hsUnseatedMembers.map((m) => (
                <div key={`hs-overlay-add-${m.id}`} className="flex flex-wrap items-center gap-1.5">
                  <select
                    className="rounded border border-white/15 bg-neutral-950 px-1.5 py-1 text-[10px] text-neutral-200"
                    defaultValue={String(hsSeatPlayers.length)}
                    aria-label={`${m.name} 좌석 삽입 위치`}
                    id={`hs-add-seat-at-${m.id}`}
                  >
                    {Array.from({ length: hsSeatPlayers.length + 1 }, (_, at) => (
                      <option key={`hs-add-at-${m.id}-${at}`} value={String(at)}>
                        {at === 0
                          ? "← 맨 왼쪽"
                          : at >= hsSeatPlayers.length
                            ? "맨 오른쪽 →"
                            : `${at + 1}번과 ${at + 2}번 사이`}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="rounded border border-white/15 bg-neutral-900 px-2 py-1 text-[11px] font-semibold text-neutral-300 hover:border-amber-400/50 hover:text-amber-100"
                    onClick={() => {
                      const sel = document.getElementById(
                        `hs-add-seat-at-${m.id}`
                      ) as HTMLSelectElement | null;
                      const at = Number(sel?.value ?? hsSeatPlayers.length);
                      addHighSocietySeat(m.id, Number.isFinite(at) ? at : hsSeatPlayers.length);
                    }}
                  >
                    + {m.name}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <label className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
        가운데 시스템 기본 방향
        <select
          className="rounded border border-white/10 bg-neutral-950 px-2 py-1"
          value={resolveSystemMiddlePushDir(highSocietySettings)}
          onChange={(e) =>
            patchHighSocietySettings({
              defaultMiddlePush: e.target.value === "left" ? "left" : "right",
            })
          }
        >
          <option value="right">오른쪽 → (기본)</option>
          <option value="left">← 왼쪽</option>
        </select>
      </label>
      <p className="text-[10px] text-neutral-500 leading-snug">
        ON 시 좌석 멤버 후원 연동이 켜집니다. OFF·설정 저장·영토 초기화는 후원 기록·멤버 금액을 건드리지 않습니다. 건별 확장 방향은{" "}
        <button
          type="button"
          className="text-sky-400 underline"
          onClick={() => {
            moveToSection("donor", "donor-management");
            window.setTimeout(() => {
              document.getElementById("high-society-mode")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            }, 80);
          }}
        >
          후원자 기록부
        </button>
        에서 설정합니다.
      </p>
      </>
      ) : null}
    </div>
  );

  const serverDonorHealthCount = Number(storageHealth?.mainState?.donorsCount || 0);
  const uiDonorRowCount = normalizeDonorsArray(state.donors).length;
  const donorUiBehindServer = serverDonorHealthCount > uiDonorRowCount;
  /** 정상 동기화 시 배지 숨김 — 불일치·오프라인·로딩만 표시 */
  const showSyncStatusBadge = donorUiBehindServer || syncStatus !== "synced";

  return (
    <main
      className="min-h-screen p-4 md:p-8 pb-24 md:pb-10 text-neutral-100"
      style={{ backgroundColor: "#1a1a1a" }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <Toast />
      <SigUploadProgressOverlay progress={sigUploadProgress} busy={sigBulkReuploadBusy} />
      <div className="lg:hidden fixed left-1/2 -translate-x-1/2 top-2 z-40 pointer-events-none">
        <div
          className={`px-3 py-1 rounded-full text-[11px] border border-white/10 transition-all ${
            pullRefreshing ? "bg-[#22c55e]/30 text-[#86efac]" : "bg-black/50 text-neutral-300"
          }`}
          style={{ opacity: pullDistance > 8 || pullRefreshing ? 1 : 0, transform: `translateY(${Math.min(18, pullDistance * 0.28)}px)` }}
        >
          {pullRefreshing ? "동기화 중..." : pullDistance >= 64 ? "놓아서 동기화" : "아래로 당겨 동기화"}
        </div>
      </div>
      <div className="mx-auto max-w-[1600px] grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-6">
        <aside className="hidden lg:block lg:sticky lg:top-6 self-start rounded-xl border border-white/10 bg-[#222222] p-3 h-fit">
          <div className="text-xs uppercase tracking-[0.12em] text-neutral-400 px-2 pb-2">메뉴</div>
          <div className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => moveToSection(item.key, item.targetId)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  activeNav === item.key
                    ? "bg-indigo-500 text-white"
                    : "bg-transparent text-neutral-300 hover:bg-white/5"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </aside>
        <div>
        <div className="flex flex-wrap items-start sm:items-center justify-between gap-2 mb-6">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <h1 className="text-2xl font-bold">{adminHeaderTitle(user)}</h1>
            {(user?.remainingDays != null || user?.unlimited) && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${user?.unlimited ? "bg-blue-900/60 text-blue-300" : (user?.remainingDays ?? 0) <= 7 ? "bg-amber-900/60 text-amber-300" : "bg-neutral-800 text-neutral-400"}`}>
                {user?.unlimited ? "무제한" : `남은 일수: ${user?.remainingDays ?? 0}일`}
              </span>
            )}
            {showSyncStatusBadge ? (
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${
                donorUiBehindServer
                  ? "bg-rose-900/60 text-rose-300"
                  : syncStatus === "synced"
                    ? "bg-emerald-900/60 text-emerald-300"
                    : syncStatus === "loading"
                      ? "bg-yellow-900/60 text-yellow-300"
                      : syncStatus === "error"
                        ? "bg-amber-900/60 text-amber-300"
                        : "bg-neutral-800 text-neutral-400"
              }`}
              title={
                donorUiBehindServer
                  ? `서버 후원 ${serverDonorHealthCount}건 · 화면 ${uiDonorRowCount}건 — 「서버 후원 복구」 또는 새로고침`
                  : syncStatus === "error"
                    ? "동기화 실패 시 개발자 도구에 401이 보이면 로그인 세션이 만료된 경우가 많습니다. 페이지를 새로고침한 뒤 다시 로그인해 보세요."
                    : undefined
              }
            >
              {donorUiBehindServer
                ? `후원 동기화 필요 (서버 ${serverDonorHealthCount} · 화면 ${uiDonorRowCount})`
                : syncStatus === "synced"
                  ? "서버 동기화됨"
                  : syncStatus === "loading"
                    ? "동기화 중..."
                    : syncStatus === "error"
                      ? "연결 재시도 중"
                      : "로컬 모드 (오프라인)"}
            </span>
            ) : null}
            <button
              className="px-2 py-1 rounded bg-[#22c55e] hover:bg-[#16a34a] text-xs font-medium text-white"
              onClick={onFetchLatestFromServer}
              title="로컬이 리셋되었을 때 서버 최신 상태를 다시 가져옵니다"
            >
              서버에서 가져오기
            </button>
            <button
              className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
                router.push("/login");
                router.refresh();
              }}
            >
              로그아웃
            </button>
          </div>
          <div className="flex items-center gap-2">
            <Link className="text-sm text-neutral-300 underline" href="/settlements">정산 기록 보기</Link>
          </div>
        </div>
        {isAdminNavSectionVisible("dashboard") && (
        <section id="dashboard-summary" className={`${panelCardClass} p-4 mb-6`}>
          {typeof storageHealth?.mainState?.donorsCount === "number" &&
          storageHealth.mainState.donorsCount > 0 &&
          normalizeDonorsArray(state.donors).length < storageHealth.mainState.donorsCount ? (
            <div className="mb-3 rounded-lg border border-rose-400/55 bg-rose-950/35 px-3 py-2 text-sm text-rose-100">
              서버에는 후원 {storageHealth.mainState.donorsCount}건
              {typeof storageHealth.mainState.totalCombined === "number" &&
              storageHealth.mainState.totalCombined > 0
                ? `(합계 ${Number(storageHealth.mainState.totalCombined).toLocaleString("ko-KR")}원)`
                : ""}
              이 있는데 화면은 {normalizeDonorsArray(state.donors).length}건
              {total > 0 ? `(합계 ${total.toLocaleString("ko-KR")}원)` : ""}입니다.
              동기화 병합 오류일 수 있습니다.{" "}
              <button
                type="button"
                className="underline font-semibold text-rose-50"
                onClick={() => void applyDonorsFromServerMainState()}
              >
                서버 후원 복구
              </button>
              {" · "}
              <button
                type="button"
                className="underline font-semibold text-rose-50"
                onClick={onFetchLatestFromServer}
              >
                서버에서 가져오기
              </button>
            </div>
          ) : null}
          {isOrphanedDonationState(state) && (
            <div className="mb-3 rounded-lg border border-amber-400/50 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
              후원 건수는 0인데 멤버 합계만 남아 있습니다. 엑셀표·후원순위가 0으로 보일 수 있습니다.
              {" "}
              <button
                type="button"
                className="underline font-semibold text-amber-200"
                onClick={() => void restoreDonorsFromDailyLogSnapshot()}
              >
                일일 로그에서 복구
              </button>
              {" · "}
              <button
                type="button"
                className="underline font-semibold text-amber-200"
                onClick={onFetchLatestFromServer}
              >
                서버에서 가져오기
              </button>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-lg bg-[#1e1e1e] border border-white/10 px-3 py-2">
              <div className="text-xs text-neutral-400">오늘 총 후원액</div>
              <div className="text-xl font-bold text-white">{formatManThousand(total)}</div>
            </div>
            <div className="rounded-lg bg-[#1e1e1e] border border-white/10 px-3 py-2">
              <div className="text-xs text-neutral-400">후원 건수</div>
              <div className="text-xl font-bold text-[#6366f1]">{normalizeDonorsArray(state.donors).length.toLocaleString("ko-KR")}</div>
            </div>
            <div className="rounded-lg bg-[#1e1e1e] border border-white/10 px-3 py-2">
              <div className="text-xs text-neutral-400">멤버 수</div>
              <div className="text-xl font-bold text-[#22c55e]">{activeMemberCount.toLocaleString("ko-KR")}</div>
            </div>
          </div>
        </section>
        )}
        <div className="grid grid-cols-1 gap-6">
          <div className="space-y-6">
            {isAdminNavSectionVisible("settlement") && (
            <section id="settlement-member-board" className={`${panelCardClass} p-4 md:p-6`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">멤버 정산 보드</h2>
            <div className="text-right">
              <div className="text-xs text-neutral-400">계좌 · 투네 · 기여도 · 전체</div>
              <div className="text-2xl font-bold">
                {formatManThousand(state.members.reduce((s,m)=>s+(m.account||0),0))}
                <span className="text-neutral-500 mx-1">·</span>
                {formatManThousand(state.members.reduce((s,m)=>s+(m.toon||0),0))}
                <span className="text-neutral-500 mx-1">·</span>
                {formatManThousand(state.members.reduce((s,m)=>s+((m.account||0)+(m.toon||0)),0))}
                <span className="text-neutral-500 mx-1">·</span>
                {formatManThousand(state.members.reduce((s,m)=>s+(m.account||0)+(m.toon||0),0))}
              </div>
            </div>
          </div>
              <div className="flex flex-wrap gap-2 mb-4">
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="새 멤버 이름"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                />
                <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700" onClick={addMember}>
                  멤버 추가
                </button>
                <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700" onClick={resetAllMembersAmounts}>
                  모든 멤버 금액 리셋
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {syncStatus === "loading" && isDefaultPlaceholderMemberList(state.members) ? (
                  <div className="lg:col-span-3 rounded-lg border border-white/10 bg-neutral-900/50 px-4 py-8 text-center text-sm text-neutral-400">
                    서버에서 멤버를 불러오는 중…
                  </div>
                ) : (
                  state.members.map((m: Member) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    onChange={updateMember}
                    onRename={renameMember}
                    onReset={resetMemberAmounts}
                    onDelete={deleteMember}
                    onRestroomAdjust={(id, delta, amount = 1) => applyRestroomChange(id, delta, amount, "멤버 보드")}
                    onRestroomSet={(id, value) => setMemberRestroomValue(id, value, "멤버 보드")}
                    donationLinkActive={
                      mealParticipants.find((p) => p.memberId === m.id)?.donationLinkActive ?? null
                    }
                    onToggleDonationLink={() => toggleMealDonationLink(m.id)}
                  />
                  ))
                )}
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-2">
                <div>
                  <h3 className="text-base font-semibold">직급 관리 (별도)</h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    직급은 멤버 정보와 분리 저장됩니다. 정렬/오버레이 표시는 아래 직급 맵을 기준으로 동작합니다.
                  </p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="text-xs text-neutral-400 mb-1">직급 모드</div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`px-2 py-1 rounded text-xs ${state.memberPositionMode !== "rankLinked" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                      onClick={() => updateMemberPositionMode("fixed")}
                    >
                      멤버 고정 직급
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-1 rounded text-xs ${state.memberPositionMode === "rankLinked" ? "bg-emerald-700 hover:bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                      onClick={() => updateMemberPositionMode("rankLinked")}
                    >
                      순위 연동 직급
                    </button>
                  </div>
                  <p className="mt-1 text-[11px] text-neutral-500">
                    순위 연동 모드에서는 점수 순으로 정렬되며, 1위부터 직급 라벨이 이동하면서 붙습니다.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {state.members.map((m) => (
                    <label key={`pos-${m.id}`} className="grid grid-cols-[120px_1fr] items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1.5">
                      <span className="truncate text-sm text-neutral-300">{m.name}</span>
                      <input
                        className="w-full rounded bg-neutral-900/80 border border-white/10 px-2 py-1.5 text-sm"
                        placeholder={state.memberPositionMode === "rankLinked" ? "순위 연동 모드에서는 아래 대표 멤버만 지정" : "직급 (예: 대표, 이사, 부장)"}
                        value={state.memberPositions?.[m.id] || ""}
                        onChange={(e) => updateMemberPosition(m.id, e.target.value)}
                        disabled={state.memberPositionMode === "rankLinked"}
                      />
                    </label>
                  ))}
                </div>
                {state.memberPositionMode === "rankLinked" && (
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <div className="mb-2 grid grid-cols-1 md:grid-cols-[120px_1fr] items-center gap-2">
                      <label className="text-xs text-neutral-300">대표 멤버</label>
                      <select
                        className="w-full rounded bg-neutral-900/80 border border-white/10 px-2 py-1.5 text-sm"
                        value={state.members.find((m) => state.memberPositions?.[m.id] === "대표")?.id || ""}
                        onChange={(e) => updateRepresentativeMember(e.target.value)}
                      >
                        <option value="">미지정(순위 1위가 대표)</option>
                        {state.members.map((m) => (
                          <option key={`rep-${m.id}`} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="text-xs text-neutral-400 mb-2">
                      순위별 직급 라벨 (1위~{Math.max(1, state.members.length)}위 · 멤버 {state.members.length}명).
                      대표 멤버를 지정하면 해당 멤버는 항상 대표로 고정됩니다.
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {Array.from({ length: Math.max(1, state.members.length) }).map((_, idx) => (
                        <label key={`rank-label-${idx}`} className="grid grid-cols-[46px_1fr] items-center gap-2 text-xs text-neutral-300">
                          <span>{idx + 1}위</span>
                          <input
                            className="w-full rounded bg-neutral-900/80 border border-white/10 px-2 py-1.5 text-sm"
                            value={state.rankPositionLabels?.[idx] || ""}
                            onChange={(e) => updateRankPositionLabel(idx, e.target.value)}
                            placeholder={idx === 0 ? "대표(고정)" : `직급 ${idx + 1}`}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="rounded-lg border border-amber-300/30 bg-amber-500/10 p-3 space-y-2">
                  <div className="text-sm font-semibold text-amber-200">후원 동기화 일괄 관리 (중복 방지)</div>
                    <p className="text-xs text-neutral-300">
                      후원 입력은 아래에서 선택한 대상에만 동기화됩니다. 시그/식사/상류사회를 켜면 모드가 자동 전환됩니다.
                      참가자별 「후원 연동 ON/OFF」로 엑셀에 배정된 후원이 해당 대전 점수에 반영될지 제어합니다.
                    </p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      ["mealBattle", "식사대전 동기화"],
                      ["sigMatch", "시그대전 동기화"],
                      ["highSociety", "상류사회 동기화"],
                      ["sigSales", "시그판매 동기화"],
                      ["none", "동기화 안 함"],
                    ] as Array<[AppState["donationSyncMode"], string]>).map(([mode, label]) => (
                      <button
                        key={`donation-sync-mode-${mode}`}
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${
                          donationSyncMode === mode
                            ? "bg-amber-600 text-white"
                            : "bg-neutral-700 hover:bg-neutral-600 text-neutral-200"
                        }`}
                        onClick={() => {
                          setState((prev: AppState) => {
                            const next: AppState = { ...prev, donationSyncMode: mode || "none" };
                            persistState(next, {
                              omitDonationFields: true,
                              persistToastLabel: `후원 동기화 · ${label}`,
                            });
                            return next;
                          });
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="text-[11px] text-neutral-400">
                    현재 모드: <span className="text-amber-200 font-semibold">{donationSyncMode}</span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">시그 대전 관리</h3>
                    <p className="text-xs text-neutral-400">Redis donors를 기준으로 점수를 실시간 집계하고, 멤버별 추가·차감 보정을 합산합니다.</p>
                    <a
                      href="/overlay/battle-effects-demo"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 mr-3 inline-block text-[11px] font-medium text-violet-400 hover:text-violet-300"
                    >
                      대전 연출 통합 허브 ↗
                    </a>
                    <a
                      href="/overlay/sig-match/demo"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-block text-[11px] font-medium text-amber-400 hover:text-amber-300"
                    >
                      시그 대전 데모 ↗
                    </a>
                  </div>
                  <button
                    onClick={() => { void toggleSigMatchActive(); }}
                    className={`px-3 py-1.5 rounded text-sm font-semibold ${
                      state.sigMatchSettings?.isActive ? "bg-emerald-600 hover:bg-emerald-500" : "bg-neutral-700 hover:bg-neutral-600"
                    }`}
                  >
                    {state.sigMatchSettings?.isActive ? "활성화됨" : "비활성화됨"}
                  </button>
                </div>
                {renderBattleOverlayTimerControls({ id: "sig-battle-overlay-timer" })}
                <div className="grid grid-cols-1 md:grid-cols-[1fr_140px_140px] gap-2">
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    placeholder="대전 제목"
                    value={state.sigMatchSettings?.title || "시그 대전"}
                    onChange={(e) => updateSigMatchSettings({ title: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    type="number"
                    min={1}
                    value={sigMatchNumericDraft.targetCount}
                    onFocus={() => setSigMatchDraftEditing("targetCount", true)}
                    onChange={(e) =>
                      setSigMatchNumericDraft((prev) => ({ ...prev, targetCount: e.target.value.replace(/[^\d]/g, "") }))
                    }
                    onBlur={commitSigMatchTargetCountDraft}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  <select
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    value={state.sigMatchSettings?.scoringMode || "count"}
                    onChange={(e) => updateSigMatchSettings({ scoringMode: e.target.value as "count" | "amount" })}
                  >
                    <option value="count">점수 방식: 건수</option>
                    <option value="amount">점수 방식: 금액</option>
                  </select>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs text-neutral-400">VS 디자인 (게이지 중앙)</span>
                  <select
                    className="w-full max-w-md px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm"
                    value={normalizeVsDesign(state.sigMatchSettings?.vsDesign)}
                    onChange={(e) => updateSigMatchSettings({ vsDesign: e.target.value })}
                  >
                    {VS_DESIGN_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-neutral-500">
                    {VS_DESIGN_OPTIONS.find((o) => o.id === normalizeVsDesign(state.sigMatchSettings?.vsDesign))
                      ?.description}
                  </span>
                </label>
                <label className="flex items-center gap-2 text-sm text-neutral-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded border-white/20 bg-neutral-900"
                    checked={state.sigMatchSettings?.countAllDonations !== false}
                    onChange={(e) => updateSigMatchSettings({ countAllDonations: e.target.checked })}
                  />
                  모든 후원 금액 집계 (시그 키워드 없이 · 벌칙/금액 대전)
                </label>
                <label className="block space-y-1">
                  <span className="text-xs text-neutral-400">벌칙/규칙 설명 (오버레이 우상단, 비우면 숨김)</span>
                  <textarea
                    className="w-full min-h-[4rem] px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm"
                    placeholder="예: 벌칙대전 — 핵불닭 소스 한 숟가락. 10만원 이상 차이로 승리해야 면제."
                    value={state.sigMatchSettings?.rulesText || ""}
                    onChange={(e) => updateSigMatchSettings({ rulesText: e.target.value })}
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-neutral-500 shrink-0">글자 크기</span>
                    <input
                      type="range"
                      min={10}
                      max={36}
                      value={state.sigMatchSettings?.rulesFontSize ?? 16}
                      onChange={(e) => updateSigMatchSettings({ rulesFontSize: Number(e.target.value) })}
                      className="flex-1 accent-emerald-500"
                    />
                    <span className="w-10 text-right text-xs text-neutral-300">
                      {state.sigMatchSettings?.rulesFontSize ?? 16}px
                    </span>
                  </div>
                </label>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
                  <span className="text-xs font-medium text-neutral-300">하단 후원 표 옵션</span>
                  <DonationTableOptionCheckboxes
                    compact
                    value={state.sigMatchSettings?.donationTableOptions}
                    onChange={(patch) =>
                      updateSigMatchSettings({
                        donationTableOptions: {
                          ...state.sigMatchSettings?.donationTableOptions,
                          ...patch,
                        },
                      })
                    }
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-2">
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    placeholder="시그 키워드 (예: 시그)"
                    value={state.sigMatchSettings?.keyword || "시그"}
                    onChange={(e) => updateSigMatchSettings({ keyword: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    placeholder="시그 금액 목록 (예: 77,100,333)"
                    value={sigSignatureAmountsInput}
                    onChange={(e) => {
                      const arr = e.target.value
                        .split(",")
                        .map((x) => Number.parseInt(x.trim(), 10))
                        .filter((x) => Number.isFinite(x) && x > 0);
                      updateSigMatchSettings({ signatureAmounts: arr });
                    }}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-2 items-center">
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    type="number"
                    min={0}
                    placeholder="포인트당 정산 단가"
                    value={sigMatchNumericDraft.incentivePerPoint}
                    onFocus={() => setSigMatchDraftEditing("incentivePerPoint", true)}
                    onChange={(e) =>
                      setSigMatchNumericDraft((prev) => ({ ...prev, incentivePerPoint: e.target.value.replace(/[^\d]/g, "") }))
                    }
                    onBlur={commitSigMatchIncentiveDraft}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                  <div className="text-xs text-neutral-400">세션 종료 시 &quot;시그 인센티브 정산&quot;이 자동 생성됩니다. (count 모드: 점수 x 단가, amount 모드: 점수=금액)</div>
                </div>
                <div className="rounded-lg border border-white/10 bg-neutral-950/30 p-3 space-y-2">
                  <div>
                    <h4 className="text-sm font-semibold text-neutral-200">랭킹 표시 멤버 (참가자) · 후원 연동</h4>
                    <p className="mt-1 text-xs text-neutral-500">
                      체크가 전부 켜져 있으면 전원이 랭킹에 나갑니다(운영비 제외). 일부만 남기면 그 멤버만 표시·집계됩니다.
                      「후원 연동 ON」인 참가자에게 엑셀과 동일하게 배정된 후원만 시그 점수에 반영됩니다. OFF면 엑셀/멤버 금액은 그대로이고 시그 점수만 제외됩니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
                      onClick={() => updateSigMatchSettings({ participantMemberIds: [] })}
                    >
                      전원 표시
                    </button>
                    <button
                      type="button"
                      className="rounded bg-amber-800/90 px-2 py-1 text-xs hover:bg-amber-700"
                      onClick={() => setAllSigDonationLinks(true)}
                    >
                      후원 연동 전체 ON
                    </button>
                    <button
                      type="button"
                      className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
                      onClick={() => setAllSigDonationLinks(false)}
                    >
                      후원 연동 전체 OFF
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-2">
                    {state.members
                      .filter((m) => !isOperatingSettlementMember(m, state.memberPositions))
                      .map((m) => {
                      const ids = state.sigMatchSettings?.participantMemberIds ?? [];
                      const allMode = ids.length === 0;
                      const checked = allMode || ids.includes(m.id);
                      const playableMemberIds = state.members
                        .filter((x) => !isOperatingSettlementMember(x, state.memberPositions))
                        .map((x) => x.id);
                      const link = resolveSigMatchDonationLink(state.sigMatchSettings, m.id);
                      return (
                        <div key={`sig-part-${m.id}`} className="flex items-center gap-1.5 text-xs text-neutral-300">
                          <label className="flex cursor-pointer items-center gap-1.5">
                            <input
                              type="checkbox"
                              className="rounded border-white/20"
                              checked={checked}
                              onChange={() => {
                                const valid = new Set(playableMemberIds);
                                if (allMode) {
                                  const next = playableMemberIds.filter((id) => id !== m.id);
                                  updateSigMatchSettings({
                                    participantMemberIds: normalizeSigMatchParticipantIds(next, valid),
                                  });
                                } else {
                                  const set = new Set(ids);
                                  let next: string[];
                                  if (set.has(m.id)) {
                                    next = ids.filter((id) => id !== m.id);
                                  } else {
                                    next = [...ids, m.id];
                                  }
                                  if (next.length === 0 || next.length >= playableMemberIds.length) {
                                    updateSigMatchSettings({ participantMemberIds: [] });
                                  } else {
                                    updateSigMatchSettings({
                                      participantMemberIds: normalizeSigMatchParticipantIds(next, valid),
                                    });
                                  }
                                }
                              }}
                            />
                            <span className="truncate max-w-[100px]">{m.name}</span>
                          </label>
                          <button
                            type="button"
                            disabled={!checked}
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              !checked
                                ? "cursor-not-allowed bg-neutral-800 text-neutral-500"
                                : link.active
                                  ? "bg-amber-700 text-white hover:bg-amber-600"
                                  : "bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
                            }`}
                            onClick={() => toggleSigDonationLink(m.id)}
                            title={
                              link.active
                                ? "후원 연동 ON — 엑셀 배정 후원이 시그 점수에 반영"
                                : "후원 연동 OFF — 시그 점수 미반영"
                            }
                          >
                            연동 {link.active ? "ON" : "OFF"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-neutral-950/40 p-3 space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold text-neutral-200">1:1 / n:n 규칙 (시그 풀)</h4>
                    <p className="mt-1 text-xs text-neutral-500">
                      풀이 없으면 후원 멤버별 1:1 집계입니다. 풀에 넣은 멤버는 시그 1건을 풀 인원 수로 나눠 동일 반영(n:n)합니다. 멤버는 한 풀에만 속할 수 있습니다. 풀 2개 → 오버레이 좌·우(1:2·2:1 등), 풀 3개 → 삼자 막대. 풀 없이 참가자만 3명이면 오버레이는 1:1:1(삼각)로 표시됩니다. 풀을 4개 이상 만들면 시그 오버레이 막대는 <span className="text-amber-400/90">앞선 3개 풀만</span> 사용합니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded bg-neutral-700 px-2 py-1 text-xs hover:bg-neutral-600"
                      onClick={() => {
                        const pools = [...(state.sigMatchSettings.sigMatchPools || [])];
                        pools.push({ id: `pool_${Date.now()}`, memberIds: [] });
                        const valid = new Set(state.members.map((m) => m.id));
                        updateSigMatchSettings({ sigMatchPools: normalizeSigMatchPools(pools, valid) });
                      }}
                    >
                      + 풀 추가
                    </button>
                  </div>
                  {(state.sigMatchSettings.sigMatchPools || []).length === 0 ? (
                    <p className="text-xs text-neutral-500">등록된 풀이 없습니다. 전원 1:1 방식입니다.</p>
                  ) : (
                    <div className="space-y-3">
                      {(state.sigMatchSettings.sigMatchPools || []).map((pool, pi) => (
                        <div key={pool.id} className="rounded border border-white/10 bg-neutral-900/60 p-2">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-neutral-300">풀 {pi + 1}</span>
                            <button
                              type="button"
                              className="rounded bg-red-900/60 px-2 py-0.5 text-[11px] hover:bg-red-800/80"
                              onClick={() => {
                                const next = (state.sigMatchSettings.sigMatchPools || []).filter((p) => p.id !== pool.id);
                                const valid = new Set(state.members.map((m) => m.id));
                                updateSigMatchSettings({ sigMatchPools: normalizeSigMatchPools(next, valid) });
                              }}
                            >
                              풀 삭제
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            {state.members.map((m) => (
                              <label key={`${pool.id}-${m.id}`} className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-300">
                                <input
                                  type="checkbox"
                                  className="rounded border-white/20"
                                  checked={pool.memberIds.includes(m.id)}
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    let pools = [...(state.sigMatchSettings.sigMatchPools || [])].map((p) => ({
                                      ...p,
                                      memberIds: [...p.memberIds],
                                    }));
                                    if (checked) {
                                      pools = pools.map((p) => {
                                        if (p.id === pool.id) return { ...p, memberIds: [...new Set([...p.memberIds, m.id])] };
                                        return { ...p, memberIds: p.memberIds.filter((id) => id !== m.id) };
                                      });
                                    } else {
                                      pools = pools.map((p) =>
                                        p.id === pool.id ? { ...p, memberIds: p.memberIds.filter((id) => id !== m.id) } : p
                                      );
                                    }
                                    const valid = new Set(state.members.map((mm) => mm.id));
                                    updateSigMatchSettings({ sigMatchPools: normalizeSigMatchPools(pools, valid) });
                                  }}
                                />
                                <span className="truncate max-w-[120px]">{m.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-2 items-end">
                  <label className="block space-y-1">
                    <span className="text-xs text-neutral-400">추가 단위 ({sigMatchScoringMode === "amount" ? "원" : "건"})</span>
                    <input
                      className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      type="number"
                      min={1}
                      value={sigMatchNumericDraft.manualAddStep}
                      onFocus={() => setSigMatchDraftEditing("manualAddStep", true)}
                      onChange={(e) =>
                        setSigMatchNumericDraft((prev) => ({ ...prev, manualAddStep: e.target.value.replace(/[^\d]/g, "") }))
                      }
                      onBlur={commitSigMatchManualAddStepDraft}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-neutral-400">차감 단위 ({sigMatchScoringMode === "amount" ? "원" : "건"})</span>
                    <input
                      className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      type="number"
                      min={1}
                      value={sigMatchNumericDraft.manualDeductStep}
                      onFocus={() => setSigMatchDraftEditing("manualDeductStep", true)}
                      onChange={(e) =>
                        setSigMatchNumericDraft((prev) => ({ ...prev, manualDeductStep: e.target.value.replace(/[^\d]/g, "") }))
                      }
                      onBlur={commitSigMatchManualDeductStepDraft}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                    />
                  </label>
                </div>
                <p className="text-[11px] text-neutral-500">
                  참가 멤버 행의「추가 / 차감」버튼에 위 단위가 적용됩니다. 보정값은 후원 집계 점수에 더해지며, 차감은 음수 보정으로
                  반영됩니다(최종 점수 0 미만은 0).
                </p>
                <div className="space-y-2">
                  {sigMatchRanking.map((row) => (
                    <div key={row.memberId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-[#1f1f1f] px-3 py-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{row.name}</div>
                        <div className="text-xs text-neutral-400">
                          점수 {formatSigMatchStat(row.score)} · 매칭 {formatSigMatchStat(row.matchedCount)}건 · 합계{" "}
                          {formatSigMatchStat(row.matchedAmount)} · 추가·차감 {row.manualAdjust >= 0 ? "+" : ""}
                          {formatSigMatchStat(row.manualAdjust)}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 justify-end">
                        <label className="flex items-center gap-1 text-[11px] text-neutral-400">
                          보정
                          <input
                            key={`sig-manual-${row.memberId}-${row.manualAdjust}`}
                            className="w-24 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-right text-neutral-100"
                            type="number"
                            defaultValue={row.manualAdjust === 0 ? "" : String(row.manualAdjust)}
                            placeholder="0"
                            onBlur={(e) => {
                              const raw = e.target.value.trim();
                              if (raw === "" || raw === "-") {
                                setSigMatchManualAdjust(row.memberId, 0);
                                return;
                              }
                              const n = Number(raw);
                              if (Number.isFinite(n)) setSigMatchManualAdjust(row.memberId, n);
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs"
                          onClick={() => adjustSigMatchManual(row.memberId, sigMatchManualSteps.addStep)}
                        >
                          추가 +{formatSigMatchManualAdjustStepLabel(sigMatchManualSteps.addStep, sigMatchScoringMode)}
                        </button>
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-xs"
                          onClick={() => adjustSigMatchManual(row.memberId, -sigMatchManualSteps.deductStep)}
                        >
                          차감 −{formatSigMatchManualAdjustStepLabel(sigMatchManualSteps.deductStep, sigMatchScoringMode)}
                        </button>
                        {row.manualAdjust !== 0 ? (
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-[11px] text-neutral-200"
                            onClick={() => setSigMatchManualAdjust(row.memberId, 0)}
                          >
                            보정 초기화
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span>대전 배율(%):</span>
                  <input
                    className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    value={battleScalePct}
                    onChange={(e) => {
                      const n = Math.max(50, Math.min(300, parseInt(e.target.value.replace(/[^\d]/g, "") || "100", 10) || 100));
                      setBattleScalePct(String(n));
                    }}
                  />
                  <input
                    type="range"
                    min={50}
                    max={300}
                    step={1}
                    value={String(getBattleScalePct())}
                    onChange={(e) => setBattleScalePct(String(parseInt(e.target.value, 10) || 100))}
                  />
                  <span className="text-neutral-300">{getBattleScalePct()}%</span>
                </div>
                <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span>가로 폭(%):</span>
                  <input
                    className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    value={battleContentWidthPct}
                    onChange={(e) => {
                      const n = Math.max(40, Math.min(100, parseInt(e.target.value.replace(/[^\d]/g, "") || "100", 10) || 100));
                      setBattleContentWidthPct(String(n));
                    }}
                  />
                  <input
                    type="range"
                    min={40}
                    max={100}
                    step={1}
                    value={String(getBattleContentWidthPct())}
                    onChange={(e) => setBattleContentWidthPct(String(parseInt(e.target.value, 10) || 100))}
                  />
                  <span className="text-neutral-300">{getBattleContentWidthPct()}%</span>
                  <span className="text-[10px] text-neutral-600">(본문 너비 · 식사대전 URL 동일)</span>
                </div>
                <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span>오버레이 URL:</span>
                  <code className="text-neutral-300 break-all">
                    /overlay/sig-match?u={overlayUserId}&host=obs&scalePct={getBattleScalePct()}&contentWidthPct=
                    {getBattleContentWidthPct()}
                  </code>
                  <button
                    type="button"
                    className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-sig-match" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                    onClick={() => {
                      const u = buildSigMatchLiveUrl();
                      void copyUrl(u, "dash-sig-match");
                    }}
                  >
                    {copiedId === "dash-sig-match" ? "복사됨!" : "URL 복사"}
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded text-xs shrink-0 bg-amber-800/90 hover:bg-amber-700"
                    onClick={() => {
                      const u = buildSigMatchLiveUrl();
                      window.open(u, "_blank", "noopener,noreferrer");
                    }}
                  >
                    실시간 오버레이 열기
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500">
                  아래 오버레이 UI는 스냅샷이 아닌 실시간 URL을 그대로 표시합니다. 관리자 변경사항이 즉시 반영됩니다.
                </p>
                <div className="mt-3 rounded-lg border border-white/10 bg-black/50 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-2 py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-neutral-300">오버레이 UI 미리보기</span>
                      <span className="text-[10px] text-neutral-500">
                        scalePct={getBattleScalePct()} · contentWidthPct={getBattleContentWidthPct()} 반영 · 변경 시 자동 갱신
                      </span>
                    </div>
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-emerald-500/60 hover:text-emerald-200"
                      onClick={() => {
                        sigMatchPreviewUrlRef.current = `${buildSigMatchLiveUrl()}&_t=${Date.now()}`;
                        setSigMatchPreviewIframeSrc(appendAdminPreviewEmbedToOverlayUrl(sigMatchPreviewUrlRef.current));
                        setSigMatchPreviewIframeKey((k) => k + 1);
                      }}
                    >
                      새로고침
                    </button>
                  </div>
                  <div
                    className="relative w-full overflow-hidden bg-black/40"
                    style={{
                      height: `${Math.min(720, Math.max(280, Math.round(280 * (getBattleScalePct() / 100))))}px`,
                    }}
                  >
                    {sigMatchPreviewIframeSrc ? (
                      <iframe
                        key={`sig-match-preview-${sigMatchPreviewIframeKey}`}
                        src={sigMatchPreviewIframeSrc}
                        title="시그 대전 오버레이 미리보기"
                        className="absolute inset-0 h-full w-full border-0"
                        style={{ background: "transparent" }}
                      />
                    ) : (
                      <div className="flex h-[280px] items-center justify-center text-xs text-neutral-500">미리보기 URL 생성 중…</div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">식사 대전 관리</h3>
                    <p className="text-xs text-neutral-400">
                      참여 멤버별 게이지 색·점수·개인 목표, 상단 제목·미션 말풍선, 오버레이 색상을 실시간 제어합니다. &quot;팀대전&quot;을 켜고 멤버를 A/B에 넣으면 팀 합산 막대로 표시됩니다(팀 모드: 2분할, 개인 모드: 채움 안 색 분할). 식사 매치「개인」이면 (총점 ÷ 참가자 목표 합) 채움 막대입니다. 멤버 행에서 색을 먼저 고른 뒤 참가 체크하면 그 색이 적용됩니다.
                      &quot;후원 연동 ON&quot;인 멤버에게만 후원 입력 시 식대전 점수가 오르고(만 원 단위 환산), 다른 멤버 후원은 멤버 금액·엑셀에만 반영됩니다.
                    </p>
                  </div>
                  <button
                    className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs"
                    onClick={() => window.open(buildMealMatchLiveUrl(), "_blank", "noopener,noreferrer")}
                  >
                    식사대전 오버레이 열기
                  </button>
                </div>
                {renderBattleOverlayTimerControls({ id: "meal-battle-overlay-timer" })}
                <p className="text-[11px] text-neutral-500">
                  위 &quot;대전 배율(%)&quot;·&quot;가로 폭(%)&quot;는 시그 대전과 공유됩니다. 아래 미리보기는 스냅샷이 아닌{" "}
                  <code className="text-neutral-400">/overlay/meal-match</code> 실시간 URL이며, 식사 대전 설정·점수 변경이 곧바로
                  반영됩니다.
                </p>
                <div className="mt-3 rounded-lg border border-white/10 bg-black/50 overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-2 py-1.5">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-neutral-300">식사 대전 오버레이 미리보기</span>
                      <span className="text-[10px] text-neutral-500">
                        scalePct={getBattleScalePct()} · contentWidthPct={getBattleContentWidthPct()} 반영 · 변경 시 자동 갱신
                      </span>
                    </div>
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-emerald-500/60 hover:text-emerald-200"
                      onClick={() => {
                        mealMatchPreviewUrlRef.current = `${buildMealMatchLiveUrl()}&_t=${Date.now()}`;
                        setMealMatchPreviewIframeSrc(appendAdminPreviewEmbedToOverlayUrl(mealMatchPreviewUrlRef.current));
                        setMealMatchPreviewIframeKey((k) => k + 1);
                      }}
                    >
                      새로고침
                    </button>
                  </div>
                  <div
                    className="relative w-full overflow-hidden bg-black/40"
                    style={{
                      height: `${Math.min(720, Math.max(280, Math.round(280 * (getBattleScalePct() / 100))))}px`,
                    }}
                  >
                    {mealMatchPreviewIframeSrc ? (
                      <iframe
                        key={`meal-match-preview-${mealMatchPreviewIframeKey}`}
                        src={mealMatchPreviewIframeSrc}
                        title="식사 대전 오버레이 미리보기"
                        className="absolute inset-0 h-full w-full border-0"
                        style={{ background: "transparent" }}
                      />
                    ) : (
                      <div className="flex h-[280px] items-center justify-center text-xs text-neutral-500">미리보기 URL 생성 중…</div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <label className="block space-y-1">
                    <span className="text-xs text-neutral-400">상단 큰 제목</span>
                    <input
                      className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      placeholder="예: 식사 대전"
                      value={state.mealBattle?.overlayTitle || ""}
                      onChange={(e) => updateMealBattle({ overlayTitle: e.target.value })}
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs text-neutral-400">미션 말풍선 (비우면 숨김)</span>
                    <input
                      className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      placeholder="예: 개똥이 사료값"
                      value={state.mealBattle?.currentMission || ""}
                      onChange={(e) => updateMealBattle({ currentMission: e.target.value })}
                    />
                  </label>
                </div>
                <label className="block space-y-1">
                  <span className="text-xs text-neutral-400">벌칙/규칙 설명 (오버레이 우상단, 비우면 숨김)</span>
                  <textarea
                    className="w-full min-h-[4rem] px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm"
                    placeholder="예: 벌칙대전 규칙 — 10만원 이상 차이로 승리해야 면제"
                    value={state.mealBattle?.overlayRulesText || ""}
                    onChange={(e) => updateMealBattle({ overlayRulesText: e.target.value })}
                  />
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-[11px] text-neutral-500 shrink-0">글자 크기</span>
                    <input
                      type="range"
                      min={10}
                      max={36}
                      value={state.mealBattle?.overlayRulesFontSize ?? 16}
                      onChange={(e) => updateMealBattle({ overlayRulesFontSize: Number(e.target.value) })}
                      className="flex-1 accent-emerald-500"
                    />
                    <span className="w-10 text-right text-xs text-neutral-300">
                      {state.mealBattle?.overlayRulesFontSize ?? 16}px
                    </span>
                  </div>
                </label>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-2">
                  <span className="text-xs font-medium text-neutral-300">하단 후원 표 옵션</span>
                  <DonationTableOptionCheckboxes
                    compact
                    value={state.mealBattle?.donationTableOptions}
                    onChange={(patch) =>
                      updateMealBattle({
                        donationTableOptions: {
                          ...state.mealBattle?.donationTableOptions,
                          ...patch,
                        },
                      })
                    }
                  />
                </div>
                <label className="block space-y-1 max-w-xl">
                  <span className="text-xs text-neutral-400">식사 매치 모드 → 오버레이 게이지 형태</span>
                  <select
                    className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    value={state.mealMatchSettings?.mode || "team"}
                    onChange={(e) => updateMealMatchSettings({ mode: e.target.value as "team" | "individual" })}
                  >
                    <option value="team">팀 — 분할/채움 형태(아래 팀대전·개인 설정과 조합)</option>
                    <option value="individual">개인(1인) — 총점÷목표합 채움 막대</option>
                  </select>
                </label>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3">
                  <label className="flex items-center gap-2 text-sm text-neutral-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(state.mealBattle?.teamBattleEnabled)}
                      onChange={(e) => updateMealBattle({ teamBattleEnabled: e.target.checked })}
                    />
                    팀대전 (A/B에 멤버를 넣으면 막대가 팀 합산 기준으로 표시)
                  </label>
                  {state.mealBattle?.teamBattleEnabled ? (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <label className="block space-y-1">
                          <span className="text-xs text-neutral-400">A팀 이름</span>
                          <input
                            className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                            value={state.mealBattle?.teamAName || "A팀"}
                            onChange={(e) => updateMealBattle({ teamAName: e.target.value })}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs text-neutral-400">B팀 이름</span>
                          <input
                            className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                            value={state.mealBattle?.teamBName || "B팀"}
                            onChange={(e) => updateMealBattle({ teamBName: e.target.value })}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs text-neutral-400">A팀 목표 (0=자동)</span>
                          <input
                            className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                            type="number"
                            min={0}
                            value={state.mealBattle?.teamAGoal ?? 0}
                            onChange={(e) => updateMealBattle({ teamAGoal: Math.max(0, Number.parseInt(e.target.value || "0", 10) || 0) })}
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs text-neutral-400">B팀 목표 (0=자동)</span>
                          <input
                            className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                            type="number"
                            min={0}
                            value={state.mealBattle?.teamBGoal ?? 0}
                            onChange={(e) => updateMealBattle({ teamBGoal: Math.max(0, Number.parseInt(e.target.value || "0", 10) || 0) })}
                          />
                        </label>
                      </div>
                      <div className="text-xs text-neutral-400">전체 멤버를 A팀·B팀·미배정 중 하나로 지정합니다. 식대전 참가자만 점수가 합산됩니다. 운영비는 대전 참가 대상이 아닙니다.</div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[220px] overflow-y-auto pr-1">
                        {state.members
                          .filter((m) => !isOperatingSettlementMember(m, state.memberPositions))
                          .map((m) => {
                          const inA = (state.mealBattle?.teamAMemberIds || []).includes(m.id);
                          const inB = (state.mealBattle?.teamBMemberIds || []).includes(m.id);
                          const val = inA ? "A" : inB ? "B" : "";
                          return (
                            <div key={m.id} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-[#1f1f1f] px-2 py-1.5">
                              <span className="text-sm truncate">{m.name}</span>
                              <select
                                className="text-xs px-2 py-1 rounded bg-neutral-900 border border-white/10 shrink-0"
                                value={val}
                                onChange={(e) => setMealBattleMemberTeam(m.id, e.target.value as "" | "A" | "B")}
                              >
                                <option value="">미배정</option>
                                <option value="A">{state.mealBattle?.teamAName || "A팀"}</option>
                                <option value="B">{state.mealBattle?.teamBName || "B팀"}</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[1fr_140px] gap-2 items-end">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">말풍선 배경</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.missionBubbleBg, "#9333ea")}
                        onChange={(e) => updateMealBattle({ missionBubbleBg: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">말풍선 글자</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.missionBubbleTextColor, "#ffffff")}
                        onChange={(e) => updateMealBattle({ missionBubbleTextColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">게이지 트랙</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.gaugeTrackBg, "#171717")}
                        title="단색만 피커로 고를 수 있습니다. 알파는 아래 입력란에 hex/rgba로 입력하세요."
                        onChange={(e) => updateMealBattle({ gaugeTrackBg: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">채움 막대(개인)</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.gaugeFillColor, "#22c55e")}
                        onChange={(e) => updateMealBattle({ gaugeFillColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">A팀 막대</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.teamAColor, "#2563eb")}
                        onChange={(e) => updateMealBattle({ teamAColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">B팀 막대</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.teamBColor, "#dc2626")}
                        onChange={(e) => updateMealBattle({ teamBColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">점수·요약 글자</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.scoreTextColor, "#ffffff")}
                        onChange={(e) => updateMealBattle({ scoreTextColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">이름 태그 배경</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.nameTagBg, "#facc15")}
                        onChange={(e) => updateMealBattle({ nameTagBg: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-neutral-400">이름 태그 글자</span>
                      <input
                        type="color"
                        value={toColorPickerValue(state.mealBattle?.nameTagTextColor, "#000000")}
                        onChange={(e) => updateMealBattle({ nameTagTextColor: e.target.value })}
                        className="h-9 w-full rounded border border-white/20 bg-transparent"
                      />
                    </label>
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="block space-y-1">
                      <span className="text-xs text-neutral-400">신규 참가 기본 목표</span>
                      <input
                        className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                        type="number"
                        min={1}
                        value={state.mealBattle?.totalGoal || 100}
                        onChange={(e) => updateMealBattle({ totalGoal: Math.max(1, Number.parseInt(e.target.value || "100", 10) || 100) })}
                      />
                    </label>
                    <div className="space-y-2 rounded border border-white/10 bg-black/20 p-2">
                      <div className="text-[11px] text-neutral-500">오버레이 테두리 (기본 끔)</div>
                      <label className="flex items-center gap-2 text-xs text-neutral-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(state.mealBattle?.showPanelBorder)}
                          onChange={(e) => updateMealBattle({ showPanelBorder: e.target.checked })}
                        />
                        메인 패널 테두리
                      </label>
                      <label className="flex items-center gap-2 text-xs text-neutral-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(state.mealBattle?.showGaugeTrackBorder)}
                          onChange={(e) => updateMealBattle({ showGaugeTrackBorder: e.target.checked })}
                        />
                        게이지 트랙 테두리
                      </label>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    placeholder="게이지 트랙 배경 (rgba/hex, 예: rgba(23,23,23,0.85))"
                    value={state.mealBattle?.gaugeTrackBg || ""}
                    onChange={(e) => updateMealBattle({ gaugeTrackBg: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    placeholder="채움 막대 색 (개인 모드, rgba/hex)"
                    value={state.mealBattle?.gaugeFillColor || ""}
                    onChange={(e) => updateMealBattle({ gaugeFillColor: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    placeholder="패널 테두리 색 (rgba/hex)"
                    value={state.mealBattle?.panelBorderColor || ""}
                    onChange={(e) => updateMealBattle({ panelBorderColor: e.target.value })}
                  />
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    placeholder="게이지 트랙 테두리 색 (rgba/hex)"
                    value={state.mealBattle?.gaugeTrackBorderColor || ""}
                    onChange={(e) => updateMealBattle({ gaugeTrackBorderColor: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-[180px_120px_1fr] gap-2 items-center">
                  <select
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    value={state.mealBattle?.timerTheme || "default"}
                    onChange={(e) => updateMealBattle({ timerTheme: e.target.value as "default" | "neon" | "minimal" | "danger" })}
                  >
                    <option value="default">타이머 테마: 기본</option>
                    <option value="neon">타이머 테마: 네온</option>
                    <option value="minimal">타이머 테마: 미니멀</option>
                    <option value="danger">타이머 테마: 경고</option>
                  </select>
                  <input
                    className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                    type="number"
                    min={16}
                    max={120}
                    value={state.mealBattle?.timerSize || 36}
                    onChange={(e) =>
                      updateMealBattle({
                        timerSize: Math.max(16, Math.min(120, Number.parseInt(e.target.value || "36", 10) || 36)),
                      })
                    }
                  />
                  <div className="text-xs text-neutral-400">
                    타이머 크기·테마는 meal-match 오버레이에 실시간 반영됩니다. URL 테스트:{" "}
                    <code className="text-neutral-500">?timerTheme=neon</code>
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-neutral-900/50 p-3 space-y-2">
                  <div className="text-xs font-semibold text-neutral-200">게이지 연출</div>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                    {(
                      [
                        ["critical", "크리티컬 (90%·타이머 임박)"],
                        ["floatingScore", "플로팅 +점수"],
                        ["rankUp", "1등 왕관 (이름 옆)"],
                        ["timerTension", "타이머 긴장"],
                        ["gaugeMotion", "게이지 막대 연출"],
                      ] as const
                    ).map(([key, label]) => {
                      const ge = normalizeMealGaugeEffects(state.mealBattle?.gaugeEffects);
                      return (
                        <label key={key} className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={ge[key]}
                            onChange={(e) =>
                              updateMealBattle({
                                gaugeEffects: { ...ge, [key]: e.target.checked },
                              })
                            }
                          />
                          <span className="text-neutral-300">{label}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    오버레이 URL 테스트: <code className="text-neutral-400">?fx=none</code>,{" "}
                    <code className="text-neutral-400">?fx=critical,rank</code> (상태 설정보다 URL이 우선)
                  </p>
                  <a
                    href="/overlay/battle-effects-demo"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mr-3 inline-block text-[11px] font-medium text-violet-400 hover:text-violet-300"
                  >
                    대전 연출 통합 허브 ↗
                  </a>
                  <a
                    href="/overlay/meal-match/gauge-demo"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
                  >
                    식사 게이지 데모 ↗
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700 text-sm" onClick={resetMealMatchScores}>
                    점수 초기화
                  </button>
                  <span className="text-xs text-neutral-400">패널·게이지 테두리는 위 옵션을 켠 경우에만 오버레이에 표시됩니다.</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {state.members
                    .filter((m) => !isOperatingSettlementMember(m, state.memberPositions))
                    .map((m, idx) => {
                    const p = mealParticipants.find((x) => x.memberId === m.id);
                    const draft =
                      state.mealBattle?.memberGaugeColors?.[m.id] ||
                      MEAL_PARTICIPANT_COLORS[idx % MEAL_PARTICIPANT_COLORS.length];
                    const swatch = p?.color || draft;
                    const pickerVal = toColorPickerValue(typeof swatch === "string" ? swatch : "", "#60a5fa");
                    return (
                      <div
                        key={m.id}
                        className="rounded border border-white/10 bg-[#1f1f1f] px-3 py-2 flex items-center justify-between gap-2"
                      >
                        <span className="text-sm truncate min-w-0">{m.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <input
                            type="color"
                            value={pickerVal}
                            title="게이지 색"
                            onChange={(e) => {
                              const c = e.target.value;
                              if (p) patchMealParticipantColor(m.id, c);
                              else mergeMealMemberGaugeColor(m.id, c);
                            }}
                            className="h-8 w-10 rounded border border-white/20 bg-transparent cursor-pointer"
                          />
                          <label className="flex items-center gap-1 text-xs text-neutral-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={Boolean(p)}
                              onChange={(e) => toggleMealParticipant(m.id, e.target.checked)}
                            />
                            참가
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-[11px] text-amber-200/90">
                  후원 연동: 「식사대전 동기화」모드 + 참가자 「후원 연동 ON」이어야 게이지 점수에 반영됩니다. 연동 ON 시 참가 체크가 없으면 자동으로 참가 처리됩니다. 운영비 멤버는 참가할 수 없습니다.
                </p>
                <div className="space-y-2">
                  {mealParticipants.map((row) => (
                    <div key={row.memberId} className="rounded border border-white/10 bg-[#1f1f1f] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm">{row.name}</div>
                        <div className="text-xs text-neutral-400">
                          점수 {(Number(row.score) || 0).toLocaleString("ko-KR")} / 목표 {(Number(row.goal ?? state.mealBattle?.totalGoal ?? 100) || 100).toLocaleString("ko-KR")}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        <label className="flex items-center gap-1 text-xs text-neutral-400">
                          표시 이름
                          <input
                            className="w-28 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-neutral-100"
                            value={row.name || ""}
                            onChange={(e) =>
                              updateMealParticipant(row.memberId, (p) => ({
                                ...p,
                                name: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs text-neutral-400">
                          개인 목표
                          <input
                            className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-right text-neutral-100"
                            type="number"
                            min={1}
                            value={row.goal ?? state.mealBattle?.totalGoal ?? 100}
                            onChange={(e) =>
                              updateMealParticipant(row.memberId, (p) => ({
                                ...p,
                                goal: Math.max(1, Number.parseInt(e.target.value || "1", 10) || 1),
                              }))
                            }
                          />
                        </label>
                        <button
                          type="button"
                          className={`px-2 py-1 rounded text-xs font-medium ${
                            row.donationLinkActive ? "bg-amber-700 hover:bg-amber-600 text-white" : "bg-neutral-700 hover:bg-neutral-600 text-neutral-200"
                          }`}
                          onClick={() => toggleMealDonationLink(row.memberId)}
                        >
                          후원 연동 {row.donationLinkActive ? "ON" : "OFF"}
                        </button>
                        <input
                          type="color"
                          value={toColorPickerValue(row.color, "#60a5fa")}
                          onChange={(e) => patchMealParticipantColor(row.memberId, e.target.value)}
                          className="h-8 w-10 rounded border border-white/20 bg-transparent"
                        />
                        <button
                          className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs"
                          onClick={() => updateMealParticipant(row.memberId, (p) => ({ ...p, score: Math.max(0, p.score + 1) }))}
                        >
                          +1
                        </button>
                        <button
                          className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs"
                          onClick={() => updateMealParticipant(row.memberId, (p) => ({ ...p, score: Math.max(0, p.score + 10) }))}
                        >
                          +10
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span>오버레이 URL:</span>
                  <code className="text-neutral-300 break-all">
                    /overlay/meal-match?u={overlayUserId}&scalePct={getBattleScalePct()}&contentWidthPct=
                    {getBattleContentWidthPct()}
                  </code>
                  <button
                    type="button"
                    className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-meal-match" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                    onClick={() => {
                      const u = buildMealMatchLiveUrl();
                      void copyUrl(u, "dash-meal-match");
                    }}
                  >
                    {copiedId === "dash-meal-match" ? "복사됨!" : "URL 복사"}
                  </button>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                  <div>
                    <h4 className="text-sm font-semibold">후원 순위 오버레이</h4>
                    <p className="text-xs text-neutral-400 mt-1">
                      계좌·투네 후원을 합쳐 「후원 순위」 한 목록으로 표시합니다. 기본 오버레이는{" "}
                      <strong className="text-neutral-300">10위까지</strong>입니다(5명 이상이면 좌우 반 나눔).
                      11위 이후 전원은 같은 테마의{" "}
                      <strong className="text-neutral-300">세로형 전체 순위</strong> 오버레이를 OBS에 따로 추가하세요.
                      예전처럼 계좌/투네 두 칸이면{" "}
                      <code className="text-neutral-300">layout=dual</code>.
                    </p>
                  </div>
                  <label className="text-[11px] text-neutral-400 flex flex-col gap-1 rounded border border-white/10 bg-black/20 px-2 py-2">
                    <span>제목 문구</span>
                    <input
                      type="text"
                      value={state.donorRankingsTheme.titleText || ""}
                      onChange={(e) => updateDonorRankingsTheme({ titleText: e.target.value })}
                      className="h-8 w-full rounded border border-white/10 bg-neutral-900/80 px-2 text-sm"
                      placeholder="👑 웹후원 순위 👑"
                      maxLength={60}
                    />
                  </label>
                  <div className="rounded border border-white/10 bg-neutral-900/40 p-2 space-y-2">
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                      <label className="text-[11px] text-neutral-400">
                        표시 개수 (최대 {DONOR_RANKINGS_COMPACT_TOP_MAX}위)
                        <input
                          type="range"
                          min={1}
                          max={DONOR_RANKINGS_COMPACT_TOP_MAX}
                          value={Math.min(
                            DONOR_RANKINGS_COMPACT_TOP_MAX,
                            Math.max(1, Number(state.donorRankingsTheme.top) || DONOR_RANKINGS_COMPACT_TOP_MAX)
                          )}
                          onChange={(e) => updateDonorRankingsTheme({ top: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="text-xs text-neutral-300">{state.donorRankingsTheme.top}명</div>
                      </label>
                      <label className="text-[11px] text-neutral-400">
                        제목 폰트
                        <input
                          type="range"
                          min={14}
                          max={80}
                          value={state.donorRankingsTheme.titleSize}
                          onChange={(e) => updateDonorRankingsTheme({ titleSize: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="text-xs text-neutral-300">{state.donorRankingsTheme.titleSize}px</div>
                      </label>
                      <label className="text-[11px] text-neutral-400">
                        행 폰트
                        <input
                          type="range"
                          min={12}
                          max={64}
                          value={state.donorRankingsTheme.rowSize}
                          onChange={(e) => updateDonorRankingsTheme({ rowSize: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="text-xs text-neutral-300">{state.donorRankingsTheme.rowSize}px</div>
                      </label>
                      <label className="text-[11px] text-neutral-400">
                        순위 폰트
                        <input
                          type="range"
                          min={12}
                          max={72}
                          value={state.donorRankingsTheme.rankSize}
                          onChange={(e) => updateDonorRankingsTheme({ rankSize: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="text-xs text-neutral-300">{state.donorRankingsTheme.rankSize}px</div>
                      </label>
                      <label className="text-[11px] text-neutral-400">
                        오버레이 투명도(헤더·목록·행 배경 공통 · 중간 구간은 덜 어둡게)
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={state.donorRankingsTheme.overlayOpacity}
                          onChange={(e) => updateDonorRankingsTheme({ overlayOpacity: Number(e.target.value) })}
                          className="w-full"
                        />
                        <div className="text-xs text-neutral-300">{state.donorRankingsTheme.overlayOpacity}%</div>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                      {[
                        ["headerAccountBg", "순위 헤더(통합)"],
                        ["headerToonBg", "투네 헤더(dual만)"],
                        ["titleColor", "제목 색"],
                        ["rankColor", "순위 색"],
                        ["nameColor", "닉네임 색"],
                        ["amountColor", "금액 색"],
                      ].map(([key, label]) => (
                        <label key={key} className="text-[11px] text-neutral-400 flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-1">
                          <span>{label}</span>
                          <input
                            type="color"
                            value={toColorPickerValue(String((state.donorRankingsTheme as unknown as Record<string, unknown>)[key] ?? ""), "#ffffff")}
                            onChange={(e) => updateDonorRankingsTheme({ [key]: e.target.value } as Partial<AppState["donorRankingsTheme"]>)}
                            className="h-7 w-9 rounded border border-white/20 bg-transparent p-0.5"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {(
                        [
                          ["bg", "전체 배경", "#ffffff"],
                          ["panelBg", "패널 배경", "#fff8fc"],
                          ["borderColor", "테두리", "#ffd2e8"],
                          ["rowEvenBg", "짝수 행", "#ffffff"],
                          ["rowOddBg", "홀수 행", "#ffffff"],
                          ["outlineColor", "텍스트 외곽선", "#000000"],
                        ] as const
                      ).map(([key, label, fallback]) => (
                        <label key={key} className="text-[11px] text-neutral-400 flex items-center gap-2 rounded border border-white/10 bg-black/20 px-2 py-1">
                          <span className="w-24 shrink-0">{label}</span>
                          <input
                            type="color"
                            value={toColorPickerValue(
                              String((state.donorRankingsTheme as unknown as Record<string, unknown>)[key] ?? ""),
                              fallback
                            )}
                            onChange={(e) =>
                              updateDonorRankingsTheme({ [key]: e.target.value } as Partial<AppState["donorRankingsTheme"]>)
                            }
                            className="h-7 w-9 shrink-0 rounded border border-white/20 bg-transparent p-0.5"
                          />
                          <input
                            type="text"
                            value={String((state.donorRankingsTheme as unknown as Record<string, unknown>)[key] || "")}
                            onChange={(e) => updateDonorRankingsTheme({ [key]: e.target.value } as Partial<AppState["donorRankingsTheme"]>)}
                            className="h-7 min-w-0 flex-1 rounded border border-white/10 bg-neutral-900/80 px-2 text-xs"
                            placeholder="transparent / #fff / rgba(...)"
                          />
                        </label>
                      ))}
                    </div>
                    <label className="text-[11px] text-neutral-400 flex flex-col gap-1 rounded border border-white/10 bg-black/20 px-2 py-2">
                      <span>텍스트 외곽선 두께(px)</span>
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0}
                          max={DONOR_RANKINGS_OUTLINE_MAX_PX}
                          step={0.25}
                          value={state.donorRankingsTheme.outlineWidth}
                          onChange={(e) => updateDonorRankingsTheme({ outlineWidth: Number(e.target.value) })}
                          className="flex-1"
                        />
                        <input
                          type="number"
                          min={0}
                          max={DONOR_RANKINGS_OUTLINE_MAX_PX}
                          step={0.25}
                          value={state.donorRankingsTheme.outlineWidth}
                          onChange={(e) =>
                            updateDonorRankingsTheme({
                              outlineWidth: Math.max(
                                0,
                                Math.min(DONOR_RANKINGS_OUTLINE_MAX_PX, parseFloat(e.target.value || "0") || 0)
                              ),
                            })
                          }
                          className="w-16 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs text-right"
                        />
                      </div>
                      <span className="text-[10px] text-neutral-500">0 = 없음 · 기본 4 (두꺼운 검정 외곽선)</span>
                    </label>
                    <div className="text-[11px] text-neutral-500">
                      반투명/rgba 값이 필요하면 아래 URL 파라미터로 덮어쓸 수 있습니다. 기본은 관리자 저장값이 사용됩니다.
                    </div>
                    <div className="rounded border border-white/10 bg-black/25 px-2 py-2 space-y-2">
                      <div className="text-[11px] text-neutral-400">기본 테마 5종 (원클릭 적용)</div>
                      <div className="flex flex-wrap gap-1.5">
                        {BUILT_IN_DONOR_RANKINGS_PRESETS.map((preset) => {
                          const active = state.donorRankingsPresetId === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              title={preset.name}
                              className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                                active
                                  ? "bg-emerald-700 border-emerald-500 text-white"
                                  : "bg-neutral-800/90 border-white/10 text-neutral-200 hover:bg-neutral-700"
                              }`}
                              onClick={() => applyDonorRankingsPreset(preset.id)}
                            >
                              {preset.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        className="h-8 w-56 rounded border border-white/10 bg-neutral-900/80 px-2 text-xs"
                        value={donorRankingPresetName}
                        onChange={(e) => setDonorRankingPresetName(e.target.value)}
                        placeholder="프리셋 이름 (예: 방송 기본)"
                      />
                      <button type="button" className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs" onClick={saveDonorRankingsPreset}>
                        현재값 프리셋 저장
                      </button>
                    </div>
                    <div className="space-y-1">
                      {(state.donorRankingsPresets || []).length === 0 ? (
                        <p className="text-[11px] text-neutral-500">저장된 프리셋이 없습니다.</p>
                      ) : (
                        (state.donorRankingsPresets || []).map((preset) => {
                          const builtIn = isBuiltInDonorRankingsPresetId(preset.id);
                          return (
                            <div key={preset.id} className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2 py-1">
                              <span className="text-xs text-neutral-200 truncate">
                                {preset.name}
                                {builtIn ? <span className="ml-1 text-[10px] text-neutral-500">(기본)</span> : null}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  className={`px-2 py-0.5 rounded text-xs ${state.donorRankingsPresetId === preset.id ? "bg-emerald-700" : "bg-neutral-700 hover:bg-neutral-600"}`}
                                  onClick={() => applyDonorRankingsPreset(preset.id)}
                                >
                                  {state.donorRankingsPresetId === preset.id ? "적용중" : "적용"}
                                </button>
                                {!builtIn ? (
                                  <button
                                    type="button"
                                    className="px-2 py-0.5 rounded text-xs bg-red-900/80 hover:bg-red-800"
                                    onClick={() => deleteDonorRankingsPreset(preset.id)}
                                  >
                                    삭제
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                    <span>OBS URL (짧게):</span>
                    <code className="text-neutral-300 break-all">
                      /overlay/donor-rankings?u={overlayUserId}&host=obs
                    </code>
                    <button
                      type="button"
                      className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-donor-rankings" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                      onClick={() => {
                        const u = buildDonorRankingsUrl();
                        void copyUrl(u, "dash-donor-rankings");
                      }}
                    >
                      {copiedId === "dash-donor-rankings" ? "복사됨!" : "URL 복사"}
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                    <span>전체 순위 (세로):</span>
                    <code className="text-neutral-300 break-all">
                      /overlay/donor-rankings/full?u={overlayUserId}&host=obs
                    </code>
                    <button
                      type="button"
                      className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-donor-rankings-full" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                      onClick={() => {
                        const u = buildDonorRankingsUrl({ full: true });
                        void copyUrl(u, "dash-donor-rankings-full");
                      }}
                    >
                      {copiedId === "dash-donor-rankings-full" ? "복사됨!" : "URL 복사"}
                    </button>
                  </div>
                  <div className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                    <span>테스트 URL:</span>
                    <code className="text-neutral-300 break-all">
                      /overlay/donor-rankings?u={overlayUserId}&host=obs&test=true
                    </code>
                    <button
                      type="button"
                      className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-donor-rankings-test" ? "bg-emerald-600" : "bg-amber-800/90 hover:bg-amber-700"}`}
                      onClick={() => {
                        const u = buildDonorRankingsUrl({ test: true });
                        void copyUrl(u, "dash-donor-rankings-test");
                      }}
                    >
                      {copiedId === "dash-donor-rankings-test" ? "복사됨!" : "테스트 URL 복사"}
                    </button>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 px-3 py-2">
                    <div className="text-xs text-neutral-300 mb-1">
                      후원 리스트 패널 투명도(헤더·목록·행 공통 · 중간 구간은 덜 어둡게)
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={state.donorRankingsTheme.overlayOpacity}
                        onChange={(e) => updateDonorRankingsTheme({ overlayOpacity: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <div className="w-14 text-right text-xs text-neutral-200">{state.donorRankingsTheme.overlayOpacity}%</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                    <span>OBS 크기(%)</span>
                    <input
                      className="w-20 rounded bg-neutral-900/80 border border-white/10 px-2 py-1 text-sm text-right"
                      value={String(getDonorRankingsZoomPct())}
                      onChange={(e) => {
                        const n = parseInt(e.target.value.replace(/[^\d]/g, "") || "100", 10);
                        updateDonorRankingsTheme({
                          zoomPct: Math.max(30, Math.min(300, Number.isFinite(n) ? n : 100)),
                        });
                      }}
                    />
                    <span className="text-neutral-500">30~300 (서버 저장 · URL에 넣지 않음)</span>
                  </div>
                  <div className="text-[11px] text-emerald-200/90 rounded border border-emerald-500/25 bg-emerald-950/30 px-3 py-2 leading-relaxed">
                    OBS 브라우저 소스는 <code className="text-emerald-100">?u=계정&amp;host=obs</code>만 쓰면 됩니다.
                    제목·색·크기·투명도·줌 등 모든 옵션은 이 페이지에서 저장되며 오버레이가 서버에서 불러옵니다.
                  </div>
                  <p className="text-[11px] text-neutral-500">
                    배경 GIF·본문 이미지는{" "}
                    <button
                      type="button"
                      className="text-sky-400 underline"
                      onClick={() => moveToSection("overlay", "overlay-settings")}
                    >
                      오버레이 설정
                    </button>
                    {" "}탭 「오버레이 배경 · 본문 이미지」에서 설정합니다.
                  </p>
                </div>
              </div>
              {!sigSalesModalOpen ? (
                <SigSalesCompactCard
                  sigCount={sigInventoryCount}
                  activeCount={sigActiveCount}
                  rollingCount={rollingItemsForAdmin.length}
                  roulettePhase={rouletteServerStatus.phase}
                  uploadBusy={sigBulkReuploadBusy}
                  onOpen={openSigSalesModal}
                />
              ) : null}
              <SigSalesHybridModal
                open={sigSalesModalOpen}
                activeTab={sigSalesModalTab}
                onTabChange={setSigSalesModalTab}
                onClose={() => setSigSalesModalOpen(false)}
                newTabHref="/admin/sig-sales"
              >
                {sigSalesModalTab === "wheel" ? (
              <div className="rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="rounded-xl border-2 border-sky-400/50 bg-sky-500/15 p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-base font-bold text-sky-100">강제 5개 판매 (수동 지정 · 회전 없음)</h3>
                    <Link
                      href="/admin/sig-sales"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded bg-yellow-500 px-2 py-1 text-[11px] font-bold text-black hover:bg-yellow-400"
                    >
                      상세 수동 UI 열기
                    </Link>
                  </div>
                  <p className="text-[11px] leading-snug text-sky-100/90">
                    시그 이름으로 5개를 고른 뒤 「강제 5개 판매 실행」을 누르면 결과 고정 + 판매 완료(기존 판매 완료 이미지)까지 처리됩니다.
                    한방 금액은 자동 합산({forcedSlotsAutoOneShotPrice.toLocaleString("ko-KR")}원)됩니다.
                  </p>
                  <div className="grid gap-2 sm:grid-cols-5">
                    {Array.from({ length: 5 }, (_, idx) => (
                      <label key={`forced-slot-${idx}`} className="flex flex-col text-[11px] text-neutral-300">
                        {idx + 1}번째 시그
                        <select
                          className="mt-1 rounded border border-white/15 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100"
                          value={rouletteForcedSlotIds[idx] || ""}
                          onChange={(e) =>
                            setRouletteForcedSlotIds((prev) => {
                              const next = [...prev];
                              next[idx] = e.target.value;
                              return next;
                            })
                          }
                        >
                          <option value="">선택</option>
                          {forcedSigPickOptions.map((item) => (
                            <option key={`forced-pick-${idx}-${item.id}`} value={item.id}>
                              {item.name} ({Math.max(0, Number(item.price || 0)).toLocaleString("ko-KR")}원)
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col text-[11px] text-neutral-400">
                      한방 시그 이미지 URL(선택)
                      <input
                        type="text"
                        className="mt-0.5 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                        placeholder="/uploads/sigs/finalent/....gif"
                        value={rouletteForcedOneShotImageUrl}
                        onChange={(e) => setRouletteForcedOneShotImageUrl(e.target.value)}
                      />
                      <input
                        type="file"
                        accept="image/gif,image/png,image/jpeg,image/webp,.gif,.png,.jpg,.jpeg,.webp"
                        className="mt-1 text-[11px] text-neutral-300 file:mr-2 file:rounded file:border-0 file:bg-indigo-700 file:px-2 file:py-1 file:text-xs file:text-white hover:file:bg-indigo-600"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          if (!file) return;
                          uploadSigImage(ONE_SHOT_SIG_ID, file);
                          e.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <label className="flex flex-col text-[11px] text-neutral-400">
                      또는 시그 ID 5개 (고급 · 쉼표/공백)
                      <input
                        type="text"
                        className="mt-0.5 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                        placeholder="sig_a sig_b sig_c sig_d sig_e"
                        value={rouletteForcedSigIdsInput}
                        onChange={(e) => setRouletteForcedSigIdsInput(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={rouletteSpinBusy || !forcedSlotsReady}
                      className="rounded bg-sky-600 px-4 py-2 text-sm font-bold text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void spinSigRoulette({ forceFiveOnly: true });
                      }}
                    >
                      {rouletteSpinBusy ? "처리 중…" : "강제 5개 판매 실행"}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/20 px-2 py-1.5 text-xs text-neutral-200 hover:bg-white/10"
                      onClick={() => {
                        window.open(
                          `/overlay/sig-sales-forced?u=${encodeURIComponent(overlayUserId)}`,
                          "_blank",
                          "noopener,noreferrer"
                        );
                      }}
                    >
                      강제 오버레이 미리보기
                    </button>
                    {!forcedSlotsReady ? (
                      <span className="text-[11px] text-amber-200">5칸 모두 서로 다른 시그를 선택해야 실행됩니다.</span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">시그 판매 및 회전판 추첨 관리</h3>
                    <p className="text-xs text-neutral-400">
                      회전판 당첨은 서버(<code className="text-neutral-300">/api/roulette/spin</code>)에서만 결정되어 Redis에 저장됩니다. 판매 ±는 기존과 동일하게 전체 상태로 동기화되며 후원(donors) 병합 로직과 충돌하지 않습니다.
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-amber-200/90">
                      아래 숫자는 <strong className="text-amber-100">회전 횟수이며 곧 당첨 시그 개수</strong>입니다(회전 1회당 시그 1개). 예: 5면 휠이 5번 돌아가고 시그 5개가 나옵니다. 금액 칸을 비우면 해당 회차는{" "}
                      <strong className="text-amber-100">전체 풀에서 무작위</strong>이며, 같은 버튼 한 번 안에서는{" "}
                      <strong className="text-amber-100">시그가 서로 중복되지 않습니다</strong>. 서로 다른 시그 수가 부족하면 오류가 납니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col text-[11px] text-neutral-400">
                      회전 수 (= 시그 당첨 수)
                      <input
                        type="number"
                        min={1}
                        max={999}
                        className="mt-0.5 w-24 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                        value={rouletteSpinCount}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setRouletteSpinCount(raw);
                          const nn = Math.max(1, Math.min(999, parseInt(String(raw || "5"), 10) || 5));
                          const capRows = Math.min(nn, ROULETTE_ROUND_UI_CAP);
                          setRoulettePriceRanges((prev) => {
                            const next = prev.slice(0, capRows);
                            while (next.length < capRows) next.push({ min: "", max: "" });
                            return next;
                          });
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={rouletteSpinBusy}
                      className="rounded bg-fuchsia-700 px-3 py-2 text-sm font-semibold hover:bg-fuchsia-600 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => {
                        void spinSigRoulette();
                      }}
                    >
                      {rouletteSpinBusy ? "회전 요청 중…" : "회전판 돌리기"}
                    </button>
                  </div>
                </div>
                {rouletteActionMessage ? (
                  <div className="rounded border border-fuchsia-500/35 bg-fuchsia-950/40 px-3 py-2 text-xs leading-snug text-fuchsia-50/95">
                    {rouletteActionMessage}
                  </div>
                ) : null}
                {(() => {
                  const n = Math.max(1, Math.min(999, parseInt(String(rouletteSpinCount || "5"), 10) || 5));
                  const rows = Math.min(n, ROULETTE_ROUND_UI_CAP);
                  return (
                    <div className="rounded border border-white/10 bg-black/30 p-2">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-neutral-400">
                        <span className="font-medium text-neutral-300">시그별 최소/최대 금액 (원)</span>
                        <span>
                          나올 시그 <span className="text-fuchsia-300">{n}</span>개 중 앞{" "}
                          <span className="text-fuchsia-300">{rows}</span>개까지 개별 설정 · 빈칸=해당 줄은 전체 랜덤
                          {n > ROULETTE_ROUND_UI_CAP ? (
                            <span className="text-amber-300/90">
                              {" "}
                              ({ROULETTE_ROUND_UI_CAP + 1}번째~는 {ROULETTE_ROUND_UI_CAP}번째와 동일 조건)
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                        {Array.from({ length: rows }, (_, i) => (
                          <div key={`roulette-tier-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="w-14 shrink-0 text-neutral-500">{i + 1}번째</span>
                            <input
                              className="w-28 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                              placeholder="최소(빈칸=없음)"
                              inputMode="numeric"
                              value={roulettePriceRanges[i]?.min ?? ""}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d]/g, "");
                                setRoulettePriceRanges((prev) => {
                                  const cap = Math.min(
                                    Math.max(1, Math.min(999, parseInt(String(rouletteSpinCount || "5"), 10) || 5)),
                                    ROULETTE_ROUND_UI_CAP
                                  );
                                  const next = prev.slice(0, cap);
                                  while (next.length < cap) next.push({ min: "", max: "" });
                                  next[i] = { ...(next[i] || { min: "", max: "" }), min: v };
                                  return next;
                                });
                              }}
                            />
                            <span className="text-neutral-500">~</span>
                            <input
                              className="w-28 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                              placeholder="최대(빈칸=없음)"
                              inputMode="numeric"
                              value={roulettePriceRanges[i]?.max ?? ""}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d]/g, "");
                                setRoulettePriceRanges((prev) => {
                                  const cap = Math.min(
                                    Math.max(1, Math.min(999, parseInt(String(rouletteSpinCount || "5"), 10) || 5)),
                                    ROULETTE_ROUND_UI_CAP
                                  );
                                  const next = prev.slice(0, cap);
                                  while (next.length < cap) next.push({ min: "", max: "" });
                                  next[i] = { ...(next[i] || { min: "", max: "" }), max: v };
                                  return next;
                                });
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}
                <div className="rounded-xl border border-sky-300/30 bg-sky-500/5 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-sky-200">회전판 빠른 점검</div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
                      <span className="rounded bg-white/10 px-2 py-1">phase: {rouletteServerStatus.phase}</span>
                      <span className="rounded bg-white/10 px-2 py-1">
                        rolling: {rouletteServerStatus.isRolling ? "예" : "아니오"}
                      </span>
                      <span className="rounded bg-white/10 px-2 py-1">당첨 시그: {rouletteServerStatus.nWin}개</span>
                      <span className="rounded bg-white/10 px-2 py-1">
                        한방(데이터): {rouletteServerStatus.hasOneShot ? "있음" : "없음"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-neutral-400">
                    <span className="rounded bg-black/25 px-2 py-1 font-mono text-neutral-200">
                      session: {rouletteServerStatus.sessionShort}
                    </span>
                    <span className="rounded bg-black/25 px-2 py-1">
                      시작 시각: {rouletteServerStatus.startedLabel}
                    </span>
                  </div>
                  <p className="text-[11px] leading-snug text-sky-100/90">
                    방송 오버레이는 당첨 시그만 한 줄로 표시합니다(합산 한방 카드 없음). 아래쪽 인벤 롤링 보드를 같이 쓰려면 URL에{" "}
                    <code className="rounded bg-black/30 px-1 text-emerald-200">sigBoardWithResults=1</code> 를 붙이세요.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={rouletteResetBusy}
                      className="rounded bg-amber-800 px-2 py-1 text-xs font-semibold text-amber-50 hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={() => {
                        void resetRouletteIdle();
                      }}
                    >
                      {rouletteResetBusy ? "초기화 중…" : "회전판 초기화 (IDLE)"}
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-1 text-xs ${copiedId === "dash-sig-quick-all" ? "bg-emerald-600" : "bg-sky-700 hover:bg-sky-600"}`}
                      onClick={() => {
                        if (!rouletteQuickSummaryText.trim()) return;
                        void copyUrl(rouletteQuickSummaryText, "dash-sig-quick-all");
                      }}
                    >
                      {copiedId === "dash-sig-quick-all" ? "복사됨!" : "점검 URL 전체 복사"}
                    </button>
                    <button type="button" className="rounded bg-[#6366f1] px-2 py-1 text-xs hover:bg-[#4f46e5]" onClick={() => window.open(rouletteQuickUrls.progressPath, "_blank", "noopener,noreferrer")}>
                      통합 열기
                    </button>
                  </div>
                  <p className="text-[11px] text-neutral-400">
                    방송·점검은 <span className="text-neutral-200">통합 오버레이</span> URL만 사용하세요.
                    {selectedMemberId ? (
                      <>
                        {" "}(멤버 필터는 아래 드롭다운으로 선택된 상태가 URL에 포함됩니다)
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                  <span>통합 오버레이 URL</span>
                  <span className="text-neutral-500">(메뉴 수 · 멤버)</span>
                  <span>메뉴 수</span>
                  <input
                    className="w-16 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs"
                    value={sigSalesMenuCount}
                    onChange={(e) => {
                      const n = clampSigSalesMenuCount(e.target.value);
                      const nextText = String(n);
                      setSigSalesMenuCount(nextText);
                      setState((prev) => {
                        const prevCount = clampSigSalesMenuCount(prev.rouletteState?.menuCount);
                        if (prevCount === n) return prev;
                        const next = {
                          ...prev,
                          rouletteState: {
                            ...prev.rouletteState,
                            menuCount: n,
                          },
                        };
                        persistState(next);
                        return next;
                      });
                    }}
                  />
                  <label className="ml-2 inline-flex items-center gap-1 rounded border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-neutral-300">
                    <input
                      type="checkbox"
                      checked={state.rouletteState?.menuFillFromAllActive === true}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setState((prev) => {
                          const prevVal = prev.rouletteState?.menuFillFromAllActive === true;
                          if (prevVal === checked) return prev;
                          const next = {
                            ...prev,
                            rouletteState: {
                              ...prev.rouletteState,
                              menuFillFromAllActive: checked,
                            },
                          };
                          persistState(next);
                          return next;
                        });
                      }}
                    />
                    전체 활성 시그 보충
                  </label>
                  <div className="basis-full rounded border border-white/10 bg-black/20 px-3 py-2 max-w-xl">
                    <div className="text-xs text-neutral-300 mb-1">확정 결과 카드 크기 (%)</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={50}
                        max={100}
                        step={1}
                        value={clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct)}
                        onChange={(e) => {
                          const n = clampSigSalesResultScalePct(Number(e.target.value));
                          setState((prev) => {
                            const prevN = clampSigSalesResultScalePct(prev.rouletteState?.sigResultScalePct);
                            if (prevN === n) return prev;
                            const next: AppState = {
                              ...prev,
                              rouletteState: {
                                ...prev.rouletteState,
                                sigResultScalePct: n,
                              },
                            };
                            persistState(next);
                            return next;
                          });
                        }}
                        className="flex-1 min-w-[120px]"
                      />
                      <div className="w-14 text-right text-xs text-neutral-200">
                        {clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct)}%
                      </div>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral-500 leading-snug">
                      OBS에서 결과만 과하게 크면 슬라이더를 내리세요. 저장값은 URL 없이도 오버레이에 적용되며, 필요 시{" "}
                      <code className="rounded bg-black/30 px-1 text-neutral-400">sigResultScalePct</code>로 한 번 더 덮어쓸 수
                      있습니다.
                    </p>
                  </div>
                  <span className="text-neutral-500">멤버</span>
                  <select
                    className="rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs"
                    value={selectedMemberId}
                    onChange={(e) => setSelectedMemberId(e.target.value)}
                  >
                    <option value="">전체(필터 없음)</option>
                    {(state.members || []).map((m) => (
                      <option key={`sig-progress-member-${m.id}`} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <code className="text-neutral-300 break-all">
                    /overlay/sig-sales?u={overlayUserId}&scalePct={getBattleScalePct()}&wheelScalePct=85&menuCount={getSigSalesMenuCount()}
                    {selectedMemberId ? `&memberId=${selectedMemberId}` : ""}&sigResultScalePct=
                    {clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct)}
                  </code>
                  <code className="text-sky-300 break-all">
                    /overlay/sig-sales-forced?u={overlayUserId}&scalePct={getBattleScalePct()}&wheelScalePct=85&menuCount={getSigSalesMenuCount()}
                    {selectedMemberId ? `&memberId=${selectedMemberId}` : ""}&sigResultScalePct=
                    {clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct)}
                  </code>
                  <button
                    type="button"
                    className={`rounded px-2 py-1 text-xs shrink-0 ${copiedId === "dash-sig-sales" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                    onClick={() => {
                      const rs = clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct);
                      const u = `${window.location.origin}/overlay/sig-sales?u=${overlayUserId}&scalePct=${getBattleScalePct()}&wheelScalePct=85&menuCount=${getSigSalesMenuCount()}${selectedMemberId ? `&memberId=${encodeURIComponent(selectedMemberId)}` : ""}&sigResultScalePct=${rs}`;
                      void copyUrl(u, "dash-sig-sales");
                    }}
                  >
                    {copiedId === "dash-sig-sales" ? "복사됨!" : "URL 복사"}
                  </button>
                  <button
                    type="button"
                    className="rounded bg-[#6366f1] px-2 py-1 text-xs hover:bg-[#4f46e5]"
                    onClick={() => {
                      const rs = clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct);
                      window.open(
                        `/overlay/sig-sales?u=${overlayUserId}&scalePct=${getBattleScalePct()}&wheelScalePct=85&menuCount=${getSigSalesMenuCount()}${selectedMemberId ? `&memberId=${encodeURIComponent(selectedMemberId)}` : ""}&sigResultScalePct=${rs}`,
                        "_blank",
                        "noopener,noreferrer"
                      );
                    }}
                  >
                    미리보기 열기
                  </button>
                  <button
                    type="button"
                    className="rounded bg-sky-700 px-2 py-1 text-xs hover:bg-sky-600"
                    onClick={() => {
                      const rs = clampSigSalesResultScalePct(state.rouletteState?.sigResultScalePct);
                      window.open(
                        `/overlay/sig-sales-forced?u=${overlayUserId}&scalePct=${getBattleScalePct()}&wheelScalePct=85&menuCount=${getSigSalesMenuCount()}${selectedMemberId ? `&memberId=${encodeURIComponent(selectedMemberId)}` : ""}&sigResultScalePct=${rs}`,
                        "_blank",
                        "noopener,noreferrer"
                      );
                    }}
                  >
                    강제 오버레이 열기
                  </button>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                  <p className="text-xs text-neutral-300">
                    회전판 실제 미리보기는 <code>/admin/sig-sales</code>에서 확인하고, 방송 장면에서는 통합 오버레이(<code>/overlay/sig-sales</code>) 한 개만 사용하세요.
                  </p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="text-xs font-semibold text-neutral-300 mb-2">판매 활성 시그 (빠른 조절)</div>
                  <div className="flex flex-col gap-2">
                    {(state.sigInventory || [])
                      .filter((x) => x.isActive)
                      .map((item) => (
                        <div key={`active-${item.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-neutral-900/50 px-2 py-1">
                          <span className="text-sm font-medium truncate max-w-[200px]">{item.name}</span>
                          {item.maxCount <= 1 ? (
                            <span className="text-xs text-neutral-400">{item.soldCount >= 1 ? "완판" : "판매대기"}</span>
                          ) : null}
                          <div className="flex gap-1">
                            <button type="button" className="rounded bg-red-900/70 px-2 py-0.5 text-xs" onClick={() => adjustSigSoldCount(item.id, -1)}>
                              취소 -1
                            </button>
                            <button type="button" className="rounded bg-emerald-800 px-2 py-0.5 text-xs" onClick={() => adjustSigSoldCount(item.id, 1)}>
                              판매 +1
                            </button>
                          </div>
                        </div>
                      ))}
                    {(state.sigInventory || []).every((x) => !x.isActive) ? (
                      <p className="text-xs text-neutral-500">판매 활성 시그가 없습니다. 아래 목록에서 &quot;판매 활성&quot;을 켜 주세요.</p>
                    ) : null}
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-neutral-300">시그판매 제외 설정 (그리드/회전판 공통)</div>
                    <button
                      type="button"
                      className="rounded bg-neutral-700 px-2 py-0.5 text-[11px] hover:bg-neutral-600"
                      onClick={() => {
                        setState((prev: AppState) => {
                          const next: AppState = { ...prev, sigSalesExcludedIds: [] };
                          persistState(next);
                          return next;
                        });
                      }}
                    >
                      전체 해제
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                    {(state.sigInventory || []).map((item) => {
                      const excluded = (state.sigSalesExcludedIds || []).includes(item.id);
                      return (
                        <label
                          key={`exclude-sig-sales-${item.id}`}
                          className={`flex cursor-pointer items-center justify-between rounded border px-2 py-1 text-xs ${
                            excluded ? "border-rose-500/40 bg-rose-950/35 text-rose-100" : "border-white/10 bg-neutral-900/40 text-neutral-200"
                          }`}
                        >
                          <span className="truncate pr-2">{item.name}</span>
                          <input
                            type="checkbox"
                            checked={excluded}
                            onChange={(e) => toggleSigSalesExcluded(item.id, e.target.checked)}
                            className="h-4 w-4"
                          />
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-neutral-500">
                    체크된 시그는 <code>/overlay/sig-sales</code> 화면 표시와 <code>/api/roulette/spin</code> 추첨 후보에서 제외됩니다.
                  </p>
                </div>
              </div>
                ) : null}
                {sigSalesModalTab === "rolling" ? (
              <div className="rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold">시그 롤링</h3>
                    <p className="text-xs text-neutral-400">
                      GIF는 1회 재생과 무관하게 표시 시간 후{" "}
                      <strong className="text-sky-200/90">다음 이미지로 즉시 교체</strong>됩니다. OBS(
                      <code className="text-neutral-500">host=obs</code>)도 동일합니다. 한 화면에서{" "}
                      <strong className="text-amber-200/90">좌=고액(30만 원 이상)</strong> /{" "}
                      <strong className="text-sky-200/90">우=저액(30만 원 미만)</strong>으로 나눠 각각 롤링합니다.
                    </p>
                  </div>
                  <div className="flex flex-col items-stretch gap-2 sm:items-end">
                    <div className="text-xs text-neutral-400 flex flex-wrap items-center justify-end gap-2">
                      <span>오버레이 URL:</span>
                      <code className="text-neutral-300 break-all text-left">
                        /overlay/sig-rolling?u={overlayUserId}&host=obs
                      </code>
                      <button
                        type="button"
                        className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-sig-rolling" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                        onClick={() => {
                          const u = `${window.location.origin}/overlay/sig-rolling?u=${overlayUserId}&host=obs`;
                          void copyUrl(u, "dash-sig-rolling");
                        }}
                      >
                        {copiedId === "dash-sig-rolling" ? "복사됨!" : "URL 복사"}
                      </button>
                    </div>
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs self-end"
                      onClick={() =>
                        window.open(
                          `/overlay/sig-rolling?u=${overlayUserId}&host=obs`,
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                    >
                      오버레이 열기
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <label className={`cursor-pointer rounded bg-sky-800 px-3 py-1.5 text-sm hover:bg-sky-700 ${sigBulkReuploadBusy ? "pointer-events-none opacity-50" : ""}`}>
                    파일 선택 (여러 장)
                    <input
                      type="file"
                      accept="image/gif,image/png,image/jpeg,image/webp"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        const rawCount = e.target.files?.length ?? 0;
                        if (rawCount > 0) {
                          flushSync(() => {
                            setSigUploadProgress({
                              current: 0,
                              total: rawCount,
                              label: `${rawCount}개 파일 선택됨 — 목록 확인 중…`,
                            });
                          });
                        }
                        void addSigRollingFromFiles(e.target.files);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <label className={`cursor-pointer rounded bg-violet-800 px-3 py-1.5 text-sm hover:bg-violet-700 ${sigBulkReuploadBusy ? "pointer-events-none opacity-50" : ""}`}>
                    폴더 선택
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                      className="hidden"
                      onChange={(e) => {
                        const rawCount = e.target.files?.length ?? 0;
                        if (rawCount > 0) {
                          flushSync(() => {
                            setSigUploadProgress({
                              current: 0,
                              total: rawCount,
                              label: `${rawCount}개 파일 선택됨 — 목록 확인 중…`,
                            });
                          });
                        }
                        void addSigRollingFromFiles(e.target.files);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="rounded bg-emerald-800 px-3 py-1.5 text-sm hover:bg-emerald-700 disabled:opacity-50"
                    disabled={legacyOnlyRollingCount <= 0}
                    onClick={convertAllLegacyRollingToSigInventory}
                  >
                    판매 시그로 전체 치환{legacyOnlyRollingCount > 0 ? ` (${legacyOnlyRollingCount})` : ""}
                  </button>
                  <button
                    type="button"
                    className="rounded bg-amber-900/80 px-3 py-1.5 text-sm hover:bg-amber-800"
                    title="같은 이미지 URL은 위쪽 항목만 유지"
                    onClick={dedupeSigRollingByImageUrl}
                  >
                    롤링 중복 제거(URL)
                  </button>
                </div>
                {sigUploadProgress ? (
                  <SigUploadProgressPanel progress={sigUploadProgress} busy={sigBulkReuploadBusy} />
                ) : null}
                {sigRollingUploadMessage ? (
                  <p className="text-xs text-emerald-300/95 whitespace-pre-wrap rounded border border-emerald-500/30 bg-emerald-950/30 px-2 py-1.5">
                    {sigRollingUploadMessage}
                  </p>
                ) : null}
                <div className="max-w-xl space-y-2 rounded border border-white/10 bg-black/20 p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block text-xs text-neutral-300">
                      이미지 표시 시간
                      <div className="mt-1 flex items-center gap-1.5">
                        <button
                          type="button"
                          className="h-8 w-8 rounded bg-neutral-700 text-sm hover:bg-neutral-600"
                          title="1초 줄이기"
                          onClick={() =>
                            setSigRollingStaticHoldSeconds(
                              Math.round(normalizeSigRolling(state.sigRolling).staticHoldMs / 1000) - 1
                            )
                          }
                        >
                          −
                        </button>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          step={1}
                          className="w-20 rounded border border-white/10 bg-neutral-950/80 px-2 py-1.5 text-center text-sm"
                          value={Math.max(
                            1,
                            Math.round(normalizeSigRolling(state.sigRolling).staticHoldMs / 1000)
                          )}
                          onChange={(e) => setSigRollingStaticHoldSeconds(parseInt(e.target.value, 10) || 5)}
                        />
                        <span className="text-sm text-neutral-300">초</span>
                        <button
                          type="button"
                          className="h-8 w-8 rounded bg-neutral-700 text-sm hover:bg-neutral-600"
                          title="1초 늘리기"
                          onClick={() =>
                            setSigRollingStaticHoldSeconds(
                              Math.round(normalizeSigRolling(state.sigRolling).staticHoldMs / 1000) + 1
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                    </label>
                    <div className="flex flex-wrap gap-1.5 pb-0.5">
                      {[2, 3, 5, 8, 10, 15, 30].map((sec) => {
                        const currentSec = Math.max(
                          1,
                          Math.round(normalizeSigRolling(state.sigRolling).staticHoldMs / 1000)
                        );
                        const active = currentSec === sec;
                        return (
                          <button
                            key={sec}
                            type="button"
                            className={`rounded px-2.5 py-1.5 text-xs ${
                              active
                                ? "bg-sky-600 text-white"
                                : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
                            }`}
                            onClick={() => setSigRollingStaticHoldSeconds(sec)}
                          >
                            {sec}초
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <p className="text-[10px] text-neutral-500">
                    설정한 시간만큼 보여 준 뒤 다음 이미지로 바뀝니다. GIF도 동일합니다(재생 길이와 무관).
                  </p>
                </div>
                <details open className="rounded border border-white/15 bg-black/25">
                  <summary className="cursor-pointer list-none px-2 py-2 text-xs font-medium text-neutral-300 hover:bg-white/5 [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex flex-wrap items-center gap-2">
                      등록된 이미지 목록
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-neutral-400">
                        {rollingItemsForAdmin.length}개
                      </span>
                      <span className="text-[11px] text-neutral-500">클릭하여 접기·펼치기</span>
                    </span>
                  </summary>
                  <ul className="space-y-2 border-t border-white/10 p-2 pt-3">
                    {rollingItemsForAdmin.length === 0 ? (
                      <li className="text-xs text-neutral-500">등록된 이미지가 없습니다.</li>
                    ) : (
                      rollingItemsForAdmin.map((it, pos, arr) => {
                        const inInventory = (state.sigInventory || []).some((x) => x.id === it.id);
                        return (
                        <li
                          key={it.id}
                          className="flex flex-wrap items-center gap-2 rounded border border-white/10 bg-black/30 px-2 py-2"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={it.url} alt="" className="h-14 w-14 shrink-0 rounded object-cover" />
                          <input
                            type="text"
                            className="min-w-[120px] flex-1 rounded border border-white/10 bg-neutral-950/80 px-2 py-1 text-sm"
                            value={it.label}
                            placeholder="표시 이름"
                            onChange={(e) => {
                              renameSigRollingItem(it.id, e.target.value);
                            }}
                          />
                          {!inInventory ? (
                            <button
                              type="button"
                              className="rounded bg-sky-800 px-2 py-1 text-xs hover:bg-sky-700"
                              onClick={() => convertLegacyRollingToSigInventory(it.id)}
                            >
                              판매 시그로 치환
                            </button>
                          ) : null}
                          <label className="rounded bg-violet-800 px-2 py-1 text-xs hover:bg-violet-700 cursor-pointer">
                            이미지 교체
                            <input
                              type="file"
                              accept="image/gif,image/png,image/jpeg,image/webp"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0] || null;
                                replaceSigRollingItemImage(it.id, file);
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <div className="flex gap-1">
                            <button
                              type="button"
                              className="rounded bg-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
                              disabled={pos === 0}
                              onClick={() => moveSigRollingItem(it.id, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="rounded bg-neutral-700 px-2 py-1 text-xs disabled:opacity-40"
                              disabled={pos >= arr.length - 1}
                              onClick={() => moveSigRollingItem(it.id, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="rounded bg-red-900/70 px-2 py-1 text-xs hover:bg-red-800"
                              onClick={() => removeSigRollingItem(it.id)}
                            >
                              롤링 제외
                            </button>
                          </div>
                        </li>
                        );
                      })
                    )}
                  </ul>
                </details>
              </div>
                ) : null}
                {sigSalesModalTab === "inventory" ? (
              <div className="rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-base font-semibold">시그 판매 관리</h3>
                    <p className="text-xs text-neutral-400">
                      인벤토리에서 이번 방송 노출 시그를 선택하고 판매량을 실시간 조정합니다. 방송은 위 회전판 오버레이 URL(
                      <code>/overlay/sig-sales</code>)만 쓰면 되며, 「보드 노출」로
                      체크된 시그가 있으면 그 롤링 보드가 같은 화면 상단에 자동으로 붙습니다. 회전판만 보이게 하려면 URL에{" "}
                      <code className="text-neutral-300">hideSigBoard=1</code>만 추가하면 됩니다.
                    </p>
                  </div>
                </div>
                <div className="rounded border border-amber-400/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  5개·한방 <strong className="text-amber-50">전체 수동 설정</strong>은 이 탭이 아니라{" "}
                  <Link href="/admin/sig-sales" target="_blank" rel="noopener noreferrer" className="font-semibold text-amber-200 underline">
                    시그 판매 회전판(/admin/sig-sales)
                  </Link>
                  {" · "}
                  <Link href="/admin/sig-sales-manual" target="_blank" rel="noopener noreferrer" className="font-semibold text-sky-300 underline">
                    수동 시그 판매(/admin/sig-sales-manual)
                  </Link>
                  페이지 상단의 <strong className="text-amber-50">「수동 설정(5개 + 한방)」</strong> 섹션입니다. 모달 우측 상단 「새 탭에서 열기」로도 이동할 수 있습니다.
                </div>
                <div className="rounded border border-white/10 bg-black/25 p-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-neutral-300">멤버별 판매 프리셋</span>
                  <select
                    className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                    value={sigPresetMemberId}
                    onChange={(e) => setSigPresetMemberId(e.target.value)}
                  >
                    {state.members.map((m) => (
                      <option key={`sig-preset-${m.id}`} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-sky-800 hover:bg-sky-700 text-xs"
                    onClick={() => saveSigSalesPresetForMember(sigPresetMemberId)}
                  >
                    현재 설정 저장
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs"
                    onClick={() => applySigSalesPresetForMember(sigPresetMemberId)}
                  >
                    프리셋 적용
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-violet-800 hover:bg-violet-700 text-xs"
                    onClick={applyNextSigSalesPresetMember}
                  >
                    다음 멤버 적용
                  </button>
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-xs"
                    onClick={() => clearSigSalesPresetForMember(sigPresetMemberId)}
                  >
                    프리셋 삭제
                  </button>
                  <span className="text-[11px] text-neutral-500">
                    저장: 선택 멤버 시그의 현재 판매 활성 상태 / 적용: 해당 멤버 시그만 판매 활성
                  </span>
                </div>
                <div className="rounded border border-white/10 bg-black/25 p-2 flex flex-wrap items-center gap-2">
                  <button
                    className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-sm"
                    onClick={downloadSigPricesExcel}
                    title="현재 시그 목록의 이름·가격·판매 설정을 엑셀로 저장"
                  >
                    시그 가격 엑셀 다운로드
                  </button>
                  <label className="px-3 py-1 rounded bg-teal-700 hover:bg-teal-600 text-sm cursor-pointer">
                    시그 가격 엑셀 업로드
                    <input
                      className="hidden"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => {
                        void uploadSigPricesExcel(e.target.files?.[0] || null);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    className="px-3 py-1 rounded bg-sky-700 hover:bg-sky-600 text-sm"
                    onClick={downloadSigExcelTemplate}
                    title="새 시그 추가용 빈 양식"
                  >
                    새 시그 추가 양식
                  </button>
                  <label className="px-3 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-sm cursor-pointer" title="양식 기준 새 시그 행 추가(기존 이름은 건너뜀)">
                    새 시그 엑셀 추가
                    <input
                      className="hidden"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => {
                        uploadSigExcel(e.target.files?.[0] || null);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <label
                    className="px-3 py-1 rounded bg-lime-900/85 hover:bg-lime-800 text-sm cursor-pointer"
                    title="시그 가격 엑셀 다운로드 파일(sig-prices-*.xlsx)로 전체 목록 복구"
                  >
                    엑셀에서 시그 목록 복구
                    <input
                      className="hidden"
                      type="file"
                      accept=".xlsx,.xls"
                      ref={sigRestoreExcelInputRef}
                      onChange={(e) => {
                        void restoreSigInventoryFromExcelFile(e.target.files?.[0] || null);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="px-3 py-1 rounded bg-teal-900/80 hover:bg-teal-800 text-sm"
                    title="상태보내기(JSON) — 시그·멤버·후원·오버레이 프리셋·설정 전체 복구"
                    onClick={() => sigRestoreJsonInputRef.current?.click()}
                  >
                    JSON에서 전체 복구
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1 rounded bg-orange-900/80 hover:bg-orange-800 text-sm"
                    title="앱 설치 직후와 동일한 시그 행·판매 제외·멤버 프리셋·회전판·롤링 설정"
                    onClick={resetSigInventoryToDefaults}
                  >
                    기본 목록으로 초기화
                  </button>
                  <button
                    className="px-3 py-1 rounded bg-red-900/80 hover:bg-red-800 text-sm"
                    onClick={clearAllSigItems}
                  >
                    전체 지우기
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1 rounded bg-amber-900/75 hover:bg-amber-800 text-sm"
                    title="같은 이미지 URL(경로 기준) 또는 같은 시그 이름은 첫 행만 유지"
                    onClick={() => dedupeSigInventoryItems("imageUrl")}
                  >
                    중복 제거(URL·이름)
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1 rounded bg-amber-900/75 hover:bg-amber-800 text-sm"
                    title="같은 이름+가격은 첫 행만 유지"
                    onClick={() => dedupeSigInventoryItems("nameAndPrice")}
                  >
                    중복 제거(이름+가격)
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-sm disabled:opacity-50"
                    disabled={sigBulkReuploadBusy}
                        title="PC에서 여러 GIF 선택 · 파일명이 시그 이름과 같거나 「금액_이름.gif」(예: 1,000,000_버터플라이.gif)이면 해당 행 이미지·가격 반영. 그 외는 새 시그 추가"
                    onClick={() => sigBulkReuploadInputRef.current?.click()}
                  >
                    {sigBulkReuploadBusy ? "업로드 중…" : "PC 시그 일괄 업로드"}
                  </button>
                  {sigExcelResult ? <span className="text-xs text-neutral-300">{sigExcelResult}</span> : null}
                  <span className="text-[11px] text-neutral-500 w-full">
                    「가격 업로드」는 <strong className="text-neutral-300">기존 목록의 가격만</strong> 수정합니다. 목록이 리셋됐으면
                    「<strong className="text-lime-200/90">엑셀에서 시그 목록 복구</strong>」에 sig-prices 다운로드 파일을 넣으세요.
                  </span>
                </div>
                {sigUploadProgress ? (
                  <SigUploadProgressPanel progress={sigUploadProgress} busy={sigBulkReuploadBusy} />
                ) : null}
                <div className="rounded border border-white/10 bg-black/25 p-2 grid grid-cols-1 md:grid-cols-[180px_1fr] gap-2 items-center">
                  <div className="text-xs text-neutral-300">판매 완료 오버레이 이미지</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs min-w-[240px]"
                      placeholder="이미지 URL 또는 경로 (gif/png/jpg)"
                      value={state.sigSoldOutStampUrl || ""}
                      onChange={(e) => updateSigSoldOutStampUrl(e.target.value)}
                    />
                    <label className="cursor-pointer rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-700">
                      이미지 업로드
                      <input
                        className="hidden"
                        type="file"
                        accept=".gif,.png,.jpg,.jpeg,image/gif,image/png,image/jpeg"
                        onChange={(e) => uploadSigSoldOutStampImage(e.target.files?.[0] || null)}
                      />
                    </label>
                    <button
                      type="button"
                      className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
                      onClick={() => updateSigSoldOutStampUrl("")}
                    >
                      기본 도장 사용
                    </button>
                  </div>
                  <div className="text-[11px] text-neutral-500">완판 시 시그 이미지 정중앙에 겹쳐 표시됩니다.</div>
                  <div className="flex items-center gap-2">
                    <div className="relative h-14 w-14 overflow-hidden rounded border border-white/10 bg-black/30">
                      <Image
                        src={resolveSigAdminPreviewSrc(
                          state.sigSoldOutStampUrl || DEFAULT_SIG_SOLD_STAMP_URL,
                          "stamp"
                        )}
                        alt="완판 오버레이 미리보기"
                        fill
                        unoptimized
                        className="object-contain"
                      />
                    </div>
                    <span className="text-xs text-neutral-400">{state.sigSoldOutStampUrl ? "커스텀 이미지 사용 중" : "기본 도장 사용 중"}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="rounded border border-white/10 bg-black/25 p-2 grid grid-cols-1 md:grid-cols-[1fr_120px_1fr_1fr_auto] gap-2">
                    <input
                      className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                      placeholder="신규 시그 이름"
                      value={newSigName}
                      onChange={(e) => setNewSigName(e.target.value)}
                    />
                    <input
                      className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                      type="number"
                      min={0}
                      placeholder="가격"
                      value={newSigPrice}
                      onChange={(e) => setNewSigPrice(e.target.value)}
                    />
                    <select
                      className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                      value={newSigMemberId}
                      onChange={(e) => setNewSigMemberId(e.target.value)}
                    >
                      <option value="">공통(전체 멤버)</option>
                      {state.members.map((m) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <div className="flex flex-col gap-1">
                      <input
                        className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                        placeholder="이미지 URL 또는 경로"
                        value={newSigImageUrl}
                        onChange={(e) => setNewSigImageUrl(e.target.value)}
                      />
                      <label className="cursor-pointer w-fit rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-700">
                        이미지 업로드 (PC)
                        <input
                          className="hidden"
                          type="file"
                          accept=".gif,.png,.jpg,.jpeg,image/gif,image/png,image/jpeg"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            uploadNewSigImage(file);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <button
                      className="px-3 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                      onClick={addSigItem}
                      disabled={newSigImageUploading}
                    >
                      {newSigImageUploading ? "이미지 업로드 중..." : "시그 추가"}
                    </button>
                  </div>
                  {resolveNewSigDraftPreviewSrc(newSigPreviewUrl, newSigImageUrl, user?.id) ? (
                    <div className="rounded border border-white/10 bg-black/20 p-2">
                      <div className="text-[11px] text-neutral-400 mb-2">
                        신규 시그 이미지 미리보기 (아래 목록의 기존 시그에는 반영되지 않음)
                      </div>
                      <div className="relative h-[48px] w-20 overflow-hidden rounded border border-white/10 bg-black/30">
                        {/* next/image는 비정상 URL 시 _next/static 조합 버그가 나올 수 있어 동적 시그는 native img 사용 */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          key={`new-sig-draft-${newSigPreviewUrl || newSigImageUrl}`}
                          src={resolveNewSigDraftPreviewSrc(newSigPreviewUrl, newSigImageUrl, user?.id)}
                          alt="신규 시그 미리보기"
                          className="absolute inset-0 h-full w-full object-contain"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => {
                            e.currentTarget.onerror = null;
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                  <div className={`rounded border px-3 py-2 ${sigImageUrlIssues.length > 0 ? "border-rose-400/40 bg-rose-900/20" : "border-emerald-400/30 bg-emerald-900/20"}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold">
                        시그 이미지 URL 자동 탐지
                      </div>
                      <div className={`text-xs ${sigImageUrlIssues.length > 0 ? "text-rose-200" : "text-emerald-200"}`}>
                        {sigImageUrlIssues.length > 0 ? `문제 ${sigImageUrlIssues.length}건` : "문제 없음"}
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-neutral-300">
                      /uploads 경로, 깨진 URL, 빈 URL을 자동 감지합니다.
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className="rounded bg-black/35 px-2 py-1 text-neutral-200">legacy /uploads: {legacyUploadsCount}</span>
                      <span className="rounded bg-black/35 px-2 py-1 text-neutral-200">깨진 URL: {brokenImageUrlCount}</span>
                      <span className="rounded bg-black/35 px-2 py-1 text-neutral-200">빈 URL: {emptyImageUrlCount}</span>
                    </div>
                    {sigImageUrlIssues.length > 0 ? (
                      <div className="mt-2 max-h-28 overflow-auto rounded border border-white/10 bg-black/30 p-2 text-[11px] text-rose-100">
                        {sigImageUrlIssues.map((issue) => (
                          <div key={`sig-url-issue-${issue.id}`} className="mb-1 last:mb-0">
                            <span className="font-semibold">{issue.name}</span>
                            {" · "}
                            {issue.isLegacyUploads ? "[legacy /uploads] " : ""}
                            {issue.isBroken ? "[깨진 URL] " : ""}
                            {issue.isEmpty ? "[빈 URL] " : ""}
                            <span className="text-rose-200/80">{issue.raw || "(empty)"}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                  {sigOcrBanner ? (
                    <div className="rounded border border-violet-400/45 bg-violet-950/50 px-3 py-2 text-sm leading-snug text-violet-50 whitespace-pre-wrap shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                      {sigOcrBanner}
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-black/25 px-2 py-1.5 text-xs">
                    <span className="text-neutral-400">시그 행 접기 · 업로드 상태는 바로 위 보라색 칸에 표시됩니다.</span>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          className="rounded bg-neutral-700 px-2 py-1 hover:bg-neutral-600"
                          onClick={() => {
                            const ids = (state.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID).map((x) => x.id);
                            setSigInventoryRowOpen(Object.fromEntries(ids.map((id) => [id, true])));
                          }}
                        >
                          모두 펼치기
                        </button>
                        <button
                          type="button"
                          className="rounded bg-neutral-700 px-2 py-1 hover:bg-neutral-600"
                          onClick={() => {
                            const ids = (state.sigInventory || []).filter((x) => x.id !== ONE_SHOT_SIG_ID).map((x) => x.id);
                            setSigInventoryRowOpen(Object.fromEntries(ids.map((id) => [id, false])));
                          }}
                        >
                          모두 접기
                        </button>
                      </div>
                      <button
                        type="button"
                        className="rounded bg-emerald-700 px-3 py-1.5 text-sm font-bold text-white shadow hover:bg-emerald-600 disabled:opacity-50"
                        disabled={sigBulkReuploadBusy}
                        title="PC에서 여러 GIF 선택 · 목록이 비어 있으면 새 시그로 추가"
                        onClick={() => sigBulkReuploadInputRef.current?.click()}
                      >
                        {sigBulkReuploadBusy
                          ? sigUploadProgress
                            ? `업로드 중 ${sigUploadProgress.current}/${sigUploadProgress.total}…`
                            : "업로드 중…"
                          : "PC 시그 일괄 업로드"}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-rose-800/90 px-3 py-1.5 text-sm font-semibold text-white shadow hover:bg-rose-700 disabled:opacity-50"
                        disabled={sigBulkReuploadBusy}
                        onClick={() => clearSigInventoryImagesOnly()}
                      >
                        시그 이미지만 지우기
                      </button>
                    </div>
                  </div>
                  {(state.sigInventory || []).map((item) => {
                    const isOneShot = item.id === ONE_SHOT_SIG_ID;
                    const hasLegacyLocalUrl = isLegacyLocalSigImageUrl(item.imageUrl);
                    const hasBrokenUrl = isBrokenSigImageUrl(item.imageUrl);
                    const rowOpen = isOneShot ? true : Boolean(sigInventoryRowOpen[item.id]);
                    return (
                    <div key={item.id} className="rounded border border-white/10 bg-[#1f1f1f] overflow-hidden">
                      <div className="flex flex-wrap items-center gap-2 border-b border-white/5 bg-black/15 px-2 py-2">
                        {!isOneShot ? (
                          <button
                            type="button"
                            className="shrink-0 rounded px-1.5 py-0.5 text-neutral-400 hover:bg-white/10"
                            aria-expanded={rowOpen}
                            aria-label={rowOpen ? "행 접기" : "행 펼치기"}
                            onClick={() =>
                              setSigInventoryRowOpen((p) => ({
                                ...p,
                                [item.id]: !Boolean(p[item.id]),
                              }))
                            }
                          >
                            {rowOpen ? "▼" : "▶"}
                          </button>
                        ) : null}
                        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-3 text-sm">
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={Boolean(item.isRolling)}
                                onChange={(e) => toggleSigRollingItem(item.id, e.target.checked)}
                              />
                              <span>보드 노출</span>
                            </label>
                            <label className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={Boolean(item.isActive)}
                                onChange={(e) => toggleSigActiveItem(item.id, e.target.checked)}
                              />
                              <span>{isOneShot ? "OBS 표시" : "판매 활성"}</span>
                            </label>
                            <span className="font-semibold">{item.name}</span>
                            {isOneShot ? (
                              <span className="text-[10px] text-amber-200/80">한방 · 이름·이미지 편집 가능</span>
                            ) : null}
                          </div>
                          <div className="text-xs text-neutral-400">가격 {item.price.toLocaleString("ko-KR")}</div>
                          <div className="flex flex-wrap items-center gap-1">
                            {item.maxCount <= 1 && item.soldCount >= 1 ? (
                              <Image
                                src={state.sigSoldOutStampUrl || DEFAULT_SIG_SOLD_STAMP_URL}
                                alt="완판 도장"
                                width={28}
                                height={28}
                                unoptimized
                                className="h-7 w-7 object-contain opacity-90"
                              />
                            ) : null}
                            {!isOneShot && (
                              <>
                                <button type="button" className="px-2 py-1 rounded bg-red-900/70 hover:bg-red-800 text-xs" onClick={() => adjustSigSoldCount(item.id, -1)}>취소 -1</button>
                                <button type="button" className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs" onClick={() => adjustSigSoldCount(item.id, 1)}>판매 +1</button>
                                <button type="button" className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs" onClick={() => removeSigItem(item.id)}>삭제</button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {rowOpen ? (
                      <div className="space-y-2 px-3 py-2">
                      {!isOneShot ? (
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <input
                            type="number"
                            min={0}
                            className="w-16 rounded border border-white/10 bg-neutral-900/80 px-2 py-0.5 text-[11px]"
                            placeholder="순서"
                            value={Number(state.sigRollingMeta?.[item.id]?.order ?? 0)}
                            onChange={(e) => {
                              const order = Math.max(0, Math.floor(Number(e.target.value || 0)));
                              setState((prev) => {
                                const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
                                const cur = meta[item.id] || {};
                                meta[item.id] = { ...cur, order };
                                const next = { ...prev, sigRollingMeta: meta };
                                persistVisualSettings(next, { sigRollingMeta: meta });
                                return next;
                              });
                            }}
                          />
                          <input
                            className="min-w-[140px] flex-1 rounded border border-white/10 bg-neutral-900/80 px-2 py-0.5 text-[11px]"
                            placeholder="롤링 라벨(선택)"
                            value={state.sigRollingMeta?.[item.id]?.label || ""}
                            onChange={(e) => {
                              const label = e.target.value;
                              setState((prev) => {
                                const meta = { ...(prev.sigRollingMeta || {}) } as Record<string, { label?: string; order?: number }>;
                                const cur = meta[item.id] || {};
                                meta[item.id] = { ...cur, label };
                                const next = { ...prev, sigRollingMeta: meta };
                                persistVisualSettings(next, { sigRollingMeta: meta });
                                return next;
                              });
                            }}
                          />
                        </div>
                      ) : null}
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_120px_1fr_1.3fr] gap-2">
                        <input
                          className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                          value={item.name}
                          onChange={(e) => updateSigItem(item.id, { name: e.target.value })}
                          placeholder={isOneShot ? "한방 시그 이름" : undefined}
                        />
                        <input
                          className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                          type="number"
                          min={0}
                          value={sigPriceDraftMap[item.id] ?? String(item.price)}
                          disabled={isOneShot}
                          title={isOneShot ? "한방 금액은 활성 시그 합계로 자동 계산됩니다" : undefined}
                          onChange={(e) =>
                            setSigPriceDraftMap((prev) => ({
                              ...prev,
                              [item.id]: e.target.value,
                            }))
                          }
                          onBlur={() => commitSigPriceDraft(item.id, item.price)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.currentTarget.blur();
                            }
                          }}
                        />
                        <select
                          className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                          value={item.memberId || ""}
                          disabled={isOneShot}
                          onChange={(e) => updateSigItem(item.id, { memberId: e.target.value })}
                        >
                          <option value="">공통(전체 멤버)</option>
                          {state.members.map((m) => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                        <div className="flex flex-col gap-1">
                          <input
                            className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs"
                            placeholder="이미지 URL 또는 경로"
                            value={item.imageUrl || ""}
                            onChange={(e) => updateSigItem(item.id, { imageUrl: e.target.value })}
                            onBlur={() => {
                              const uid = overlayUserId;
                              if (!uid) return;
                              const fixed = normalizeSigImageUrlStored(
                                repairDiskUploadSigImagePath(item.imageUrl || "", uid)
                              );
                              if (fixed && fixed !== item.imageUrl) {
                                updateSigItem(item.id, { imageUrl: fixed });
                              }
                            }}
                          />
                          <label className="cursor-pointer w-fit rounded bg-indigo-800 px-2 py-1 text-xs hover:bg-indigo-700">
                            이미지 업로드
                            <input
                              className="hidden"
                              type="file"
                              accept=".gif,.png,.jpg,.jpeg,image/gif,image/png,image/jpeg"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                uploadSigImage(item.id, file);
                                e.currentTarget.value = "";
                              }}
                            />
                          </label>
                        </div>
                      </div>
                      {resolveInventorySigThumbSrc(
                        item.imageUrl,
                        item.name,
                        sigRowUploadPreviewMap[item.id],
                        user?.id
                      ) ? (
                        <div className="mt-2 flex items-start gap-2">
                          <button
                            type="button"
                            className="relative h-[38px] w-[64px] overflow-hidden rounded border border-white/10 bg-black/30 transition hover:border-violet-300/70"
                            title="클릭해서 크게 보기"
                            onClick={() =>
                              setSigImagePreviewModal({
                                src: resolveInventorySigThumbSrc(
                                  item.imageUrl,
                                  item.name,
                                  sigRowUploadPreviewMap[item.id],
                                  user?.id
                                ),
                                name: item.name,
                                rawUrl: item.imageUrl || "",
                              })
                            }
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              key={`sig-thumb-${item.id}-${sigRowUploadPreviewMap[item.id] || item.imageUrl || ""}`}
                              src={resolveInventorySigThumbSrc(
                                item.imageUrl,
                                item.name,
                                sigRowUploadPreviewMap[item.id],
                                user?.id
                              )}
                              alt={`${item.name} 미리보기`}
                              className="absolute inset-0 h-full w-full object-contain"
                              loading="lazy"
                              decoding="async"
                              onError={(e) =>
                                handleSigPreviewImgError(e, item.imageUrl, item.name, user?.id)
                              }
                            />
                          </button>
                          <div className="text-xs text-neutral-400 break-all">
                            이미지 설정됨: {item.imageUrl.startsWith("data:image/") ? "업로드 이미지(data URL)" : item.imageUrl}
                            {hasLegacyLocalUrl ? (
                              <div className="mt-1 text-neutral-400">
                                서버 업로드 경로(/uploads)입니다.
                              </div>
                            ) : null}
                            {hasBrokenUrl ? (
                              <div className="mt-1 text-rose-300">
                                경고: 이미지 URL이 손상되었습니다. 파일을 다시 업로드해 주세요.
                              </div>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {isOneShot ? (
                        <div className="mt-2 text-[11px] text-fuchsia-300">
                          한방 시그 금액은 나온 시그 합계(판매량×가격)로 자동 계산됩니다.
                        </div>
                      ) : null}
                      </div>
                      ) : null}
                    </div>
                  );
                  })}
                </div>
                <div className="text-xs text-neutral-500">
                  「보드 노출」은 <code>/overlay/sig-sales</code> 상단 롤링 그리드,「판매 활성」은 회전판 메뉴 후보에 포함됩니다. 시그 추가/멤버 지정/판매량 조절은 즉시 `/api/state`를 통해 Redis에 반영됩니다.{" "}
                  <span className="text-neutral-400">
                    시그 이미지는 PC에서 파일을 선택하면 서버에 저장되고 URL이 자동으로 붙습니다. EC2는 <code className="text-neutral-300">/var/lib/DIN/uploads/sigs</code> 영구 경로를 쓰며, 재시작 후에는 <strong className="text-amber-200/90">새 공인 IP</strong>로 접속해야 합니다(Elastic IP 권장).
                  </span>
                </div>
              </div>
                ) : null}
              </SigSalesHybridModal>
              <input
                ref={sigRestoreJsonInputRef}
                type="file"
                className="hidden"
                accept=".json,application/json"
                onChange={(e) => {
                  void restoreSigInventoryFromJsonFile(e.target.files?.[0] || null);
                }}
              />
              <input
                ref={sigBulkReuploadInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".gif,.png,.jpg,.jpeg,.webp,image/gif,image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const rawCount = e.target.files?.length ?? 0;
                  if (rawCount > 0) {
                    flushSync(() => {
                      setSigUploadProgress({
                        current: 0,
                        total: rawCount,
                        label: `${rawCount}개 파일 선택됨 — 처리 시작…`,
                      });
                    });
                  }
                  void bulkReuploadSigInventoryFromFiles(e.target.files);
                }}
              />
              {sigImagePreviewModal ? (
                <div
                  className="fixed inset-0 z-[500] flex items-center justify-center bg-black/80 px-4 py-6"
                  onClick={() => setSigImagePreviewModal(null)}
                >
                  <div
                    className="w-full max-w-4xl rounded-xl border border-white/20 bg-neutral-950/95 p-3 shadow-2xl"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-white">{sigImagePreviewModal.name}</div>
                        <div className="truncate text-[11px] text-neutral-400">
                          {sigImagePreviewModal.rawUrl || sigImagePreviewModal.src}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="rounded bg-neutral-700 px-2 py-1 text-xs text-white hover:bg-neutral-600"
                        onClick={() => setSigImagePreviewModal(null)}
                      >
                        닫기
                      </button>
                    </div>
                    <div className="relative flex min-h-[40vh] w-full items-center justify-center overflow-hidden rounded border border-white/10 bg-black/40 p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={sigImagePreviewModal.src}
                        alt={`${sigImagePreviewModal.name} 원본 미리보기`}
                        className="max-h-[70vh] max-w-full object-contain"
                        loading="lazy"
                        decoding="async"
                        onError={(e) =>
                          handleSigPreviewImgError(
                            e,
                            sigImagePreviewModal.rawUrl,
                            sigImagePreviewModal.name,
                            user?.id
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              ) : null}
              <div id="timer-control-section" className="mt-4 rounded-lg border border-white/10 bg-neutral-900/40 p-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-base font-semibold">타이머 제어</h3>
                    <p className="text-xs text-neutral-400 mt-1">
                      일반 타이머(generalTimer)와 대전 타이머(matchTimer)는 분리되어 있습니다. 여기서는 일반 타이머만 ±분·일시정지·글꼴·오버레이 ON/OFF를 조정합니다. 시그·식사 대전 타이머는 각 대전 패널의 「대전 오버레이 타이머」에서 제어하세요.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-violet-500/40 bg-violet-950/50 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-900/60"
                    title="타이머 전용 팝업 창"
                    onClick={() => openAdminTimerPopup(user?.id || overlayUserId)}
                  >
                    별도 창에서 열기
                  </button>
                </div>
                {([{ key: "generalTimer", flag: "general" as const, label: "일반 타이머" }] as const).map((timerDef) => {
                  const timer = state[timerDef.key];
                  const timerStyle = state.timerDisplayStyles?.[timerDef.flag] || {
                    showHours: false,
                    design: "pill",
                    fontFamily: "mono",
                    fontColor: "",
                    bgColor: "",
                    borderColor: "",
                    outlineColor: "",
                    outlineWidth: 0.8,
                    bgOpacity: 40,
                    scalePercent: 100,
                  };
                  const timerFontId = normalizeTimerFontFamily(timerStyle.fontFamily);
                  const timerFontCss = resolveTimerFontFamilyCss(timerFontId);
                  const timerDesignId = normalizeTimerDesign(timerStyle.design);
                  const effective = getEffectiveRemainingTime(timer, timerUiNow);
                  const circularTimerFontSize = resolveCircularImageTimerFontSize({
                    timerOnlyMode: true,
                    scalePercent: timerStyle.scalePercent ?? 100,
                  });
                  const mm = Math.floor(effective / 60);
                  const ss = effective % 60;
                  const overlayOn = state.matchTimerEnabled?.[timerDef.flag] !== false;
                  const timerOnlyUrl = `/overlay?u=${overlayUserId}&timerType=${timerDef.flag}&host=obs`;
                  return (
                    <div key={timerDef.key} className="rounded border border-white/10 bg-[#1f1f1f] px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold">{timerDef.label}</div>
                          <div className="text-xs text-neutral-400">
                            남은 시간 {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
                          </div>
                          <label className="mt-1 flex items-center gap-2 text-xs text-neutral-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={overlayOn}
                              onChange={() => updateMatchTimerEnabled({ [timerDef.flag]: !overlayOn })}
                            />
                            오버레이 사용
                          </label>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            className={`px-2 py-1 rounded text-xs ${timer.isActive ? "bg-amber-700 hover:bg-amber-600" : "bg-emerald-700 hover:bg-emerald-600"}`}
                            onClick={() =>
                              updateMatchTimer(timerDef.key, (t) => {
                                if (t.isActive) return pauseTimer(t);
                                const effective = getEffectiveRemainingTime(t);
                                if (effective <= 0) {
                                  const mins = parseInt(timerMinuteInputs[timerDef.key] || "0", 10);
                                  if (Number.isFinite(mins) && mins > 0) {
                                    return resumeTimer({
                                      remainingTime: mins * 60,
                                      isActive: false,
                                      lastUpdated: Date.now(),
                                    });
                                  }
                                }
                                return resumeTimer(t);
                              })
                            }
                          >
                            {timer.isActive ? "⏸ 일시정지" : "▶ 시작"}
                          </button>
                          <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs" onClick={() => adjustTimerSeconds(timerDef.key, -60)}>-1분</button>
                          <button className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs" onClick={() => adjustTimerSeconds(timerDef.key, +60)}>+1분</button>
                          <button className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs" onClick={() => adjustTimerSeconds(timerDef.key, +10)}>+10초</button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-neutral-400">분 설정</span>
                        <input
                          className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                          inputMode="numeric"
                          value={timerMinuteInputs[timerDef.key]}
                          onChange={(e) => {
                            const raw = e.target.value.replace(/[^\d]/g, "");
                            setTimerMinuteInputs((prev) => ({ ...prev, [timerDef.key]: raw }));
                          }}
                        />
                        <button
                          type="button"
                          className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs"
                          onClick={() => {
                            const mins = parseInt(timerMinuteInputs[timerDef.key] || "0", 10);
                            setTimerMinutes(timerDef.key, Number.isFinite(mins) ? mins : 0);
                          }}
                        >
                          분으로 설정
                        </button>
                      </div>
                      {timerDef.flag === "general" && (
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
                          <span>일반 타이머 오버레이:</span>
                          <code className="text-neutral-300 break-all">{timerOnlyUrl}</code>
                          <button
                            type="button"
                            className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-general-timer" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                            onClick={() => {
                              const u = `${window.location.origin}${timerOnlyUrl}`;
                              void copyUrl(u, "dash-general-timer");
                            }}
                          >
                            {copiedId === "dash-general-timer" ? "복사됨!" : "URL 복사"}
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs text-white"
                            onClick={() => window.open(timerOnlyUrl, "_blank", "noopener,noreferrer")}
                          >
                            오버레이 열기
                          </button>
                        </div>
                      )}
                      <div className="mt-3 border-t border-white/10 pt-2 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-2">
                        <label className="text-xs text-neutral-400">디자인</label>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="min-w-[12rem] max-w-full px-2 py-1.5 rounded bg-neutral-900/80 border border-white/10 text-sm"
                            value={timerDesignId}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                design: normalizeTimerDesign(e.target.value),
                              })
                            }
                          >
                            {TIMER_DESIGN_OPTIONS.map((opt) => (
                              <option key={opt.id} value={opt.id}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                          <span className="text-[10px] text-neutral-500">{TIMER_DESIGN_OPTIONS.find((o) => o.id === timerDesignId)?.description}</span>
                        </div>
                        <label className="text-xs text-neutral-400 sm:col-span-2">미리보기</label>
                        <div
                          className={`sm:col-span-2 flex min-h-[9rem] items-center justify-center rounded-lg border border-white/10 px-4 py-3 ${
                            isImageFrameTimerDesign(timerDesignId) && timerDesignId === "speedometer"
                              ? "bg-neutral-900"
                              : "bg-neutral-950/80"
                          }`}
                          style={
                            isImageFrameTimerDesign(timerDesignId)
                              ? { minHeight: Math.max(144, Math.round(circularTimerFontSize * 5.8)) }
                              : undefined
                          }
                        >
                          {timerDesignId === "flip-countdown" ? (
                            <FlipCountdownTimer
                              remainingSeconds={effective}
                              showHours={timerStyle.showHours}
                              fontSize={Math.max(20, Math.round(circularTimerFontSize * 0.5))}
                              fontFamily={timerFontId}
                              fontColor={String(timerStyle.fontColor || "")}
                              bgColor={String(timerStyle.bgColor || "")}
                              bgOpacity={timerStyle.bgOpacity}
                            />
                          ) : timerDesignId === "led-matrix" ? (
                            <LedMatrixTimer
                              remainingSeconds={effective}
                              showHours={timerStyle.showHours}
                              fontSize={Math.max(28, Math.round(circularTimerFontSize * 0.65))}
                              fontColor={String(timerStyle.fontColor || "")}
                              bgColor={String(timerStyle.bgColor || "")}
                              borderColor={String(timerStyle.borderColor || "")}
                              bgOpacity={timerStyle.bgOpacity}
                            />
                          ) : isImageFrameTimerDesign(timerDesignId) ? (
                            <CircularImageTimer
                              remainingSeconds={effective}
                              showHours={timerStyle.showHours}
                              design={timerDesignId}
                              fontSize={circularTimerFontSize}
                              fontFamily={timerFontId}
                              fontColor={String(timerStyle.fontColor || "")}
                            />
                          ) : (
                            <span
                              className="text-2xl font-bold tabular-nums text-white"
                              style={{ fontFamily: timerFontCss }}
                            >
                              {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
                            </span>
                          )}
                        </div>
                        <label className="text-xs text-neutral-400">표시 형식</label>
                        <button
                          type="button"
                          className={`w-fit px-2 py-1 rounded border text-xs ${timerStyle.showHours ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`}
                          onClick={() => updateTimerDisplayStyle(timerDef.flag, { showHours: !timerStyle.showHours })}
                        >
                          시:분:초 {timerStyle.showHours ? "항상 ON" : "자동"} (60분까지 분:초 · 61분부터 시:분:초)
                        </button>
                        <label className="text-xs text-neutral-400">글꼴</label>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            className="min-w-[12rem] max-w-full px-2 py-1.5 rounded bg-neutral-900/80 border border-white/10 text-sm"
                            value={timerFontId}
                            onFocus={() => ensureTimerGoogleFontsLoaded()}
                            onChange={(e) => {
                              ensureTimerGoogleFontsLoaded();
                              updateTimerDisplayStyle(timerDef.flag, {
                                fontFamily: normalizeTimerFontFamily(e.target.value),
                              });
                            }}
                          >
                            <optgroup label="귀여운">
                              {TIMER_FONT_FAMILY_OPTIONS.filter((o) => o.group === "cute").map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="디스플레이">
                              {TIMER_FONT_FAMILY_OPTIONS.filter((o) => o.group === "display").map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="깔끔·가독">
                              {TIMER_FONT_FAMILY_OPTIONS.filter((o) => o.group === "clean").map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="레트로">
                              {TIMER_FONT_FAMILY_OPTIONS.filter((o) => o.group === "retro").map((opt) => (
                                <option key={opt.id} value={opt.id}>
                                  {opt.label}
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                        <label className="text-xs text-neutral-400">글자 색상</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="w-14 h-9 rounded bg-neutral-900/80 border border-white/10"
                            value={toColorPickerValue(String(timerStyle.fontColor ?? ""), "#ffffff")}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { fontColor: e.target.value })}
                          />
                          <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updateTimerDisplayStyle(timerDef.flag, { fontColor: "" })}>기본</button>
                        </div>
                        <label className="text-xs text-neutral-400">배경 색상</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="w-14 h-9 rounded bg-neutral-900/80 border border-white/10"
                            value={toColorPickerValue(
                              String(timerStyle.bgColor ?? ""),
                              timerDesignId === "led-matrix" ? "#000000" : "#ffffff"
                            )}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                bgColor: e.target.value,
                                bgOpacity: restoreTimerBackgroundOpacity(timerDesignId, timerStyle.bgOpacity),
                              })
                            }
                          />
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                            onClick={() =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                bgColor: timerDesignId === "led-matrix" ? "#000000" : "",
                                bgOpacity: restoreTimerBackgroundOpacity(timerDesignId, timerStyle.bgOpacity),
                              })
                            }
                          >
                            기본
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                            onClick={() => updateTimerDisplayStyle(timerDef.flag, { bgColor: "transparent", borderColor: "transparent", outlineColor: "", bgOpacity: 0 })}
                          >
                            배경 없음
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                            onClick={() =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                bgColor: timerDesignId === "led-matrix" ? "#000000" : "",
                                bgOpacity: timerDesignId === "led-matrix" ? 100 : 40,
                              })
                            }
                          >
                            배경 넣기
                          </button>
                        </div>
                        <label className="text-xs text-neutral-400">테두리 색상</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="w-14 h-9 rounded bg-neutral-900/80 border border-white/10"
                            value={toColorPickerValue(
                              String(timerStyle.borderColor ?? ""),
                              timerDesignId === "led-matrix" ? "#ef4444" : "#ffffff"
                            )}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { borderColor: e.target.value })}
                          />
                          <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updateTimerDisplayStyle(timerDef.flag, { borderColor: "" })}>기본</button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                            onClick={() => updateTimerDisplayStyle(timerDef.flag, { borderColor: "transparent" })}
                          >
                            테두리 없음
                          </button>
                        </div>
                        <label className="text-xs text-neutral-400">글자 외곽선 색상</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="color"
                            className="w-14 h-9 rounded bg-neutral-900/80 border border-white/10"
                            value={toColorPickerValue(String(timerStyle.outlineColor ?? ""), "#000000")}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { outlineColor: e.target.value })}
                          />
                          <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updateTimerDisplayStyle(timerDef.flag, { outlineColor: "" })}>기본</button>
                        </div>
                        <label className="text-xs text-neutral-400">글자 외곽선 두께</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="3"
                            step="0.1"
                            value={String(timerStyle.outlineWidth ?? 0.8)}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                outlineWidth: Math.max(0, Math.min(3, parseFloat(e.target.value || "0.8") || 0.8)),
                              })
                            }
                            className="flex-1 accent-violet-500"
                          />
                          <input
                            className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                            value={String(timerStyle.outlineWidth ?? 0.8)}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                outlineWidth: Math.max(0, Math.min(3, parseFloat(e.target.value.replace(/[^\d.]/g, "") || "0.8") || 0.8)),
                              })
                            }
                          />
                          <span className="text-xs text-neutral-500">px</span>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                            onClick={() => updateTimerDisplayStyle(timerDef.flag, { outlineWidth: 0.8 })}
                          >
                            기본
                          </button>
                        </div>
                        <label className="text-xs text-neutral-400">배경 투명도</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={String(timerStyle.bgOpacity ?? 40)}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { bgOpacity: Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10) || 0)) })}
                            className="flex-1 accent-emerald-500"
                          />
                          <input
                            className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                            value={String(timerStyle.bgOpacity ?? 40)}
                            onChange={(e) => updateTimerDisplayStyle(timerDef.flag, { bgOpacity: Math.max(0, Math.min(100, parseInt(e.target.value.replace(/[^\d]/g, "") || "0", 10) || 0)) })}
                          />
                          <span className="text-xs text-neutral-500">%</span>
                        </div>
                        <label className="text-xs text-neutral-400">타이머 크기</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="range"
                            min="50"
                            max="250"
                            value={String(timerStyle.scalePercent ?? 100)}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                scalePercent: Math.max(50, Math.min(250, parseInt(e.target.value || "100", 10) || 100)),
                              })
                            }
                            className="flex-1 accent-fuchsia-500"
                          />
                          <input
                            className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                            value={String(timerStyle.scalePercent ?? 100)}
                            onChange={(e) =>
                              updateTimerDisplayStyle(timerDef.flag, {
                                scalePercent: Math.max(50, Math.min(250, parseInt(e.target.value.replace(/[^\d]/g, "") || "100", 10) || 100)),
                              })
                            }
                          />
                          <span className="text-xs text-neutral-500">%</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            )}

            {isAdminNavSectionVisible("donor") && (
            <>
            <section id="donor-management" className={`${panelCardClass} p-4 md:p-6`}>
              <h2 className="text-lg font-semibold mb-3">후원자 기록부</h2>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="text-xs text-neutral-400">금액 표시</span>
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded border text-xs font-medium ${
                    donorsAmountFormat === "full"
                      ? "border-emerald-400 bg-emerald-800/60 text-emerald-100"
                      : "border-white/15 bg-neutral-800 text-neutral-300"
                  }`}
                  onClick={() => applyGlobalDonorsFormat("full")}
                >
                  풀 (1,000,000)
                </button>
                <button
                  type="button"
                  className={`px-2.5 py-1 rounded border text-xs font-medium ${
                    donorsAmountFormat === "short"
                      ? "border-emerald-400 bg-emerald-800/60 text-emerald-100"
                      : "border-white/15 bg-neutral-800 text-neutral-300"
                  }`}
                  onClick={() => applyGlobalDonorsFormat("short")}
                >
                  만원 (100만)
                </button>
                <span className="text-[11px] text-neutral-500">
                  풀=입력한 원 그대로 ·                   만원=축약 표기 · 오버레이·목표 막대에도 동일(막대 총액만 천원 반올림)
                </span>
              </div>

              <div id="high-society-mode" className="mb-4 rounded-lg border border-amber-400/35 bg-amber-950/25 p-3 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-amber-100">상류사회 모드 (땅따먹기)</div>
                    <p className="mt-0.5 text-[11px] text-neutral-400 leading-snug">
                      확장 룰: <strong className="text-neutral-200">1만원 = 5cm</strong>
                      · 1만원 정확히 배수만 영토 기록부 입력 시 참고(1만=5cm)
                      · 영토(cm)는 「상류사회 · 영토 기록부」에서만 수동 반영 — 후원 리스트와 연동 없음
                      (예: 2만원 → 10cm, 1만9천원 → 0cm). 1인 시작{" "}
                      <strong className="text-neutral-200">{formatCm(hsStartCm)}</strong>
                      · 전장 총길이{" "}
                      <strong className="text-neutral-200">
                        {hsEffectiveFieldCm.toLocaleString("ko-KR")}cm
                      </strong>
                      ({hsSeatPlayers.length || 0}명). 양끝은 단방향, 가운데는{" "}
                      <strong className="text-neutral-300">시스템 한쪽 방향</strong>
                      (수동 변경은 모드 ON일 때만 · 원복 후 적용).
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="rounded border border-violet-500/40 bg-violet-950/50 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-900/60"
                      title="상류사회·영토 전용 팝업 창"
                      onClick={() => openAdminHighSocietyPopup(user?.id || overlayUserId)}
                    >
                      별도 창에서 열기
                    </button>
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 text-xs font-semibold ${
                        highSocietySettings.enabled
                          ? "bg-amber-600 text-white"
                          : "bg-neutral-700 text-neutral-200 hover:bg-neutral-600"
                      }`}
                      onClick={() => patchHighSocietySettings({ enabled: !highSocietySettings.enabled })}
                    >
                      {highSocietySettings.enabled ? "상류사회 ON" : "상류사회 OFF"}
                    </button>
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 text-xs font-semibold border ${
                        highSocietySettings.territoryPaused
                          ? "border-sky-400 bg-sky-700/90 text-white"
                          : "border-white/15 bg-neutral-800 text-neutral-200 hover:border-sky-400/50"
                      }`}
                      disabled={!highSocietySettings.enabled}
                      title={
                        highSocietySettings.enabled
                          ? "영토·후원 합산·투네 반영 모두 동결"
                          : "모드 ON일 때만 사용"
                      }
                      onClick={() =>
                        patchHighSocietySettings({ territoryPaused: !highSocietySettings.territoryPaused })
                      }
                    >
                      {highSocietySettings.territoryPaused ? "영토 재개" : "영토 일시정지"}
                    </button>
                  </div>
                </div>
                {highSocietySettings.enabled ? (
                  <div className="rounded border border-white/10 bg-black/20 px-2.5 py-2 text-[11px] text-neutral-400 leading-snug">
                    좌석 배치·1인 시작 cm·전장 설정은{" "}
                    <button
                      type="button"
                      className="text-sky-400 underline"
                      onClick={() => {
                        moveToSection("overlay", "overlay-settings");
                        window.setTimeout(() => {
                          document.getElementById("high-society-overlay")?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }, 80);
                      }}
                    >
                      오버레이 관리 → 상류사회
                    </button>
                    에서 설정하세요. 아래 합산·리스트에서는 가운데 좌석 후원의 확장 방향만 바꿉니다.
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto_auto_auto_auto] gap-3 mt-4">
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  name="donorName"
                  placeholder="후원자 이름"
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                />
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  name="donorMessage"
                  placeholder="후원 메시지 (선택)"
                  value={donorMessage}
                  onChange={(e) => setDonorMessage(e.target.value)}
                />
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  name="donorAmount"
                  placeholder={
                    donorsAmountFormat === "full" ? "입금액 (예: 35000)" : "입금액 (예: 38 또는 38000)"
                  }
                  inputMode="numeric"
                  value={donorAmount}
                  onChange={(e) => setDonorAmount(e.target.value)}
                />
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={donorTarget}
                  onChange={(e) => setDonorTarget(e.target.value as DonorTarget)}
                >
                  <option value="account">계좌</option>
                  <option value="toon">투네</option>
                </select>
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={donorMemberId || ""}
                  onChange={(e) => setDonorMemberId(e.target.value)}
                >
                  {state.members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <button
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 font-semibold"
                  onClick={addDonor}
                >
                  합산 추가
                </button>
              </div>
              <div className="mt-4 rounded border border-emerald-500/25 bg-emerald-500/5 p-3 space-y-2">
                <div className="text-xs font-semibold text-emerald-200">계좌·투네 일괄 붙여넣기</div>
                <div className="text-[11px] text-neutral-400 leading-snug">
                  첫 줄 <code className="text-emerald-200/90">계좌</code> 또는{" "}
                  <code className="text-emerald-200/90">투네</code> · 각 줄{" "}
                  <code className="text-neutral-300">후원자 멤버 금액</code>
                  <br />
                  예: <span className="text-neutral-300">안녕 태호 300000</span> · 멤버는 태호→BT태호, 자하→이자하, 비서→연비서처럼 짧게 써도 됩니다.
                </div>
                <textarea
                  className="w-full min-h-[140px] px-3 py-2 rounded bg-neutral-950 border border-white/10 text-sm font-mono"
                  name="bulkDonationPaste"
                  placeholder={"계좌\n안녕 태호 300000\n연이 홍쓰 50000\n익명 연비서 15000"}
                  value={bulkDonationText}
                  onChange={(e) => {
                    setBulkDonationText(e.target.value);
                    setBulkDonationPreview(null);
                  }}
                  disabled={bulkDonationBusy}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold disabled:opacity-50"
                    onClick={previewBulkDonations}
                    disabled={bulkDonationBusy || !bulkDonationText.trim()}
                  >
                    미리보기·멤버 매칭
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold disabled:opacity-50"
                    onClick={applyBulkDonations}
                    disabled={bulkDonationBusy || !bulkDonationText.trim()}
                  >
                    {bulkDonationBusy ? "반영 중…" : "일괄 합산 추가"}
                  </button>
                </div>
                {bulkDonationPreview && (
                  <div className="max-h-48 overflow-auto rounded border border-white/10 bg-black/30 text-[11px]">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-neutral-900 text-neutral-400">
                        <tr>
                          <th className="p-1 text-left">줄</th>
                          <th className="p-1 text-left">후원자</th>
                          <th className="p-1 text-left">멤버</th>
                          <th className="p-1 text-right">금액</th>
                          <th className="p-1 text-left">매칭</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bulkDonationPreview.map((r) => (
                          <tr
                            key={`${r.lineNo}-${r.raw}`}
                            className={r.matched ? "text-neutral-200" : "text-amber-300"}
                          >
                            <td className="p-1">{r.lineNo}</td>
                            <td className="p-1">{r.donorName}</td>
                            <td className="p-1">
                              {r.matched ? r.memberName : `${r.memberHint} (미매칭)`}
                            </td>
                            <td className="p-1 text-right">{r.amount.toLocaleString("ko-KR")}</td>
                            <td className="p-1">{r.matched ? "OK" : "확인 필요"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="p-2 text-neutral-500 border-t border-white/5">
                      대상: {bulkDonationTarget === "toon" ? "투네" : "계좌"} · 매칭{" "}
                      {bulkDonationPreview.filter((r) => r.matched).length}/
                      {bulkDonationPreview.length}
                      {bulkDonationSkipped.length > 0
                        ? ` · 형식오류 ${bulkDonationSkipped.length}`
                        : ""}
                    </div>
                  </div>
                )}
              </div>
              <div className="text-sm text-neutral-400 mt-2">입력값에 콤마/문자 포함되어도 숫자만 인식</div>
              <div className="mt-4 rounded border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-3">
                <div className="rounded border border-white/10 bg-black/25 px-3 py-2">
                  <div className="text-xs font-semibold text-cyan-200">투네 연동키 (자동 연동)</div>
                  <div className="text-[11px] text-neutral-400 mt-1">
                    투네이션 <strong className="text-neutral-300">계정설정 연동키</strong>만 붙여넣어도 됩니다.{" "}
                    <strong className="text-neutral-300">실시간 수집 ON</strong>이면 서버 WebSocket이 후원을 받아
                    엑셀표에 즉시 반영합니다(7/29 방식). 서버가 끊기면 브라우저 릴레이가 자동 fallback 합니다.
                  </div>
                  <div className="text-[11px] text-amber-200/80 mt-1 leading-snug">
                    · <strong className="text-amber-100">투네</strong>: 알림 후원자 닉 ≠ 채널 주인명 → 후원자명=알림 닉 그대로{" "}
                    <strong>투네</strong> 열 저장 (메시지 첫 토큰=멤버 선택)
                    <br />
                    · <strong className="text-amber-100">계좌</strong>: 알림 후원자 닉 = 채널 주인명 →{" "}
                    <strong>계좌</strong> 열. 메시지{" "}
                    <span className="text-amber-100">「실제후원자 멤버 (메시지…)」</span> 순으로 파싱 (님·호칭 무시)
                    <br />
                    · 메시지가 <span className="text-amber-100">「계좌 후원자 멤버」</span> 형식이면 닉과 무관하게{" "}
                    <strong>계좌</strong> (앞·중간 어디든, 닉 필드만 넣은 경우도 인식)
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className={`px-3 py-1.5 rounded text-xs font-semibold ${toonationSocketEnabled ? "bg-emerald-600 hover:bg-emerald-500" : "bg-neutral-700 hover:bg-neutral-600"}`}
                    disabled={toonationSavePending}
                    onClick={() => {
                      void persistToonationSettings({ socketEnabled: !toonationSocketEnabled });
                    }}
                  >
                    실시간 수집 {toonationSocketEnabled ? "ON" : "OFF"}
                  </button>
                  <span className="text-[11px] px-2 py-1 rounded border border-violet-500/40 text-violet-200 bg-violet-500/10">
                    자동 반영 항상 ON
                  </span>
                  <span
                    className={`text-[11px] px-2 py-1 rounded border ${
                      toonationListenerStatus?.kind === "connected"
                        ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                        : toonationListenerStatus?.kind === "error"
                          ? "border-rose-500/40 text-rose-300 bg-rose-500/10"
                          : "border-white/10 text-neutral-400 bg-black/20"
                    }`}
                  >
                    {toonationListenerStatus?.message || "상태 확인 중…"}
                  </span>
                  {toonationListenerMeta.lastDonationAt ? (
                    <span className="text-[11px] text-neutral-500">
                      마지막 후원 수신:{" "}
                      {new Date(toonationListenerMeta.lastDonationAt).toLocaleTimeString("ko-KR")}
                    </span>
                  ) : toonationListenerMeta.lastEventAt ? (
                    <span className="text-[11px] text-amber-400/90">
                      WS 연결됐으나 후원 0건 — <strong className="text-amber-200">통합알림창·Alertbox</strong>을
                      닫고 실시간 수집을 다시 켜세요 (
                      {new Date(toonationListenerMeta.lastEventAt).toLocaleTimeString("ko-KR")})
                    </span>
                  ) : toonationSocketEnabled && toonationListenerStatus?.kind === "connected" ? (
                    <span className="text-[11px] text-neutral-500">
                      서버 WS 연결됨 — 7/29 방식으로 서버가 수집합니다(브라우저 릴레이는 fallback)
                    </span>
                  ) : null}
                </div>
                <input
                  className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm font-mono"
                  placeholder="연동키 (예: f28dc2204fbaf86fd9df74c12f435c73) 또는 Alertbox URL"
                  value={toonationAlertboxUrl}
                  onChange={(e) => {
                    toonationLocalEditedAfterRef.current = Date.now();
                    setToonationAlertboxUrl(e.target.value.trim());
                  }}
                />
                <input
                  className="w-full px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm"
                  placeholder="채널 주인명 (투네 알림 닉과 같으면 계좌, 다르면 투네)"
                  value={toonationOwnerName}
                  onChange={(e) => {
                    toonationLocalEditedAfterRef.current = Date.now();
                    setToonationOwnerName(e.target.value);
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="px-4 py-2 rounded text-sm font-semibold bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={toonationSavePending || !toonationSettingsHydrated}
                    onClick={() => {
                      void persistToonationSettings();
                    }}
                  >
                    {toonationSavePending ? "저장·확인 중…" : "연동 설정 저장"}
                  </button>
                  {toonationLastSavedAt ? (
                    <span className="text-[11px] text-emerald-300/90">
                      서버 저장 확인됨 ·{" "}
                      {new Date(toonationLastSavedAt).toLocaleString("ko-KR")}
                    </span>
                  ) : (
                    <span className="text-[11px] text-neutral-500">
                      연동키·채널 주인명 입력 후 저장하면 서버 반영 여부를 확인합니다.
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-neutral-500">
                  예: <span className="text-neutral-300">BT태호</span> / 공백·기호 차이는 자동 무시합니다.
                  <br />
                  자동 반영 시 멤버명은 <span className="text-neutral-300">유사 일치</span>(
                  <span className="text-neutral-300">태호</span>→BT태호, 오타·호칭 포함)로 엑셀표에 배치합니다.
                  멤버·후원자 힌트가 없거나 매칭 실패 시:{" "}
                  <span className="text-neutral-300">1천원 이하</span>는{" "}
                  <span className="text-neutral-300">운영비</span>
                  (없으면 후원 순위 1위), 그 초과 금액은{" "}
                  <span className="text-neutral-300">후원 순위 1위</span>
                  (대표·운영비 제외)로 보냅니다. 플레이어 멤버가 없을 때만{" "}
                  <span className="text-neutral-300">운영비 → 대표 → 국고</span> 순으로 대체합니다.
                </div>
                {toonationResolvedAlertboxUrl && user?.id ? (
                  <div className="text-[11px] text-cyan-200/90 mt-1 leading-snug">
                    <strong className="text-cyan-100">엑셀표 OBS</strong>(
                    <code className="text-neutral-400">/overlay?u={user.id}</code>)만 켜져 있어도 투네 WS가 자동
                    릴레이됩니다. 연동키는 관리자에서 한 번 저장하면 Redis에 유지됩니다.
                    <br />
                    <strong className="text-amber-200">통합알림창·투네 Alertbox를 Chrome/OBS에 따로 켜 두면 후원 JSON이 서버로 오지 않습니다.</strong>{" "}
                    반드시 닫고, 엑셀표 overlay + 실시간 수집 ON만 사용하세요.
                    <br />
                    알림만 뜨고 표가 안 바뀌면: 엑셀표 소스 새로고침·연동키 확인. (선택) 별도 릴레이 페이지{" "}
                    <code className="text-neutral-500">/overlay/toonation-relay</code> 또는 URL에{" "}
                    <code className="text-neutral-500">key=연동키</code> 추가.
                  </div>
                ) : null}
                {toonationAlertboxUrl.trim() && !toonationResolvedAlertboxUrl ? (
                  <div className="text-[11px] text-rose-300">
                    연동키 형식이 올바르지 않습니다. (영문·숫자 6~64자, 또는 toon.at Alertbox URL)
                  </div>
                ) : toonationResolvedAlertboxUrl ? (
                  <div className="text-[11px] text-neutral-500 break-all">
                    연결 URL: {toonationResolvedAlertboxUrl}
                    {extractToonationLinkKey(toonationAlertboxUrl) ? (
                      <span className="text-neutral-600"> · 키 {extractToonationLinkKey(toonationAlertboxUrl)}</span>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
                    onClick={() => setToonationAlertboxUrl("f28dc2204fbaf86fd9df74c12f435c73")}
                  >
                    제공된 연동키 채우기
                  </button>
                  {toonationResolvedAlertboxUrl ? (
                    <a
                      href={toonationResolvedAlertboxUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs"
                    >
                      Alertbox 열기
                    </a>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded bg-fuchsia-700 hover:bg-fuchsia-600 text-xs font-semibold"
                    onClick={injectToonationTestEvent}
                  >
                    테스트 이벤트 주입(투네)
                  </button>
                  {showDevSeedTools ? (
                    <>
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-xs font-semibold"
                        onClick={() => void seedDevDummyDonations("replace")}
                        title="로컬 개발 전용 — 후원 목록을 더미로 채웁니다"
                      >
                        더미 후원 채우기
                      </button>
                      <button
                        type="button"
                        className="px-3 py-1.5 rounded bg-amber-900/80 hover:bg-amber-800 text-xs"
                        onClick={() => void seedDevDummyDonations("append")}
                        title="기존 후원 유지 + 더미 추가"
                      >
                        더미 추가
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
                    onClick={() => void fetchUnmatchedEvents()}
                  >
                    미매칭 새로고침
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
                    onClick={() => void fetchToonationQueue()}
                  >
                    대기 리스트 새로고침
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-xs font-semibold"
                    onClick={() => openPlayerAlertPopup(overlayUserId)}
                  >
                    후원 웹 팝업 열기
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500">
                  후원 팝업:{" "}
                  <code className="text-neutral-400">{buildPlayerAlertPopupUrl(overlayUserId)}</code>
                  {" · "}
                  <a
                    href={`/player-alert?u=${encodeURIComponent(overlayUserId)}&preview=1`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sky-400 hover:text-sky-300"
                  >
                    실제 팝업 미리보기
                  </a>
                </p>
                <details className="rounded border border-white/10 bg-black/10 p-2 group">
                  <summary className="cursor-pointer text-xs text-neutral-400 select-none">
                    레거시 큐·별칭 (미사용) — (0)이어도 후원금과 무관 · 클릭하여 펼치기
                  </summary>
                  <div className="mt-2 space-y-2">
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs text-neutral-300">투네이션 미반영 대기 ({toonationQueue.length}) · 자동 처리</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="px-2 py-0.5 rounded bg-neutral-700 hover:bg-neutral-600 text-[11px]"
                        onClick={async () => {
                          const uid = user?.id || "";
                          if (!uid) return;
                          await fetch(`/api/donations/queue?u=${encodeURIComponent(uid)}`, {
                            method: "DELETE",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ clearAll: true }),
                          }).catch(() => {});
                          await fetchToonationQueue();
                        }}
                      >
                        모두 비우기
                      </button>
                    </div>
                  </div>
                  <div className="max-h-[200px] overflow-auto pr-1 space-y-1">
                    {toonationQueue.length === 0 && (
                      <div className="text-xs text-neutral-500">대기 이벤트가 없습니다.</div>
                    )}
                    {toonationQueue.map((evt) => {
                      const matchedThumb =
                        evt.matchedSigName && user?.id
                          ? resolveSigOverlayCardImageUrl(
                              evt.matchedSigName,
                              evt.matchedSigImageUrl,
                              user.id
                            )
                          : "";
                      return (
                      <div key={evt.id} className="text-xs text-neutral-300 rounded border border-white/10 bg-neutral-900/50 px-2 py-2">
                        <div className="flex gap-2">
                          {matchedThumb ? (
                            <div className="h-14 w-14 shrink-0 overflow-hidden rounded border border-amber-500/30 bg-black/40">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={matchedThumb}
                                alt={evt.matchedSigName || "시그"}
                                className="h-full w-full object-contain"
                              />
                            </div>
                          ) : null}
                          <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 space-y-0.5">
                              <div className="text-[10px] text-neutral-500">
                                [{new Date(evt.at).toLocaleTimeString("ko-KR", { hour12: false })}]
                                {evt.target === "account" ? " · 계좌" : " · 투네"}
                              </div>
                              {evt.matchedSigName ? (
                                <div className="text-sm font-bold text-amber-100">
                                  {evt.matchedSigName}
                                  {evt.isAutoMatched ? "" : " (추정)"}
                                </div>
                              ) : null}
                              <div>
                                <span className="text-cyan-300 font-semibold">{evt.donorName}</span>
                                <span className="text-neutral-500"> · </span>
                                <span className="text-yellow-200 tabular-nums">{evt.amount.toLocaleString("ko-KR")}원</span>
                              </div>
                              {evt.playerName || evt.memberAutoAssigned ? (
                                <div className="text-emerald-300/90">
                                  플레이어: {evt.playerName || "(자동배치)"}
                                </div>
                              ) : null}
                              {evt.message ? (
                                <div className="text-[11px] text-neutral-300 line-clamp-2" title={evt.message}>
                                  메시지: {evt.message}
                                </div>
                              ) : null}
                            </div>
                            <div className="flex flex-col items-end gap-1 shrink-0">
                              <button
                                type="button"
                                className="px-2 py-0.5 rounded bg-neutral-700 hover:bg-neutral-600 text-[11px]"
                                onClick={async () => {
                                  await removeQueueEvent(evt.id);
                                  await fetchToonationQueue();
                                }}
                              >
                                제거
                              </button>
                            </div>
                          </div>
                          <div className="mt-1 text-[11px] text-neutral-400">
                            <div className="text-neutral-500 mb-0.5">대기 중 시그</div>
                            {(() => {
                              const list = evt.sigListSnapshot || [];
                              const waiting = list.filter(
                                (s) =>
                                  s.isActive &&
                                  (s.maxCount == null || Number.isNaN(Number(s.maxCount)) || (s.soldCount || 0) < s.maxCount)
                              );
                              if (waiting.length === 0) {
                                return <div className="text-neutral-600">없음</div>;
                              }
                              return (
                                <ul className="max-h-[88px] overflow-y-auto space-y-0.5 pl-3 list-disc text-neutral-300">
                                  {waiting.map((s) => (
                                    <li key={`${evt.id}-${s.id}`}>
                                      {s.name} ({s.price.toLocaleString("ko-KR")}원)
                                    </li>
                                  ))}
                                </ul>
                              );
                            })()}
                          </div>
                          </div>
                        </div>
                      </div>
                    );
                    })}
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="text-xs text-neutral-300 mb-2">미매칭 후원 목록 ({unmatchedEvents.length})</div>
                  <div className="max-h-[220px] overflow-auto pr-1 space-y-2">
                    {unmatchedEvents.length === 0 && (
                      <div className="text-xs text-neutral-500">현재 미매칭 후원이 없습니다.</div>
                    )}
                    {unmatchedEvents.map((evt) => (
                      <div key={evt.id} className="rounded border border-white/10 bg-neutral-900/60 p-2">
                        <div className="text-xs text-neutral-300">
                          {evt.donorName} / {evt.amount.toLocaleString("ko-KR")}원
                        </div>
                        {evt.message ? (
                          <div className="mt-1 text-[11px] text-neutral-400 line-clamp-2" title={evt.message}>
                            {evt.message}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            className="px-2 py-1 rounded bg-neutral-900 border border-white/10 text-xs"
                            value={unmatchedAssignMap[evt.id] || donorMemberId || state.members[0]?.id || ""}
                            onChange={(e) => setUnmatchedAssignMap((prev) => ({ ...prev, [evt.id]: e.target.value }))}
                          >
                            {state.members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs"
                            onClick={() => void applyUnmatchedEvent(evt)}
                          >
                            선택 멤버로 반영
                          </button>
                          <input
                            className="px-2 py-1 rounded bg-neutral-900 border border-white/10 text-xs min-w-[140px]"
                            placeholder="별칭 (기본: 후원자명)"
                            value={aliasInputMap[evt.id] ?? evt.donorName}
                            onChange={(e) => setAliasInputMap((prev) => ({ ...prev, [evt.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-sky-700 hover:bg-sky-600 text-xs"
                            onClick={() => void saveAliasForUnmatched(evt)}
                          >
                            저장 및 반영
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-indigo-700 hover:bg-indigo-600 text-xs"
                            onClick={() => void applyUnmatchedEvent(evt)}
                          >
                            별칭 없이 반영
                          </button>
                          <button
                            type="button"
                            className="px-2 py-1 rounded bg-rose-700 hover:bg-rose-600 text-xs"
                            onClick={() => void removeUnmatchedEvent(evt.id)}
                          >
                            목록에서 제거
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="text-xs text-neutral-300 mb-2">별칭 목록 ({donorAliases.length})</div>
                  <div className="max-h-[140px] overflow-auto pr-1 space-y-1">
                    {donorAliases.length === 0 && (
                      <div className="text-xs text-neutral-500">등록된 별칭이 없습니다.</div>
                    )}
                    {donorAliases.map((a) => (
                      <div key={`${a.alias}:${a.memberId}`} className="text-xs text-neutral-300 flex items-center justify-between gap-2">
                        <span>{a.alias} → {state.members.find((m) => m.id === a.memberId)?.name || a.memberId}</span>
                        <button
                          type="button"
                          className="px-2 py-0.5 rounded bg-neutral-700 hover:bg-neutral-600 text-[11px]"
                          onClick={async () => {
                            const uid = user?.id || "";
                            if (!uid) return;
                            await fetch(`/api/donations/aliases?u=${encodeURIComponent(uid)}`, {
                              method: "DELETE",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ alias: a.alias }),
                            }).catch(() => {});
                            await fetchDonationAliases();
                          }}
                        >
                          삭제
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
                  </div>
                </details>
                <div className="rounded border border-white/10 bg-black/20 p-2">
                  <div className="text-xs text-neutral-400 mb-2">작업 로그 ({toonationLogs.length})</div>
                  <div className="max-h-[160px] overflow-auto pr-1 space-y-1">
                    {toonationLogs.length === 0 && (
                      <div className="text-xs text-neutral-500">로그가 없습니다.</div>
                    )}
                    {toonationLogs.map((log) => (
                      <div key={log.id} className="text-xs text-neutral-300">
                        [{new Date(log.at).toLocaleTimeString("ko-KR", { hour12: false })}] {log.message}
                      </div>
                    ))}
                  </div>
                </div>
                {user?.id &&
                toonationSettingsHydrated &&
                toonationResolvedAlertboxUrl &&
                !isExampleToonationLinkKey(toonationResolvedAlertboxUrl) ? (
                  <ToonationBrowserRelay
                    userId={user.id}
                    linkKey={extractToonationLinkKey(toonationAlertboxUrl) || toonationAlertboxUrl}
                    ownerName={toonationOwnerName}
                    enabled
                    deferToServerListener
                    hidden
                    onForwarded={onBrowserRelayForwarded}
                  />
                ) : null}
              </div>
            </section>

            <section id="contribution-management" className={`${panelCardClass} p-4 md:p-6`}>
              <h2 className="text-lg font-semibold mb-3">기여도 기록부</h2>
              <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto_auto_auto] gap-3">
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={contributionDelta > 0 ? "plus" : "minus"}
                  onChange={(e) => setContributionDelta(e.target.value === "minus" ? -1 : 1)}
                >
                  <option value="plus">추가(+)</option>
                  <option value="minus">차감(-)</option>
                </select>
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="금액 (예: 35000)"
                  inputMode="numeric"
                  value={contributionAmount}
                  onChange={(e) => setContributionAmount(e.target.value)}
                />
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={contributionMemberId || ""}
                  onChange={(e) => setContributionMemberId(e.target.value)}
                >
                  {state.members.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="메모(선택)"
                  value={contributionNote}
                  onChange={(e) => setContributionNote(e.target.value)}
                />
                <button
                  className={`px-4 py-2 rounded font-semibold ${contributionDelta > 0 ? "bg-cyan-600 hover:bg-cyan-500" : "bg-rose-600 hover:bg-rose-500"}`}
                  onClick={addContribution}
                >
                  기여도 반영
                </button>
              </div>
              <div className="text-sm text-neutral-400 mt-2">후원 입력과 동일하게 건별 로그를 남기며, 로그에서 되돌리기/삭제할 수 있습니다.</div>
            </section>

            <section id="restroom-management" className={`${panelCardClass} p-4 md:p-6`}>
              <h2 className="text-lg font-semibold mb-3">화장실 기록부</h2>
              <p className="text-sm text-neutral-400 mb-3">
                엑셀표「화장실」열에만 반영됩니다. 후원·투네 자동 연동 없음 — 수동 차감/추가/무제한만 가능합니다.
                차감 모드에서 횟수를 비우거나 0이면 해당 멤버 화장실을 0으로 초기화합니다. 무제한은 표에{" "}
                <span className="text-cyan-200">{RESTROOM_UNLIMITED_SYMBOL}</span> 로 표시됩니다.
              </p>
              <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto_auto_auto] gap-3">
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={restroomMode}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRestroomMode(v === "plus" ? "plus" : v === "unlimited" ? "unlimited" : "minus");
                  }}
                >
                  <option value="minus">차감(-)</option>
                  <option value="plus">추가(+)</option>
                  <option value="unlimited">무제한({RESTROOM_UNLIMITED_SYMBOL})</option>
                </select>
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 disabled:opacity-50"
                  placeholder={restroomMode === "unlimited" ? "무제한 설정 (횟수 불필요)" : "횟수 (예: 1)"}
                  inputMode="numeric"
                  value={restroomAmount}
                  disabled={restroomMode === "unlimited"}
                  onChange={(e) => setRestroomAmount(e.target.value)}
                />
                <select
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  value={restroomMemberId || ""}
                  onChange={(e) => setRestroomMemberId(e.target.value)}
                >
                  {state.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name} ({formatRestroomDisplay(m.restroom)})
                    </option>
                  ))}
                </select>
                <input
                  className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="메모(선택)"
                  value={restroomNote}
                  onChange={(e) => setRestroomNote(e.target.value)}
                />
                <button
                  className={`px-4 py-2 rounded font-semibold ${
                    restroomMode === "unlimited"
                      ? "bg-violet-600 hover:bg-violet-500"
                      : restroomMode === "plus"
                        ? "bg-cyan-600 hover:bg-cyan-500"
                        : "bg-rose-600 hover:bg-rose-500"
                  }`}
                  onClick={addRestroomRecord}
                >
                  {restroomMode === "unlimited" ? "무제한 설정" : "화장실 반영"}
                </button>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-400">
                      <th className="text-left font-medium p-1">시각</th>
                      <th className="text-left font-medium p-1">멤버</th>
                      <th className="text-left font-medium p-1">구분</th>
                      <th className="text-right font-medium p-1">횟수</th>
                      <th className="text-left font-medium p-1">메모</th>
                      <th className="text-right font-medium p-1 w-28">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(state.restroomLogs || [])
                      .slice()
                      .sort((a, b) => b.at - a.at)
                      .map((log) => {
                        const member = state.members.find((m) => m.id === log.memberId);
                        const unlimitedLog = isRestroomUnlimitedLog(log);
                        return (
                          <tr key={log.id} className="border-t border-white/10">
                            <td className="p-1 text-neutral-400"><ClientTime ts={log.at} /></td>
                            <td className="p-1 text-neutral-300">{member?.name || log.memberId}</td>
                            <td className="p-1">
                              {unlimitedLog ? (
                                <span className="text-violet-300">무제한</span>
                              ) : log.delta > 0 ? (
                                <span className="text-cyan-300">추가</span>
                              ) : (
                                <span className="text-rose-300">차감</span>
                              )}
                            </td>
                            <td className="p-1 text-right whitespace-nowrap">
                              {unlimitedLog ? RESTROOM_UNLIMITED_SYMBOL : log.amount.toLocaleString("ko-KR")}
                            </td>
                            <td className="p-1 text-neutral-400">{log.note || "-"}</td>
                            <td className="p-1 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  className="px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-xs"
                                  onClick={() => {
                                    requestConfirm("화장실 로그 되돌리기", "이 기록을 되돌리고 로그에서 제거할까요?", () => {
                                      setState((prev: AppState) => {
                                        const members = prev.members.map((m: Member) => {
                                          if (m.id !== log.memberId) return m;
                                          return { ...m, restroom: restroomValueAfterUndoLog(m.restroom, log) };
                                        });
                                        const next: AppState = {
                                          ...prev,
                                          members,
                                          restroomLogs: (prev.restroomLogs || []).filter((x) => x.id !== log.id),
                                        };
                                        persistState(next, { includeDonationFields: true });
                                        return next;
                                      });
                                    });
                                  }}
                                >
                                  되돌리기
                                </button>
                                <button
                                  className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
                                  onClick={() => {
                                    requestConfirm("화장실 로그 삭제", "로그만 삭제할까요? (멤버 값은 유지)", () => {
                                      setState((prev: AppState) => {
                                        const next: AppState = {
                                          ...prev,
                                          restroomLogs: (prev.restroomLogs || []).filter((x) => x.id !== log.id),
                                        };
                                        persistState(next, { includeDonationFields: true });
                                        return next;
                                      });
                                    });
                                  }}
                                >
                                  삭제
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    {(state.restroomLogs || []).length === 0 && (
                      <tr><td colSpan={6} className="p-3 text-neutral-500 text-center">기록 없음</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section id="territory-management" className={`${panelCardClass} p-4 md:p-6`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">상류사회 · 영토 기록부</h2>
                <button
                  type="button"
                  className="rounded border border-violet-500/40 bg-violet-950/50 px-3 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-900/60"
                  onClick={() => openAdminHighSocietyPopup(user?.id || overlayUserId)}
                >
                  별도 창에서 열기
                </button>
              </div>
              <p className="text-sm text-neutral-400 mb-3">
                후원·투네와 <strong className="text-neutral-300">자동 연동 없음</strong> — cm을 직접 추가/차감합니다.
                영토 게이지 반영은 이 기록부에서만 합니다(후원 리스트 금액·영토 ON과 무관).
              </p>
              {!highSocietySettings.enabled ? (
                <p className="text-sm text-amber-200/90">상류사회 모드를 ON 한 뒤 사용하세요.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto_auto_auto_auto] gap-3">
                    <select
                      className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      value={territoryMode}
                      onChange={(e) => setTerritoryMode(e.target.value === "minus" ? "minus" : "plus")}
                    >
                      <option value="plus">확장(+)</option>
                      <option value="minus">축소(-)</option>
                    </select>
                    <input
                      className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      placeholder="cm (예: 5, 10)"
                      inputMode="numeric"
                      value={territoryCm}
                      onChange={(e) => setTerritoryCm(e.target.value)}
                    />
                    <select
                      className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      value={territoryMemberId || ""}
                      onChange={(e) => setTerritoryMemberId(e.target.value)}
                      disabled={hsSeatPlayers.length === 0}
                    >
                      {hsSeatPlayers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                    {hsSeatPlayers.length === 0 && (
                      <p className="text-xs text-amber-300/90 col-span-full">
                        좌석 멤버가 없습니다. 오버레이 탭에서 상류사회 좌석을 지정해 주세요.
                      </p>
                    )}
                    <select
                      className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm"
                      value={territoryPushDir}
                      onChange={(e) =>
                        setTerritoryPushDir(
                          e.target.value === "left" || e.target.value === "right" || e.target.value === "split"
                            ? e.target.value
                            : "system"
                        )
                      }
                      title="가운데 좌석만 방향 적용"
                    >
                      <option value="system">방향·시스템</option>
                      <option value="left">← 왼쪽</option>
                      <option value="right">→ 오른쪽</option>
                      <option value="split">↔ 양분</option>
                    </select>
                    <input
                      className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                      placeholder="메모(선택)"
                      value={territoryNote}
                      onChange={(e) => setTerritoryNote(e.target.value)}
                    />
                    <button
                      className={`px-4 py-2 rounded font-semibold ${
                        territoryMode === "plus" ? "bg-amber-600 hover:bg-amber-500" : "bg-rose-600 hover:bg-rose-500"
                      }`}
                      onClick={addTerritoryRecord}
                    >
                      영토 반영
                    </button>
                  </div>
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-neutral-400">
                          <th className="text-left font-medium p-1">시각</th>
                          <th className="text-left font-medium p-1">멤버</th>
                          <th className="text-left font-medium p-1">구분</th>
                          <th className="text-right font-medium p-1">cm</th>
                          <th className="text-left font-medium p-1">방향</th>
                          <th className="text-left font-medium p-1">메모</th>
                          <th className="text-right font-medium p-1 w-24">작업</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(state.territoryLogs || [])
                          .slice()
                          .sort((a, b) => b.at - a.at)
                          .map((log) => {
                            const member = state.members.find((m) => m.id === log.memberId);
                            return (
                              <tr key={log.id} className="border-t border-white/10">
                                <td className="p-1 text-neutral-400">
                                  <ClientTime ts={log.at} />
                                </td>
                                <td className="p-1 text-neutral-300">{member?.name || log.memberId}</td>
                                <td className="p-1">
                                  {log.delta > 0 ? (
                                    <span className="text-amber-300">확장</span>
                                  ) : (
                                    <span className="text-rose-300">축소</span>
                                  )}
                                </td>
                                <td className="p-1 text-right tabular-nums">{log.amount}</td>
                                <td className="p-1 text-neutral-400">
                                  {formatTerritoryLogPushDirLabel(log, highSocietySettings, state.members || [])}
                                </td>
                                <td className="p-1 text-neutral-400">{log.note || "-"}</td>
                                <td className="p-1 text-right">
                                  <button
                                    className="px-2 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-xs"
                                    onClick={() => {
                                      requestConfirm("영토 로그 삭제", "이 기록을 삭제할까요?", () => {
                                        setState((prev: AppState) => {
                                          let next: AppState = {
                                            ...prev,
                                            territoryLogs: (prev.territoryLogs || []).filter(
                                              (x) => x.id !== log.id
                                            ),
                                            updatedAt: Date.now(),
                                          };
                                          next = syncHighSocietyMemberWidthSnapshotInState(next);
                                          persistState(next, { omitDonationFields: true });
                                          notifyBroadcastStateLocalUpdated(user?.id, next.updatedAt);
                                          return next;
                                        });
                                      });
                                    }}
                                  >
                                    삭제
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        {(state.territoryLogs || []).length === 0 && (
                          <tr>
                            <td colSpan={7} className="p-3 text-neutral-500 text-center">
                              기록 없음
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>

            <section className={`${panelCardClass} p-4 md:p-6 ${simpleMode ? "hidden" : ""}`}>
              <h2 className="text-lg font-semibold mb-3">채팅용 복사 & 보안</h2>
              <textarea
                className="w-full min-h-[100px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10 font-mono"
                value={chatDraft}
                onChange={(e) => { setChatDraft(e.target.value); setChatDraftDirty(true); }}
                placeholder="여기에 결과가 표시됩니다. 방송 전 텍스트를 직접 보정할 수 있어요."
              />
              <div className="flex gap-2 mt-2">
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={regenerateDraft}
                >
                  재생성
                </button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={onCopyDraft}
                >
                  복사하기
                </button>
                {copied && <span className="self-center text-emerald-400">복사됨</span>}
              </div>
              <div className="text-sm text-neutral-400 mt-2">
                HTTPS 환경에서 클립보드 API 사용. 실패 시 폴백 사용.
              </div>
            </section>

            <section id="donor-list" className={`${panelCardClass} p-4 md:p-6 ${simpleMode ? "hidden" : ""}`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">후원자 리스트</h2>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded bg-violet-800 hover:bg-violet-700 text-sm"
                  title="3분 자동 저장된 일일 로그 — 오늘 스냅샷 우선, 없으면 최근"
                  onClick={() => void restoreDonorsFromDailyLogSnapshot()}
                >
                  일일 로그에서 후원 복구
                </button>
              </div>

              <div className="mb-3 rounded-lg border border-amber-400/40 bg-amber-950/30 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-amber-100">상류사회 · 영토</div>
                    <p className="text-[11px] text-neutral-400 mt-0.5">
                      후원·투네 합산은 영토 게이지와 <strong className="text-neutral-300">연동되지 않습니다</strong>.
                      cm 조절은 아래 「상류사회 · 영토 기록부」에서만 수동 반영하세요.
                      {" · "}
                      참고: <strong className="text-neutral-300">1만원 = 5cm</strong>
                    </p>
                  </div>
                  <span
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold shrink-0 ${
                      highSocietySettings.enabled
                        ? "bg-amber-600/90 text-white"
                        : "bg-neutral-800 text-neutral-400"
                    }`}
                  >
                    {highSocietySettings.enabled ? "모드 ON" : "모드 OFF"}
                  </span>
                </div>
                {highSocietySettings.enabled ? (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-300">
                    <span className="text-neutral-400">가운데 기본</span>
                    <button
                      type="button"
                      className={`rounded px-2.5 py-1 font-semibold border ${
                        resolveSystemMiddlePushDir(highSocietySettings) === "left"
                          ? "border-amber-400 bg-amber-700/90 text-white"
                          : "border-white/15 bg-neutral-900"
                      }`}
                      onClick={() => patchHighSocietySettings({ defaultMiddlePush: "left" })}
                    >
                      ← 왼쪽
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2.5 py-1 font-semibold border ${
                        resolveSystemMiddlePushDir(highSocietySettings) === "right"
                          ? "border-amber-400 bg-amber-700/90 text-white"
                          : "border-white/15 bg-neutral-900"
                      }`}
                      onClick={() => patchHighSocietySettings({ defaultMiddlePush: "right" })}
                    >
                      오른쪽 →
                    </button>
                    <button
                      type="button"
                      className="text-sky-400 underline ml-1"
                      onClick={() => {
                        moveToSection("overlay", "overlay-settings");
                        window.setTimeout(() => {
                          document.getElementById("high-society-overlay")?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }, 80);
                      }}
                    >
                      좌석·전장 설정
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="max-h-[260px] overflow-auto pr-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-400">
                      <th className="text-left font-medium p-1">시간</th>
                      <th className="text-left font-medium p-1">후원자</th>
                      <th className="text-left font-medium p-1">멤버</th>
                      <th className="text-left font-medium p-1">대상</th>
                      <th className="text-left font-medium p-1 min-w-[120px]">메시지</th>
                      <th className="text-right font-medium p-1">금액</th>
                      <th className="text-right font-medium p-1 w-28">나누기</th>
                      <th className="text-right font-medium p-1 w-16">삭제</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donorListRows
                      .slice()
                      .sort((a,b)=>b.at-a.at)
                      .map((d) => {
                        const isSplitPart = isGroupSplitPartDonor(d);
                        const isSplitSource = isGroupSplitSourceDonor(state, d);
                        const splitPartCount = isSplitSource ? countGroupSplitParts(state, d.id) : 0;
                        const splitPreview = !isSplitPart && !isSplitSource
                          ? previewGroupSplitDonation(state, d.amount, state.groupSplitDonationSettings)
                          : null;
                        return (
                          <tr key={d.id} className={`border-t border-white/10 ${isSplitPart ? "bg-violet-950/15" : isSplitSource ? "bg-violet-950/10" : ""}`}>
                            <td className="p-1 text-neutral-400"><ClientTime ts={d.at} /></td>
                            <td className="p-1">
                              {d.name}
                              {isSplitPart ? (
                                <span className="ml-1 rounded bg-violet-800/60 px-1 py-0.5 text-[10px] text-violet-200">
                                  스플릿
                                </span>
                              ) : isSplitSource ? (
                                <>
                                  <span className="ml-1 rounded bg-violet-800/60 px-1 py-0.5 text-[10px] text-violet-200">
                                    스플릿됨
                                  </span>
                                  <span className="ml-1 rounded bg-neutral-700/80 px-1 py-0.5 text-[10px] text-neutral-300">
                                    후원 제외
                                  </span>
                                </>
                              ) : null}
                            </td>
                            <td className="p-1 text-neutral-300">
                              <select
                                className="max-w-[9rem] rounded border border-white/10 bg-neutral-900/80 px-1 py-0.5 text-xs text-neutral-100"
                                value={d.memberId || ""}
                                title="후원자명은 유지하고 배치 멤버만 변경"
                                onChange={(e) => {
                                  const nextMemberId = e.target.value;
                                  if (!nextMemberId || nextMemberId === d.memberId) return;
                                  const memberName =
                                    state.members.find((x) => x.id === nextMemberId)?.name || nextMemberId;
                                  requestConfirm(
                                    "멤버 재배치",
                                    `후원자「${d.name}」의 배치만「${memberName}」로 바꿀까요? (후원자명·금액·메시지는 그대로입니다)`,
                                    () => {
                                      void (async () => {
                                        const prev = stateRef.current;
                                        const next = reassignDonorMemberInAppState(prev, d.id, nextMemberId);
                                        if (!next) return;
                                        const preserved = markAuthoritativeDonationSave(
                                          { serverUpdatedAt: next.updatedAt },
                                          next,
                                          { replaceDonors: true, awaitingServerSave: true }
                                        );
                                        setState(preserved);
                                        await commitAuthoritativeDonorPersist(preserved);
                                      })();
                                    },
                                    { confirmText: "재배치", danger: false }
                                  );
                                }}
                              >
                                {state.members.map((mem) => (
                                  <option key={mem.id} value={mem.id}>
                                    {mem.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="p-1">{(d.target || "account") === "toon" ? <span className="text-amber-300">투네</span> : <span className="text-emerald-300">계좌</span>}</td>
                            <td className="p-1 text-neutral-400 max-w-[220px]">
                              <input
                                type="text"
                                key={`${d.id}:${d.message || ""}`}
                                className="w-full min-w-[8rem] rounded border border-white/10 bg-neutral-950/80 px-1.5 py-0.5 text-xs text-neutral-200 placeholder:text-neutral-600"
                                defaultValue={d.message || ""}
                                placeholder="메시지 입력"
                                title="투네 통합알림 comment·후원 문구 — 클릭 후 입력하고 포커스를 벗어나면 저장"
                                onBlur={(e) => {
                                  const nextMessage = e.target.value;
                                  if (String(nextMessage || "").trim() === String(d.message || "").trim()) return;
                                  void (async () => {
                                    const prev = stateRef.current;
                                    const next = updateDonorMessageInAppState(prev, d.id, nextMessage);
                                    if (!next) return;
                                    const preserved = markAuthoritativeDonationSave(
                                      { serverUpdatedAt: next.updatedAt },
                                      next,
                                      { replaceDonors: true, awaitingServerSave: true }
                                    );
                                    setState(preserved);
                                    await commitAuthoritativeDonorPersist(preserved);
                                  })();
                                }}
                              />
                            </td>
                            <td className="p-1 text-right whitespace-nowrap" title={`저장값 ${d.amount.toLocaleString("ko-KR")}원${isSplitSource ? " (합산 제외)" : ""}`}>
                              <span className={isSplitSource ? "text-neutral-500 line-through decoration-neutral-600" : ""}>
                                {formatDonorAmountDisplay(d.amount)}
                              </span>
                            </td>
                            <td className="p-1 text-right">
                              {isSplitPart ? (
                                <span className="text-[10px] text-violet-300/90 whitespace-nowrap">↳ 스플릿</span>
                              ) : isSplitSource ? (
                                <span
                                  className="text-[10px] text-violet-300/90 whitespace-nowrap"
                                  title={`${splitPartCount}명에게 분배됨`}
                                >
                                  스플릿됨 · {splitPartCount}명
                                </span>
                              ) : splitPreview && splitPreview.eligibleMembers.length > 0 && splitPreview.sharePerMember > 0 ? (
                                <button
                                  type="button"
                                  className="px-2 py-0.5 rounded bg-violet-800 hover:bg-violet-700 text-[10px] whitespace-nowrap"
                                  title={`${splitPreview.sharePerMember.toLocaleString("ko-KR")}원 × ${splitPreview.eligibleMembers.length}명`}
                                  onClick={() => {
                                    requestConfirm(
                                      "단체짠 나누기",
                                      `${d.name} ${d.amount.toLocaleString("ko-KR")}원(총액 유지)을 ${splitPreview.eligibleMembers.length}명에게 나눕니다. 1인 ${splitPreview.sharePerMember.toLocaleString("ko-KR")}원${splitPreview.remainderToFirst > 0 ? `(+${splitPreview.remainderToFirst.toLocaleString("ko-KR")}원은 첫 멤버)` : ""}. 기존 1인 적립은 취소됩니다.`,
                                      () => void applyGroupSplitFromDonor(d),
                                      { confirmText: "나누기", danger: false }
                                    );
                                  }}
                                >
                                  나누기
                                </button>
                              ) : (
                                <span className="text-neutral-600">—</span>
                              )}
                            </td>
                            <td className="p-1 text-right">
                              {isSplitSource ? (
                                <span className="text-[10px] text-neutral-500">삭제 불가</span>
                              ) : (
                                <button
                                  className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                                  onClick={() => {
                                    requestConfirm("후원 기록 삭제", "해당 후원 기록을 삭제할까요?", () => {
                                      void (async () => {
                                        void removeQueueEventsMatchingDonor(d);
                                        const prev = stateRef.current;
                                        const next = revertDonationFromAppState(prev, d.id);
                                        if (!next) return;
                                        const preserved = markAuthoritativeDonationSave(
                                          { serverUpdatedAt: next.updatedAt },
                                          next,
                                          { replaceDonors: true, awaitingServerSave: true }
                                        );
                                        setState(preserved);
                                        const ok = await commitAuthoritativeDonorPersist(preserved);
                                        if (!ok) {
                                          return;
                                        }
                                      })();
                                    }, { confirmText: "삭제", danger: true });
                                  }}
                                >
                                  삭제
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    {donorListRows.length === 0 && (
                      <tr><td className="p-2 text-neutral-400" colSpan={8}>기록이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="text-xs text-neutral-400 mt-2">
                후원자 리스트는 건별 기록입니다. (동일 후원자여도 건별로 별도 행 표시)
                {" "}
                <strong className="text-neutral-300">멤버</strong> 열에서 후원자명은 그대로 두고 배치만 바꿀 수 있습니다.
                {" "}
                투네이션 <strong className="text-neutral-300">통합알림창 하단 후원 메시지(comment)</strong>는
                잘라내지 않고 <strong className="text-neutral-300">메시지</strong> 열에 원문 그대로 저장됩니다.
                {" "}
                비어 있는 행은 셀을 클릭해 직접 입력·저장할 수 있습니다.
                {" "}
                (예: 알림 닉「Y 철수」+ 메시지「익명 비서」→ 후원자 Y 철수, 메시지 익명 비서)
                {" "}
                단체 후원은 리스트 <strong className="text-violet-300">나누기</strong>로 균등 분배하거나, 멤버·금액을 나눠 <strong className="text-neutral-300">합산 추가</strong>로 수동 입력하세요.
              </div>
            </section>

            <section className={`${panelCardClass} p-4 md:p-6 ${simpleMode ? "hidden" : ""}`}>
              <h2 className="text-lg font-semibold mb-3">기여도 로그</h2>
              <div className="max-h-[260px] overflow-auto pr-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-400">
                      <th className="text-left font-medium p-1">시간</th>
                      <th className="text-left font-medium p-1">멤버</th>
                      <th className="text-left font-medium p-1">구분</th>
                      <th className="text-right font-medium p-1">금액</th>
                      <th className="text-left font-medium p-1">메모</th>
                      <th className="text-right font-medium p-1 w-28">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(state.contributionLogs || [])
                      .slice()
                      .sort((a, b) => b.at - a.at)
                      .map((log) => {
                        const member = state.members.find((m) => m.id === log.memberId);
                        return (
                          <tr key={log.id} className="border-t border-white/10">
                            <td className="p-1 text-neutral-400"><ClientTime ts={log.at} /></td>
                            <td className="p-1 text-neutral-300">{member?.name || log.memberId}</td>
                            <td className="p-1">{log.delta > 0 ? <span className="text-cyan-300">추가</span> : <span className="text-rose-300">차감</span>}</td>
                            <td className="p-1 text-right whitespace-nowrap" title={`저장값 ${log.amount.toLocaleString("ko-KR")}원`}>
                              {formatDonorAmountDisplay(log.amount)}
                            </td>
                            <td className="p-1 text-neutral-400">{log.note || "-"}</td>
                            <td className="p-1 text-right">
                              <div className="flex justify-end gap-1">
                                <button
                                  className="px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-xs"
                                  onClick={() => {
                                    requestConfirm("기여도 로그 되돌리기", "이 기록을 되돌리고 로그에서 제거할까요?", () => {
                                      setState((prev: AppState) => {
                                        const members = prev.members.map((m: Member) => {
                                          if (m.id !== log.memberId) return m;
                                          const curr = Math.max(0, m.contribution || 0);
                                          const nextContribution = log.delta > 0
                                            ? Math.max(0, curr - log.amount)
                                            : curr + log.amount;
                                          return { ...m, contribution: nextContribution };
                                        });
                                        const next: AppState = {
                                          ...prev,
                                          members,
                                          contributionLogs: (prev.contributionLogs || []).filter((x) => x.id !== log.id),
                                        };
                                        persistState(next, { includeDonationFields: true });
                                        return next;
                                      });
                                    }, { confirmText: "되돌리기", danger: true });
                                  }}
                                >
                                  되돌리기
                                </button>
                                <button
                                  className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                  onClick={() => {
                                    requestConfirm("기여도 로그 삭제", "값 변화 없이 로그만 삭제할까요?", () => {
                                      setState((prev: AppState) => {
                                        const next: AppState = {
                                          ...prev,
                                          contributionLogs: (prev.contributionLogs || []).filter((x) => x.id !== log.id),
                                        };
                                        persistState(next, { includeDonationFields: true });
                                        return next;
                                      });
                                    }, { confirmText: "삭제", danger: true });
                                  }}
                                >
                                  삭제
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    {(state.contributionLogs || []).length === 0 && (
                      <tr><td className="p-2 text-neutral-400" colSpan={6}>기록이 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={`${panelCardClass} p-4 md:p-6 ${simpleMode ? "hidden" : ""}`}>
              <h2 className="text-lg font-semibold mb-3">후원자별 누적 합계</h2>
              <div className="max-h-[240px] overflow-auto pr-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-neutral-400">
                      <th className="text-left font-medium p-1">후원자</th>
                      <th className="text-right font-medium p-1">계좌 누적</th>
                      <th className="text-right font-medium p-1">투네 누적</th>
                      <th className="text-right font-medium p-1">총 누적</th>
                      <th className="text-right font-medium p-1">건수</th>
                    </tr>
                  </thead>
                  <tbody>
                    {donorTotalsByName.map((row) => (
                      <tr key={row.name} className="border-t border-white/10">
                        <td className="p-1">{row.name}</td>
                        <td className="p-1 text-right whitespace-nowrap text-emerald-300" title={`저장값 ${row.account.toLocaleString("ko-KR")}원`}>
                          {formatDonorAmountDisplay(row.account)}
                        </td>
                        <td className="p-1 text-right whitespace-nowrap text-amber-300" title={`저장값 ${row.toon.toLocaleString("ko-KR")}원`}>
                          {formatDonorAmountDisplay(row.toon)}
                        </td>
                        <td className="p-1 text-right whitespace-nowrap font-semibold" title={`합계 ${row.total.toLocaleString("ko-KR")}원`}>
                          {formatDonorAmountDisplay(row.total)}
                        </td>
                        <td className="p-1 text-right text-neutral-400">{row.count}</td>
                      </tr>
                    ))}
                    {donorTotalsByName.length === 0 && (
                      <tr><td className="p-2 text-neutral-400" colSpan={5}>누적 데이터가 없습니다.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={`${panelCardClass} p-4 md:p-6`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">미션 전광판</h2>
                <div className="flex items-center gap-2">
                  <button
                    className="px-2 py-1 rounded bg-emerald-800 hover:bg-emerald-700 text-xs disabled:opacity-50"
                    disabled={missionRestoreLoading}
                    onClick={async () => {
                      setMissionRestoreLoading(true);
                      try {
                        const backup = loadMissionsBackup(user?.id);
                        if (backup && backup.length > 0) {
                          setState((prev) => {
                            const next = { ...prev, missions: backup };
                            persistState(next);
                            return next;
                          });
                          return;
                        }
                        const apiState = await loadStateFromApi(user?.id);
                        if (!apiState || !Array.isArray(apiState.missions) || apiState.missions.length === 0) {
                          alert("서버에 저장된 미션 데이터가 없습니다.");
                          return;
                        }
                        setState((prev) => {
                          const next = { ...prev, missions: apiState.missions! };
                          persistState(next);
                          return next;
                        });
                      } finally {
                        setMissionRestoreLoading(false);
                      }
                    }}
                    title="실수로 초기화했을 경우 서버에 저장된 미션을 복구합니다"
                  >
                    {missionRestoreLoading ? "불러오는 중..." : "서버에서 불러오기"}
                  </button>
                  <button
                    className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs"
                    onClick={() => {
                      requestConfirm("미션 전광판 초기화", "계정에 저장된 모든 미션을 삭제할까요? (서버에서 불러오기로 복구 가능)", () => {
                        setState((prev) => {
                          if ((prev.missions || []).length > 0) {
                            saveMissionsBackup(prev.missions || [], user?.id);
                          }
                          const next = { ...prev, missions: [] };
                          persistState(next);
                          return next;
                        });
                      }, { confirmText: "초기화", danger: true });
                    }}
                  >
                    초기화
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] gap-2 mb-3">
                <input className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 min-h-[44px]" placeholder="미션 제목 (예: 노래 부르기)" value={missionTitle} onChange={(e) => setMissionTitle(e.target.value)} />
                <input className="px-3 py-2 rounded bg-neutral-900/80 border border-white/10 w-full sm:w-32 min-h-[44px]" placeholder="가격 (예: 3만)" value={missionPrice} onChange={(e) => setMissionPrice(e.target.value)} />
                <button className="px-4 py-2 rounded bg-amber-700 hover:bg-amber-600 font-semibold min-h-[44px]" onClick={() => {
                  if (!missionTitle.trim()) return;
                  setState((prev) => {
                    const m: MissionItem = { id: `mis_${Date.now()}`, title: missionTitle.trim(), price: missionPrice.trim() || "무료" };
                    const next = { ...prev, missions: [...(prev.missions || []), m] };
                    persistState(next);
                    return next;
                  });
                  setMissionTitle(""); setMissionPrice("");
                }}>추가</button>
              </div>
              {(state.missions || []).length === 0 && <div className="text-sm text-neutral-400 p-4 text-center border border-dashed border-white/10 rounded">미션이 없습니다.</div>}
              {(state.missions || []).length > 0 && (
                <div className="space-y-1 max-h-[340px] overflow-auto">
                  {(state.missions || []).map((mis, idx) => (
                    <div key={mis.id}
                      className="flex items-center gap-2 px-3 py-2 rounded bg-neutral-900/40 border border-white/10 min-h-[44px]"
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", String(idx)); }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const src = parseInt(e.dataTransfer.getData("text/plain") || "-1", 10);
                        if (isNaN(src) || src < 0 || src === idx) return;
                        setState((prev) => {
                          const arr = [...(prev.missions || [])];
                          const [moved] = arr.splice(src, 1);
                          arr.splice(idx, 0, moved);
                          const next = { ...prev, missions: arr };
                          persistState(next); return next;
                        });
                      }}
                    >
                      <span className="text-sm font-mono text-neutral-500 w-6">{idx + 1}</span>
                      <input className="flex-1 px-2 py-1 rounded bg-neutral-800 border border-white/10 text-sm min-h-[40px]" value={mis.title} onChange={(e) => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).map(m => m.id === mis.id ? { ...m, title: e.target.value } : m) };
                          persistState(next); return next;
                        });
                      }} />
                      <input className="w-24 px-2 py-1 rounded bg-neutral-800 border border-white/10 text-sm text-right min-h-[40px]" value={mis.price} onChange={(e) => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).map(m => m.id === mis.id ? { ...m, price: e.target.value } : m) };
                          persistState(next); return next;
                        });
                      }} />
                      <button className={`px-2 py-1 rounded border text-xs min-h-[36px] ${mis.isHot ? "border-red-500 text-red-300" : "border-white/10 text-neutral-500"}`} onClick={() => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).map(m => m.id === mis.id ? { ...m, isHot: !m.isHot } : m) };
                          persistState(next); return next;
                        });
                      }}>{mis.isHot ? "HOT" : "hot"}</button>
                      <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs min-h-[36px]" onClick={() => {
                        if (idx === 0) return;
                        setState((prev) => {
                          const arr = [...(prev.missions || [])];
                          [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                          const next = { ...prev, missions: arr };
                          persistState(next); return next;
                        });
                      }}>▲</button>
                      <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs min-h-[36px]" onClick={() => {
                        if (idx >= (state.missions || []).length - 1) return;
                        setState((prev) => {
                          const arr = [...(prev.missions || [])];
                          [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                          const next = { ...prev, missions: arr };
                          persistState(next); return next;
                        });
                      }}>▼</button>
                      <button className="px-2 py-1 rounded bg-red-800 hover:bg-red-700 text-xs min-h-[36px]" onClick={() => {
                        setState((prev) => {
                          const next = { ...prev, missions: (prev.missions || []).filter(m => m.id !== mis.id) };
                          persistState(next); return next;
                        });
                      }}>삭제</button>
                    </div>
                  ))}
                </div>
              )}
              <div className="text-xs text-neutral-400 mt-2">오버레이 프리셋에서 &quot;미션 전광판&quot;을 ON하면 우측→좌측 흐름으로 방송 화면에 표시됩니다.</div>
            </section>
            </>
            )}

            {isAdminNavSectionVisible("overlay") && (
            <section id="overlay-settings" className={`${panelCardClass} p-4 md:p-6`}>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">오버레이 관리 (다중)</h2>
                <div className="flex gap-1 flex-wrap">
                  {PRESET_TEMPLATES.map((t) => (
                    <button key={t.name} className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs text-white" onClick={() => addPreset(t.name, t.preset)}>+ {t.name}</button>
                  ))}
                </div>
              </div>
              <p className="text-xs text-neutral-400 mb-3">각 오버레이는 독립 URL을 가집니다. OBS/Prism에 브라우저 소스로 각각 추가하세요.</p>
              <p className="text-xs text-neutral-500 mb-3">
                복사되는 URL은 <span className="text-neutral-300">서버(Redis)에 저장된 최신 상태</span>를 실시간으로 불러옵니다. 아래 프레임 미리보기만 편집 시점 스냅샷을 쓸 수 있습니다.
                위치/크기는 Prism에서 조정하세요. 세로 방송이면 브라우저 소스를 1080×1920에 맞추면 됩니다.
              </p>
              <div className="mb-3 rounded border border-white/10 bg-black/20 p-2 text-xs text-neutral-400 flex flex-wrap items-center gap-2">
                <span>후원 순위 (10위):</span>
                <code className="text-neutral-300 break-all">/overlay/donor-rankings?u={overlayUserId}&host=obs</code>
                <button
                  type="button"
                  className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-donor-rankings-inline" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                  onClick={() => {
                    const u = buildDonorRankingsUrl();
                    void copyUrl(u, "dash-donor-rankings-inline");
                  }}
                >
                  {copiedId === "dash-donor-rankings-inline" ? "복사됨!" : "URL 복사"}
                </button>
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs text-white"
                  onClick={() => window.open(buildDonorRankingsUrl(), "_blank", "noopener,noreferrer")}
                >
                  오버레이 열기
                </button>
              </div>
              <div className="mb-3 rounded border border-white/10 bg-black/20 p-2 text-xs text-neutral-400 flex flex-wrap items-center gap-2">
                <span>전체 순위 (세로):</span>
                <code className="text-neutral-300 break-all">/overlay/donor-rankings/full?u={overlayUserId}&host=obs</code>
                <button
                  type="button"
                  className={`px-2 py-1 rounded text-xs shrink-0 ${copiedId === "dash-donor-rankings-full-inline" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                  onClick={() => {
                    const u = buildDonorRankingsUrl({ full: true });
                    void copyUrl(u, "dash-donor-rankings-full-inline");
                  }}
                >
                  {copiedId === "dash-donor-rankings-full-inline" ? "복사됨!" : "URL 복사"}
                </button>
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs text-white"
                  onClick={() => window.open(buildDonorRankingsUrl({ full: true }), "_blank", "noopener,noreferrer")}
                >
                  오버레이 열기
                </button>
              </div>
              <div className="mb-3 rounded border border-fuchsia-500/25 bg-fuchsia-950/20 p-3 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-fuchsia-100">후원 순위 · 글자·색상</h4>
                  <p className="mt-1 text-[11px] text-neutral-400 leading-snug">
                    Prism/OBS 브라우저 소스는 <strong className="text-neutral-300">저장 즉시 반영</strong>됩니다(URL 재복사 불필요).
                    후원 순위 테마·프리셋 상세는 <button type="button" className="text-sky-400 underline" onClick={() => document.getElementById("donor-management")?.scrollIntoView({ behavior: "smooth" })}>후원자</button> 탭에도 있습니다. 배경 GIF·본문 이미지는 아래 「오버레이 배경 · 본문 이미지」에서 설정하세요.
                  </p>
                </div>
                <label className="text-[11px] text-neutral-400 flex flex-col gap-1 rounded border border-fuchsia-500/25 bg-black/25 px-2 py-2">
                  <span>제목 문구</span>
                  <input
                    type="text"
                    value={state.donorRankingsTheme.titleText || ""}
                    onChange={(e) => updateDonorRankingsTheme({ titleText: e.target.value })}
                    className="h-8 w-full rounded border border-white/10 bg-neutral-900/80 px-2 text-sm"
                    placeholder="후원 순위"
                    maxLength={60}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label className="text-[11px] text-neutral-400">
                    제목(px)
                    <input
                      type="range"
                      min={14}
                      max={80}
                      value={state.donorRankingsTheme.titleSize}
                      onChange={(e) => updateDonorRankingsTheme({ titleSize: Number(e.target.value) })}
                      className="w-full"
                    />
                    <span className="text-xs text-neutral-300">{state.donorRankingsTheme.titleSize}px</span>
                  </label>
                  <label className="text-[11px] text-neutral-400">
                    행(px)
                    <input
                      type="range"
                      min={12}
                      max={64}
                      value={state.donorRankingsTheme.rowSize}
                      onChange={(e) => updateDonorRankingsTheme({ rowSize: Number(e.target.value) })}
                      className="w-full"
                    />
                    <span className="text-xs text-neutral-300">{state.donorRankingsTheme.rowSize}px</span>
                  </label>
                  <label className="text-[11px] text-neutral-400">
                    순위(px)
                    <input
                      type="range"
                      min={12}
                      max={72}
                      value={state.donorRankingsTheme.rankSize}
                      onChange={(e) => updateDonorRankingsTheme({ rankSize: Number(e.target.value) })}
                      className="w-full"
                    />
                    <span className="text-xs text-neutral-300">{state.donorRankingsTheme.rankSize}px</span>
                  </label>
                  <label className="text-[11px] text-neutral-400">
                    배경 투명도(헤더·목록·행 · 덜 어둡게)
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={state.donorRankingsTheme.overlayOpacity}
                      onChange={(e) => updateDonorRankingsTheme({ overlayOpacity: Number(e.target.value) })}
                      className="w-full"
                    />
                    <span className="text-xs text-neutral-300">{state.donorRankingsTheme.overlayOpacity}%</span>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                  {(
                    [
                      ["titleColor", "제목 색"],
                      ["rankColor", "순위 색"],
                      ["nameColor", "닉네임 색"],
                      ["amountColor", "금액 색"],
                      ["headerAccountBg", "헤더 배경"],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-neutral-400"
                    >
                      <span>{label}</span>
                      <input
                        type="color"
                        value={toColorPickerValue(
                          String((state.donorRankingsTheme as unknown as Record<string, unknown>)[key] ?? ""),
                          "#ffffff"
                        )}
                        onChange={(e) =>
                          updateDonorRankingsTheme({ [key]: e.target.value } as Partial<AppState["donorRankingsTheme"]>)
                        }
                        className="h-7 w-9 rounded border border-white/20 bg-transparent p-0.5"
                      />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {(
                    [
                      ["bg", "전체 배경", "#ffffff"],
                      ["panelBg", "패널 배경", "#fff8fc"],
                    ] as const
                  ).map(([key, label, fallback]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded border border-fuchsia-500/25 bg-black/25 px-2 py-1 text-[11px] text-neutral-400"
                    >
                      <span className="w-24 shrink-0">{label}</span>
                      <input
                        type="color"
                        value={toColorPickerValue(
                          String((state.donorRankingsTheme as unknown as Record<string, unknown>)[key] ?? ""),
                          fallback
                        )}
                        onChange={(e) =>
                          updateDonorRankingsTheme({ [key]: e.target.value } as Partial<AppState["donorRankingsTheme"]>)
                        }
                        className="h-7 w-9 shrink-0 rounded border border-white/20 bg-transparent p-0.5"
                      />
                      <input
                        type="text"
                        value={String((state.donorRankingsTheme as unknown as Record<string, unknown>)[key] || "")}
                        onChange={(e) =>
                          updateDonorRankingsTheme({ [key]: e.target.value } as Partial<AppState["donorRankingsTheme"]>)
                        }
                        className="h-7 min-w-0 flex-1 rounded border border-white/10 bg-neutral-900/80 px-2 text-xs"
                        placeholder="transparent / rgba(...)"
                      />
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="flex items-center gap-2 rounded border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-neutral-400">
                    <span className="w-24 shrink-0">텍스트 외곽선</span>
                    <input
                      type="text"
                      value={state.donorRankingsTheme.outlineColor || ""}
                      onChange={(e) => updateDonorRankingsTheme({ outlineColor: e.target.value })}
                      className="h-7 w-full rounded border border-white/10 bg-neutral-900/80 px-2 text-xs"
                      placeholder="rgba(...) / #000"
                    />
                  </label>
                  <label className="flex flex-col gap-1 rounded border border-white/10 bg-black/25 px-2 py-2 text-[11px] text-neutral-400">
                    <span>텍스트 외곽선 두께(px)</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={DONOR_RANKINGS_OUTLINE_MAX_PX}
                        step={0.25}
                        value={state.donorRankingsTheme.outlineWidth}
                        onChange={(e) => updateDonorRankingsTheme({ outlineWidth: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <input
                        type="number"
                        min={0}
                        max={DONOR_RANKINGS_OUTLINE_MAX_PX}
                        step={0.25}
                        value={state.donorRankingsTheme.outlineWidth}
                        onChange={(e) =>
                          updateDonorRankingsTheme({
                            outlineWidth: Math.max(
                              0,
                              Math.min(DONOR_RANKINGS_OUTLINE_MAX_PX, parseFloat(e.target.value || "0") || 0)
                            ),
                          })
                        }
                        className="w-16 rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs text-right"
                      />
                    </div>
                  </label>
                </div>
              </div>
              <div id="overlay-bg-media" className="mb-4 space-y-1">
                <h3 className="text-sm font-semibold text-fuchsia-100">오버레이 배경 · 본문 이미지</h3>
                <p className="text-[11px] text-neutral-400 leading-snug">
                  후원 순위·엑셀표 오버레이의 GIF 배경·본문 이미지입니다. 각 URL과 연동되어 저장됩니다.
                </p>
              </div>
              <div className="mt-3 rounded-2xl border border-fuchsia-400/35 bg-gradient-to-br from-fuchsia-950/55 via-rose-950/45 to-pink-950/40 p-4 shadow-[0_10px_36px_rgba(236,72,153,0.22)] backdrop-blur-md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-pink-100">후원 랭킹 · 배경 GIF</h4>
                    <p className="mt-1 max-w-xl text-xs text-pink-100/75">
                      후원 랭킹(<code className="text-pink-50/90">/overlay/donor-rankings</code>) 전용 배경입니다. 엑셀표 배경과 분리되어 독립 저장됩니다.
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <code className="max-w-[min(100%,420px)] break-all text-[11px] text-fuchsia-100/90">
                      /overlay/donor-rankings?u={overlayUserId}&host=obs
                    </code>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${copiedId === "dash-donor-rankings-bg" ? "bg-emerald-600" : "bg-white/15 text-pink-50 hover:bg-white/25"}`}
                        onClick={() => {
                          const u = buildDonorRankingsUrl();
                          void copyUrl(u, "dash-donor-rankings-bg");
                        }}
                      >
                        {copiedId === "dash-donor-rankings-bg" ? "복사됨!" : "URL 복사"}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-gradient-to-r from-fuchsia-600 to-pink-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:from-fuchsia-500 hover:to-pink-500"
                        onClick={() => window.open(buildDonorRankingsUrl(), "_blank", "noopener,noreferrer")}
                      >
                        오버레이 열기
                      </button>
                    </div>
                  </div>
                </div>
                {(() => {
                  const drCfg = normalizeDonorRankingsOverlayConfig(state.donorRankingsOverlayConfig);
                  const presetSelectValue = DONATION_LISTS_BG_GIF_PRESETS.some((p) => p.url && p.url === drCfg.bgGifUrl)
                    ? drCfg.bgGifUrl
                    : drCfg.bgGifUrl.trim()
                      ? "__custom__"
                      : "";
                  return (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        GIF 프리셋
                        <select
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 shadow-inner outline-none focus:border-fuchsia-400/70"
                          value={presetSelectValue}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__custom__") return;
                            updateDonorRankingsOverlayConfig({
                              bgGifUrl: v,
                              isBgEnabled: Boolean(String(v || "").trim()),
                            });
                          }}
                        >
                          {DONATION_LISTS_BG_GIF_PRESETS.map((p) => (
                            <option key={p.label} value={p.url}>
                              {p.label}
                            </option>
                          ))}
                          <option value="__custom__">직접 URL 입력</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        GIF URL (https… 또는 /public 경로)
                        <input
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 placeholder:text-pink-200/40 outline-none focus:border-fuchsia-400/70"
                          placeholder="예: https://media.giphy.com/... 또는 /images/bg/my.gif"
                          value={drCfg.bgGifUrl}
                          onChange={(e) =>
                            updateDonorRankingsOverlayConfig({
                              bgGifUrl: e.target.value,
                              isBgEnabled: Boolean(String(e.target.value || "").trim()),
                            })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90 md:col-span-2">
                        배경 투명도 ({drCfg.bgOpacity}%)
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={drCfg.bgOpacity}
                          onChange={(e) => updateDonorRankingsOverlayConfig({ bgOpacity: Number(e.target.value) })}
                          className="w-full accent-fuchsia-400"
                        />
                      </label>
                      <label className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2.5 md:col-span-2 cursor-pointer">
                        <span className="text-xs font-semibold text-pink-50">배경 사용</span>
                        <span className="flex items-center gap-2 text-[11px] text-pink-100/80">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-white/30 bg-black/40 text-fuchsia-500 focus:ring-fuchsia-400"
                            checked={drCfg.isBgEnabled}
                            onChange={(e) => updateDonorRankingsOverlayConfig({ isBgEnabled: e.target.checked })}
                          />
                          ON / OFF
                        </span>
                      </label>
                    </div>
                  );
                })()}
              </div>
              <div className="mt-3 rounded-2xl border border-fuchsia-400/35 bg-gradient-to-br from-fuchsia-950/55 via-rose-950/45 to-pink-950/40 p-4 shadow-[0_10px_36px_rgba(236,72,153,0.22)] backdrop-blur-md">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-pink-100">후원 랭킹 · 본문 이미지 / GIF</h4>
                  <p className="mt-1 max-w-xl text-xs text-pink-100/75">
                    순위 패널 본문(제목 아래·목록 아래 등)에 표시할 이미지·GIF입니다. 파일 업로드 또는 URL을 사용할 수 있으며, 일반·전체 후원순위 오버레이에 함께 적용됩니다.
                  </p>
                </div>
                {(() => {
                  const drCfg = normalizeDonorRankingsOverlayConfig(state.donorRankingsOverlayConfig);
                  return (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        파일 업로드 (gif / png / jpg / webp)
                        <input
                          type="file"
                          accept="image/gif,image/png,image/jpeg,image/webp,.gif,.png,.jpg,.jpeg,.webp"
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 file:mr-3 file:rounded file:border-0 file:bg-fuchsia-600 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            uploadDonorRankingsBodyImage(file);
                            e.target.value = "";
                          }}
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        이미지 URL (https… 또는 /uploads 경로)
                        <input
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 placeholder:text-pink-200/40 outline-none focus:border-fuchsia-400/70"
                          placeholder="예: /uploads/sigs/.../banner.gif"
                          value={drCfg.bodyImageUrl}
                          onChange={(e) =>
                            updateDonorRankingsBodyImageConfig({
                              bodyImageUrl: e.target.value,
                              isBodyImageEnabled: Boolean(String(e.target.value || "").trim()),
                            })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        배치 위치
                        <select
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 shadow-inner outline-none focus:border-fuchsia-400/70"
                          value={drCfg.bodyImagePosition}
                          onChange={(e) =>
                            updateDonorRankingsBodyImageConfig({
                              bodyImagePosition: e.target.value as OverlayConfig["bodyImagePosition"],
                            })
                          }
                        >
                          <option value="abovePanel">패널 위</option>
                          <option value="belowTitle">제목 아래 (기본)</option>
                          <option value="belowList">순위 목록 아래</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        본문 이미지 투명도 ({drCfg.bodyImageOpacity}%)
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={drCfg.bodyImageOpacity}
                          onChange={(e) =>
                            updateDonorRankingsBodyImageConfig({ bodyImageOpacity: Number(e.target.value) })
                          }
                          className="w-full accent-fuchsia-400"
                        />
                      </label>
                      {drCfg.bodyImageUrl.trim() ? (
                        <div className="md:col-span-2 flex flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={drCfg.bodyImageUrl.trim()}
                            alt=""
                            className="max-h-20 max-w-[200px] rounded object-contain"
                          />
                          <button
                            type="button"
                            className="rounded bg-white/15 px-2 py-1 text-xs text-pink-50 hover:bg-white/25"
                            onClick={() =>
                              updateDonorRankingsBodyImageConfig({
                                bodyImageUrl: "",
                                isBodyImageEnabled: false,
                              })
                            }
                          >
                            이미지 지우기
                          </button>
                        </div>
                      ) : null}
                      <label className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2.5 md:col-span-2 cursor-pointer">
                        <span className="text-xs font-semibold text-pink-50">본문 이미지 사용</span>
                        <span className="flex items-center gap-2 text-[11px] text-pink-100/80">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-white/30 bg-black/40 text-fuchsia-500 focus:ring-fuchsia-400"
                            checked={drCfg.isBodyImageEnabled}
                            onChange={(e) =>
                              updateDonorRankingsBodyImageConfig({ isBodyImageEnabled: e.target.checked })
                            }
                          />
                          ON / OFF
                        </span>
                      </label>
                    </div>
                  );
                })()}
              </div>
              <div className="mt-3 rounded-2xl border border-indigo-400/35 bg-gradient-to-br from-indigo-950/55 via-violet-950/45 to-fuchsia-950/40 p-4 shadow-[0_10px_36px_rgba(99,102,241,0.22)] backdrop-blur-md">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-indigo-100">후원순위 PNG 프레임 (투명 테두리)</h4>
                  <p className="mt-1 max-w-xl text-xs text-indigo-100/75">
                    후원순위 패널 <strong className="font-semibold">바깥 장식 테두리</strong>용 PNG입니다. 중앙은 투명(알파)으로 두고, 모서리·테두리 장식만 그려 주세요.
                  </p>
                </div>
                {(() => {
                  const drCfg = normalizeDonorRankingsOverlayConfig(state.donorRankingsOverlayConfig);
                  return (
                    <div className="mt-4 space-y-3">
                      <div className="rounded border border-white/10 bg-black/30 p-2 text-[10px] leading-relaxed text-neutral-300">
                        <p className="mb-1 font-semibold text-emerald-200/95">PNG 제작 가이드</p>
                        <ul className="list-disc space-y-0.5 pl-4">
                          <li>
                            권장 캔버스: <strong>920×680px</strong> (패널 기본 크기 기준)
                          </li>
                          <li>
                            중앙 투명 창: 약 <strong>860×580px</strong>
                          </li>
                          <li>
                            프레임 두께(여백): 상·하·좌·우 각 <strong>30px</strong> 권장
                          </li>
                          <li>
                            파일 형식: <strong>PNG-24</strong> (알파 채널 필수)
                          </li>
                          <li>업로드 후 「안쪽 여백」으로 패널과 프레임 정렬을 미세 조정</li>
                        </ul>
                      </div>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="flex flex-col gap-1.5 text-[11px] font-medium text-indigo-100/90">
                          PNG 업로드
                          <input
                            type="file"
                            accept=".png,image/png"
                            className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-indigo-50 file:mr-3 file:rounded file:border-0 file:bg-indigo-600 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-white"
                            onChange={(e) => {
                              const file = e.target.files?.[0] || null;
                              uploadDonorRankingsFrameImage(file);
                              e.target.value = "";
                            }}
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-[11px] font-medium text-indigo-100/90">
                          PNG 프레임 URL
                          <input
                            className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-indigo-50 placeholder:text-indigo-200/40 outline-none focus:border-indigo-400/70"
                            placeholder="예: /uploads/.../frame.png"
                            value={drCfg.frameUrl}
                            onChange={(e) =>
                              updateDonorRankingsBodyImageConfig({
                                frameUrl: e.target.value,
                                isFrameEnabled: Boolean(String(e.target.value || "").trim()),
                              })
                            }
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-[11px] font-medium text-indigo-100/90">
                          프레임 불투명도 ({drCfg.frameOpacity}%)
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={drCfg.frameOpacity}
                            onChange={(e) =>
                              updateDonorRankingsBodyImageConfig({ frameOpacity: Number(e.target.value) })
                            }
                            className="w-full accent-indigo-400"
                          />
                        </label>
                        <label className="flex flex-col gap-1.5 text-[11px] font-medium text-indigo-100/90">
                          프레임 안쪽 여백(px)
                          <input
                            className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-indigo-50 outline-none focus:border-indigo-400/70"
                            type="number"
                            min={0}
                            max={120}
                            value={drCfg.frameInset}
                            onChange={(e) =>
                              updateDonorRankingsBodyImageConfig({
                                frameInset: Number(e.target.value.replace(/[^\d]/g, "") || 0),
                              })
                            }
                          />
                        </label>
                      </div>
                      {drCfg.frameUrl.trim() ? (
                        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2.5">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={drCfg.frameUrl.trim()}
                            alt=""
                            className="max-h-20 max-w-[200px] rounded object-contain"
                          />
                          <button
                            type="button"
                            className="rounded bg-white/15 px-2 py-1 text-xs text-indigo-50 hover:bg-white/25"
                            onClick={() =>
                              updateDonorRankingsBodyImageConfig({
                                frameUrl: "",
                                isFrameEnabled: false,
                              })
                            }
                          >
                            프레임 지우기
                          </button>
                        </div>
                      ) : null}
                      <label className="flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2.5">
                        <span className="text-xs font-semibold text-indigo-50">프레임 사용</span>
                        <span className="flex items-center gap-2 text-[11px] text-indigo-100/80">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-white/30 bg-black/40 text-indigo-500 focus:ring-indigo-400"
                            checked={drCfg.isFrameEnabled}
                            disabled={!drCfg.frameUrl.trim()}
                            onChange={(e) =>
                              updateDonorRankingsBodyImageConfig({ isFrameEnabled: e.target.checked })
                            }
                          />
                          ON / OFF
                        </span>
                      </label>
                      <p className="text-[10px] text-neutral-500">
                        기본 안쪽 여백 32px. PNG 가이드의 30px 여백과 맞추고, 패널 크기에 따라 ±4px 조정하세요.
                      </p>
                    </div>
                  );
                })()}
              </div>
              <div className="mt-3 rounded-2xl border border-fuchsia-400/35 bg-gradient-to-br from-fuchsia-950/55 via-rose-950/45 to-pink-950/40 p-4 shadow-[0_10px_36px_rgba(236,72,153,0.22)] backdrop-blur-md">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h4 className="text-sm font-semibold text-pink-100">후원 엑셀표 · 배경 GIF</h4>
                    <p className="mt-1 max-w-xl text-xs text-pink-100/75">
                      후원 엑셀표 배경 GIF입니다. 통합 오버레이(<code className="text-pink-50/90">/overlay</code>)·단독(
                      <code className="text-pink-50/90">/overlay/donation-lists</code>) 모두 반영됩니다. Giphy <span className="text-pink-50/90">페이지</span> 주소(
                      <code className="break-all">giphy.com/gifs/…</code>)도 자동으로 직접 GIF/MP4로 바뀝니다. GIF 선명도를 높이면 표 뒤 애니메이션이 더 잘 보입니다.
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <code className="max-w-[min(100%,420px)] break-all text-[11px] text-fuchsia-100/90">
                      /overlay/donation-lists?u={overlayUserId}
                    </code>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className={`rounded px-2 py-1 text-xs ${copiedId === "dash-donation-lists" ? "bg-emerald-600" : "bg-white/15 text-pink-50 hover:bg-white/25"}`}
                        onClick={() => {
                          const u = `${window.location.origin}/overlay/donation-lists?u=${overlayUserId}`;
                          void copyUrl(u, "dash-donation-lists");
                        }}
                      >
                        {copiedId === "dash-donation-lists" ? "복사됨!" : "URL 복사"}
                      </button>
                      <button
                        type="button"
                        className="rounded bg-gradient-to-r from-fuchsia-600 to-pink-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:from-fuchsia-500 hover:to-pink-500"
                        onClick={() => window.open(`/overlay/donation-lists?u=${overlayUserId}`, "_blank", "noopener,noreferrer")}
                      >
                        오버레이 열기
                      </button>
                    </div>
                  </div>
                </div>
                {(() => {
                  const dlCfg = normalizeDonationListsOverlayConfig(state.donationListsOverlayConfig);
                  const presetSelectValue = DONATION_LISTS_BG_GIF_PRESETS.some((p) => p.url && p.url === dlCfg.bgGifUrl)
                    ? dlCfg.bgGifUrl
                    : dlCfg.bgGifUrl.trim()
                      ? "__custom__"
                      : "";
                  return (
                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        GIF 프리셋
                        <select
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 shadow-inner outline-none focus:border-fuchsia-400/70"
                          value={presetSelectValue}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (v === "__custom__") return;
                            updateDonationListsOverlayConfig({ bgGifUrl: v, isBgEnabled: Boolean(String(v || "").trim()) });
                          }}
                        >
                          {DONATION_LISTS_BG_GIF_PRESETS.map((p) => (
                            <option key={p.label} value={p.url}>
                              {p.label}
                            </option>
                          ))}
                          <option value="__custom__">직접 URL 입력</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90">
                        GIF URL (https… 또는 /public 경로)
                        <input
                          className="rounded-lg border border-white/20 bg-black/25 px-2 py-2 text-sm text-pink-50 placeholder:text-pink-200/40 outline-none focus:border-fuchsia-400/70"
                          placeholder="https://i.giphy.com/xxxxx.gif 또는 giphy.com/gifs/… 페이지"
                          value={dlCfg.bgGifUrl}
                          onChange={(e) =>
                            updateDonationListsOverlayConfig({
                              bgGifUrl: e.target.value,
                              isBgEnabled: Boolean(String(e.target.value || "").trim()),
                            })
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1.5 text-[11px] font-medium text-pink-100/90 md:col-span-2">
                        GIF 선명도 ({dlCfg.bgOpacity}% · 높을수록 잘 보임)
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={dlCfg.bgOpacity}
                          onChange={(e) => updateDonationListsOverlayConfig({ bgOpacity: Number(e.target.value) })}
                          className="w-full accent-fuchsia-400"
                        />
                      </label>
                      <label className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2.5 md:col-span-2 cursor-pointer">
                        <span className="text-xs font-semibold text-pink-50">배경 사용</span>
                        <span className="flex items-center gap-2 text-[11px] text-pink-100/80">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-white/30 bg-black/40 text-fuchsia-500 focus:ring-fuchsia-400"
                            checked={dlCfg.isBgEnabled}
                            onChange={(e) => updateDonationListsOverlayConfig({ isBgEnabled: e.target.checked })}
                          />
                          ON / OFF
                        </span>
                      </label>
                    </div>
                  );
                })()}
              </div>
              <div id="high-society-overlay" className="mb-3 rounded border border-amber-500/35 bg-amber-950/25 p-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-amber-100">상류사회 · 세로(9:16) 오버레이</h4>
                    <p className="mt-1 text-[11px] text-neutral-400 leading-snug max-w-xl">
                      모드 ON/OFF는{" "}
                      <button
                        type="button"
                        className="text-sky-400 underline"
                        onClick={() => {
                          moveToSection("donor", "donor-management");
                          window.setTimeout(() => {
                            document.getElementById("high-society-mode")?.scrollIntoView({
                              behavior: "smooth",
                              block: "start",
                            });
                          }, 80);
                        }}
                      >
                        후원자 기록부 → 상류사회 모드
                      </button>
                      에서만 설정합니다. ON이면 좌석 멤버 후원이 상단 영토 게이지에 반영됩니다.{" "}
                      확장: <strong className="text-neutral-300">1만원=5cm</strong>
                      · 1만원 배수만(1만9천→0cm).{" "}
                      <strong className="text-neutral-300">갱신 시점</strong>은 아래 옵션으로 선택합니다.
                      OBS 캔버스·브라우저 소스 <strong className="text-neutral-300">1080×1920</strong>.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      className="rounded border border-violet-500/40 bg-violet-950/50 px-2.5 py-1 text-[11px] font-semibold text-violet-100 hover:bg-violet-900/60"
                      onClick={() => openAdminHighSocietyPopup(user?.id || overlayUserId)}
                    >
                      별도 창
                    </button>
                    <span
                      className={`rounded px-2.5 py-1 text-[11px] font-semibold ${
                        highSocietySettings.enabled
                          ? "bg-amber-600/90 text-white"
                          : "bg-neutral-800 text-neutral-400"
                      }`}
                    >
                      {highSocietySettings.enabled ? "모드 ON" : "모드 OFF"}
                    </span>
                  </div>
                </div>

                <div className="rounded border border-white/10 bg-black/25 p-2.5 space-y-2">
                  <div className="text-[11px] font-semibold text-amber-100/95">좌석 · 전장 · 후원 연동</div>
                  {highSocietySeatLayoutPanel}
                </div>

                <div className="rounded border border-white/10 bg-black/25 p-2.5 space-y-2">
                  <div className="text-[11px] font-semibold text-amber-100/95">영토 게이지 갱신</div>
                  <p className="text-[10px] text-neutral-400 leading-snug">
                    실시간은 후원이 들어올 때마다 게이지가 움직이고, 라운드 종료 후는 「타이머 제어」 일반
                    타이머가 0이 될 때까지 게이지를 고정한 뒤 한 번에 반영합니다. 「영토 일시정지」는
                    게이지(영토)만 멈추고, 후원·투네 합산은 계속 반영됩니다.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 text-xs font-semibold border ${
                        (highSocietySettings.territoryUpdateMode || "realtime") === "realtime"
                          ? "border-amber-400 bg-amber-700/90 text-white"
                          : "border-white/15 bg-neutral-900 text-neutral-300 hover:border-white/30"
                      }`}
                      onClick={() => patchHighSocietySettings({ territoryUpdateMode: "realtime" })}
                    >
                      실시간
                    </button>
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 text-xs font-semibold border ${
                        highSocietySettings.territoryUpdateMode === "onRoundEnd"
                          ? "border-amber-400 bg-amber-700/90 text-white"
                          : "border-white/15 bg-neutral-900 text-neutral-300 hover:border-white/30"
                      }`}
                      onClick={() => patchHighSocietySettings({ territoryUpdateMode: "onRoundEnd" })}
                    >
                      라운드 종료 후
                    </button>
                    <button
                      type="button"
                      className={`rounded px-3 py-1.5 text-xs font-semibold border ${
                        highSocietySettings.territoryPaused
                          ? "border-sky-400 bg-sky-700/90 text-white"
                          : "border-white/15 bg-neutral-900 text-neutral-300 hover:border-sky-400/50"
                      }`}
                      disabled={!highSocietySettings.enabled}
                      title="영토·후원 합산·투네 반영 모두 동결"
                      onClick={() =>
                        patchHighSocietySettings({ territoryPaused: !highSocietySettings.territoryPaused })
                      }
                    >
                      {highSocietySettings.territoryPaused ? "영토 재개" : "영토 일시정지"}
                    </button>
                    <button
                      type="button"
                      className="rounded px-3 py-1.5 text-xs font-semibold border border-white/15 bg-neutral-900 text-neutral-300 hover:border-amber-400/50 disabled:opacity-40"
                      disabled={!highSocietySettings.enabled}
                      title="영토 게이지만 새 라운드로 — 후원·멤버 금액은 유지"
                      onClick={() => {
                        if (
                          !window.confirm(
                            "영토 게이지만 초기화합니다.\n후원 기록·멤버 계좌/투네 금액은 그대로 유지됩니다.\n계속할까요?"
                          )
                        ) {
                          return;
                        }
                        patchHighSocietySettings({ resetTerritory: true });
                      }}
                    >
                      영토만 초기화
                    </button>
                  </div>
                </div>

                <div className="rounded border border-white/10 bg-black/25 p-2.5 space-y-2">
                  <div className="text-[11px] font-semibold text-amber-100/95">가운데 좌석 · 확장 방향</div>
                  <p className="text-[10px] text-neutral-400 leading-snug">
                    양끝은 고정(좌끝→ / 우끝←). 가운데 후원 건별 수동 방향은{" "}
                    <button
                      type="button"
                      className="text-sky-400 underline"
                      onClick={() => {
                        moveToSection("donor", "donor-management");
                        window.setTimeout(() => {
                          document.getElementById("high-society-mode")?.scrollIntoView({
                            behavior: "smooth",
                            block: "start",
                          });
                        }, 80);
                      }}
                    >
                      후원자 기록부
                    </button>
                    에서 설정합니다.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!highSocietySettings.enabled}
                      className={`rounded px-3 py-1.5 text-xs font-semibold border disabled:opacity-40 ${
                        resolveSystemMiddlePushDir(highSocietySettings) === "left"
                          ? "border-amber-400 bg-amber-700/90 text-white"
                          : "border-white/15 bg-neutral-900 text-neutral-300 hover:border-white/30"
                      }`}
                      onClick={() => patchHighSocietySettings({ defaultMiddlePush: "left" })}
                    >
                      ← 왼쪽
                    </button>
                    <button
                      type="button"
                      disabled={!highSocietySettings.enabled}
                      className={`rounded px-3 py-1.5 text-xs font-semibold border disabled:opacity-40 ${
                        resolveSystemMiddlePushDir(highSocietySettings) === "right"
                          ? "border-amber-400 bg-amber-700/90 text-white"
                          : "border-white/15 bg-neutral-900 text-neutral-300 hover:border-white/30"
                      }`}
                      onClick={() => patchHighSocietySettings({ defaultMiddlePush: "right" })}
                    >
                      오른쪽 →
                    </button>
                  </div>
                  {!highSocietySettings.enabled ? (
                    <p className="text-[10px] text-amber-200/80">방향 설정은 상류사회 ON일 때만 적용됩니다.</p>
                  ) : null}
                </div>

                <div className="rounded border border-white/10 bg-black/25 p-2.5 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-amber-100/95">연출 효과</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-[10px] border border-white/15 bg-neutral-900 text-neutral-300 hover:border-amber-400/50"
                        onClick={() =>
                          patchHighSocietySettings({
                            fx: {
                              frontier: true,
                              growFlash: true,
                              contestedEdge: true,
                              arrowBlade: true,
                              strongOutline: true,
                            },
                          })
                        }
                      >
                        전부 ON
                      </button>
                      <button
                        type="button"
                        className="rounded px-2 py-0.5 text-[10px] border border-white/15 bg-neutral-900 text-neutral-300 hover:border-amber-400/50"
                        onClick={() =>
                          patchHighSocietySettings({
                            fx: {
                              frontier: false,
                              growFlash: false,
                              contestedEdge: false,
                              arrowBlade: false,
                              strongOutline: false,
                            },
                          })
                        }
                      >
                        전부 OFF
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-neutral-400 leading-snug">
                    땅따먹기 잠식·경계·외곽선 연출을 개별로 켜고 끕니다. 기본은 전부 OFF이며, 저장되면 OBS·아래 미리보기에 반영됩니다.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {(
                      [
                        { key: "frontier" as const, label: "잠식 전선", desc: "확장 방향 경계 빛" },
                        { key: "growFlash" as const, label: "확장 플래시", desc: "땅이 늘 때 번쩍" },
                        { key: "contestedEdge" as const, label: "분쟁 경계", desc: "평평 모드 줄무늬" },
                        { key: "arrowBlade" as const, label: "화살 칼날", desc: "화살표 금색 팁" },
                        { key: "strongOutline" as const, label: "강한 외곽선", desc: "텍스트 stroke" },
                      ] as const
                    ).map((opt) => {
                      const fxNow = normalizeHighSocietyFxSettings(highSocietySettings.fx);
                      const on = Boolean(fxNow[opt.key]);
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          className={`flex items-center justify-between gap-2 rounded px-2.5 py-1.5 text-left border ${
                            on
                              ? "border-amber-400/70 bg-amber-900/40 text-amber-50"
                              : "border-white/10 bg-neutral-900 text-neutral-400"
                          }`}
                          onClick={() =>
                            patchHighSocietySettings({
                              fx: {
                                ...fxNow,
                                [opt.key]: !on,
                              },
                            })
                          }
                        >
                          <span>
                            <span className="block text-[11px] font-semibold">{opt.label}</span>
                            <span className="block text-[9px] opacity-80">{opt.desc}</span>
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                              on ? "bg-amber-500 text-black" : "bg-neutral-700 text-neutral-300"
                            }`}
                          >
                            {on ? "ON" : "OFF"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-col items-stretch gap-2">
                  <code className="max-w-full break-all text-[11px] text-amber-100/90">
                    /overlay/high-society?u={overlayUserId}&host=obs&bar=
                    {highSocietySettings.barStyle || "flat"}&startCm={Math.round(hsStartCm)}
                  </code>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={`rounded px-2 py-1 text-xs ${copiedId === "dash-high-society" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                      onClick={() => {
                        patchHighSocietySettings({ barStyle: "flat" });
                        const u = `${window.location.origin}/overlay/high-society?u=${overlayUserId}&host=obs&bar=flat&startCm=${Math.round(hsStartCm)}`;
                        void copyUrl(u, "dash-high-society");
                      }}
                    >
                      {copiedId === "dash-high-society" ? "복사됨!" : "OBS URL 복사(평평)"}
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-1 text-xs ${copiedId === "dash-high-society-arrow" ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                      onClick={() => {
                        patchHighSocietySettings({ barStyle: "arrow" });
                        const u = `${window.location.origin}/overlay/high-society?u=${overlayUserId}&host=obs&bar=arrow&startCm=${Math.round(hsStartCm)}`;
                        void copyUrl(u, "dash-high-society-arrow");
                      }}
                    >
                      {copiedId === "dash-high-society-arrow" ? "복사됨!" : "OBS URL 복사(화살표)"}
                    </button>
                    <button
                      type="button"
                      className="rounded bg-amber-700 hover:bg-amber-600 px-2 py-1 text-xs font-semibold text-white"
                      onClick={() =>
                        window.open(
                          `/overlay/high-society?u=${overlayUserId}&test=true&bar=${highSocietySettings.barStyle || "flat"}`,
                          "_blank",
                          "noopener,noreferrer"
                        )
                      }
                    >
                      테스트 미리보기
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/30 overflow-hidden p-2">
                  <div className="mb-1.5 flex items-center justify-end">
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-amber-500/60 hover:text-amber-200"
                      onClick={() => {
                        notifyBroadcastStateLocalUpdated(user?.id, stateRef.current?.updatedAt);
                        setHsPreviewIframeKey((k) => k + 1);
                      }}
                    >
                      미리보기 새로고침
                    </button>
                  </div>
                  {(() => {
                    const hsFxNow = normalizeHighSocietyFxSettings(highSocietySettings.fx);
                    const hsFxParam = highSocietyFxToHsFxParam(hsFxNow);
                    return (
                  <div
                    className="relative w-full bg-black/60 mx-auto overflow-hidden rounded-md"
                    style={{ maxWidth: 720, minHeight: 148, aspectRatio: "18 / 5" }}
                  >
                    {overlayUserId ? (
                      <iframe
                        key={`hs-preview-${hsPreviewIframeKeySig}-${hsPreviewIframeKey}`}
                        src={appendAdminPreviewEmbedToOverlayUrl(
                          `/overlay/high-society?u=${encodeURIComponent(overlayUserId)}&bar=${encodeURIComponent(highSocietySettings.barStyle || "flat")}&startCm=${encodeURIComponent(String(Math.round(hsStartCm)))}&hsFx=${encodeURIComponent(hsFxParam)}`
                        )}
                        title="상류사회 세로 오버레이 미리보기"
                        className="absolute inset-0 h-full w-full border-0"
                        style={{ background: "transparent" }}
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-500">
                        {authReady ? "계정 ID 대기 중" : "계정 불러오는 중…"}
                      </div>
                    )}
                  </div>
                    );
                  })()}
                  <p className="mt-1.5 text-[10px] text-neutral-500 text-center">
                    게이지 미리보기 · OBS는 1080×1920 세로 소스 사용
                  </p>
                </div>
              </div>

              <div className="mb-3 rounded-lg border border-white/10 bg-black/30 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-2 py-1.5">
                  <span className="text-xs font-medium text-neutral-300">후원 순위 (10위) 미리보기</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className={`rounded px-2 py-0.5 text-[11px] shrink-0 ${
                        copiedId === "dash-donor-rankings-preview"
                          ? "bg-emerald-600 text-white"
                          : "border border-white/15 text-neutral-300 hover:border-emerald-500/60 hover:text-emerald-200"
                      }`}
                      onClick={() => {
                        const u = buildDonorRankingsUrl();
                        void copyUrl(u, "dash-donor-rankings-preview");
                      }}
                    >
                      {copiedId === "dash-donor-rankings-preview" ? "복사됨!" : "OBS URL 복사"}
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-0.5 text-[11px] shrink-0 ${
                        copiedId === "dash-donor-rankings-preview-test"
                          ? "bg-emerald-600 text-white"
                          : "border border-amber-500/40 text-amber-200/90 hover:border-amber-400/70"
                      }`}
                      onClick={() => {
                        const u = buildDonorRankingsUrl({ test: true });
                        void copyUrl(u, "dash-donor-rankings-preview-test");
                      }}
                    >
                      {copiedId === "dash-donor-rankings-preview-test" ? "복사됨!" : "테스트 URL"}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-emerald-500/60 hover:text-emerald-200"
                      onClick={() => setDonorRankingsPreviewIframeKey((k) => k + 1)}
                    >
                      새로고침
                    </button>
                  </div>
                </div>
                <div className="relative w-full bg-black/40" style={{ minHeight: "260px", aspectRatio: "16 / 9" }}>
                  {overlayUserId ? (
                    <iframe
                      key={`donor-rankings-${donorRankingsPreviewIframeKey}-${overlayUserId}`}
                      src={appendAdminPreviewEmbedToOverlayUrl(
                        (() => {
                          /** OBS용 host=obs 는 미리보기에 넣지 않음 — fixed 레이아웃·빈 화면 유발 */
                          const q = new URLSearchParams({ u: overlayUserId });
                          return `/overlay/donor-rankings?${q.toString()}`;
                        })()
                      )}
                      title="후원 순위 오버레이 미리보기"
                      className="absolute inset-0 h-full w-full border-0"
                      style={{ background: "transparent" }}
                      onLoad={() => {
                        notifyAdminPreviewDonorsUpdated(
                          overlayUserId,
                          stateRef.current?.donors || [],
                          stateRef.current?.updatedAt
                        );
                      }}
                    />
                  ) : !authReady ? (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-400">
                      계정 정보 불러오는 중…
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-xs text-neutral-400 px-4 text-center">
                      <p>
                        미리보기용 계정 ID를 아직 받지 못했습니다. 관리자 화면은 열려 있어도 미리보기 iframe에는{" "}
                        <code className="text-neutral-300">u=</code> 가 필요합니다.
                      </p>
                      <button
                        type="button"
                        className="rounded bg-sky-700 px-3 py-1.5 text-sky-50 hover:bg-sky-600"
                        onClick={() => {
                          setAuthReady(false);
                          fetch("/api/auth/me", { credentials: "include" })
                            .then(async (r) => {
                              if (!r.ok) throw new Error("auth_me");
                              return r.json();
                            })
                            .then((data) => {
                              if (data?.user?.id) setUser(data.user);
                              else router.replace("/login?reason=expired&from=/admin");
                            })
                            .catch(() => router.replace("/login?reason=expired&from=/admin"))
                            .finally(() => setAuthReady(true));
                        }}
                      >
                        계정 다시 불러오기
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-3 rounded-lg border border-white/10 bg-black/30 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-2 py-1.5">
                  <span className="text-xs font-medium text-neutral-300">전체 후원 순위 (세로) 미리보기</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className={`rounded px-2 py-0.5 text-[11px] shrink-0 ${
                        copiedId === "dash-donor-rankings-full-preview"
                          ? "bg-emerald-600 text-white"
                          : "border border-white/15 text-neutral-300 hover:border-emerald-500/60 hover:text-emerald-200"
                      }`}
                      onClick={() => {
                        const u = buildDonorRankingsUrl({ full: true });
                        void copyUrl(u, "dash-donor-rankings-full-preview");
                      }}
                    >
                      {copiedId === "dash-donor-rankings-full-preview" ? "복사됨!" : "OBS URL 복사"}
                    </button>
                    <button
                      type="button"
                      className={`rounded px-2 py-0.5 text-[11px] shrink-0 ${
                        copiedId === "dash-donor-rankings-full-preview-test"
                          ? "bg-emerald-600 text-white"
                          : "border border-amber-500/40 text-amber-200/90 hover:border-amber-400/70"
                      }`}
                      onClick={() => {
                        const u = buildDonorRankingsUrl({ test: true, full: true });
                        void copyUrl(u, "dash-donor-rankings-full-preview-test");
                      }}
                    >
                      {copiedId === "dash-donor-rankings-full-preview-test" ? "복사됨!" : "테스트 URL"}
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-emerald-500/60 hover:text-emerald-200"
                      onClick={() => setDonorRankingsPreviewIframeKey((k) => k + 1)}
                    >
                      새로고침
                    </button>
                  </div>
                </div>
                <div className="relative w-full max-w-[420px] mx-auto bg-black/40" style={{ minHeight: "420px", aspectRatio: "9 / 16" }}>
                  {overlayUserId ? (
                    <iframe
                      key={`donor-rankings-full-${donorRankingsPreviewIframeKey}-${overlayUserId}`}
                      src={appendAdminPreviewEmbedToOverlayUrl(
                        (() => {
                          const q = new URLSearchParams({ u: overlayUserId });
                          return `/overlay/donor-rankings/full?${q.toString()}`;
                        })()
                      )}
                      title="전체 후원 순위 세로 오버레이 미리보기"
                      className="absolute inset-0 h-full w-full border-0"
                      style={{ background: "transparent" }}
                      onLoad={() => {
                        notifyAdminPreviewDonorsUpdated(
                          overlayUserId,
                          stateRef.current?.donors || [],
                          stateRef.current?.updatedAt
                        );
                      }}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-400">
                      {authReady ? "계정 ID 대기 중" : "계정 불러오는 중…"}
                    </div>
                  )}
                </div>
                <p className="px-2 py-1.5 text-[10px] text-neutral-500 text-center">
                  10위 이후 전원 · 한 줄 세로 목록 · 테마는 위 후원순위와 동일
                </p>
              </div>

              <div className="mb-3 rounded border border-sky-500/30 bg-sky-950/25 p-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-sky-100">수동 시그 판매 오버레이</h4>
                    <p className="mt-1 text-[11px] text-neutral-400 leading-snug">
                      회전판(<code className="text-neutral-300">/overlay/sig-sales</code>)과{" "}
                      <strong className="text-neutral-300">별도 OBS 브라우저 소스</strong>입니다. 시그 5개·한방 입력 후
                      「수동 결과 적용」으로 방송 화면에 반영합니다.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 shrink-0">
                    <Link
                      href="/admin/sig-sales-manual"
                      className="rounded-lg bg-sky-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700"
                    >
                      수동 시그 설정
                    </Link>
                    <button
                      type="button"
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                        copiedId === "dash-sig-sales-manual" ? "bg-emerald-600 text-white" : "bg-neutral-700 hover:bg-neutral-600 text-neutral-100"
                      }`}
                      onClick={() => {
                        const u =
                          typeof window !== "undefined"
                            ? buildSigSalesManualOverlayUrl(window.location.origin, overlayUserId)
                            : buildSigSalesManualOverlayUrl("http://localhost:3000", overlayUserId);
                        void copyUrl(u, "dash-sig-sales-manual");
                      }}
                    >
                      {copiedId === "dash-sig-sales-manual" ? "복사됨!" : "OBS URL 복사"}
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-sky-500/40 px-3 py-1.5 text-xs text-sky-200 hover:bg-sky-900/40"
                      onClick={() => {
                        const u = buildSigSalesManualOverlayUrl(
                          typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
                          overlayUserId
                        );
                        window.open(u, "_blank", "noopener,noreferrer");
                      }}
                    >
                      오버레이 열기
                    </button>
                  </div>
                </div>
                <code className="block break-all text-[11px] text-sky-100/90">
                  /overlay/sig-sales-manual?u={overlayUserId}&hideSigBoard=1
                </code>
              </div>
              <div className="mb-3 rounded border border-violet-500/30 bg-violet-950/25 p-3 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-violet-100">OBS 텍스트 오버레이 (다중)</h4>
                    <p className="mt-1 text-[11px] text-neutral-400 leading-snug">
                      통합·후원 오버레이처럼 <strong className="text-neutral-300">소스마다 URL이 다릅니다</strong>.
                      화면 위·아래 등 위치를 나누려면 「+ OBS 텍스트 추가」 후 각각 OBS 브라우저 소스로 등록하세요.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="shrink-0 rounded-lg bg-violet-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
                      disabled={obsTextRegistry.instances.length >= MAX_OBS_TEXT_INSTANCES}
                      onClick={addObsTextOverlayQuick}
                    >
                      + OBS 텍스트 추가 ({obsTextRegistry.instances.length}/{MAX_OBS_TEXT_INSTANCES})
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg bg-neutral-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-neutral-600"
                      onClick={() => {
                        if (typeof window === "undefined") return;
                        const text = formatObsTextOverlayUrlList(
                          window.location.origin,
                          overlayUserId,
                          obsTextRegistry
                        );
                        void copyUrl(text, "dash-obs-text-all");
                      }}
                    >
                      {copiedId === "dash-obs-text-all" ? "전체 URL 복사됨" : "전체 URL 복사"}
                    </button>
                    <Link
                      href={`/admin/obs-text?u=${encodeURIComponent(overlayUserId)}`}
                      className="shrink-0 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-600"
                    >
                      전체 편집
                    </Link>
                  </div>
                </div>
                {obsTextRegistry.instances.length === 0 ? (
                  <p className="text-xs text-neutral-500">등록된 텍스트 오버레이가 없습니다.</p>
                ) : (
                  <div className="space-y-2">
                    {obsTextRegistry.instances.map((inst) => {
                      const path = obsTextOverlayPath(overlayUserId, inst.id);
                      const absUrl =
                        typeof window !== "undefined"
                          ? buildObsTextOverlayUrl(
                              window.location.origin,
                              overlayUserId,
                              inst.id
                            )
                          : path;
                      const copyKey = `dash-obs-text-${inst.id}`;
                      return (
                        <div
                          key={inst.id}
                          className="rounded-lg border border-white/10 bg-neutral-950/50 p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-violet-100">{inst.name}</span>
                            <code className="text-[10px] text-neutral-500">textId={inst.id}</code>
                          </div>
                          <code className="block break-all text-[11px] text-violet-200/80">{path}</code>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              className={`rounded px-2 py-1 text-xs ${copiedId === copyKey ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`}
                              onClick={() => void copyUrl(absUrl, copyKey)}
                            >
                              {copiedId === copyKey ? "복사됨!" : "URL 복사"}
                            </button>
                            <button
                              type="button"
                              className="rounded bg-indigo-700 px-2 py-1 text-xs hover:bg-indigo-600"
                              onClick={() => window.open(absUrl, "_blank", "noopener,noreferrer")}
                            >
                              오버레이 열기
                            </button>
                            <button
                              type="button"
                              className="rounded border border-violet-500/40 px-2 py-1 text-xs text-violet-200 hover:bg-violet-900/40"
                              onClick={() => duplicateObsTextOverlayQuick(inst.id)}
                            >
                              복제
                            </button>
                            <Link
                              href={`/admin/obs-text?u=${encodeURIComponent(overlayUserId)}&textId=${encodeURIComponent(inst.id)}`}
                              className="rounded border border-violet-500/40 px-2 py-1 text-xs text-violet-200 hover:bg-violet-900/40"
                            >
                              편집
                            </Link>
                            {obsTextRegistry.instances.length > 1 ? (
                              <button
                                type="button"
                                className="rounded px-2 py-1 text-xs text-rose-300 hover:bg-rose-950/40"
                                onClick={() => removeObsTextOverlayQuick(inst.id)}
                              >
                                삭제
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={`rounded px-2 py-1 text-xs ${obsTextPreviewId === inst.id ? "bg-violet-600 text-white" : "bg-neutral-800 text-neutral-300"}`}
                              onClick={() => {
                                setObsTextPreviewInstanceId(inst.id);
                                setObsTextPreviewIframeKey((k) => k + 1);
                              }}
                            >
                              아래 미리보기
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="mb-3 rounded-lg border border-violet-500/20 bg-black/30 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-2 py-1.5">
                  <span className="text-xs font-medium text-violet-200/90">
                    OBS 텍스트 미리보기 —{" "}
                    {obsTextRegistry.instances.find((i) => i.id === obsTextPreviewId)?.name ?? obsTextPreviewId}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-neutral-300 hover:border-violet-400/60 hover:text-violet-200"
                      onClick={() => setObsTextPreviewIframeKey((k) => k + 1)}
                    >
                      새로고침
                    </button>
                    <Link
                      href={`/admin/obs-text?u=${encodeURIComponent(overlayUserId)}&textId=${encodeURIComponent(obsTextPreviewId)}`}
                      className="rounded border border-violet-500/40 px-2 py-0.5 text-[11px] text-violet-200 hover:bg-violet-900/40"
                    >
                      편집
                    </Link>
                  </div>
                </div>
                <div
                  className="relative w-full bg-gradient-to-b from-slate-800 to-slate-900"
                  style={{ minHeight: "200px", aspectRatio: "16 / 9" }}
                >
                  <iframe
                    key={`obs-text-${obsTextPreviewIframeKey}-${obsTextPreviewId}-${overlayUserId}`}
                    src={appendAdminPreviewEmbedToOverlayUrl(
                      obsTextOverlayPath(overlayUserId, obsTextPreviewId)
                    )}
                    title="OBS 텍스트 오버레이 미리보기"
                    className="absolute inset-0 h-full w-full border-0"
                    style={{ background: "transparent" }}
                  />
                </div>
              </div>
              {presets.length === 0 && (
                <div className="text-sm text-neutral-400 p-6 text-center border border-dashed border-white/10 rounded">아직 오버레이가 없습니다. 위 버튼으로 추가하세요.</div>
              )}
              <div className="space-y-3">
                {presets.map((p) => {
                  const url = buildPrismOverlayUrl(p, !!p.vertical);
                  const demoUrl = buildPrismDemoOverlayUrl(p, !!p.vertical);
                  const previewUrl = buildStablePreviewUrl(p);
                  const scaleNum = Math.max(0.5, Math.min(4, Number.parseFloat(p.scale || "1") || 1));
                  const scalePct = Math.round(scaleNum * 100);
                  const isOpen = editingId === p.id;
                  return (
                    <div key={p.id} className="rounded border border-white/10 bg-neutral-900/40">
                      <div className="flex flex-wrap items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setEditingId(isOpen ? null : p.id)}>
                        <span className="text-sm">{isOpen ? "▼" : "▶"}</span>
                        <input
                          className="px-2 py-0.5 rounded bg-neutral-800 border border-white/10 text-sm font-semibold flex-shrink-0 w-full sm:w-40"
                          value={p.name}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => updatePreset(p.id, { name: e.target.value })}
                        />
                        <span className="text-xs text-neutral-500 truncate basis-full sm:basis-auto sm:flex-1 font-mono">{url.slice(0, 80)}...</span>
                        <button className={`px-2 py-1 rounded text-xs ${copiedId === p.id ? "bg-[#22c55e]" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={(e) => { e.stopPropagation(); copyUrl(url, p.id); }}>{copiedId === p.id ? "복사됨!" : "URL 복사"}</button>
                        <button className={`px-2 py-1 rounded text-xs ${copiedId === `${p.id}-demo` ? "bg-emerald-600" : "bg-fuchsia-700 hover:bg-fuchsia-600"}`} onClick={(e) => { e.stopPropagation(); copyUrl(demoUrl, `${p.id}-demo`); }}>{copiedId === `${p.id}-demo` ? "복사됨!" : "데모 URL"}</button>
                        <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={(e) => { e.stopPropagation(); window.open(demoUrl, "_blank", "noopener,noreferrer"); }}>데모 열기</button>
                        <button className="px-2 py-1 rounded bg-[#ef4444] hover:bg-[#dc2626] text-xs text-white" onClick={(e) => { e.stopPropagation(); removePreset(p.id); }}>삭제</button>
                        <div
                          className="basis-full rounded border border-white/10 bg-black/20 px-2 py-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="mb-1 flex items-center justify-between text-[11px] text-neutral-400">
                            <span>엑셀표 스케일(빠른 조절)</span>
                            <span className="text-neutral-200">{scalePct}%</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="range"
                              min="50"
                              max="400"
                              step="1"
                              value={String(scalePct)}
                              onChange={(e) => {
                                const n = Math.max(50, Math.min(400, parseInt(e.target.value || "100", 10) || 100));
                                updatePreset(p.id, { scale: String(n / 100) });
                              }}
                              className="flex-1 accent-emerald-500"
                            />
                            <input
                              className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-[11px] text-right"
                              value={String(scalePct)}
                              onChange={(e) => {
                                const raw = e.target.value.replace(/[^\d]/g, "");
                                const n = Math.max(50, Math.min(400, parseInt(raw || "100", 10) || 100));
                                updatePreset(p.id, { scale: String(n / 100) });
                              }}
                            />
                            <span className="text-[11px] text-neutral-500">%</span>
                          </div>
                        </div>
                      </div>
                      {isOpen && (
                        <div className={`border-t border-white/10 ${simpleMode ? "hidden" : ""}`}>
                          <div
                            id="overlay-amount-format"
                            className="mx-3 mt-3 space-y-2 rounded-lg border border-emerald-500/35 bg-emerald-950/30 px-3 py-2.5"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-emerald-200">금액 표시 (멤버표·목표막대)</span>
                            <button
                              type="button"
                              className={`px-2.5 py-1 rounded border text-xs font-medium ${(p.donorsFormat || "short") === "full" ? "border-emerald-400 bg-emerald-800/60 text-emerald-100" : "border-white/15 bg-neutral-800 text-neutral-300"}`}
                              onClick={() =>
                                updatePreset(p.id, {
                                  donorsFormat: (p.donorsFormat || "short") === "full" ? "short" : "full",
                                })
                              }
                            >
                              {(p.donorsFormat || "short") === "full" ? "풀 (1,000,000)" : "만원 (100만)"}
                            </button>
                            <span className="text-[10px] text-neutral-400 leading-snug">
                              변경 후 <strong className="text-neutral-300">URL 복사</strong> 또는 OBS 소스 새로고침
                            </span>
                            </div>
                            {(p.showMembers || p.showTotal) && (
                              <div className="grid grid-cols-1 gap-2 border-t border-emerald-500/20 pt-2 sm:grid-cols-[120px_1fr_120px_1fr] sm:items-center">
                                <label className="text-xs text-neutral-400">표 글꼴</label>
                                <select
                                  className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                  value={p.tableFontFamily || "auto"}
                                  onChange={(e) => updatePreset(p.id, { tableFontFamily: e.target.value })}
                                >
                                  {TABLE_FONT_FAMILY_OPTIONS.map((opt) => (
                                    <option key={opt.id} value={opt.id}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>
                                <label className="text-xs text-neutral-400">멤버 표 글자(px)</label>
                                <input
                                  className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                  inputMode="numeric"
                                  value={p.memberSize}
                                  onChange={(e) => updatePreset(p.id, { memberSize: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
                                />
                                <label className="text-xs text-neutral-400">총합 글자(px)</label>
                                <input
                                  className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                  inputMode="numeric"
                                  value={p.totalSize}
                                  onChange={(e) => updatePreset(p.id, { totalSize: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                />
                                <div className="sm:col-span-4 flex flex-wrap items-center gap-2 pt-1">
                                  <span className="text-xs text-neutral-400">표 하단 총합 행</span>
                                  <button
                                    type="button"
                                    className={`px-2.5 py-1 rounded border text-xs font-medium ${
                                      (p.showTableSumRow ?? p.showTotal) !== false
                                        ? "border-emerald-400 bg-emerald-800/60 text-emerald-100"
                                        : "border-rose-400/60 bg-rose-950/40 text-rose-100"
                                    }`}
                                    onClick={() =>
                                      updatePreset(p.id, {
                                        showTableSumRow: (p.showTableSumRow ?? p.showTotal) === false,
                                      })
                                    }
                                  >
                                    {(p.showTableSumRow ?? p.showTotal) !== false ? "총합 행 ON" : "총합 행 OFF"}
                                  </button>
                                  <span className="text-[10px] text-neutral-500">
                                    OFF면 엑셀표 맨 아래 「총합」줄이 사라집니다
                                  </span>
                                </div>
                                <p className="sm:col-span-4 text-[10px] text-neutral-500 leading-snug">
                                  「자동 글자 크기」ON이면 화면에 맞춰 줄어듭니다. Prism/OBS는 저장값이 실시간 반영됩니다.
                                </p>
                              </div>
                            )}
                          </div>
                        <div className="px-3 pb-3 grid grid-cols-1 lg:grid-cols-2 gap-3 pt-3">
                          <div className="space-y-2 lg:order-2">
                            <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                              <label className="text-xs text-neutral-400">테마</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.theme} onChange={(e) => updatePreset(p.id, { theme: e.target.value })}>
                                {baseThemeChoices.map((tid) => (
                                  <option key={tid} value={tid}>{overlayThemeLabel(tid)}</option>
                                ))}
                              </select>
                              <div className="col-span-full">
                                <ThemeThumbs value={p.theme} options={baseThemeChoices} onChange={(v) => updatePreset(p.id, { theme: v })} />
                              </div>
                              {/* Palette view removed per user preference; compact select retained */}
                              {/* 「멤버·총합 테마」UI 제거 — 상단「테마」가 membersTheme/totalTheme도 함께 맞춤. 저장값·현재 표 설정은 변경하지 않음 */}
                              {(p.showMembers || p.showTotal) && (
                                <>
                                  <label className="text-xs text-neutral-400">표 배경 불투명도</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min="0" max="100" value={p.tableBgOpacity || "100"} onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value })} className="flex-1 accent-emerald-500" />
                                    <input className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right" value={p.tableBgOpacity || "100"} onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} />
                                    <span className="text-xs text-neutral-500">% (100=불투명)</span>
                                  </div>
                                  <div className="col-span-full space-y-2.5 rounded-lg border border-white/10 bg-neutral-950/50 p-2.5">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="text-xs font-semibold text-emerald-300/90">헤더(상단)</div>
                                      <button
                                        type="button"
                                        className="shrink-0 px-2 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/60 border border-emerald-500/30 text-xs text-emerald-100"
                                        onClick={() => updatePreset(p.id, emptyTableThemeAutoColorPatch())}
                                        title="수동 지정한 표 색을 모두 지우고 선택한 테마 기본 디자인으로 되돌립니다"
                                      >
                                        표 색 전부 테마 자동
                                      </button>
                                    </div>
                                    <p className="text-[10px] text-neutral-500 leading-snug">
                                      색이 「테마 자동」이어도 미리보기 칸에 테마 색이 보입니다. 테마가 안 바뀌면 위 버튼으로 수동 색을 한 번에 지우세요.
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                                      <label className="text-xs text-neutral-400">헤더 배경색</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(
                                            p.tableHeaderBgColor,
                                            resolveTableThemeHeaderPreviewHex(
                                              String(
                                                p.membersTheme && p.membersTheme !== "auto"
                                                  ? p.membersTheme
                                                  : p.theme || "default"
                                              )
                                            )
                                          )}
                                          onChange={(e) => {
                                            const next = e.target.value;
                                            const preview = resolveTableThemeHeaderPreviewHex(
                                              String(
                                                p.membersTheme && p.membersTheme !== "auto"
                                                  ? p.membersTheme
                                                  : p.theme || "default"
                                              )
                                            );
                                            /** 테마 자동 상태에서 피커만 열었다 닫으면 미리보기 색이 수동값으로 고정되지 않게 */
                                            if (!String(p.tableHeaderBgColor || "").trim() && next.toLowerCase() === preview.toLowerCase()) {
                                              return;
                                            }
                                            updatePreset(p.id, { tableHeaderBgColor: next });
                                          }}
                                        />
                                        <span className="text-xs text-neutral-400 font-mono truncate max-w-[8rem] sm:max-w-none">{p.tableHeaderBgColor || "테마 자동"}</span>
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableHeaderBgColor: "" })}>테마 자동</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">헤더 글자색</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(
                                            p.tableHeaderTextColor,
                                            resolveTableThemeHeaderTextPreviewHex(activeTableThemeId(p))
                                          )}
                                          onChange={(e) => {
                                            const next = e.target.value;
                                            const preview = resolveTableThemeHeaderTextPreviewHex(activeTableThemeId(p));
                                            if (!String(p.tableHeaderTextColor || "").trim() && next.toLowerCase() === preview.toLowerCase()) {
                                              return;
                                            }
                                            updatePreset(p.id, { tableHeaderTextColor: next });
                                          }}
                                        />
                                        <span className="text-xs text-neutral-400 font-mono truncate max-w-[8rem] sm:max-w-none">{p.tableHeaderTextColor || "테마 자동"}</span>
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableHeaderTextColor: "" })}>테마 자동</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">헤더 외곽선 색</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(p.tableHeaderTextOutlineColor || p.tableTextOutlineColor || "#060c18", "#060c18")}
                                          onChange={(e) => updatePreset(p.id, { tableHeaderTextOutlineColor: e.target.value })}
                                        />
                                        <input
                                          className="flex-1 min-w-0 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs font-mono"
                                          value={p.tableHeaderTextOutlineColor || ""}
                                          onChange={(e) => updatePreset(p.id, { tableHeaderTextOutlineColor: e.target.value })}
                                          placeholder="비우면 본문 외곽선과 동일"
                                        />
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableHeaderTextOutlineColor: "" })}>본문과 동일</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">헤더 외곽선 두께</label>
                                      <div className="flex min-w-0 items-center gap-2">
                                        <input
                                          type="range"
                                          min={0}
                                          max={3}
                                          step={0.1}
                                          value={(() => {
                                            const raw =
                                              p.tableHeaderTextOutlineWidth !== undefined && p.tableHeaderTextOutlineWidth !== ""
                                                ? p.tableHeaderTextOutlineWidth
                                                : p.tableTextOutlineWidth;
                                            const n = parseFloat(String(raw ?? ""));
                                            return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 1.0;
                                          })()}
                                          onChange={(e) => updatePreset(p.id, { tableHeaderTextOutlineWidth: e.target.value })}
                                          className="flex-1 accent-emerald-500"
                                        />
                                        <input
                                          className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                          type="number"
                                          min={0}
                                          max={3}
                                          step={0.1}
                                          value={p.tableHeaderTextOutlineWidth ?? ""}
                                          onChange={(e) =>
                                            updatePreset(p.id, {
                                              tableHeaderTextOutlineWidth: e.target.value.replace(/[^\d.]/g, "").slice(0, 3),
                                            })
                                          }
                                          placeholder="동일"
                                        />
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableHeaderTextOutlineWidth: "" })}>본문과 동일</button>
                                      </div>
                                    </div>
                                    <div className="text-xs font-semibold text-sky-300/90 pt-0.5">본문(멤버 행)</div>
                                    <div className="grid grid-cols-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                                      <label className="text-xs text-neutral-400">본문 배경색</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(p.tableBgColor, "#ffffff")}
                                          onChange={(e) => updatePreset(p.id, { tableBgColor: e.target.value })}
                                        />
                                        <span className="text-xs text-neutral-400 font-mono truncate max-w-[8rem] sm:max-w-none">{p.tableBgColor || "테마 자동"}</span>
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableBgColor: "" })}>테마 자동</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">본문 글자색</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(p.tableTextColor, "#ffffff")}
                                          onChange={(e) => updatePreset(p.id, { tableTextColor: e.target.value })}
                                        />
                                        <span className="text-xs text-neutral-400 font-mono truncate max-w-[8rem] sm:max-w-none">{p.tableTextColor || "테마 자동(#fff)"}</span>
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableTextColor: "" })}>테마 자동</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">총합 글자색</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(p.totalTextColor, "#111827")}
                                          onChange={(e) => updatePreset(p.id, { totalTextColor: e.target.value })}
                                        />
                                        <span className="text-xs text-neutral-400 font-mono truncate max-w-[8rem] sm:max-w-none">{p.totalTextColor || "테마 자동"}</span>
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { totalTextColor: "" })}>테마 자동</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">기여도 글자색</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(
                                            p.contributionColor,
                                            resolveTableThemeContributionPreviewHex(activeTableThemeId(p))
                                          )}
                                          onChange={(e) => {
                                            const next = e.target.value;
                                            const preview = resolveTableThemeContributionPreviewHex(activeTableThemeId(p));
                                            if (!String(p.contributionColor || "").trim() && next.toLowerCase() === preview.toLowerCase()) {
                                              return;
                                            }
                                            updatePreset(p.id, { contributionColor: next });
                                          }}
                                        />
                                        <span className="text-xs text-neutral-400 font-mono truncate max-w-[8rem] sm:max-w-none">{p.contributionColor || "테마 자동"}</span>
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { contributionColor: "" })}>테마 자동</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">줄무늬(짝 행)</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(
                                            p.tableRowEvenBg,
                                            resolveTableThemeRowStripePreviewHex(activeTableThemeId(p), "even")
                                          )}
                                          onChange={(e) => {
                                            const next = tableRowStripeBgFromPickerHex(e.target.value, 0.06);
                                            const preview = resolveTableThemeRowStripePreviewHex(activeTableThemeId(p), "even");
                                            if (!String(p.tableRowEvenBg || "").trim() && toColorPickerValue(next, preview).toLowerCase() === preview.toLowerCase()) {
                                              return;
                                            }
                                            updatePreset(p.id, { tableRowEvenBg: next });
                                          }}
                                        />
                                        <input
                                          className="flex-1 min-w-0 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs font-mono"
                                          value={p.tableRowEvenBg || ""}
                                          onChange={(e) => updatePreset(p.id, { tableRowEvenBg: e.target.value })}
                                          placeholder="rgba(255,255,255,0.06) 또는 비우면 테마 자동"
                                        />
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableRowEvenBg: "" })}>테마 자동</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">줄무늬(홀 행)</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(
                                            p.tableRowOddBg,
                                            resolveTableThemeRowStripePreviewHex(activeTableThemeId(p), "odd")
                                          )}
                                          onChange={(e) => {
                                            const next = tableRowStripeBgFromPickerHex(e.target.value, 0.14);
                                            const preview = resolveTableThemeRowStripePreviewHex(activeTableThemeId(p), "odd");
                                            if (!String(p.tableRowOddBg || "").trim() && toColorPickerValue(next, preview).toLowerCase() === preview.toLowerCase()) {
                                              return;
                                            }
                                            updatePreset(p.id, { tableRowOddBg: next });
                                          }}
                                        />
                                        <input
                                          className="flex-1 min-w-0 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs font-mono"
                                          value={p.tableRowOddBg || ""}
                                          onChange={(e) => updatePreset(p.id, { tableRowOddBg: e.target.value })}
                                          placeholder="rgba(255,255,255,0.14) 또는 비우면 테마 자동"
                                        />
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableRowOddBg: "" })}>테마 자동</button>
                                      </div>
                                    </div>
                                    <div className="text-xs font-semibold text-neutral-300 pt-0.5">공통</div>
                                    <div className="grid grid-cols-1 sm:grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5">
                                      <label className="text-xs text-neutral-400">표 선 색</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(
                                            p.tableLineColor,
                                            resolveTableThemeLinePreviewHex(
                                              String(
                                                p.membersTheme && p.membersTheme !== "auto"
                                                  ? p.membersTheme
                                                  : p.theme || "default"
                                              )
                                            )
                                          )}
                                          onChange={(e) => {
                                            const next = e.target.value;
                                            const preview = resolveTableThemeLinePreviewHex(
                                              String(
                                                p.membersTheme && p.membersTheme !== "auto"
                                                  ? p.membersTheme
                                                  : p.theme || "default"
                                              )
                                            );
                                            if (!String(p.tableLineColor || "").trim() && next.toLowerCase() === preview.toLowerCase()) {
                                              return;
                                            }
                                            updatePreset(p.id, { tableLineColor: next });
                                          }}
                                        />
                                        <span className="text-xs text-neutral-400 font-mono truncate max-w-[8rem] sm:max-w-none">{p.tableLineColor || "테마 자동"}</span>
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableLineColor: "" })}>테마 자동</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">패널 외곽 테두리</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <input
                                          type="color"
                                          className="h-9 w-14 shrink-0 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                          value={toColorPickerValue(
                                            p.tablePanelBorderColor,
                                            resolveTableThemePanelBorderPreviewHex(activeTableThemeId(p))
                                          )}
                                          onChange={(e) => {
                                            const next = e.target.value;
                                            const preview = resolveTableThemePanelBorderPreviewHex(activeTableThemeId(p));
                                            if (!String(p.tablePanelBorderColor || "").trim() && next.toLowerCase() === preview.toLowerCase()) {
                                              return;
                                            }
                                            updatePreset(p.id, { tablePanelBorderColor: next });
                                          }}
                                        />
                                        <span className="text-xs text-neutral-400 font-mono truncate max-w-[8rem] sm:max-w-none">{p.tablePanelBorderColor || "테마 자동"}</span>
                                        <button type="button" className="shrink-0 px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tablePanelBorderColor: "" })}>테마 자동</button>
                                      </div>
                                      <label className="text-xs text-neutral-400">표 선</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <button
                                          type="button"
                                          className={`px-2.5 py-1 rounded border text-xs font-medium ${
                                            p.tableGridLines !== false
                                              ? "border-emerald-400 bg-emerald-800/50 text-emerald-100"
                                              : "border-rose-400/60 bg-rose-950/40 text-rose-100"
                                          }`}
                                          onClick={() =>
                                            updatePreset(p.id, {
                                              tableGridLines: p.tableGridLines === false,
                                            })
                                          }
                                        >
                                          {p.tableGridLines !== false ? "표시 ON" : "OFF"}
                                        </button>
                                        <span className="text-[10px] text-neutral-500">가로·세로·외곽 전부</span>
                                      </div>
                                      <label className="text-xs text-neutral-400">세로선</label>
                                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                                        <button
                                          type="button"
                                          disabled={p.tableGridLines === false}
                                          className={`px-2.5 py-1 rounded border text-xs font-medium ${
                                            p.tableGridLines === false
                                              ? "border-neutral-600 bg-neutral-900/50 text-neutral-500 cursor-not-allowed"
                                              : p.tableVerticalLines !== false
                                                ? "border-emerald-400 bg-emerald-800/50 text-emerald-100"
                                                : "border-rose-400/60 bg-rose-950/40 text-rose-100"
                                          }`}
                                          onClick={() =>
                                            updatePreset(p.id, {
                                              tableVerticalLines: p.tableVerticalLines === false,
                                            })
                                          }
                                        >
                                          {p.tableVerticalLines !== false ? "표시 ON" : "OFF"}
                                        </button>
                                        <span className="text-[10px] text-neutral-500">열 구분 세로선 (표 선 ON일 때)</span>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="col-span-full space-y-3">
                                    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
                                      <span className="text-xs font-medium text-neutral-300 shrink-0">총합 행</span>
                                      <button
                                        type="button"
                                        className={`px-2.5 py-1 rounded border text-xs font-medium ${
                                          (p.showTableSumRow ?? p.showTotal) !== false
                                            ? "border-emerald-400 bg-emerald-800/50 text-emerald-100"
                                            : "border-rose-400/60 bg-rose-950/40 text-rose-100"
                                        }`}
                                        onClick={() =>
                                          updatePreset(p.id, {
                                            showTableSumRow: (p.showTableSumRow ?? p.showTotal) === false,
                                          })
                                        }
                                      >
                                        {(p.showTableSumRow ?? p.showTotal) !== false ? "표시 ON" : "삭제(숨김)"}
                                      </button>
                                      <span className="text-[10px] text-neutral-500">표 맨 아래 총합 줄</span>
                                      <label className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
                                        TOTAL 표시
                                        <select
                                          className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-neutral-200"
                                          value={p.totalMode || "total"}
                                          onChange={(e) => updatePreset(p.id, { totalMode: e.target.value as "total" })}
                                        >
                                          <option value="total">TOTAL</option>
                                        </select>
                                      </label>
                                    </div>

                                    <div className="rounded-lg border border-pink-400/35 bg-pink-950/25 p-3 space-y-3">
                                      <div>
                                        <h5 className="text-xs font-semibold text-pink-100">엑셀표 배경 GIF</h5>
                                        <p className="mt-0.5 text-[10px] text-pink-100/70 leading-snug">
                                          표 뒤에 깔리는 장식 GIF입니다. URL 입력 또는 업로드 후 불투명도·밝기를 조절하세요.
                                        </p>
                                      </div>
                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                        <input
                                          className="w-full min-w-0 px-2.5 py-2 rounded-lg bg-neutral-900/80 border border-white/15 text-sm"
                                          placeholder="예: https://media.giphy.com/.../giphy.gif"
                                          value={p.tableBgGifUrl || ""}
                                          onChange={(e) => updatePreset(p.id, { tableBgGifUrl: e.target.value })}
                                        />
                                        <label className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-xs font-semibold text-white cursor-pointer shrink-0">
                                          GIF 업로드
                                          <input
                                            type="file"
                                            accept=".gif,image/gif"
                                            className="hidden"
                                            onChange={(e) => {
                                              const file = e.target.files?.[0] || null;
                                              uploadTableBgGifImage(p.id, file);
                                              e.currentTarget.value = "";
                                            }}
                                          />
                                        </label>
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <label className="block space-y-1.5">
                                          <span className="text-xs text-neutral-300">
                                            GIF 불투명도 ({p.tableBgGifOpacity || "45"}%)
                                          </span>
                                          <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={p.tableBgGifOpacity || "45"}
                                            onChange={(e) => updatePreset(p.id, { tableBgGifOpacity: e.target.value })}
                                            className="w-full accent-emerald-500"
                                          />
                                        </label>
                                        <label className="block space-y-1.5">
                                          <span className="text-xs text-neutral-300">
                                            GIF 밝기 ({p.tableBgGifBrightness || "100"}%)
                                          </span>
                                          <input
                                            type="range"
                                            min="40"
                                            max="200"
                                            value={p.tableBgGifBrightness || "100"}
                                            onChange={(e) => updatePreset(p.id, { tableBgGifBrightness: e.target.value })}
                                            className="w-full accent-emerald-500"
                                          />
                                        </label>
                                      </div>
                                    </div>

                                    <div className="rounded-lg border border-indigo-400/40 bg-indigo-950/30 p-3 space-y-3">
                                      <div>
                                        <h5 className="text-sm font-semibold text-indigo-100">엑셀표 PNG 프레임 (투명 테두리)</h5>
                                        <p className="mt-1 text-xs leading-relaxed text-indigo-100/80 max-w-2xl">
                                          표 <strong className="font-semibold text-indigo-50">바깥 장식 테두리</strong>용 PNG입니다.
                                          중앙은 투명(알파)으로 두고, 모서리·테두리 장식만 그려 주세요.
                                        </p>
                                      </div>
                                      <div className="rounded-md border border-white/10 bg-black/35 px-3 py-2.5 text-[11px] leading-relaxed text-neutral-200">
                                        <p className="font-semibold text-emerald-200 mb-1.5">PNG 제작 가이드</p>
                                        <ul className="list-disc pl-5 space-y-1">
                                          <li>권장 캔버스: <strong className="text-white">920×680px</strong> (표 기본 크기 기준)</li>
                                          <li>중앙 투명 창(표가 보이는 영역): 약 <strong className="text-white">860×580px</strong></li>
                                          <li>프레임 두께(여백): 상·하·좌·우 각 <strong className="text-white">30px</strong> 권장</li>
                                          <li>파일 형식: <strong className="text-white">PNG-24</strong> (알파 채널 필수)</li>
                                          <li>업로드 후 「안쪽 여백」으로 표와 프레임 정렬을 미세 조정</li>
                                        </ul>
                                      </div>
                                      <div className="space-y-3">
                                        <div className="flex flex-col gap-2">
                                          <span className="text-xs font-medium text-indigo-100/90">내장 프레임 프리셋</span>
                                          <div className="flex flex-wrap gap-2">
                                            {EXCEL_TABLE_FRAME_PRESETS.map((fp) => {
                                              const active = (p.tableFrameUrl || "").trim() === fp.url;
                                              return (
                                                <button
                                                  key={fp.id}
                                                  type="button"
                                                  className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-1.5 text-[10px] transition-colors ${
                                                    active
                                                      ? "border-emerald-400 bg-emerald-950/50 text-emerald-100"
                                                      : "border-white/15 bg-black/30 text-neutral-300 hover:border-indigo-400/60"
                                                  }`}
                                                  title={fp.label}
                                                  onClick={() =>
                                                    updatePreset(p.id, {
                                                      tableFrameUrl: fp.url,
                                                      tableFrameInset: fp.defaultInset ?? p.tableFrameInset ?? "32",
                                                      tableFrameOpacity: fp.defaultOpacity ?? p.tableFrameOpacity ?? "100",
                                                      tableFrameEnabled: true,
                                                    })
                                                  }
                                                >
                                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                                  <img
                                                    src={fp.url}
                                                    alt=""
                                                    className="h-12 w-16 rounded object-contain bg-neutral-950/80"
                                                  />
                                                  <span className="max-w-[5.5rem] truncate">{fp.label}</span>
                                                </button>
                                              );
                                            })}
                                            {(p.tableFrameUrl || "").trim() &&
                                            !findExcelTableFramePresetByUrl(p.tableFrameUrl || "") ? (
                                              <span className="self-center text-[10px] text-neutral-500">직접 URL</span>
                                            ) : null}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        <label className="flex flex-col gap-1.5 min-w-0">
                                          <span className="text-xs font-medium text-indigo-100/90">PNG 프레임 URL</span>
                                          <input
                                            className="w-full min-w-0 px-2.5 py-2 rounded-lg bg-neutral-900/80 border border-white/15 text-sm"
                                            placeholder="예: /assets/excel-frames/golden-frame.png"
                                            value={p.tableFrameUrl || ""}
                                            onChange={(e) => {
                                              const url = e.target.value;
                                              updatePreset(p.id, {
                                                tableFrameUrl: url,
                                                tableFrameEnabled: Boolean(String(url || "").trim()),
                                              });
                                            }}
                                          />
                                        </label>
                                        <label className="flex flex-col gap-1.5">
                                          <span className="text-xs font-medium text-indigo-100/90">PNG 업로드</span>
                                          <span className="inline-flex items-center justify-center px-3 py-2 rounded-lg bg-[#6366f1] hover:bg-[#4f46e5] text-xs font-semibold text-white cursor-pointer">
                                            파일 선택
                                            <input
                                              type="file"
                                              accept=".png,image/png"
                                              className="hidden"
                                              onChange={(e) => {
                                                const file = e.target.files?.[0] || null;
                                                uploadTableFrameImage(p.id, file);
                                                e.currentTarget.value = "";
                                              }}
                                            />
                                          </span>
                                        </label>
                                        <label className="flex flex-col gap-1.5 sm:col-span-1">
                                          <span className="text-xs font-medium text-indigo-100/90">
                                            프레임 불투명도 ({p.tableFrameOpacity || "100"}%)
                                          </span>
                                          <input
                                            type="range"
                                            min="0"
                                            max="100"
                                            value={p.tableFrameOpacity || "100"}
                                            onChange={(e) => updatePreset(p.id, { tableFrameOpacity: e.target.value })}
                                            className="w-full accent-indigo-400"
                                          />
                                        </label>
                                        <label className="flex flex-col gap-1.5">
                                          <span className="text-xs font-medium text-indigo-100/90">프레임 안쪽 여백(px)</span>
                                          <input
                                            className="w-full max-w-[8rem] px-2.5 py-2 rounded-lg bg-neutral-900/80 border border-white/15 text-sm"
                                            type="number"
                                            min={0}
                                            max={120}
                                            value={p.tableFrameInset ?? "32"}
                                            onChange={(e) => updatePreset(p.id, { tableFrameInset: e.target.value })}
                                          />
                                          <span className="text-[10px] text-neutral-500">
                                            기본 32px. 가이드의 30px 여백과 맞추고 ±4px 조정하세요.
                                          </span>
                                        </label>
                                      </div>
                                      {(p.tableFrameUrl || "").trim() ? (
                                        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2.5">
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img
                                            src={(p.tableFrameUrl || "").trim()}
                                            alt=""
                                            className="max-h-20 max-w-[200px] rounded object-contain bg-neutral-950/80"
                                          />
                                          <button
                                            type="button"
                                            className="rounded bg-white/15 px-2 py-1 text-xs text-indigo-50 hover:bg-white/25"
                                            onClick={() =>
                                              updatePreset(p.id, {
                                                tableFrameUrl: "",
                                                tableFrameEnabled: false,
                                              })
                                            }
                                          >
                                            프레임 지우기
                                          </button>
                                        </div>
                                      ) : null}
                                      <div className="flex flex-wrap items-center gap-3">
                                        <label className="text-xs text-neutral-400">프레임 적용</label>
                                        <button
                                          type="button"
                                          className={`px-2 py-0.5 rounded border text-xs ${
                                            (p.tableFrameUrl || "").trim() && p.tableFrameEnabled !== false
                                              ? "border-emerald-500 text-emerald-300"
                                              : "border-white/10 text-neutral-500"
                                          }`}
                                          disabled={!(p.tableFrameUrl || "").trim()}
                                          onClick={() => {
                                            const hasUrl = Boolean((p.tableFrameUrl || "").trim());
                                            if (!hasUrl) return;
                                            const applied = p.tableFrameEnabled !== false;
                                            updatePreset(p.id, { tableFrameEnabled: !applied });
                                          }}
                                        >
                                          {(p.tableFrameUrl || "").trim() && p.tableFrameEnabled !== false ? "ON" : "OFF"}
                                        </button>
                                        <span className="text-[10px] text-neutral-500">
                                          OFF면 URL은 유지하고 표에만 적용하지 않습니다.
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                </>
                              )}
                              {p.showGoal && (
                                <>
                                  <label className="text-xs text-neutral-400">목표바 테마</label>
                                  <select
                                    className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                    value={p.goalTheme || "auto"}
                                    onChange={(e) => updatePreset(p.id, { goalTheme: e.target.value })}
                                  >
                                    <option value="default">기본(핑크 그라데이션)</option>
                                  </select>
                                  {/* Palette view removed; keep compact select */}
                                </>
                              )}
                              <label className="text-xs text-neutral-400">안가림 모드</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.noCrop !== false ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { noCrop: !(p.noCrop !== false) })}>
                                {p.noCrop !== false ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">Prism 영역</label>
                              <select
                                className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                value={p.box || "full"}
                                onChange={(e) => updatePreset(p.id, { box: e.target.value as any })}
                              >
                                <option value="full">전체(1920x1080/1080x1920)</option>
                                <option value="tight">콘텐츠만(여백 제거)</option>
                              </select>
                              <label className="text-xs text-neutral-400">중앙 고정 레이아웃</label>
                              <button
                                className={`px-2 py-0.5 rounded border text-xs ${p.layout === "center-fixed" ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`}
                                onClick={() => updatePreset(p.id, { layout: p.layout === "center-fixed" ? undefined : "center-fixed" })}
                                type="button"
                              >
                                {p.layout === "center-fixed" ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">줌 반응</label>
                              <select
                                className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                value={p.zoomMode || "follow"}
                                onChange={(e) => updatePreset(p.id, { zoomMode: e.target.value as any })}
                              >
                                <option value="follow">정상(확대=커짐)</option>
                                <option value="invert">반전(확대=작아짐)</option>
                                <option value="neutral">무시(크기 고정)</option>
                              </select>
                              <label className={`text-xs ${p.tableFree ? "text-neutral-600" : "text-neutral-400"}`}>표 위치(앵커)</label>
                              <select
                                className={`px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm ${(p.tableFree || p.layout === "center-fixed") ? "opacity-60 cursor-not-allowed" : ""}`}
                                value={p.anchor || "cc"}
                                onChange={(e) => updatePreset(p.id, { anchor: e.target.value })}
                                disabled={!!p.tableFree || p.layout === "center-fixed"}
                              >
                                <option value="tl">상좌</option>
                                <option value="tc">상중</option>
                                <option value="tr">상우</option>
                                <option value="cl">중좌</option>
                                <option value="cc">중앙</option>
                                <option value="cr">중우</option>
                                <option value="bl">하좌</option>
                                <option value="bc">하중</option>
                                <option value="br">하우</option>
                              </select>
                              <label className={`text-xs ${p.tableFree ? "text-neutral-600" : "text-neutral-400"}`}>표 여백(px)</label>
                              <div className={`grid grid-cols-2 gap-2 ${p.tableFree ? "opacity-60 pointer-events-none" : ""}`}>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-neutral-500 w-6">상</span>
                                  <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.tableMarginTop || "0"} onChange={(e) => updatePreset(p.id, { tableMarginTop: e.target.value.replace(/[^\d-]/g, "") })} />
                                  <span className="text-[11px] text-neutral-500 w-6">하</span>
                                  <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.tableMarginBottom || "0"} onChange={(e) => updatePreset(p.id, { tableMarginBottom: e.target.value.replace(/[^\d-]/g, "") })} />
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] text-neutral-500 w-6">좌</span>
                                  <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.tableMarginLeft || "0"} onChange={(e) => updatePreset(p.id, { tableMarginLeft: e.target.value.replace(/[^\d-]/g, "") })} />
                                  <span className="text-[11px] text-neutral-500 w-6">우</span>
                                  <input className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.tableMarginRight || "0"} onChange={(e) => updatePreset(p.id, { tableMarginRight: e.target.value.replace(/[^\d-]/g, "") })} />
                                </div>
                              </div>
                              <div className="col-span-full flex flex-wrap gap-1">
                                {[
                                  { label: "상단바(중앙)", anchor: "tc" },
                                  { label: "상단바(좌)", anchor: "tl" },
                                  { label: "상단바(우)", anchor: "tr" },
                                ].map(({ label, anchor }) => (
                                  <button
                                    key={label}
                                    type="button"
                                    className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                    onClick={() => updatePreset(p.id, { tableFree: false, anchor, compact: true, tight: true })}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                              <label className="text-xs text-neutral-400">표 자유 위치</label>
                              <div className={`flex items-center gap-2 ${p.layout === "center-fixed" ? "opacity-60 pointer-events-none" : ""}`}>
                                <button
                                  className={`px-2 py-0.5 rounded border text-xs ${p.tableFree ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`}
                                  onClick={() => updatePreset(p.id, { tableFree: !p.tableFree })}
                                  type="button"
                                >
                                  {p.tableFree ? "자유 위치 ON" : "자유 위치 OFF"}
                                </button>
                                <span className="text-[10px] text-neutral-500">(X/Y 비율로 중앙점 지정)</span>
                              </div>
                              {p.tableFree && (
                                <>
                                  <label className="text-xs text-neutral-400">표 X%</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="range" min="0" max="100"
                                      value={p.tableX || "50"}
                                      onChange={(e) => updatePreset(p.id, { tableX: String(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10)))) })}
                                      className="flex-1 accent-emerald-500"
                                    />
                                    <input
                                      className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                      value={p.tableX || "50"}
                                      onChange={(e) => updatePreset(p.id, { tableX: e.target.value.replace(/[^\\d]/g, "") })}
                                    />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                  <label className="text-xs text-neutral-400">표 Y%</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="range" min="0" max="100"
                                      value={p.tableY || "50"}
                                      onChange={(e) => updatePreset(p.id, { tableY: String(Math.max(0, Math.min(100, parseInt(e.target.value || "0", 10)))) })}
                                      className="flex-1 accent-emerald-500"
                                    />
                                    <input
                                      className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                      value={p.tableY || "50"}
                                      onChange={(e) => updatePreset(p.id, { tableY: e.target.value.replace(/[^\\d]/g, "") })}
                                    />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                </>
                              )}
                              <label className="text-xs text-neutral-400">엑셀표 스케일(%)</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min="50"
                                  max="400"
                                  step="1"
                                  value={String(scalePct)}
                                  onChange={(e) => {
                                    const n = Math.max(50, Math.min(400, parseInt(e.target.value || "100", 10) || 100));
                                    updatePreset(p.id, { scale: String(n / 100) });
                                  }}
                                  className="flex-1 accent-emerald-500"
                                />
                                <input
                                  className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                  value={String(scalePct)}
                                  onChange={(e) => {
                                    const raw = e.target.value.replace(/[^\d]/g, "");
                                    const n = Math.max(50, Math.min(400, parseInt(raw || "100", 10) || 100));
                                    updatePreset(p.id, { scale: String(n / 100) });
                                  }}
                                />
                                <span className="text-xs text-neutral-500">%</span>
                              </div>
                              <label className="text-xs text-neutral-400">표 글꼴</label>
                              <select
                                className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                value={p.tableFontFamily || "auto"}
                                onChange={(e) => updatePreset(p.id, { tableFontFamily: e.target.value })}
                              >
                                {TABLE_FONT_FAMILY_OPTIONS.map((opt) => (
                                  <option key={opt.id} value={opt.id}>
                                    {opt.label}
                                  </option>
                                ))}
                              </select>
                              <label className="text-xs text-neutral-400">표 글자 크기(px)</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min={10}
                                  max={80}
                                  value={clampTableMemberSizePx(p.memberSize, 24)}
                                  onChange={(e) =>
                                    updatePreset(p.id, { memberSize: String(Number(e.target.value)) })
                                  }
                                  className="flex-1 accent-emerald-500"
                                />
                                <input
                                  className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                  inputMode="numeric"
                                  value={p.memberSize}
                                  onChange={(e) =>
                                    updatePreset(p.id, {
                                      memberSize: e.target.value.replace(/[^\d]/g, "").slice(0, 2),
                                    })
                                  }
                                />
                                <span className="text-xs text-neutral-500">px</span>
                              </div>
                              <p className="text-[10px] text-neutral-500 col-span-full leading-snug">
                                글꼴·크기는 프리SET·OBS URL에 반영됩니다. 「자동 글자 크기」ON이면 화면에 맞춰 px가 줄어듭니다.
                              </p>
                              <label className="text-xs text-neutral-400">총합 글자(px)</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.totalSize} onChange={(e) => updatePreset(p.id, { totalSize: e.target.value })} />
                              <label className="text-xs text-neutral-400">줄 간격</label>
                              <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={String(p.dense)} onChange={(e) => updatePreset(p.id, { dense: e.target.value === "true" })}>
                                <option value="true">촘촘</option><option value="false">보통</option>
                              </select>
                              <label className="text-xs text-neutral-400">Prism 맞춤</label>
                              <select
                                className={`px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm ${p.layout === "center-fixed" ? "opacity-60 cursor-not-allowed" : ""}`}
                                value={p.autoFit || "none"}
                                onChange={(e) => updatePreset(p.id, { autoFit: e.target.value as any })}
                                disabled={p.layout === "center-fixed"}
                              >
                                <option value="none">사용 안 함</option>
                                <option value="width">가로 맞춤</option>
                                <option value="height">세로 맞춤</option>
                                <option value="contain">화면 맞춤(여백)</option>
                                <option value="cover">꽉 채움(자름)</option>
                              </select>
                              <label className="text-xs text-neutral-400">맞춤 기준(핀)</label>
                              <select
                                className={`px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm ${p.layout === "center-fixed" ? "opacity-60 cursor-not-allowed" : ""}`}
                                value={p.autoFitPin || "cc"}
                                onChange={(e) => updatePreset(p.id, { autoFitPin: e.target.value as any })}
                                disabled={p.layout === "center-fixed"}
                              >
                                <option value="cc">중앙</option>
                                <option value="tl">좌상</option>
                                <option value="tc">상단</option>
                                <option value="tr">우상</option>
                                <option value="cl">좌</option>
                                <option value="cr">우</option>
                                <option value="bl">좌하</option>
                                <option value="bc">하단</option>
                                <option value="br">우하</option>
                              </select>
                              <label className="text-xs text-neutral-400">자동 글자 크기</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.autoFont ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { autoFont: !p.autoFont })}>
                                {p.autoFont ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">컴팩트 모드</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.compact ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { compact: !p.compact })}>
                                {p.compact ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">촘촘 간격(+티커 간격)</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.tight ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { tight: !p.tight })}>
                                {p.tight ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">표 폭 고정</label>
                              <button className={`px-2 py-0.5 rounded border text-xs ${p.lockWidth ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { lockWidth: !p.lockWidth })}>
                                {p.lockWidth ? "ON" : "OFF"}
                              </button>
                              <label className={`text-xs ${p.lockWidth ? "text-neutral-600" : "text-neutral-400"}`}>이름 칸 확장</label>
                              <button
                                className={`px-2 py-0.5 rounded border text-xs ${p.lockWidth ? "opacity-60 cursor-not-allowed" : (p.nameGrow !== false ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500")}`}
                                onClick={() => !p.lockWidth && updatePreset(p.id, { nameGrow: !(p.nameGrow !== false) })}
                                disabled={!!p.lockWidth}
                              >
                                {p.nameGrow !== false ? "ON" : "OFF"}
                              </button>
                              <label className="text-xs text-neutral-400">이름 너비(ch)</label>
                              <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="(기본 자동)" value={p.nameCh || ""} onChange={(e) => updatePreset(p.id, { nameCh: e.target.value.replace(/[^\d]/g, "") })} />
                              <p className="col-span-full text-[10px] text-neutral-500">
                                헤더·본문 배경/글자색은 위 「테마」 영역에서 설정합니다. 헤더 외곽선은 비우면 아래 본문 외곽선과 동일하게 적용됩니다.
                              </p>
                              <label className="text-xs text-neutral-400">표 글자 외곽선 색</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  className="h-9 w-14 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                  value={toColorPickerValue(p.tableTextOutlineColor || "#060c18", "#060c18")}
                                  onChange={(e) => updatePreset(p.id, { tableTextOutlineColor: e.target.value })}
                                />
                                <input
                                  className="flex-1 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-xs font-mono"
                                  value={p.tableTextOutlineColor || ""}
                                  onChange={(e) => updatePreset(p.id, { tableTextOutlineColor: e.target.value })}
                                  placeholder="기본(글자색에 맞춤)"
                                />
                                <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { tableTextOutlineColor: "" })}>기본</button>
                              </div>
                              <label className="text-xs text-neutral-400">표 글자 외곽선 두께</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min={0}
                                  max={3}
                                  step={0.1}
                                  value={(() => {
                                    const n = parseFloat(String(p.tableTextOutlineWidth ?? ""));
                                    return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 1.0;
                                  })()}
                                  onChange={(e) => updatePreset(p.id, { tableTextOutlineWidth: e.target.value })}
                                  className="flex-1 accent-emerald-500"
                                />
                                <input
                                  className="w-16 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                  type="number"
                                  min={0}
                                  max={3}
                                  step={0.1}
                                  value={p.tableTextOutlineWidth ?? ""}
                                  onChange={(e) =>
                                    updatePreset(p.id, {
                                      tableTextOutlineWidth: e.target.value.replace(/[^\d.]/g, "").slice(0, 3),
                                    })
                                  }
                                  placeholder="자동"
                                />
                              </div>
                              <p className="text-[10px] text-neutral-500 col-span-full">0이면 외곽선 없음. 비우면 글자 크기에 맞춰 자동.</p>
                              <label className="col-span-full flex cursor-pointer items-start gap-2 rounded border border-sky-500/25 bg-sky-950/20 px-3 py-2 text-xs text-neutral-200">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 accent-sky-400"
                                  checked={Boolean(p.overlayTextSharpRender)}
                                  onChange={(e) =>
                                    updatePreset(p.id, { overlayTextSharpRender: e.target.checked })
                                  }
                                />
                                <span>
                                  <span className="font-medium text-sky-100">선명 렌더링</span>
                                  <span className="mt-0.5 block text-[10px] leading-snug text-neutral-400">
                                    OBS·Prism에서 외곽 soft blur 제거, geometricPrecision 적용.
                                    (CEF는 stroke 대신 선명한 shadow 링 — 관리자 프리뷰와 동일하게 맞춤)
                                  </span>
                                </span>
                              </label>
                              <div className="col-span-full rounded border border-amber-500/25 bg-amber-950/20 p-3 space-y-2">
                                <div className="text-xs font-semibold text-amber-100">1~3위 텍스트 효과 (엑셀표)</div>
                                <p className="text-[10px] leading-snug text-neutral-500">
                                  행 배경은 바꾸지 않습니다. 순위·이름 글자에만 gradient/글로우 등이 적용되며, 후원 합계 0원이면 효과가 숨겨집니다.
                                </p>
                                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                  <label className="text-xs text-neutral-400">
                                    순위 표시 형식 (4위 이하)
                                    <select
                                      className="mt-1 w-full rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                                      value={p.rankLabelFormat || "hash"}
                                      onChange={(e) => updatePreset(p.id, { rankLabelFormat: e.target.value })}
                                    >
                                      <option value="hash">#1, #2 …</option>
                                      <option value="plain">1, 2 …</option>
                                      <option value="suffix">1위, 2위 …</option>
                                    </select>
                                  </label>
                                  <label className="text-xs text-neutral-400">
                                    1~3위 텍스트 효과
                                    <select
                                      className="mt-1 w-full rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                                      value={
                                        ["text", "emoji", "bg", "both"].includes(String(p.rankTop3Mode || "off"))
                                          ? "text"
                                          : "off"
                                      }
                                      onChange={(e) =>
                                        updatePreset(p.id, {
                                          rankTop3Mode: e.target.value === "text" ? "text" : "off",
                                        })
                                      }
                                    >
                                      <option value="off">OFF</option>
                                      <option value="text">ON (순위·이름 gradient)</option>
                                    </select>
                                  </label>
                                  <label className="text-xs text-neutral-400">
                                    공통 효과 (등수별 미설정 시)
                                    <select
                                      className="mt-1 w-full rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-sm"
                                      value={p.rankTop3Effect || "none"}
                                      onChange={(e) => updatePreset(p.id, { rankTop3Effect: e.target.value })}
                                    >
                                      <option value="none">gradient 흐름 (기본·추천)</option>
                                      <option value="colorShift">gradient 흐름 (지정색)</option>
                                      <option value="rainbow">무지개 흐름 (등수 톤)</option>
                                      <option value="glow">글로우</option>
                                      <option value="sparkle">반짝</option>
                                    </select>
                                  </label>
                                </div>
                                {(["text", "emoji", "bg", "both"].includes(String(p.rankTop3Mode || "off"))) ? (
                                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                                    {(
                                      [
                                        ["rank1Effect", "rank1TextColor", "rank1TextColorAlt", "1위", "#ca8a04", "#fef08a", "colorShift"],
                                        ["rank2Effect", "rank2TextColor", "rank2TextColorAlt", "2위", "#64748b", "#e2e8f0", "colorShift"],
                                        ["rank3Effect", "rank3TextColor", "rank3TextColorAlt", "3위", "#b45309", "#fde68a", "colorShift"],
                                      ] as const
                                    ).map(([effectKey, colorKey, colorAltKey, label, colorFallback, colorAltFallback, effectDefault]) => (
                                      <div key={effectKey} className="rounded border border-white/10 bg-black/20 p-2 space-y-1">
                                        <div className="text-[11px] text-neutral-300 font-medium">{label}</div>
                                        <label className="block text-[10px] text-neutral-500">
                                          텍스트 효과
                                          <select
                                            className="mt-0.5 w-full rounded border border-white/10 bg-neutral-900/80 px-2 py-1 text-xs"
                                            value={String((p as unknown as Record<string, string | undefined>)[effectKey] || "")}
                                            onChange={(e) => updatePreset(p.id, { [effectKey]: e.target.value } as Partial<OverlayPreset>)}
                                          >
                                            <option value="">공통/기본</option>
                                            <option value="colorShift">gradient 흐름 (지정색)</option>
                                            <option value="rainbow">무지개 흐름</option>
                                            <option value="glow">글로우</option>
                                            <option value="sparkle">반짝</option>
                                          </select>
                                        </label>
                                        <div className="grid grid-cols-2 gap-1">
                                          <label className="text-[10px] text-neutral-500">
                                            흐름색 A
                                            <input
                                              type="color"
                                              className="mt-0.5 h-7 w-full rounded border border-white/10 bg-neutral-900/80 p-0.5"
                                              value={toColorPickerValue(String((p as unknown as Record<string, string | undefined>)[colorKey] || ""), colorFallback)}
                                              onChange={(e) => updatePreset(p.id, { [colorKey]: e.target.value } as Partial<OverlayPreset>)}
                                            />
                                          </label>
                                          <label className="text-[10px] text-neutral-500">
                                            흐름색 B
                                            <input
                                              type="color"
                                              className="mt-0.5 h-7 w-full rounded border border-white/10 bg-neutral-900/80 p-0.5"
                                              value={toColorPickerValue(String((p as unknown as Record<string, string | undefined>)[colorAltKey] || ""), colorAltFallback)}
                                              onChange={(e) => updatePreset(p.id, { [colorAltKey]: e.target.value } as Partial<OverlayPreset>)}
                                            />
                                          </label>
                                        </div>
                                        <p className="text-[10px] text-neutral-600">추천: {effectDefault} · 순위·이름 동일 적용</p>
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-[10px] text-neutral-500">
                                    ON으로 켜면 1~3위 순위 숫자와 이름에 금·은·동 gradient가 흐릅니다. 미리보기:{" "}
                                    <a
                                      href="/rank-top3-effect-preview.html"
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-amber-300 underline"
                                    >
                                      효과 샘플
                                    </a>
                                  </p>
                                )}
                              </div>
                              <label className="text-xs text-neutral-400">표 글자 굵기</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="range"
                                  min={400}
                                  max={900}
                                  step={100}
                                  value={(() => {
                                    const n = parseInt(String(p.tableFontWeight ?? ""), 10);
                                    return Number.isFinite(n) ? Math.min(900, Math.max(400, n)) : 800;
                                  })()}
                                  onChange={(e) => updatePreset(p.id, { tableFontWeight: e.target.value })}
                                  className="flex-1 accent-emerald-500"
                                />
                                <select
                                  className="w-28 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                  value={(() => {
                                    const n = parseInt(String(p.tableFontWeight ?? ""), 10);
                                    return Number.isFinite(n) ? String(Math.min(900, Math.max(400, n))) : "";
                                  })()}
                                  onChange={(e) =>
                                    updatePreset(p.id, {
                                      tableFontWeight: e.target.value ? e.target.value : "",
                                    })
                                  }
                                >
                                  <option value="">기본(800)</option>
                                  <option value="400">400 보통</option>
                                  <option value="500">500 중간</option>
                                  <option value="600">600 세미볼드</option>
                                  <option value="700">700 볼드</option>
                                  <option value="800">800 엑스트라</option>
                                  <option value="900">900 최대</option>
                                </select>
                              </div>
                              <p className="text-[10px] text-neutral-500 col-span-full">헤더는 본문보다 한 단계 더 굵게(최대 900). 비우면 800.</p>
                              <label className="text-xs text-neutral-400">계좌 글자 색상</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  className="h-9 w-14 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                  value={toColorPickerValue(p.accountColor, "#ffffff")}
                                  onChange={(e) => updatePreset(p.id, { accountColor: e.target.value })}
                                />
                                <span className="text-xs text-neutral-400 font-mono">{p.accountColor || "테마 기본"}</span>
                                <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { accountColor: "" })}>자동</button>
                              </div>
                              <label className="text-xs text-neutral-400">투네 글자 색상</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="color"
                                  className="h-9 w-14 rounded border border-white/10 bg-neutral-900/80 p-1 cursor-pointer"
                                  value={toColorPickerValue(p.toonColor, "#ffffff")}
                                  onChange={(e) => updatePreset(p.id, { toonColor: e.target.value })}
                                />
                                <span className="text-xs text-neutral-400 font-mono">{p.toonColor || "테마 기본"}</span>
                                <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { toonColor: "" })}>자동</button>
                              </div>
                              {managePositionInPrism && (
                                <>
                                  <label className="text-xs text-neutral-400">위치 설정(Prism에서)</label>
                                  <div className="text-xs text-neutral-500">위치/크기 조정은 Prism에서 진행합니다.</div>
                                </>
                              )}
                            </div>

                            <div className="h-px bg-white/10 my-1" />
                            <details className="rounded border border-white/10 bg-neutral-900/40" open>
                              <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">표 옵션</summary>
                              <div className="p-3 space-y-2">
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-neutral-400">표만 모드</label>
                                  <button className={`px-2 py-0.5 rounded border text-xs ${p.tableOnly ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { tableOnly: !p.tableOnly })}>
                                    {p.tableOnly ? "표만 ON" : "표만 OFF"}
                                  </button>
                                  <span className="text-[10px] text-neutral-500">(표만: 목록·총합만, 나머지 숨김)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-neutral-400">합계 선 표시</label>
                                  <button
                                    className={`px-2 py-0.5 rounded border text-xs ${p.totalLineVisible ? "border-amber-500 text-amber-300" : "border-white/10 text-neutral-500"}`}
                                    onClick={() => updatePreset(p.id, { totalLineVisible: !p.totalLineVisible })}
                                  >
                                    {p.totalLineVisible ? "선 ON" : "선 OFF(기본)"}
                                  </button>
                                  <span className="text-[10px] text-neutral-500">기본은 OFF(합계 컬럼/합계행 선 제거)</span>
                                </div>
                                <div className="space-y-2">
                                  <span className="text-xs text-neutral-400">표 열 · 총합</span>
                                  <DonationTableOptionCheckboxes
                                    compact
                                    sumRowFallback={Boolean(p.showTableSumRow ?? p.showTotal)}
                                    value={{
                                      showCombinedColumn: p.showCombinedColumn,
                                      showContributionColumn: p.showContributionColumn,
                                      showRestroomColumn: p.showRestroomColumn,
                                      showTableSumRow: p.showTableSumRow,
                                      showContributionSum: p.showContributionSum,
                                    }}
                                    onChange={(patch) => updatePreset(p.id, patch)}
                                  />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                                  <label className="text-xs text-neutral-400">계좌 헤더</label>
                                  <input
                                    className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                    placeholder="계좌 (기본)"
                                    value={
                                      p.accountHeaderLabel === "캐쉬후원" || p.accountHeaderLabel === "캐시후원"
                                        ? "계좌"
                                        : p.accountHeaderLabel || ""
                                    }
                                    onChange={(e) => updatePreset(p.id, { accountHeaderLabel: e.target.value })}
                                  />
                                  <label className="text-xs text-neutral-400">투네 헤더</label>
                                  <input
                                    className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                    placeholder="투네 (기본)"
                                    value={p.toonHeaderLabel || ""}
                                    onChange={(e) => updatePreset(p.id, { toonHeaderLabel: e.target.value })}
                                  />
                                  <label className="text-xs text-neutral-400">화장실 헤더</label>
                                  <input
                                    className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                    placeholder="화장실 (기본)"
                                    value={p.restroomHeaderLabel || ""}
                                    onChange={(e) => updatePreset(p.id, { restroomHeaderLabel: e.target.value })}
                                  />
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <label className="text-xs text-neutral-400">금액 표시</label>
                                  <button
                                    type="button"
                                    className={`px-2 py-0.5 rounded border text-xs ${(p.donorsFormat || "short") === "full" ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`}
                                    onClick={() =>
                                      updatePreset(p.id, {
                                        donorsFormat: (p.donorsFormat || "short") === "full" ? "short" : "full",
                                      })
                                    }
                                  >
                                    {(p.donorsFormat || "short") === "full" ? "풀(1,000,000)" : "만원(100만)"}
                                  </button>
                                  <span className="text-[10px] text-neutral-500">
                                    멤버 표·후원 목표 막대. OBS URL에 donorsFormat=full 반영
                                  </span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                                  <label className="text-xs text-neutral-400">표 배경 불투명도</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="range"
                                      min="0"
                                      max="100"
                                      value={p.tableBgOpacity ?? "100"}
                                      onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value })}
                                      className="flex-1 accent-emerald-500"
                                    />
                                    <input
                                      className="w-14 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                      type="number"
                                      min="0"
                                      max="100"
                                      value={p.tableBgOpacity ?? "100"}
                                      onChange={(e) => updatePreset(p.id, { tableBgOpacity: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                    />
                                    <span className="text-xs text-neutral-500">% (100=불투명)</span>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                                  <label className="text-xs text-neutral-400">폭죽(매 N만원)</label>
                                  <div className="flex items-center gap-2">
                                    <input
                                      className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm"
                                      placeholder="0=비활성"
                                      type="number"
                                      min="0"
                                      max="1000"
                                      value={p.confettiMilestone ?? ""}
                                      onChange={(e) => updatePreset(p.id, { confettiMilestone: e.target.value.replace(/[^\d]/g, "") })}
                                    />
                                    <span className="text-xs text-neutral-500">만원마다 누적매출 돌파 시 폭죽</span>
                                    <button
                                      className="px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-xs text-white"
                                      onClick={async () => {
                                        const { default: confetti } = await import("canvas-confetti");
                                        const count = 150;
                                        const defaults = { origin: { y: 0.6 }, zIndex: 9999 };
                                        function fire(particleRatio: number, opts: Record<string, unknown>) {
                                          confetti({ ...defaults, ...opts, particleCount: Math.floor(count * particleRatio) });
                                        }
                                        fire(0.25, { spread: 26, startVelocity: 55 });
                                        fire(0.2, { spread: 60 });
                                        fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
                                        fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
                                        fire(0.1, { spread: 120, startVelocity: 45 });
                                      }}
                                    >
                                      폭죽 효과 테스트
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </details>
                            <details className="rounded border border-white/10 bg-neutral-900/40">
                              <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">표시 요소</summary>
                              <div className="p-3 flex flex-wrap gap-1">
                                {([["멤버 목록", "showMembers"], ["총합", "showTotal"], ["목표바", "showGoal"], ["팀 대전차", "showTeamBattle"], ["개인 골", "showPersonalGoal"], ["타이머", "showTimer"], ["미션 전광판", "showMission"]] as [string, keyof OverlayPreset][]).map(([label, key]) => (
                                  <button key={key} className={`px-2 py-0.5 rounded border text-xs ${p[key] ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-500"}`} onClick={() => updatePreset(p.id, { [key]: !p[key] })}>{label} {p[key] ? "ON" : "OFF"}</button>
                                ))}
                              </div>
                              {!p.showGoal ? (
                                <p className="mt-2 text-[10px] text-amber-200/90 leading-snug">
                                  엑셀표 아래 후원 목표 막대(0만원 / N만원)를 쓰려면 위에서 <strong className="font-semibold">목표바 ON</strong>을 켜 주세요.
                                </p>
                              ) : null}
                              {p.showTeamBattle ? (
                                <p className="mt-2 text-[10px] text-sky-200/90 leading-snug">
                                  「팀 대전차」는 식사 대전 팀 모드(<strong className="font-semibold">teamBattleEnabled</strong>)가 켜져 있고 A/B 멤버가 배정되어 있을 때, 상단 중앙에 빨강·파랑 금액 + 타이머 + 차액 박스를 표시합니다.
                                </p>
                              ) : null}
                            </details>

                            <div className="h-px bg-white/10 my-1" />
                            <details className="rounded border border-white/10 bg-neutral-900/40">
                              <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">빠른 실행</summary>
                              <div className="p-3 flex flex-wrap gap-1">
                              {[
                                { label: "폭죽(오버레이)", patch: { showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false, confettiMilestone: "10" } },
                                { label: "엑셀표만", patch: { theme: "excel", showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false, tableOnly: true } },
                                { label: "표만", patch: { theme: "excel", showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false, tableOnly: true } },
                                { label: "멤버 보드", patch: { showMembers: true, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false } },
                                { label: "총합", patch: { showMembers: false, showTotal: true, showGoal: false, showTicker: false, showTimer: false, showMission: false } },
                                { label: "목표바", patch: { showMembers: false, showTotal: false, showGoal: true, showTicker: false, showTimer: false, showMission: false } },
                                { label: "타이머", patch: { showMembers: false, showTotal: false, showGoal: false, showTicker: false, showTimer: true, showMission: false, timerStart: Date.now() } },
                                { label: "미션 전광판", patch: { showMembers: false, showTotal: false, showGoal: false, showTicker: false, showTimer: false, showMission: true } },
                              ].map(({ label, patch }) => (
                                <button
                                  key={label}
                                  className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                  onClick={() => {
                                    if (typeof window === "undefined") return;
                                    const base = buildOverlayUrl({ ...p, ...patch });
                                    const u = new URL(base);
                                    if (patch.tableOnly) u.searchParams.set("tableOnly", "true");
                                    if (patch.theme) u.searchParams.set("theme", patch.theme);
                                    if (patch.showMembers !== undefined) u.searchParams.set("showMembers", String(patch.showMembers));
                                    if (patch.showTotal !== undefined) u.searchParams.set("showTotal", String(patch.showTotal));
                                    if (patch.showGoal !== undefined) u.searchParams.set("showGoal", String(patch.showGoal));
                                    if (patch.showTicker !== undefined) u.searchParams.set("showTicker", String(patch.showTicker));
                                    if (patch.showTimer !== undefined) u.searchParams.set("showTimer", String(patch.showTimer));
                                    if (patch.showMission !== undefined) u.searchParams.set("showMission", String(patch.showMission));
                                    if (patch.timerStart) u.searchParams.set("timerStart", String(patch.timerStart));
                                    if (patch.confettiMilestone) u.searchParams.set("confettiMilestone", patch.confettiMilestone);
                                    if ("tableBgOpacity" in patch && patch.tableBgOpacity) u.searchParams.set("tableBgOpacity", String(patch.tableBgOpacity));
                                    u.searchParams.set("autoFont", "true");
                                    u.searchParams.set("fitBase", "480");
                                    u.searchParams.set("compact", "true");
                                    u.searchParams.set("tight", "true");
                                    u.searchParams.set("lockWidth", "true");
                                    window.open(u.toString(), "_blank");
                                  }}
                                >
                                  {label}
                                </button>
                              ))}
                              {isAdminNavSectionVisible("goal") && (
                              <button
                                id="overlay-goal-shortcut"
                                className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                onClick={() => {
                                  if (typeof window === "undefined") return;
                                  const goalUrl = new URL(`${window.location.origin}/overlay/goal`);
                                  goalUrl.searchParams.set("u", overlayUserId);
                                  if (p.id) goalUrl.searchParams.set("p", p.id);
                                  goalUrl.searchParams.set(
                                    "donorsFormat",
                                    normalizeDonorsFormat(p.donorsFormat || state.donorsFormat, "short") === "full"
                                      ? "full"
                                      : "short"
                                  );
                                  if (String(p.currencyLocale || "").trim()) {
                                    goalUrl.searchParams.set("currencyLocale", String(p.currencyLocale).trim());
                                  }
                                  window.open(goalUrl.toString(), "_blank");
                                }}
                              >
                                목표 달성 바(전용)
                              </button>
                              )}
                              </div>
                            </details>

                            {/* 후원 티커 기능 제거됨 */}

                            {p.showGoal && (
                              <>
                                <div className="mb-2 rounded border border-fuchsia-500/30 bg-fuchsia-950/25 px-3 py-2">
                                  <div className="mb-1.5 text-[11px] font-semibold text-fuchsia-100/95">후원 목표 금액 (엑셀표 아래 막대)</div>
                                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">현재 목표(원)</label>
                                      <input
                                        className="w-full px-2 py-1.5 rounded bg-neutral-900/90 border border-white/15 text-sm"
                                        type="number"
                                        min={0}
                                        value={p.goal}
                                        onChange={(e) => updatePreset(p.id, { goal: e.target.value.replace(/[^\d]/g, "") })}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">초기 목표(원)</label>
                                      <input
                                        className="w-full px-2 py-1.5 rounded bg-neutral-900/90 border border-white/15 text-sm"
                                        type="number"
                                        min={0}
                                        value={p.goalBaseline || p.goal || ""}
                                        onChange={(e) => updatePreset(p.id, { goalBaseline: e.target.value.replace(/[^\d]/g, "") })}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">달성 시 증가폭(원)</label>
                                      <input
                                        className="w-full px-2 py-1.5 rounded bg-neutral-900/90 border border-white/15 text-sm"
                                        type="number"
                                        min={0}
                                        placeholder="2000000"
                                        value={p.goalIncreaseStep || ""}
                                        onChange={(e) => updatePreset(p.id, { goalIncreaseStep: e.target.value.replace(/[^\d]/g, "") })}
                                      />
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">막대 라벨</label>
                                      <input
                                        className="w-full px-2 py-1.5 rounded bg-neutral-900/90 border border-white/15 text-sm"
                                        value={p.goalLabel}
                                        onChange={(e) => updatePreset(p.id, { goalLabel: e.target.value })}
                                      />
                                    </div>
                                  </div>
                                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                                    <button
                                      type="button"
                                      className="rounded border border-fuchsia-400/50 bg-fuchsia-950/40 px-2 py-1 text-[10px] text-fuchsia-100 hover:bg-fuchsia-900/50"
                                      onClick={() => {
                                        const baseline = String(p.goalBaseline || p.goal || "").trim();
                                        if (baseline) updatePreset(p.id, { goal: baseline });
                                      }}
                                    >
                                      현재 목표 → 초기값으로
                                    </button>
                                  </div>
                                  <p className="mt-1.5 text-[10px] text-neutral-500 leading-snug">
                                    후원 합계 ≥ 현재 목표이면 「달성 시 증가폭」만큼 자동 상향(기본 200만 원). 후원 초기화 시 「초기 목표」로 복원됩니다.
                                  </p>
                                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 border-t border-fuchsia-500/20 pt-2">
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">목표 글자 색</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="color"
                                          value={toColorPickerValue(p.goalTextColor || "#6b2d4a", "#6b2d4a")}
                                          onChange={(e) => updatePreset(p.id, { goalTextColor: e.target.value })}
                                          className="h-9 w-12 rounded border border-white/20 bg-transparent p-0.5"
                                        />
                                        <input
                                          className="flex-1 px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs font-mono"
                                          value={p.goalTextColor || ""}
                                          onChange={(e) => updatePreset(p.id, { goalTextColor: e.target.value })}
                                          placeholder="#6b2d4a"
                                        />
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">목표 글자 크기(px)</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="range"
                                          min={10}
                                          max={48}
                                          value={(() => {
                                            const n = parseInt(String(p.goalFontSize || ""), 10);
                                            return Number.isFinite(n) && n >= 10 ? Math.min(48, n) : 14;
                                          })()}
                                          onChange={(e) => updatePreset(p.id, { goalFontSize: e.target.value })}
                                          className="flex-1 accent-fuchsia-500"
                                        />
                                        <input
                                          className="w-14 px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs text-right"
                                          type="number"
                                          min={10}
                                          max={48}
                                          value={p.goalFontSize || ""}
                                          onChange={(e) =>
                                            updatePreset(p.id, { goalFontSize: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })
                                          }
                                          placeholder="자동"
                                        />
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">목표 글자 굵기</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="range"
                                          min={400}
                                          max={900}
                                          step={100}
                                          value={(() => {
                                            const n = parseInt(String(p.goalFontWeight ?? ""), 10);
                                            return Number.isFinite(n) ? Math.min(900, Math.max(400, n)) : 900;
                                          })()}
                                          onChange={(e) => updatePreset(p.id, { goalFontWeight: e.target.value })}
                                          className="flex-1 accent-fuchsia-500"
                                        />
                                        <select
                                          className="w-28 px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs"
                                          value={(() => {
                                            const n = parseInt(String(p.goalFontWeight ?? ""), 10);
                                            return Number.isFinite(n) ? String(Math.min(900, Math.max(400, n))) : "";
                                          })()}
                                          onChange={(e) =>
                                            updatePreset(p.id, {
                                              goalFontWeight: e.target.value ? e.target.value : "",
                                            })
                                          }
                                        >
                                          <option value="">기본(900)</option>
                                          <option value="400">400</option>
                                          <option value="500">500</option>
                                          <option value="600">600</option>
                                          <option value="700">700</option>
                                          <option value="800">800</option>
                                          <option value="900">900</option>
                                        </select>
                                      </div>
                                    </div>
                                    <div className="space-y-1 sm:col-span-2">
                                      <label className="text-[11px] text-neutral-400">목표 글자 외곽선 색</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="color"
                                          value={toColorPickerValue(p.goalTextOutlineColor || "#060c18", "#060c18")}
                                          onChange={(e) => updatePreset(p.id, { goalTextOutlineColor: e.target.value })}
                                          className="h-9 w-12 rounded border border-white/20 bg-transparent p-0.5"
                                        />
                                        <input
                                          className="flex-1 px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs font-mono"
                                          value={p.goalTextOutlineColor || ""}
                                          onChange={(e) => updatePreset(p.id, { goalTextOutlineColor: e.target.value })}
                                          placeholder="기본(진한 테두리)"
                                        />
                                        <button
                                          type="button"
                                          className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-[10px] hover:bg-neutral-700"
                                          onClick={() => updatePreset(p.id, { goalTextOutlineColor: "" })}
                                        >
                                          기본
                                        </button>
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">목표 글자 외곽선 두께</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="range"
                                          min={0}
                                          max={3}
                                          step={0.1}
                                          value={(() => {
                                            const n = parseFloat(String(p.goalTextOutlineWidth ?? ""));
                                            return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 0.8;
                                          })()}
                                          onChange={(e) =>
                                            updatePreset(p.id, { goalTextOutlineWidth: e.target.value })
                                          }
                                          className="flex-1 accent-fuchsia-500"
                                        />
                                        <input
                                          className="w-14 px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs text-right"
                                          type="number"
                                          min={0}
                                          max={3}
                                          step={0.1}
                                          value={p.goalTextOutlineWidth ?? ""}
                                          onChange={(e) =>
                                            updatePreset(p.id, {
                                              goalTextOutlineWidth: e.target.value.replace(/[^\d.]/g, "").slice(0, 3),
                                            })
                                          }
                                          placeholder="자동"
                                        />
                                      </div>
                                      <p className="text-[10px] text-neutral-500">0이면 외곽선 없음. 비우면 글자 크기에 맞춰 자동.</p>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">막대 배경색</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="color"
                                          value={toColorPickerValue(p.goalBarBgColor || "#fde8f2", "#fde8f2")}
                                          onChange={(e) => updatePreset(p.id, { goalBarBgColor: e.target.value })}
                                          className="h-9 w-12 rounded border border-white/20 bg-transparent p-0.5"
                                        />
                                        <input
                                          className="flex-1 px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs font-mono"
                                          value={p.goalBarBgColor || ""}
                                          onChange={(e) => updatePreset(p.id, { goalBarBgColor: e.target.value })}
                                          placeholder="#fde8f2"
                                        />
                                        <button
                                          type="button"
                                          className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-[10px] hover:bg-neutral-700"
                                          onClick={() => updatePreset(p.id, { goalBarBgColor: "" })}
                                        >
                                          기본
                                        </button>
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">게이지(채움) 색</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="color"
                                          value={toColorPickerValue(p.goalBarFillColor || "#ff6eb5", "#ff6eb5")}
                                          onChange={(e) => updatePreset(p.id, { goalBarFillColor: e.target.value })}
                                          className="h-9 w-12 rounded border border-white/20 bg-transparent p-0.5"
                                        />
                                        <input
                                          className="flex-1 px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs font-mono"
                                          value={p.goalBarFillColor || ""}
                                          onChange={(e) => updatePreset(p.id, { goalBarFillColor: e.target.value })}
                                          placeholder="#ff6eb5"
                                        />
                                        <button
                                          type="button"
                                          className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-[10px] hover:bg-neutral-700"
                                          onClick={() => updatePreset(p.id, { goalBarFillColor: "" })}
                                        >
                                          기본
                                        </button>
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">목표 글꼴</label>
                                      <select
                                        className="w-full px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs"
                                        value={normalizeTableFontFamily(p.goalFontFamily || "auto")}
                                        onChange={(e) => updatePreset(p.id, { goalFontFamily: e.target.value })}
                                      >
                                        {TABLE_FONT_FAMILY_OPTIONS.map((opt) => (
                                          <option key={opt.id} value={opt.id}>
                                            {opt.label}
                                          </option>
                                        ))}
                                      </select>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">게이지 애니메이션</label>
                                      <select
                                        className="w-full px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs"
                                        value={p.goalBarAnimation || "both"}
                                        onChange={(e) => updatePreset(p.id, { goalBarAnimation: e.target.value })}
                                      >
                                        <option value="both">펄스 + 스윕 (기본)</option>
                                        <option value="pulse">펄스만</option>
                                        <option value="sweep">스윕만</option>
                                        <option value="off">끄기</option>
                                      </select>
                                    </div>
                                    <div className="space-y-1 sm:col-span-2">
                                      <label className="text-[11px] text-neutral-400">막대 배경 GIF/JPG URL</label>
                                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2">
                                        <input
                                          className="px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs"
                                          placeholder="예: https://media.giphy.com/.../giphy.gif"
                                          value={p.goalBarGifUrl || ""}
                                          onChange={(e) => updatePreset(p.id, { goalBarGifUrl: e.target.value })}
                                        />
                                        <label className="px-2 py-1 rounded bg-[#6366f1] hover:bg-[#4f46e5] text-xs text-white cursor-pointer text-center">
                                          GIF/JPG 업로드
                                          <input
                                            type="file"
                                            accept=".gif,.jpg,.jpeg,image/gif,image/jpeg"
                                            className="hidden"
                                            onChange={(e) => {
                                              const file = e.target.files?.[0] || null;
                                              uploadGoalBarGifImage(p.id, file);
                                              e.currentTarget.value = "";
                                            }}
                                          />
                                        </label>
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">배경 GIF/JPG 불투명도</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="range"
                                          min="0"
                                          max="100"
                                          value={p.goalBarGifOpacity || "45"}
                                          onChange={(e) => updatePreset(p.id, { goalBarGifOpacity: e.target.value })}
                                          className="flex-1 accent-fuchsia-500"
                                        />
                                        <input
                                          className="w-14 px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs text-right"
                                          value={p.goalBarGifOpacity || "45"}
                                          onChange={(e) =>
                                            updatePreset(p.id, {
                                              goalBarGifOpacity: e.target.value.replace(/[^\d]/g, ""),
                                            })
                                          }
                                        />
                                        <span className="text-[10px] text-neutral-500">%</span>
                                      </div>
                                    </div>
                                    <div className="space-y-1">
                                      <label className="text-[11px] text-neutral-400">배경 GIF/JPG 밝기</label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="range"
                                          min="40"
                                          max="200"
                                          value={p.goalBarGifBrightness || "100"}
                                          onChange={(e) => updatePreset(p.id, { goalBarGifBrightness: e.target.value })}
                                          className="flex-1 accent-fuchsia-500"
                                        />
                                        <input
                                          className="w-14 px-2 py-1 rounded bg-neutral-900/90 border border-white/15 text-xs text-right"
                                          value={p.goalBarGifBrightness || "100"}
                                          onChange={(e) =>
                                            updatePreset(p.id, {
                                              goalBarGifBrightness: e.target.value.replace(/[^\d]/g, ""),
                                            })
                                          }
                                        />
                                        <span className="text-[10px] text-neutral-500">%</span>
                                      </div>
                                    </div>
                                  </div>
                                  <p className="mt-1 text-[10px] text-emerald-400/90 leading-snug">
                                    Prism/OBS(`host=prism`)는 저장 후 브라우저 소스만 새로고침하면 색·크기·외곽선·막대 스타일이 바로 반영됩니다.
                                  </p>
                                </div>
                                <details className="rounded border border-white/10 bg-neutral-900/40">
                                  <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">후원 목표 — 추가 설정</summary>
                                  <div className="p-3 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-1">
                                  <p className="col-span-1 sm:col-span-2 text-[11px] text-neutral-500 leading-snug">
                                    통합·목표 오버레이: 후원 합계가 현재 목표 이상이면 「달성 시 증가폭」(기본 200만 원)만큼 자동 상향. 초기화 시 「초기 목표」(goalBaseline)로 복원됩니다.
                                  </p>
                                  <label className="text-xs text-neutral-400">총 금액(현재 후원액, 원)</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" placeholder="미지정 시 자동" value={p.goalCurrent || ""} onChange={(e) => updatePreset(p.id, { goalCurrent: e.target.value })} />
                                  <div className="col-span-1 sm:col-span-2">
                                    <details className="rounded border border-white/10 bg-neutral-900/40">
                                      <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">고급 옵션</summary>
                                      <div className="p-3 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-1">
                                        <label className="text-xs text-neutral-400">너비(px)</label>
                                        <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.goalWidth} onChange={(e) => updatePreset(p.id, { goalWidth: e.target.value })} />
                                        <label className="text-xs text-neutral-400">전체 투명도(%)</label>
                                        <div className="flex flex-col gap-1">
                                          <div className="flex items-center gap-2">
                                            <input
                                              type="range"
                                              min="0"
                                              max="100"
                                              value={p.goalOpacity ?? "100"}
                                              onChange={(e) => updatePreset(p.id, { goalOpacity: e.target.value })}
                                              className="flex-1 accent-fuchsia-500"
                                            />
                                            <input
                                              className="w-14 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                              type="number"
                                              min="0"
                                              max="100"
                                              value={p.goalOpacity ?? "100"}
                                              onChange={(e) => updatePreset(p.id, { goalOpacity: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                            />
                                          </div>
                                          <p className="text-[10px] text-neutral-500 leading-snug">
                                            막대·채움은 항상 불투명합니다. 아래 「텍스트도 투명화」를 켠 경우에만 전체 위젯이 흐려집니다.
                                          </p>
                                        </div>
                                        <label className="text-xs text-neutral-400">텍스트도 투명화</label>
                                        <label className="inline-flex items-center gap-2 text-xs text-neutral-300">
                                          <input
                                            type="checkbox"
                                            checked={Boolean(p.goalOpacityText)}
                                            onChange={(e) => updatePreset(p.id, { goalOpacityText: e.target.checked })}
                                          />
                                          체크 시 막대·글자 전체를 위 투명도(%)로 흐리게
                                        </label>
                                        <label className="text-xs text-neutral-400">글자색</label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="color"
                                            value={toColorPickerValue(p.goalTextColor || "#6b2d4a", "#6b2d4a")}
                                            onChange={(e) => updatePreset(p.id, { goalTextColor: e.target.value })}
                                            className="h-8 w-10 rounded border border-white/20 bg-transparent p-0.5"
                                          />
                                          <input
                                            className="flex-1 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm font-mono"
                                            value={p.goalTextColor || ""}
                                            onChange={(e) => updatePreset(p.id, { goalTextColor: e.target.value })}
                                            placeholder="#6b2d4a (비우면 기본)"
                                          />
                                        </div>
                                        <label className="text-xs text-neutral-400">글자 크기(px)</label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="range"
                                            min="10"
                                            max="48"
                                            value={(() => {
                                              const n = parseInt(String(p.goalFontSize || ""), 10);
                                              return Number.isFinite(n) && n >= 10 ? Math.min(48, n) : 14;
                                            })()}
                                            onChange={(e) => updatePreset(p.id, { goalFontSize: e.target.value })}
                                            className="flex-1 accent-fuchsia-500"
                                          />
                                          <input
                                            className="w-14 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                            type="number"
                                            min="10"
                                            max="48"
                                            value={p.goalFontSize || ""}
                                            onChange={(e) => updatePreset(p.id, { goalFontSize: e.target.value.replace(/[^\d]/g, "").slice(0, 2) })}
                                            placeholder="자동"
                                          />
                                        </div>
                                        <label className="text-xs text-neutral-400">글자 외곽선 색</label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="color"
                                            value={toColorPickerValue(p.goalTextOutlineColor || "#060c18", "#060c18")}
                                            onChange={(e) => updatePreset(p.id, { goalTextOutlineColor: e.target.value })}
                                            className="h-8 w-10 rounded border border-white/20 bg-transparent p-0.5"
                                          />
                                          <input
                                            className="flex-1 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm font-mono"
                                            value={p.goalTextOutlineColor || ""}
                                            onChange={(e) => updatePreset(p.id, { goalTextOutlineColor: e.target.value })}
                                            placeholder="기본"
                                          />
                                          <button
                                            type="button"
                                            className="shrink-0 rounded bg-neutral-800 px-2 py-1 text-[10px] hover:bg-neutral-700"
                                            onClick={() => updatePreset(p.id, { goalTextOutlineColor: "" })}
                                          >
                                            기본
                                          </button>
                                        </div>
                                        <label className="text-xs text-neutral-400">글자 외곽선 두께</label>
                                        <div className="flex items-center gap-2">
                                          <input
                                            type="range"
                                            min="0"
                                            max="3"
                                            step="0.1"
                                            value={(() => {
                                              const n = parseFloat(String(p.goalTextOutlineWidth ?? ""));
                                              return Number.isFinite(n) ? Math.min(3, Math.max(0, n)) : 0.8;
                                            })()}
                                            onChange={(e) => updatePreset(p.id, { goalTextOutlineWidth: e.target.value })}
                                            className="flex-1 accent-fuchsia-500"
                                          />
                                          <input
                                            className="w-14 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                            type="number"
                                            min="0"
                                            max="3"
                                            step="0.1"
                                            value={p.goalTextOutlineWidth ?? ""}
                                            onChange={(e) =>
                                              updatePreset(p.id, {
                                                goalTextOutlineWidth: e.target.value.replace(/[^\d.]/g, "").slice(0, 3),
                                              })
                                            }
                                            placeholder="자동"
                                          />
                                        </div>
                                        <p className="col-span-1 sm:col-span-2 text-[10px] text-neutral-500">
                                          글자 크기를 비우면 막대 너비에 맞춰 자동 조절됩니다. 외곽선 두께 0이면 끔.
                                        </p>
                                      </div>
                                    </details>
                                  </div>
                                  {managePositionInPrism && (
                                    <>
                                      <label className="text-xs text-neutral-400">위치 설정(Prism에서)</label>
                                      <div className="text-xs text-neutral-500">위치/크기 조정은 Prism에서 진행합니다.</div>
                                    </>
                                  )}
                                </div>
                              </details>
                              </>
                            )}

                            {p.showPersonalGoal && (
                              <details className="rounded border border-white/10 bg-neutral-900/40">
                                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">개인골</summary>
                                <div className="p-3 grid grid-cols-1 sm:grid-cols-[100px_minmax(0,1fr)] items-center gap-1">
                                  <label className="text-xs text-neutral-400">테마</label>
                                  <select className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.personalGoalTheme || "goalClassic"} onChange={(e) => updatePreset(p.id, { personalGoalTheme: e.target.value })}>
                                    <option value="goalClassic">개인골 클래식</option>
                                    <option value="goalNeon">개인골 네온</option>
                                  </select>
                                  {managePositionInPrism && (
                                    <>
                                      <label className="text-xs text-neutral-400">위치 설정(Prism에서)</label>
                                      <div className="text-xs text-neutral-500">위치/크기 조정은 Prism에서 진행합니다.</div>
                                    </>
                                  )}
                                  <label className="text-xs text-neutral-400">표시 개수</label>
                                  <input className="px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm" value={p.personalGoalLimit || "3"} onChange={(e) => updatePreset(p.id, { personalGoalLimit: e.target.value.replace(/[^\d]/g, "") })} />
                                  <div className="sm:col-span-2 text-[11px] text-neutral-500">
                                    멤버의 목표(원)를 설정해야 개인골 카드가 표시됩니다. 상단의 ‘멤버 정산 보드’에서 각 멤버의 목표를 입력하세요.
                                  </div>
                                  <div className="sm:col-span-2">
                                    <button
                                      type="button"
                                      className="px-2 py-1 rounded bg-emerald-900/50 hover:bg-emerald-800/60 border border-emerald-700/40 text-xs text-emerald-100"
                                      onClick={() => {
                                        if (typeof window === "undefined") return;
                                        window.open(buildPrismOverlayUrl(p, !!p.vertical), "_blank", "noopener,noreferrer");
                                      }}
                                    >
                                      실시간으로 열기 (개인골)
                                    </button>
                                  </div>
                                </div>
                              </details>
                            )}

                            {/* 후원 티커 섹션 제거 */}

                            {p.showTimer && (
                              <details className="rounded border border-white/10 bg-neutral-900/40">
                                <summary className="cursor-pointer select-none px-3 py-2 text-xs text-neutral-300">방송 타이머</summary>
                                <div className="p-3 space-y-3">
                                  <div className="flex flex-wrap gap-2 items-center">
                                    <button className="px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-xs" onClick={() => updatePreset(p.id, { timerStart: Date.now() })}>{p.timerStart ? "재시작" : "시작"}</button>
                                    {p.timerStart && <button className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-xs" onClick={() => updatePreset(p.id, { timerStart: null })}>정지</button>}
                                    <button
                                      className={`px-2 py-1 rounded border text-xs ${p.timerShowHours ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`}
                                      onClick={() => updatePreset(p.id, { timerShowHours: !p.timerShowHours })}
                                    >
                                      시:분:초 {p.timerShowHours ? "ON" : "OFF"}
                                    </button>
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2">
                                    <label className="text-xs text-neutral-400">글자 색상</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="color"
                                        className="w-16 h-10 rounded bg-neutral-900/80 border border-white/10"
                                        value={toColorPickerValue(String(p.timerFontColor ?? ""), "#ffffff")}
                                        onChange={(e) => updatePreset(p.id, { timerFontColor: e.target.value })}
                                      />
                                      <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { timerFontColor: "" })}>기본</button>
                                    </div>
                                    <label className="text-xs text-neutral-400">배경 색상</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="color"
                                        className="w-16 h-10 rounded bg-neutral-900/80 border border-white/10"
                                        value={toColorPickerValue(String(p.timerBgColor ?? ""), "#ffffff")}
                                        onChange={(e) =>
                                          updatePreset(p.id, {
                                            timerBgColor: e.target.value,
                                            timerBgOpacity: String(
                                              restoreTimerBackgroundOpacity(
                                                String(p.timerDesign || ""),
                                                parseInt(String(p.timerBgOpacity || "0"), 10)
                                              )
                                            ),
                                          })
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                        onClick={() =>
                                          updatePreset(p.id, {
                                            timerBgColor: String(p.timerDesign || "") === "led-matrix" ? "#000000" : "",
                                            timerBgOpacity: String(
                                              restoreTimerBackgroundOpacity(
                                                String(p.timerDesign || ""),
                                                parseInt(String(p.timerBgOpacity || "0"), 10)
                                              )
                                            ),
                                          })
                                        }
                                      >
                                        기본
                                      </button>
                                      <button
                                        type="button"
                                        className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                        onClick={() => updatePreset(p.id, { timerBgColor: "transparent", timerBorderColor: "transparent", timerOutlineColor: "", timerBgOpacity: "0" })}
                                      >
                                        배경 없음
                                      </button>
                                      <button
                                        type="button"
                                        className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                        onClick={() =>
                                          updatePreset(p.id, {
                                            timerBgColor: String(p.timerDesign || "") === "led-matrix" ? "#000000" : "",
                                            timerBgOpacity: String(p.timerDesign || "") === "led-matrix" ? "100" : "40",
                                          })
                                        }
                                      >
                                        배경 넣기
                                      </button>
                                    </div>
                                    <label className="text-xs text-neutral-400">테두리 색상</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="color"
                                        className="w-16 h-10 rounded bg-neutral-900/80 border border-white/10"
                                        value={toColorPickerValue(String(p.timerBorderColor ?? ""), "#ffffff")}
                                        onChange={(e) => updatePreset(p.id, { timerBorderColor: e.target.value })}
                                      />
                                      <button type="button" className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs" onClick={() => updatePreset(p.id, { timerBorderColor: "" })}>기본</button>
                                      <button
                                        type="button"
                                        className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 text-xs"
                                        onClick={() => updatePreset(p.id, { timerBorderColor: "transparent" })}
                                      >
                                        테두리 없음
                                      </button>
                                    </div>
                                    <label className="text-xs text-neutral-400">배경 불투명도</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="range"
                                        min="0"
                                        max="100"
                                        value={p.timerBgOpacity || "40"}
                                        onChange={(e) => updatePreset(p.id, { timerBgOpacity: e.target.value })}
                                        className="flex-1 accent-emerald-500 h-10"
                                      />
                                      <input
                                        className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                        value={p.timerBgOpacity || "40"}
                                        onChange={(e) => updatePreset(p.id, { timerBgOpacity: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                      />
                                      <span className="text-xs text-neutral-500">%</span>
                                    </div>
                                    <label className="text-xs text-neutral-400">타이머 스케일(%)</label>
                                    <div className="flex items-center gap-2">
                                      <input
                                        type="range"
                                        min="50"
                                        max="250"
                                        value={p.timerScale || "100"}
                                        onChange={(e) => updatePreset(p.id, { timerScale: e.target.value })}
                                        className="flex-1 accent-fuchsia-500 h-10"
                                      />
                                      <input
                                        className="w-20 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 text-sm text-right"
                                        value={p.timerScale || "100"}
                                        onChange={(e) => updatePreset(p.id, { timerScale: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })}
                                      />
                                      <span className="text-xs text-neutral-500">%</span>
                                    </div>
                                  </div>
                                  <div className="text-xs text-neutral-500">위치 설정은 Prism에서 조정 가능</div>
                                </div>
                              </details>
                            )}

                            {p.showMission && (
                              <>
                                <div className="h-px bg-white/10 my-1" />
                                <div className="text-xs text-neutral-400 font-semibold">미션 전광판</div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-2 mt-1">
                                  <label className="text-xs text-neutral-400">표시</label>
                                  <div>
                                    <button className={`px-2 py-1 rounded text-xs ${p.showMission ? "bg-emerald-700" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={() => updatePreset(p.id, { showMission: !p.showMission })}>{p.showMission ? "ON" : "OFF"}</button>
                                    <span className="ml-2 text-xs text-neutral-500">프리뷰/OBS에서 즉시 반영</span>
                                  </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-[120px_minmax(0,1fr)] items-center gap-3 mt-2">
                                  <label className="text-xs text-neutral-400">배경 색상</label>
                                  <input type="color" className="w-16 h-11 rounded bg-neutral-900/80 border border-white/10" value={toColorPickerValue(String(p.missionBgColor ?? ""), "#0b0b0b")} onChange={(e) => updatePreset(p.id, { missionBgColor: e.target.value })} />
                                  <label className="text-xs text-neutral-400">배경 불투명도</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min="0" max="100" value={p.missionBgOpacity || "85"} onChange={(e) => updatePreset(p.id, { missionBgOpacity: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                    <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionBgOpacity || "85"} onChange={(e) => updatePreset(p.id, { missionBgOpacity: e.target.value.replace(/[^\\d]/g, "") })} />
                                    <span className="text-xs text-neutral-500">%</span>
                                  </div>
                                  <label className="text-xs text-neutral-400">텍스트 색상</label>
                                  <input type="color" className="w-16 h-11 rounded bg-neutral-900/80 border border-white/10" value={toColorPickerValue(String(p.missionItemColor ?? ""), "#fde68a")} onChange={(e) => updatePreset(p.id, { missionItemColor: e.target.value })} />
                                  <label className="text-xs text-neutral-400">타이틀 색상</label>
                                  <input type="color" className="w-16 h-11 rounded bg-neutral-900/80 border border-white/10" value={toColorPickerValue(String(p.missionTitleColor ?? ""), "#fcd34d")} onChange={(e) => updatePreset(p.id, { missionTitleColor: e.target.value })} />
                              <label className="text-xs text-neutral-400">타이틀 효과</label>
                              <select
                                className="px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm min-h-[44px]"
                                value={(p as any).missionTitleEffect || "none"}
                                onChange={(e) => updatePreset(p.id, { missionTitleEffect: e.target.value })}
                              >
                                <option value="none">없음</option>
                                <option value="blink">깜빡임</option>
                                <option value="pulse">펄스</option>
                                <option value="glow">글로우</option>
                                <option value="sparkle">스파클</option>
                                <option value="gradient">그라데이션</option>
                                <option value="rainbow">레인보우</option>
                                <option value="shadow">섀도우</option>
                              </select>
                              <label className="text-xs text-neutral-400">제목 텍스트</label>
                              <input
                                className="px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm min-h-[44px]"
                                placeholder="MISSION"
                                value={(p as any).missionTitleText || ""}
                                onChange={(e) => updatePreset(p.id, { missionTitleText: e.target.value })}
                              />
                                  <label className="text-xs text-neutral-400">글씨 크기</label>
                                  <div className="flex items-center gap-2">
                                    <input type="range" min="10" max="80" value={p.missionFontSize || "18"} onChange={(e) => updatePreset(p.id, { missionFontSize: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                    <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionFontSize || "18"} onChange={(e) => updatePreset(p.id, { missionFontSize: e.target.value.replace(/[^\\d]/g, "") })} />
                                    <span className="text-xs text-neutral-500">px</span>
                                  </div>
                                <label className="text-xs text-neutral-400">효과</label>
                                <select
                                  className="px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm min-h-[44px]"
                                  value={p.missionEffect || "none"}
                                  onChange={(e) => updatePreset(p.id, { missionEffect: e.target.value })}
                                >
                                  <option value="none">없음</option>
                                  <option value="blink">깜빡임</option>
                                  <option value="pulse">펄스</option>
                                  <option value="glow">글로우</option>
                                </select>
                                <div className="flex items-center gap-2">
                                  <input id={`hotOnly-${p.id}`} type="checkbox" className="w-4 h-4 accent-emerald-500" checked={(p.missionEffectHotOnly as any) === "true"} onChange={(e) => updatePreset(p.id, { missionEffectHotOnly: e.target.checked ? "true" : "false" })} />
                                  <label htmlFor={`hotOnly-${p.id}`} className="text-xs text-neutral-400">핫 항목만 적용</label>
                                </div>
                                <label className="text-xs text-neutral-400">디스플레이 모드</label>
                                <select
                                  className="px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm min-h-[44px]"
                                  value={p.missionDisplayMode || "horizontal"}
                                  onChange={(e) => updatePreset(p.id, { missionDisplayMode: e.target.value })}
                                >
                                  <option value="horizontal">가로 흐름</option>
                                  <option value="vertical-slot">슬롯형(세로)</option>
                                </select>
                                {p.missionDisplayMode === "vertical-slot" && (
                                  <>
                                    <label className="text-xs text-neutral-400">노출 개수</label>
                                    <div className="flex items-center gap-2">
                                      <input type="range" min="1" max="6" value={p.missionVisibleCount || "3"} onChange={(e) => updatePreset(p.id, { missionVisibleCount: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                      <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionVisibleCount || "3"} onChange={(e) => updatePreset(p.id, { missionVisibleCount: e.target.value.replace(/[^\\d]/g, "") })} />
                                    </div>
                                  </>
                                )}
                                <label className="text-xs text-neutral-400">애니메이션 속도(초)</label>
                                <div className="flex items-center gap-2">
                                  <input type="range" min="1" max="120" value={p.missionSpeed || (p.missionDisplayMode === "vertical-slot" ? "2" : "25")} onChange={(e) => updatePreset(p.id, { missionSpeed: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                  <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionSpeed || (p.missionDisplayMode === "vertical-slot" ? "2" : "25")} onChange={(e) => updatePreset(p.id, { missionSpeed: e.target.value.replace(/[^\\d.]/g, "") })} />
                                </div>
                                <label className="text-xs text-neutral-400">아이템 간격(px)</label>
                                <div className="flex items-center gap-2">
                                  <input type="range" min="0" max="48" value={p.missionGapSize || "8"} onChange={(e) => updatePreset(p.id, { missionGapSize: e.target.value })} className="flex-1 accent-emerald-500 h-11" />
                                  <input className="w-20 px-2 py-2 rounded bg-neutral-900/80 border border-white/10 text-sm text-right min-h-[44px]" value={p.missionGapSize || "8"} onChange={(e) => updatePreset(p.id, { missionGapSize: e.target.value.replace(/[^\\d]/g, "") })} />
                                </div>
                                </div>
                                {/* Palette view removed; keep compact select */}
                                {!(p.showMission && !p.showMembers && !p.showTotal && !p.showGoal && !p.showPersonalGoal && !p.showTimer) && (
                                  <div className="mt-2 rounded border border-white/10 bg-neutral-950/60 p-2">
                                    <div className="text-xs text-neutral-400 mb-1">미션 전광판 미리보기</div>
                                    <div className="overflow-hidden">
                                      {(p.missionDisplayMode === "vertical-slot") ? (
                                        <MissionBoardSlot
                                          missions={displayMissions}
                                          fontSize={parseInt(p.missionFontSize || "18", 10)}
                                          themeVariant={(() => {
                                            const id = p.theme || "default";
                                            const excelThemes = ["excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo"];
                                            if (excelThemes.includes(id)) return "excel";
                                            if (["rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"].includes(id)) return "neon";
                                            return (id as any);
                                          })()}
                                        titleText={(p as any).missionTitleText || undefined}
                                          visibleCount={parseInt(p.missionVisibleCount || "3", 10)}
                                          speed={parseFloat(p.missionSpeed || "2")}
                                          gapSize={parseInt(p.missionGapSize || "8", 10)}
                                          bgColor={(p as any).missionBgColor || undefined}
                                          bgOpacity={parseInt(p.missionBgOpacity || "85", 10)}
                                          itemColor={(p as any).missionItemColor || undefined}
                                          titleColor={(p as any).missionTitleColor || undefined}
                                          titleEffect={((p as any).missionTitleEffect || "none") as any}
                                        />
                                      ) : (
                                        <MissionBoard
                                          missions={displayMissions}
                                          fontSize={parseInt(p.missionFontSize || "18", 10)}
                                          themeVariant={(() => {
                                            const id = p.theme || "default";
                                            const excelThemes = ["excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo"];
                                            if (excelThemes.includes(id)) return "excel";
                                            if (["rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"].includes(id)) return "neon";
                                            return (id as any);
                                          })()}
                                        titleText={(p as any).missionTitleText || undefined}
                                          duration={parseFloat(p.missionSpeed || "25")}
                                          bgColor={(p as any).missionBgColor || undefined}
                                          bgOpacity={parseInt(p.missionBgOpacity || "85", 10)}
                                          itemColor={(p as any).missionItemColor || undefined}
                                          titleColor={(p as any).missionTitleColor || undefined}
                                          titleEffect={((p as any).missionTitleEffect || "none") as any}
                                        />
                                      )}
                                    </div>
                                  </div>
                                )}
                                <div className="text-xs text-neutral-500">위치 설정(Prism에서), 고급 위치는 포지션 탭에서 조정</div>
                              </>
                            )}

                            <div className="h-px bg-white/10 my-1" />
                            <div className="flex items-center gap-2">
                              <input className="flex-1 px-2 py-1 rounded bg-neutral-900/80 border border-white/10 font-mono text-xs" readOnly value={url} />
                              <button className={`px-2 py-1 rounded text-xs whitespace-nowrap ${copiedId === p.id ? "bg-emerald-600" : "bg-neutral-700 hover:bg-neutral-600"}`} onClick={() => copyUrl(url, p.id)}>{copiedId === p.id ? "복사됨!" : "URL 복사"}</button>
                              <button
                                className="px-2 py-1 rounded bg-amber-700 hover:bg-amber-600 text-xs whitespace-nowrap"
                                onClick={() => {
                                  const snapUrl = buildEmergencySnapshotUrl(p);
                                  copyUrl(snapUrl, p.id);
                                }}
                                title="서버 연결 장애 시 멤버/금액 스냅샷을 URL에 포함해 바로 표시"
                              >
                                긴급 링크(오프라인)
                              </button>
                            </div>
                          </div>

                          <div className="lg:order-1">
                            {(p.showMission && !p.showMembers && !p.showTotal && !p.showGoal && !p.showPersonalGoal && !p.showTimer) ? (
                              <div className="rounded border border-white/10 bg-neutral-950/60 p-3">
                                <div className="text-xs text-neutral-400 mb-2">미션 전광판 미리보기</div>
                                {(p.missionDisplayMode === "vertical-slot") ? (
                                  <MissionBoardSlot
                                    missions={displayMissions}
                                    fontSize={parseInt(p.missionFontSize || "24", 10)}
                                    themeVariant={(() => {
                                      const id = p.theme || "default";
                                      const excelThemes = ["excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo"];
                                      if (excelThemes.includes(id)) return "excel";
                                      if (["rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"].includes(id)) return "neon";
                                      return (id as any);
                                    })()}
                                    titleText={(p as any).missionTitleText || undefined}
                                    visibleCount={parseInt(p.missionVisibleCount || "3", 10)}
                                    speed={parseFloat(p.missionSpeed || "2")}
                                    gapSize={parseInt(p.missionGapSize || "8", 10)}
                                    bgColor={(p as any).missionBgColor || undefined}
                                    bgOpacity={parseInt(p.missionBgOpacity || "85", 10)}
                                    itemColor={(p as any).missionItemColor || undefined}
                                    titleColor={(p as any).missionTitleColor || undefined}
                                    titleEffect={((p as any).missionTitleEffect || "none") as any}
                                  />
                                ) : (
                                  <MissionBoard
                                    missions={displayMissions}
                                    fontSize={parseInt(p.missionFontSize || "24", 10)}
                                    themeVariant={(() => {
                                      const id = p.theme || "default";
                                      const excelThemes = ["excel","excelBlue","excelSlate","excelAmber","excelRose","excelNavy","excelTeal","excelPurple","excelEmerald","excelOrange","excelIndigo"];
                                      if (excelThemes.includes(id)) return "excel";
                                      if (["rainbow","sunset","ocean","forest","aurora","violet","coral","mint","lava","ice"].includes(id)) return "neon";
                                      return (id as any);
                                    })()}
                                    titleText={(p as any).missionTitleText || undefined}
                                    duration={parseFloat(p.missionSpeed || "25")}
                                    bgColor={(p as any).missionBgColor || undefined}
                                    bgOpacity={parseInt(p.missionBgOpacity || "85", 10)}
                                    itemColor={(p as any).missionItemColor || undefined}
                                    titleColor={(p as any).missionTitleColor || undefined}
                                    titleEffect={((p as any).missionTitleEffect || "none") as any}
                                    effect={(p as any).missionEffect || "none"}
                                    effectHotOnly={(p as any).missionEffectHotOnly === "true"}
                                  />
                                )}
                              </div>
                            ) : (
                              <ClientPreviewWrapper preset={p} buildUrl={buildStablePreviewUrl} />
                            )}
                          </div>
                        </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
            )}

            {isAdminNavSectionVisible("settlement") && (
            <section className={`${panelCardClass} p-4 md:p-6`}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="text-lg font-semibold">방송 종료 정산</h2>
                <Link className="text-sm text-neutral-300 underline" href="/settlements">정산 기록 보기</Link>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="flex-1 min-w-[220px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="정산 제목 (예: 16화 세부)"
                  value={settlementTitle}
                  onChange={(e) => setSettlementTitle(e.target.value)}
                />
                <input
                  className="w-[120px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="계좌 비율 % (예: 70)"
                  value={accountRatioInput}
                  onChange={(e) => setAccountRatioInput(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <input
                  className="w-[120px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="투네 비율 % (예: 60)"
                  value={toonRatioInput}
                  onChange={(e) => setToonRatioInput(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <input
                  className="w-[120px] px-3 py-2 rounded bg-neutral-900/80 border border-white/10"
                  placeholder="세금 비율 % (예: 3.3)"
                  value={taxRateInput}
                  onChange={(e) => setTaxRateInput(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <button
                  type="button"
                  className={`px-3 py-2 rounded border text-sm whitespace-nowrap ${vatIncluded ? "border-emerald-500 bg-emerald-950/40 text-emerald-300" : "border-white/10 bg-neutral-900/80 text-neutral-400"}`}
                  onClick={() => setVatIncluded((v) => !v)}
                >
                  부가세 포함 {vatIncluded ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 rounded border text-sm whitespace-nowrap ${taxInvoiceIssued ? "border-violet-500 bg-violet-950/40 text-violet-300" : "border-white/10 bg-neutral-900/80 text-neutral-400"}`}
                  onClick={() => setTaxInvoiceIssued((v) => !v)}
                  title="체크 시 최종정산에 부가세 10% 가산(세금계산서). 미체크 시 원천세만"
                >
                  세금계산서 {taxInvoiceIssued ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 rounded border text-sm whitespace-nowrap ${omitTreasuryFromSettlement ? "border-amber-500 bg-amber-950/40 text-amber-300" : "border-white/10 bg-neutral-900/80 text-neutral-400"}`}
                  onClick={() => setOmitTreasuryFromSettlement((v) => !v)}
                  title="운영비(국고) 멤버 후원은 정산 합계·지급 대상에서 제외하고 별도 표시"
                >
                  운영비 {omitTreasuryFromSettlement ? "ON" : "OFF"}
                </button>
                <button
                  type="button"
                  className={`px-3 py-2 rounded border text-sm whitespace-nowrap ${includeTreasuryInFullStatement ? "border-cyan-500 bg-cyan-950/40 text-cyan-300" : "border-white/10 bg-neutral-900/80 text-neutral-400"}`}
                  onClick={() => setIncludeTreasuryInFullStatement((v) => !v)}
                  title="전체 정산서 PDF의 국고 50% 행 반영"
                >
                  전체정산서 국고 포함 {includeTreasuryInFullStatement ? "ON" : "OFF"}
                </button>
                <button
                  className="px-4 py-2 rounded bg-[#22c55e] hover:bg-[#16a34a] font-semibold text-white whitespace-nowrap flex-none"
                  onClick={onFinishBroadcastAndSettle}
                >
                  방송 종료(정산 생성)
                </button>
              </div>
              <div className="mt-2 text-xs text-neutral-400 leading-relaxed">
                · <span className="text-neutral-300">운영비</span>: 국고 멤버 후원은 멤버별 최종 정산·합계에서 빠지고 참고용으로만 표시됩니다.
                {" · "}
                <span className="text-neutral-300">전체정산서 국고 포함</span>: 전체 정산서 PDF에 국고 50% 송금 행을 넣습니다(매출 30%의 절반).
              </div>
              <div className="mt-3 rounded border border-white/10 bg-neutral-900/40 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-neutral-200 font-medium">멤버별 개별 비율</div>
                  <button
                    className={`px-2 py-1 rounded border text-xs ${useMemberRatioOverrides ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-400"}`}
                    onClick={() => setUseMemberRatioOverrides((v) => !v)}
                  >
                    {useMemberRatioOverrides ? "사용 중" : "미사용"}
                  </button>
                </div>
                <div className="text-xs text-neutral-400">
                  개별 비율을 비워두면 상단 공통 비율(계좌 {accountRatioInput || "70"}%, 투네 {toonRatioInput || "60"}%)이 적용됩니다.
                </div>
                {useMemberRatioOverrides && (
                  <div className="overflow-auto rounded border border-white/10">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-neutral-400 border-b border-white/10">
                          <th className="p-2 text-left">멤버</th>
                          <th className="p-2 text-left">계좌 비율 %</th>
                          <th className="p-2 text-left">투네 비율 %</th>
                        </tr>
                      </thead>
                      <tbody>
                        {state.members.map((m) => (
                          <tr key={m.id} className="border-b border-white/10">
                            <td className="p-2">{m.name}</td>
                            <td className="p-2">
                              <input
                                className="w-full px-2 py-1 rounded bg-neutral-900/80 border border-white/10"
                                placeholder={accountRatioInput || "70"}
                                value={memberRatioInputs[m.id]?.account || ""}
                                onChange={(e) => {
                                  const nextValue = e.target.value.replace(/[^\d.]/g, "");
                                  setMemberRatioInputs((prev) => ({
                                    ...prev,
                                    [m.id]: {
                                      account: nextValue,
                                      toon: prev[m.id]?.toon ?? "",
                                    },
                                  }));
                                }}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                className="w-full px-2 py-1 rounded bg-neutral-900/80 border border-white/10"
                                placeholder={toonRatioInput || "60"}
                                value={memberRatioInputs[m.id]?.toon || ""}
                                onChange={(e) => {
                                  const nextValue = e.target.value.replace(/[^\d.]/g, "");
                                  setMemberRatioInputs((prev) => ({
                                    ...prev,
                                    [m.id]: {
                                      account: prev[m.id]?.account ?? "",
                                      toon: nextValue,
                                    },
                                  }));
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div className="text-xs text-neutral-400 mt-2">
                계산식: (계좌×계좌비율 + 투네×투네비율) - 세금비율% / 비율은 % 단위로 입력
                {vatIncluded ? (
                  <span className="block mt-1 text-amber-200/90">
                    부가세 포함 ON: 원금을 공급가(÷1.1)로 환산한 뒤 수익배분·세금을 계산합니다.
                  </span>
                ) : null}
              </div>
            </section>
            )}

            {isAdminNavSectionVisible("logs") && (
            <section id="logs-data" className={`${panelCardClass} p-4 md:p-6`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">데이터</h2>
                <div className="flex gap-2">
                  <button
                    className="px-3 py-2 rounded bg-[#ef4444] hover:bg-[#dc2626] text-white"
                    onClick={() => setResetSheetOpen(true)}
                  >
                    정산 리셋(로그 기록)
                  </button>
                </div>
              </div>
              <div className="text-sm text-neutral-400 mt-2">
                3분마다 상태를 자동 저장합니다. 다른 탭과 실시간 동기화됩니다. 마지막 저장{" "}
                <span className="text-neutral-200"><ClientTime ts={state.updatedAt} /></span>
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `state-${new Date().toISOString().slice(0,10)}.json`;
                    a.click();
                  }}
                >상태 내보내기(JSON)</button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={onSnapshotNow}
                >지금 스냅샷 기록</button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={onDownloadLog}
                >히스토리 다운로드(JSON)</button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={() => {
                    if (typeof window === "undefined") return;
                    const raw = window.localStorage.getItem("excel-broadcast-daily-log-v1") || "{}";
                    const blob = new Blob([raw], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `daily-log.json`;
                    a.click();
                  }}
                >일일 로그 내보내기(JSON)</button>
                <button
                  className="px-3 py-2 rounded bg-neutral-800 hover:bg-neutral-700"
                  onClick={() => {
                    const header = "at,name,member,amount,message\r\n";
                    const rows = state.donors
                      .map((d) => {
                        const m = state.members.find((x)=>x.id===d.memberId)?.name || d.memberId;
                        const ts = new Date(d.at).toISOString();
                        const msg = String(d.message || "").replace(/"/g, '""');
                        return `${ts},${d.name},${m},${d.amount},"${msg}"`;
                      })
                      .join("\r\n");
                    const blob = new Blob([header+rows], { type: "text/csv;charset=utf-8" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `donors.csv`;
                    a.click();
                  }}
                >후원자 내보내기(CSV)</button>
              </div>
              <div className="rounded border border-white/10 bg-neutral-900/60 mt-3 max-h-[220px] overflow-auto">
                {flatLogs.length === 0 && <div className="p-3 text-sm text-neutral-400">히스토리가 없습니다. 리셋 시 자동 기록되며, [지금 스냅샷 기록]으로 즉시 저장할 수 있습니다.</div>}
                {flatLogs.map((it, idx) => (
                  <div key={idx} className="p-3 border-t border-white/10 text-sm">
                    <div className="text-xs text-neutral-400">{it.date} <ClientTime ts={it.entry.at} /></div>
                    <div className="text-neutral-300">총합 {it.entry.total.toLocaleString()} · 멤버 {it.entry.members.length} · 후원 {it.entry.donors.length}</div>
                  </div>
                ))}
              </div>
            </section>
            )}
          </div>
        </div>
      </div>
      </div>
      {actionSheet.open && (
        <div className="fixed inset-0 z-50 lg:hidden flex items-center justify-center p-4">
          <button className="absolute inset-0 bg-black/55" onClick={closeActionSheet} aria-label="액션 시트 닫기" />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#202020] p-4 shadow-xl">
            <div className="text-sm font-semibold text-white">{actionSheet.title}</div>
            {actionSheet.desc && <div className="text-xs text-neutral-400 mt-1 whitespace-pre-line">{actionSheet.desc}</div>}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <button className="px-3 py-2 rounded-lg bg-neutral-700 text-sm" onClick={closeActionSheet}>취소</button>
              <button
                className={`px-3 py-2 rounded-lg text-sm font-semibold ${actionSheet.danger ? "bg-[#ef4444] text-white" : "bg-[#22c55e] text-white"}`}
                onClick={() => {
                  const fn = actionConfirmRef.current;
                  closeActionSheet();
                  fn?.();
                }}
              >
                {actionSheet.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
      {resetSheetOpen && (
        <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
          <button className="absolute inset-0 bg-black/55" onClick={() => setResetSheetOpen(false)} aria-label="닫기" />
          <div className="relative w-full max-w-md lg:rounded-2xl rounded-t-2xl border-t lg:border border-white/10 bg-[#202020] p-4 lg:mx-4">
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-3 lg:hidden" />
            <div className="text-sm font-semibold text-white">정산 리셋 (로그 기록)</div>
            <div className="text-xs text-neutral-400 mt-1">
              멤버 초기화 여부를 선택하세요. 시그 재고·회전판·식대전·미션 등 방송 설정은 멤버 초기화에서도 유지됩니다.
            </div>
            <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <label className="block text-[11px] font-medium text-neutral-300">멤버 초기화 시 멤버 수 (1~30)</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={resetMemberSlotCount}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isFinite(v)) return;
                    setResetMemberSlotCount(Math.max(1, Math.min(30, v)));
                  }}
                  className="w-24 rounded-md border border-white/15 bg-neutral-900 px-2 py-1.5 text-sm text-white"
                />
                <span className="text-[11px] text-neutral-500">명 (기본 슬롯·이름은 멤버1… 순)</span>
              </div>
              <p className="mt-1.5 text-[10px] text-neutral-500 leading-snug">
                후원 초기화 시 목표는 저장된 「초기 목표」(goalBaseline)로 되돌립니다. 달성 시 자동 상향 폭은 프리셋의 「달성 시 증가폭」(goalIncreaseStep, 기본 200만 원)을 따릅니다.
              </p>
            </div>
            <div className="space-y-2 mt-4">
              <button
                className="w-full px-3 py-2.5 rounded-lg bg-neutral-700 hover:bg-neutral-600 text-sm text-left"
                onClick={onResetKeepMembers}
              >
                <span className="font-medium text-white">멤버 유지</span>
                <span className="block text-xs text-neutral-400 mt-0.5">이전 멤버·운영비 그대로 유지. 후원 내역·금액만 초기화</span>
              </button>
              <button
                className="w-full px-3 py-2.5 rounded-lg bg-[#ef4444] hover:bg-[#dc2626] text-sm text-left"
                onClick={onResetInitMembers}
              >
                <span className="font-medium text-white">멤버 초기화</span>
                <span className="block text-xs text-white/80 mt-0.5">
                  위에서 지정한 인원 수로 멤버 슬롯만 새로 잡고, 후원·정산 데이터는 비움
                </span>
              </button>
              <button
                className="w-full px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm"
                onClick={() => setResetSheetOpen(false)}
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
      <footer className="mt-8 text-center text-xs text-neutral-500">
        © 2026 {APP_BRAND_NAME}. All rights reserved.
      </footer>
      <nav className="fixed bottom-0 left-0 right-0 z-40 lg:hidden border-t border-white/10 bg-[#202020]/95 backdrop-blur">
        <div
          className="grid gap-1 p-2"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, navItems.filter((i) => i.mobileShort).length)}, minmax(0, 1fr))`,
          }}
        >
          {navItems
            .filter((item) => item.mobileShort)
            .map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => moveToSection(item.key, item.targetId)}
                className={`rounded-md py-2 text-xs ${activeNav === item.key ? "bg-[#6366f1] text-white" : "text-neutral-300"}`}
              >
                {item.mobileShort}
              </button>
            ))}
        </div>
      </nav>
    </main>
  );
}

function ClientPreviewWrapper({ preset, buildUrl }: { preset: OverlayPreset; buildUrl: (p: OverlayPreset) => string }) {
  const computed =
    typeof window !== "undefined" ? buildUrl(preset) || "" : "";
  const [url, setUrl] = useState(computed);
  useEffect(() => {
    if (computed !== url) setUrl(computed);
  }, [computed, url]);
  return <VerticalPreview url={url} presetName={preset.name || preset.id} />;
}

function VerticalPreview({ url, presetName }: { url: string; presetName?: string }) {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("portrait");
  const [showFrame, setShowFrame] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [broadcastMatch, setBroadcastMatch] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [w, h] = orientation === "portrait" ? [540, 960] : [960, 540];
  const previewUrl = useMemo(() => {
    if (!url || typeof url !== "string" || url.trim() === "") return "";
    try {
      const u = new URL(url);
      u.searchParams.set("previewGuide", "true");
      if (!u.searchParams.get("host")) u.searchParams.set("host", "prism");
      if (broadcastMatch) u.searchParams.set("broadcastMatch", "1");
      else u.searchParams.delete("broadcastMatch");
      return appendAdminPreviewEmbedToOverlayUrl(u.toString());
    } catch {
      return appendAdminPreviewEmbedToOverlayUrl(url);
    }
  }, [url, broadcastMatch]);
  useEffect(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    if (!previewUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    loadTimeoutRef.current = setTimeout(() => {
      setLoading(false);
      setErr("미리보기 로딩 지연 (네트워크 확인 후 새로고침)");
    }, 30000);
    return () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current);
        loadTimeoutRef.current = null;
      }
    };
  }, [previewUrl]);
  const onLoad = useCallback((e: any) => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setLoading(false);
    try {
      const doc = e?.target?.contentDocument;
      if (!doc) { setErr(null); return; }
      const title = (doc.title || "").toLowerCase();
      const text = (doc.body?.innerText || "").toLowerCase();
      if (title.includes("404") || text.includes("not found")) setErr("프리뷰 경로 404");
      else setErr(null);
    } catch {
      setErr(null);
    }
  }, []);
  const onError = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    }
    setLoading(false);
    setErr("미리보기 네트워크 오류");
  }, []);
  const reloadPreview = useCallback(() => {
    setErr(null);
    setLoading(true);
    setIframeKey((k) => k + 1);
  }, []);
  return (
    <div className="rounded border border-white/10 bg-black/70 p-2">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="text-xs text-neutral-400">프리뷰(단일 영상){presetName ? ` · ${presetName}` : ""}</div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={`rounded px-2 py-0.5 text-[11px] border ${
              broadcastMatch
                ? "border-amber-400 bg-amber-800/80 text-amber-50"
                : "border-white/15 bg-neutral-900 text-neutral-300 hover:border-white/30"
            }`}
            title="켜면 서버에 저장된 테마·헤더명(캐시/계좌 등)을 OBS와 동일하게 표시합니다"
            onClick={() => {
              setBroadcastMatch((v) => !v);
              setIframeKey((k) => k + 1);
            }}
          >
            {broadcastMatch ? "OBS 동일 ON" : "OBS 동일"}
          </button>
          <button
            className={`px-2 py-0.5 rounded border text-xs ${showFrame ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-300"}`}
            onClick={() => setShowFrame(!showFrame)}
            title="장식 프레임"
          >
            프레임
          </button>
          <button
            className={`px-2 py-0.5 rounded border text-xs ${showGuides ? "border-emerald-500 text-emerald-300" : "border-white/10 text-neutral-300"}`}
            onClick={() => setShowGuides(!showGuides)}
            title="안전 구역 가이드"
          >
            가이드
          </button>
          <button
            className="px-2 py-0.5 rounded border text-xs border-white/10 text-neutral-300 hover:border-emerald-500 hover:text-emerald-300"
            onClick={() => setOrientation(orientation === "portrait" ? "landscape" : "portrait")}
            title="가로/세로 전환"
          >
            {orientation === "portrait" ? "세로 9:16" : "가로 16:9"}
          </button>
          <button
            className="px-2 py-0.5 rounded border text-xs border-white/10 text-neutral-300 hover:border-emerald-500 hover:text-emerald-300"
            onClick={reloadPreview}
            title="프리뷰 새로고침"
          >
            새로고침
          </button>
          <button
            className={`px-2 py-0.5 rounded border text-xs ${showDiagnostics ? "border-amber-500 text-amber-300" : "border-white/10 text-neutral-300 hover:border-amber-500"}`}
            onClick={() => setShowDiagnostics((v) => !v)}
            title="원인 진단"
          >
            진단
          </button>
        </div>
      </div>
      <p className="mb-1 text-[10px] leading-snug text-neutral-500">
        기본 미리보기는 편집 중 테마를 바로 보여 줍니다. OBS(
        <code className="text-neutral-400">host=prism</code>
        )는 서버 저장본을 씁니다. 헤더색·「계좌/캐시」라벨이 다르면{" "}
        <strong className="text-neutral-400">OBS 동일</strong>을 켜거나, 테마 저장 후 OBS 브라우저 소스를 새로고침하세요.
      </p>
      {showDiagnostics && (
        <div className="mb-2 p-2 rounded bg-neutral-900/80 border border-amber-500/40 text-xs space-y-1">
          <div><span className="text-neutral-500">URL 길이:</span> {previewUrl ? previewUrl.length : 0}자 (브라우저 한도 ~2000자)</div>
          <div><span className="text-neutral-500">상태:</span> {loading ? "로딩 중" : err || "로드 완료"}</div>
          <div className="flex flex-wrap gap-2">
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-amber-400 underline">새 탭에서 열기</a>
            <button type="button" className="text-amber-400 underline" onClick={() => { navigator.clipboard?.writeText(previewUrl || ""); }}>URL 복사</button>
          </div>
          {previewUrl && previewUrl.length > 1800 && (
            <div className="text-amber-400">⚠ URL이 너무 길어 일부 환경에서 실패할 수 있습니다. 멤버/후원자 수를 줄여보세요.</div>
          )}
        </div>
      )}
      {!previewUrl ? (
        <div className="flex flex-col items-center justify-center py-16 px-4 rounded-xl border border-white/10 bg-neutral-900/50 text-center">
          <div className="text-sm text-neutral-400 mb-2">프리뷰 URL을 생성할 수 없습니다.</div>
          <div className="text-xs text-neutral-500">페이지를 새로고침하거나, 오버레이를 펼쳐 확인해 주세요.</div>
        </div>
      ) : (
      <div className="relative mx-auto rounded-xl overflow-hidden shrink-0"
           style={{
             width: "min(84vw, 1100px)",
             maxWidth: "100%",
             minHeight: 280,
             height: "auto",
             maxHeight: "82vh",
             aspectRatio: `${w} / ${h}`,
             border: "1px solid rgba(255,255,255,0.1)",
             background: "#0b0b0b",
             boxShadow: showFrame ? "0 6px 24px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 8px 24px rgba(255,255,255,0.04)" : "none",
           }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-neutral-900/90 z-[9999]">
            <div className="text-sm text-neutral-400">프리뷰 로딩 중...</div>
          </div>
        )}
        <iframe key={`${previewUrl}-${iframeKey}`} src={previewUrl} title="vertical-preview" className="absolute inset-0 w-full h-full" style={{ background: "transparent" }} scrolling="no" onLoad={onLoad} onError={onError} />
        {err && (
          <div className="absolute top-2 right-2 z-[10000] px-2 py-1 rounded bg-rose-700 text-white text-xs">
            {err}
          </div>
        )}
        {showGuides && (
          <>
            <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: "inset 0 0 0 1px rgba(0,255,170,0.35)" }} />
            <div className="absolute pointer-events-none" style={{ top: "5%", left: "5%", right: "5%", bottom: "5%", boxShadow: "inset 0 0 0 1px rgba(64,200,255,0.45)" }} />
            <div className="absolute pointer-events-none" style={{ top: "10%", left: "10%", right: "10%", bottom: "10%", boxShadow: "inset 0 0 0 1px rgba(255,200,0,0.5)" }} />
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute left-1/2 top-0 bottom-0" style={{ width: 1, background: "rgba(255,255,255,0.15)" }} />
              <div className="absolute top-1/2 left-0 right-0" style={{ height: 1, background: "rgba(255,255,255,0.15)" }} />
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}
