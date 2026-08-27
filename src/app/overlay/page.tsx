"use client";
import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { AppState, Member, Donor, MissionItem, roundToThousand, formatManThousand, formatDonorsAmount, loadStateFromApi, loadState, storageKey, defaultState, ensureMissionItems, ensureMembers, defaultMembers, normalizeDonationListsOverlayConfig, overlayPresetsStorageKey, hasMeaningfulMemberRoster, mergeDonorsForMultiTabSave, donorsListContentDiffers, mergeLocalMemberIdentityOntoRemote, normalizeDonorsArray, membersDifferByIds, isMemberRosterStrictSuperset, mergeRemoteTimerDisplayStyles, isIntentionalDonorListShrink, totalCombined } from "@/lib/state";
import { isServerAuthoritativeBroadcastState, readSessionBroadcastState } from "@/lib/server-authoritative-broadcast-state";
import {
  countableDonorTotal,
  repairMemberTotalsForDonorRoster,
  syncMemberTotalsFromDonors,
} from "@/lib/donation/apply-donation-state";
import { guardMemberTotalsAgainstAccidentalZeroWipe } from "@/lib/donation/zero-wipe-guard";
import { useAdminPreviewDonorsOverride } from "@/hooks/useAdminPreviewDonorsOverride";
import { mergeMemberRosterPreservingAmounts } from "@/lib/member-roster-merge";
import { mergeDonationApplyBase } from "@/lib/donation/merge-donation-apply-base";
import { maxOverlayAmountDisplayLength } from "@/lib/overlay-amount-display";
import {
  formatRestroomDisplay,
  isRestroomUnlimited,
  normalizeRestroomCount,
  RESTROOM_UNLIMITED,
} from "@/lib/restroom-utils";
import {
  resolveGoalFontSizePx,
  resolveGoalTextColor,
  resolveGoalTextOutlineColor,
  resolveGoalTextOutlineWidthPx,
  resolveGoalBarBgColor,
  resolveGoalBarFillColorParam,
  resolveGoalFontFamilyCss,
  resolveGoalBarAnimationMode,
  resolveGoalBarGifUrl,
  resolveGoalBarGifOpacity,
  resolveGoalBarGifBrightness,
  resolveTableFrameUrl,
  resolveTableFrameEnabled,
  resolveTableFrameOpacity,
  resolveTableFrameInsetPx,
  resolveOverlayTextSharpRender,
  shouldDefaultSharpRenderOnBroadcastHost,
  resolveGoalFontWeight,
  resolveTableTextColor,
  resolveTotalTextColor,
  resolveTableBgColor,
  resolveTableHeaderBgColor,
  resolveTableHeaderTextColor,
  resolveTableLineColor,
  resolveContributionColor,
  resolveTableRowEvenBg,
  resolveTableRowOddBg,
  resolveTablePanelBorderColor,
  resolveTableVerticalLines,
  resolveTableGridLines,
  resolveTableTextOutlineColor,
  resolveTableTextOutlineWidthPx,
  resolveTableHeaderTextOutlineColor,
  resolveTableHeaderTextOutlineWidthPx,
  resolveTableFontWeight,
  resolveTableFontFamilyId,
  resolveLivePresetStyleParam,
  presetToParams,
  isOverlayBroadcastHost,
  isAdminDashboardPreviewEmbed,
  isEmbeddedInSameOriginAdminFrame,
  isExternalOverlayBroadcastHost,
  isOverlayServerAuthoritativeUrl,
  shouldSuppressOverlaySseConnection,
  resolveScopedOverlayUserId,
  mergeOverlayPresetsForOverlayView,
  resolveTimerOverlayStyle,
  applyHiddenTimerStyleFromState,
  timerOverlayStyleHasCustomColors,
  applyTimerBackgroundOpacity,
  getTimerPillPaddingPx,
  isTimerBackgroundHidden,
  isTimerBorderVisuallyHidden,
  isHiddenTimerDisplayStyle,
  TIMER_PILL_BORDER_PX,
  type OverlayPresetLike,
  type ResolvedTimerOverlayStyle,
} from "@/lib/overlay-params";
import { resolveTableFontFamilyCss } from "@/lib/table-font-style";
import {
  ensureTimerGoogleFontsLoaded,
  resolveTimerFontFamilyCss,
} from "@/lib/timer-font-style";
import { getEffectiveRemainingTime, mergeGeneralTimerPreferEffective } from "@/lib/timer-utils";
import { useFlip } from "@/lib/flip";
import MissionBoard from "@/components/MissionBoard";
import MissionBoardSlot from "@/components/MissionBoardSlot";
import OverlayToonationRelayHost from "@/components/OverlayToonationRelayHost";
import { GoalBar } from "@/components/GoalBar";
import { FlipCountdownTimer } from "@/components/FlipCountdownTimer";
import { LedMatrixTimer } from "@/components/LedMatrixTimer";
import { CircularImageTimer } from "@/components/CircularImageTimer";
import {
  isImageFrameTimerDesign,
  normalizeTimerDesign,
  resolveCircularImageTimerFontSize,
  formatTimerClockText,
} from "@/lib/timer-design";
import BattleTeamColumnBoard from "@/components/battle/BattleTeamColumnBoard";
import { isDefaultContributionFormula } from "@/lib/contribution-formula";
import { mealBattleUsesRawDonationScore } from "@/lib/meal-battle-donation";
import { isOperatingSettlementMember } from "@/lib/settlement-utils";
import {
  buildBroadcastTextOutlineShadowCss,
  buildBroadcastTextOutlineStyle,
  DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR,
} from "@/lib/text-outline-style";
import { useSSEConnection } from "@/lib/sse-client";
import { useGoalPresetAutoEscalate } from "@/hooks/useGoalPresetAutoEscalate";
import { resolveAnimatedSourceForEmbed } from "@/lib/gif-url";
import {
  createStateUpdatedScheduler,
  DEFAULT_ADMIN_PREVIEW_POLL_MS,
  DONOR_STATE_UPDATED_DEBOUNCE_MS,
  DONOR_STATE_UPDATED_MAX_WAIT_MS,
  readDonationListsOverlayPollMs,
  readOverlayLiveSyncPollMs,
} from "@/lib/overlay-pull-policy";
import { startStaggeredOverlayPoll } from "@/lib/overlay-poll-stagger";
import { buildOverlaySyncSignature, isRicherDonationSnapshot, isNewerIntentionalDonationShrink, shouldRejectPoorerDonationRemote, shouldKeepStaleOverlayOverRemote, isEmptyDonationRemote, isIntentionalMemberRosterShrink, isServerAuthoritativeMemberRosterShrink, isLocalMemberRosterGrowOverRemote } from "@/lib/overlay-sync-signature";
import { readDonorRankingsRevision } from "@/lib/donor-rankings-rev";
import {
  overlayUserIdsMatch,
  readLocalBroadcastState,
  subscribeBroadcastStateLocalUpdated,
  subscribeOverlayPresetsLocalUpdated,
} from "@/lib/broadcast-state-local-sync";
import { buildOverlayRankedMembers, buildMemberCreationOrderIndex, compareMembersByDonationTotal, OVERLAY_HALF_SPLIT_MIN_COUNT } from "@/lib/utils";
import {
  isDonationTableBoolKey,
  mergeDonationTablePresetFields,
  resolveDonationTableColumnsOptions,
} from "@/lib/donation-table-options";
import {
  EXCEL_GOLD_RANK_TEXT_COLORS,
  isExcelGoldTableTheme,
  isExcelMemberTableTheme,
  resolveExcelMemberTableAccent,
  resolveTableThemeHeaderBgCss,
  resolveTableThemePanelBorderCss,
  resolveTableThemeTotalBorderCss,
  resolveTableThemeRowStripeCss,
  resolveTableThemeContributionColorCss,
} from "@/lib/excel-member-table-theme";
import {
  overlayTableCellGridCss,
  overlayTableGridLineWidthPx,
  overlayTableHairlineShadow,
  snapOverlayScaleForCrispLines,
} from "@/lib/overlay-table-crisp-lines";
import {
  EXCEL_RANK_TOP3_EFFECTS_CSS,
  isExcelRankTop3TextMode,
  resolveExcelRankTop3RowStyle,
  resolveExcelRankTop3Style,
} from "@/lib/excel-rank-top3-style";
import { clampWidthToViewport, computeReadableCanvasScale, ensureCanvasFontPx, isNarrowBroadcastViewport } from "@/lib/overlay-mobile-fit";
import { useOverlayViewportSize } from "@/hooks/useOverlayViewportSize";
import {
  loadOverlayLastGood,
  saveOverlayLastGood,
  shouldKeepLastGoodInsteadOf,
} from "@/lib/overlay-last-good";
import { STATE_PICK_OVERLAY_DONORS } from "@/lib/state-api-pick";

function tryDecodeSnapshot(str: string | null): AppState | null {
  if (!str) return null;
  try {
    const json = decodeURIComponent(atob(str));
    const obj = JSON.parse(json);
    if (obj && typeof obj === "object" && Array.isArray(obj.members)) {
      const now = Date.now();
      const merged = { ...defaultState(), ...obj, updatedAt: obj.updatedAt || now };
      const v = ensureMembers(merged.members);
      merged.members = v.length > 0 ? v : defaultMembers();
      merged.missions = ensureMissionItems(merged.missions);
      return merged;
    }
  } catch {}
  return null;
}

function tryReadSnapshotFromStorage(snapKey: string | null): AppState | null {
  if (!snapKey || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(snapKey);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object" && Array.isArray(obj.members)) {
      const now = Date.now();
      const merged = { ...defaultState(), ...obj, updatedAt: obj.updatedAt || now };
      const v = ensureMembers(merged.members);
      merged.members = v.length > 0 ? v : defaultMembers();
      merged.missions = ensureMissionItems(merged.missions);
      return merged;
    }
  } catch {}
  return null;
}

function migrateLegacyOverlayLastGood(userId?: string): AppState | null {
  if (typeof window === "undefined") return null;
  const legacyKey = `overlay-last-good-${userId || "default"}`;
  try {
    const raw = window.localStorage.getItem(legacyKey);
    if (!raw) return null;
    const obj = JSON.parse(raw) as AppState;
    if (obj && hasMeaningfulMemberRoster(obj)) {
      saveOverlayLastGood(obj, userId, STATE_PICK_OVERLAY_DONORS);
      window.localStorage.removeItem(legacyKey);
      return obj;
    }
  } catch {}
  return null;
}

function useRemoteState(userId?: string, enabled = true): { state: AppState | null; ready: boolean } {
  /** OBS/Prism·타이머 단독 URL — CEF LS·last-good 옛 설정으로 서버와 무관한 값이 나오지 않게 서버 우선 */
  const preferServerOnly =
    typeof window !== "undefined" && isOverlayServerAuthoritativeUrl();
  const preferServerOnlyRef = useRef(preferServerOnly);
  preferServerOnlyRef.current = preferServerOnly;

  const readInitialLastGood = (): AppState | null => {
    if (preferServerOnly) return null;
    return (
      loadOverlayLastGood(userId, STATE_PICK_OVERLAY_DONORS) ||
      migrateLegacyOverlayLastGood(userId)
    );
  };
  const [state, setState] = useState<AppState | null>(() => {
    if (typeof window === "undefined") return null;
    if (preferServerOnly) return null;
    try {
      const local = loadState(userId);
      if (local && hasMeaningfulMemberRoster(local)) {
        return local;
      }
      const lastGood = readInitialLastGood();
      if (lastGood && hasMeaningfulMemberRoster(lastGood)) {
        return lastGood;
      }
    } catch {}
    return null;
  });
  const lastUpdatedRef = useRef(
    state && hasMeaningfulMemberRoster(state) ? state.updatedAt || 0 : 0
  );
  const lastDonorRevRef = useRef(0);
  const lastVisualSigRef = useRef("");
  const overlaySinceRef = useRef(0);
  overlaySinceRef.current = Math.max(lastUpdatedRef.current, lastDonorRevRef.current);
  const syncingRef = useRef(false);
  const pendingForceSyncRef = useRef(false);
  const membersRosterSyncUntilRef = useRef(0);
  const syncOnceRef = useRef<
    (opts?: { forceFull?: boolean; membersRosterSync?: boolean }) => Promise<void>
  >(async () => {});
  const scheduleStateUpdatedRef = useRef<(() => void) | null>(null);
  const lastGoodRef = useRef<AppState | null>(
    preferServerOnly
      ? null
      : state && hasMeaningfulMemberRoster(state)
        ? state
        : readInitialLastGood()
  );
  const isViable = (s: AppState | null) => !!(s && hasMeaningfulMemberRoster(s));
  const loadLastGood = useCallback((): AppState | null => {
    if (preferServerOnlyRef.current) return null;
    const cached = loadOverlayLastGood(userId, STATE_PICK_OVERLAY_DONORS);
    if (cached && hasMeaningfulMemberRoster(cached)) return cached;
    return migrateLegacyOverlayLastGood(userId);
  }, [userId]);
  const saveLastGood = useCallback((s: AppState) => {
    if (!hasMeaningfulMemberRoster(s)) return;
    /** OBS CEF LS에 옛 금액을 쌓지 않음 — 세션 lastGoodRef 만 사용 */
    if (preferServerOnlyRef.current) return;
    saveOverlayLastGood(s, userId, STATE_PICK_OVERLAY_DONORS);
  }, [userId]);
  const restoreLastGood = useCallback(() => {
    /** OBS: LS 복원 금지, 이번 세션에 받은 서버 스냅샷만 복구 */
    const cached = preferServerOnlyRef.current
      ? lastGoodRef.current
      : lastGoodRef.current || loadLastGood();
    if (!cached || !hasMeaningfulMemberRoster(cached)) return;
    const nextSig = buildOverlaySyncSignature(cached);
    if (nextSig !== lastVisualSigRef.current) {
      lastVisualSigRef.current = nextSig;
      setState(cached);
    }
    lastGoodRef.current = cached;
  }, [loadLastGood]);
  const mergeKeepingStrongRoster = useCallback((incoming: AppState): AppState => {
    const good = lastGoodRef.current;
    let merged = incoming;
    const remoteRosterChanged =
      Boolean(good) &&
      Array.isArray(incoming.members) &&
      incoming.members.length > 0 &&
      membersDifferByIds(good!.members || [], incoming.members) &&
      Number(incoming.updatedAt || 0) >= Number(good!.updatedAt || 0);
    if (preferServerOnlyRef.current) {
      /**
       * OBS: 서버 이름·금액·로스터가 정본. last-good 옛 실명/옛 인원으로 덮지 않음.
       * 원격만 플레이스홀더/빈 로스터일 때만 세션 로스터 유지 —
       * 단, 멤버 추가·삭제·교체(id 집합 변경 + 최신 stamp)는 서버 로스터를 수용.
       */
      if (
        good &&
        hasMeaningfulMemberRoster(good) &&
        !hasMeaningfulMemberRoster(incoming) &&
        !remoteRosterChanged
      ) {
        merged = {
          ...incoming,
          members: good.members,
          memberPositions: good.memberPositions,
          memberPositionMode: good.memberPositionMode,
          rankPositionLabels: good.rankPositionLabels,
        };
      }
      /** else: incoming 그대로 — 개명·멤버 추가가 last-good에 막히지 않음 */
    } else if (
      good &&
      hasMeaningfulMemberRoster(good) &&
      !hasMeaningfulMemberRoster(incoming) &&
      !remoteRosterChanged
    ) {
      merged = {
        ...incoming,
        members: good.members,
        memberPositions: good.memberPositions,
        memberPositionMode: good.memberPositionMode,
        rankPositionLabels: good.rankPositionLabels,
      };
    } else if (good && hasMeaningfulMemberRoster(good) && !remoteRosterChanged) {
      /**
       * 미리보기: 서버가 더 최신 실명이면 서버 이름 유지.
       * (예전에는 localNewerOrEqual 만으로 last-good 옛 이름이 OBS/미리보기를 덮을 수 있었음)
       */
      const remoteNewer = Number(incoming.updatedAt || 0) > Number(good.updatedAt || 0);
      if (remoteNewer) {
        merged = incoming;
      } else {
        merged = mergeLocalMemberIdentityOntoRemote(incoming, good);
      }
    }
    const prevTimer = lastGoodRef.current?.generalTimer ?? merged.generalTimer;
    const prevMatchTimer =
      lastGoodRef.current?.matchTimer ??
      lastGoodRef.current?.generalTimer ??
      merged.matchTimer ??
      merged.generalTimer;
    merged = {
      ...merged,
      generalTimer: mergeGeneralTimerPreferEffective(prevTimer, merged.generalTimer),
      matchTimer: mergeGeneralTimerPreferEffective(
        prevMatchTimer,
        merged.matchTimer ?? merged.generalTimer
      ),
    };
    /** 타이머 제어 색·투명도 — 원격이 기본색·키 생략이면 last-good 커스텀 유지 (디자인은 서버) */
    const lastTimerStyles = good?.timerDisplayStyles;
    const incomingTimerStyles = merged.timerDisplayStyles;
    const hasIncomingTimerKey = Object.prototype.hasOwnProperty.call(merged, "timerDisplayStyles");
    const mergedTimerStyles = mergeRemoteTimerDisplayStyles({
      last: lastTimerStyles,
      incoming: incomingTimerStyles,
      hasIncomingKey: hasIncomingTimerKey,
    });
    if (mergedTimerStyles) {
      merged = { ...merged, timerDisplayStyles: mergedTimerStyles };
    }
    return merged;
  }, []);
  /** donors → members 재계산 + 로스터 불일치 보정(단체짠 split 후 엑셀 0 방지) */
  const applyOverlayDonationSync = useCallback(
    (incoming: AppState): AppState => {
      const good = lastGoodRef.current;
      const serverAuthoritative = preferServerOnlyRef.current;
      let merged = mergeKeepingStrongRoster(incoming);
      /**
       * wire donors 축소(구 300 cap 등) — last-good 과 union 후 재계산.
       * OBS(host=obs)는 서버가 정본: last-good union 하면 관리자/서버보다 금액이 높게 고착됨.
       */
      if (good?.donors?.length && !serverAuthoritative) {
        const incomingDonors = normalizeDonorsArray(merged.donors);
        const goodDonors = normalizeDonorsArray(good.donors);
        const intentionalShrink = isIntentionalDonorListShrink(
          incomingDonors,
          goodDonors,
          Number(merged.updatedAt || 0),
          Number(good.updatedAt || 0)
        );
        if (!intentionalShrink) {
          const incomingCountable = countableDonorTotal(incomingDonors);
          const goodCountable = countableDonorTotal(goodDonors);
          if (
            goodCountable > 0 &&
            (incomingDonors.length < goodDonors.length ||
              incomingCountable < goodCountable * 0.99)
          ) {
            merged = {
              ...merged,
              donors: mergeDonorsForMultiTabSave(incomingDonors, goodDonors, {
                incomingUpdatedAt: Number(merged.updatedAt || 0),
                existingUpdatedAt: Number(good.updatedAt || 0),
              }),
            };
          }
        }
      }
      const synced = syncMemberTotalsFromDonors(merged);
      /** OBS: donors→members 재계산 결과만 사용 (last-good 금액 재주입 금지) */
      if (serverAuthoritative && !isEmptyDonationRemote(synced)) {
        return synced;
      }
      /**
       * 멤버 추가·삭제(id 집합 변경) 직후는 옛 last-good 로스터로 되돌리지 않되,
       * 공통 멤버 금액이 0으로 오면 last-good 금액을 유지한다.
       */
      if (
        good &&
        Array.isArray(synced.members) &&
        membersDifferByIds(synced.members, good.members || []) &&
        Number(synced.updatedAt || 0) >= Number(good.updatedAt || 0)
      ) {
        if (isServerAuthoritativeMemberRosterShrink(good, synced)) {
          return guardMemberTotalsAgainstAccidentalZeroWipe(synced, good);
        }
        return guardMemberTotalsAgainstAccidentalZeroWipe(
          {
            ...synced,
            members: mergeMemberRosterPreservingAmounts(good.members || [], synced.members),
          },
          good
        );
      }
      return guardMemberTotalsAgainstAccidentalZeroWipe(
        repairMemberTotalsForDonorRoster(synced, lastGoodRef.current, merged),
        good ?? lastGoodRef.current
      );
    },
    [mergeKeepingStrongRoster]
  );
  const onSSE = useCallback((incoming: any) => {
    if (!incoming) return;
    if (incoming.type === "state_updated") {
      if (incoming.donationApplied) {
        void syncOnceRef.current({ forceFull: true });
        return;
      }
      const membersRosterAt = Number(incoming.membersRosterUpdatedAt);
      if (Number.isFinite(membersRosterAt) && membersRosterAt > 0) {
        membersRosterSyncUntilRef.current = Date.now() + 45_000;
        void syncOnceRef.current({ forceFull: true, membersRosterSync: true });
        return;
      }
      const timerStylesAt = Number(incoming.timerDisplayStylesUpdatedAt);
      if (Number.isFinite(timerStylesAt) && timerStylesAt > 0) {
        void syncOnceRef.current({ forceFull: true });
        return;
      }
      const generalTimerAt = Number(incoming.generalTimerUpdatedAt);
      if (Number.isFinite(generalTimerAt) && generalTimerAt > 0) {
        void syncOnceRef.current({ forceFull: true });
        return;
      }
      const dr = Number(incoming.donorRankingsUpdatedAt);
      if (Number.isFinite(dr) && dr > 0) {
        void syncOnceRef.current({ forceFull: true });
        return;
      }
      if (typeof incoming.updatedAt === "number") {
        scheduleStateUpdatedRef.current?.();
      }
      return;
    }
    if (shouldKeepLastGoodInsteadOf(incoming as AppState, STATE_PICK_OVERLAY_DONORS, lastGoodRef.current)) {
      restoreLastGood();
      return;
    }
    if (!Array.isArray((incoming as AppState).members)) return;
    const ts = (incoming as any).updatedAt || Date.now();
    const next = applyOverlayDonationSync(incoming as AppState);
    const nextSig = buildOverlaySyncSignature(next);
    if (nextSig === lastVisualSigRef.current) {
      lastUpdatedRef.current = Math.max(lastUpdatedRef.current, ts);
      return;
    }
    lastVisualSigRef.current = nextSig;
    lastUpdatedRef.current = ts;
    setState(next);
    if (isViable(next) && hasMeaningfulMemberRoster(next)) {
      lastGoodRef.current = next;
      saveLastGood(next);
    }
  }, [saveLastGood, applyOverlayDonationSync, restoreLastGood]);
  const _sse = useSSEConnection(onSSE);
  const readLocalStateIfExists = useCallback((): AppState | null => {
    if (typeof window === "undefined") return null;
    if (isServerAuthoritativeBroadcastState()) {
      return readSessionBroadcastState(userId) ?? loadState(userId ?? undefined);
    }
    try {
      const key = storageKey(userId);
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return loadState(userId ?? undefined);
    } catch {
      return null;
    }
  }, [userId]);
  useEffect(() => {
    if (!enabled) return;
    const preferServer = preferServerOnlyRef.current;
    const local = preferServer ? null : readLocalStateIfExists();
    const lastGood = preferServer ? null : loadLastGood();
    const hasStrongRosterRef = { current: false };
    const preferLocal =
      local && isViable(local)
        ? local
        : lastGood && isViable(lastGood)
          ? lastGood
          : null;
    if (preferLocal && !preferServer) {
      lastVisualSigRef.current = buildOverlaySyncSignature(preferLocal);
      setState(preferLocal);
      /** placeholder 로컬의 updatedAt 이 API since/비교를 막지 않게 함 */
      if (hasMeaningfulMemberRoster(preferLocal)) {
        hasStrongRosterRef.current = true;
        lastUpdatedRef.current = preferLocal.updatedAt || 0;
        lastDonorRevRef.current = readDonorRankingsRevision(preferLocal);
        lastGoodRef.current = preferLocal;
        saveLastGood(preferLocal);
      } else {
        lastUpdatedRef.current = 0;
        lastDonorRevRef.current = 0;
      }
    } else {
      lastUpdatedRef.current = 0;
      lastDonorRevRef.current = 0;
      lastGoodRef.current = null;
    }
    const syncOnce = async (opts?: { forceFull?: boolean; membersRosterSync?: boolean }) => {
      if (syncingRef.current) {
        if (opts?.forceFull) pendingForceSyncRef.current = true;
        return;
      }
      syncingRef.current = true;
      try {
        const localNow = preferServerOnlyRef.current ? null : readLocalStateIfExists();
        const localStrong = hasMeaningfulMemberRoster(localNow);
        const shownForCompare = lastGoodRef.current;
        if (
          !preferServerOnlyRef.current &&
          localNow &&
          localStrong &&
          localNow.updatedAt &&
          localNow.updatedAt > lastUpdatedRef.current &&
          !shouldKeepLastGoodInsteadOf(localNow, STATE_PICK_OVERLAY_DONORS, lastGoodRef.current) &&
          !(
            shownForCompare &&
            isRicherDonationSnapshot(shownForCompare, localNow) &&
            !isNewerIntentionalDonationShrink(localNow, shownForCompare)
          )
        ) {
          const mergedLocal = applyOverlayDonationSync(localNow);
          const nextSig = buildOverlaySyncSignature(mergedLocal);
          lastUpdatedRef.current = mergedLocal.updatedAt || localNow.updatedAt;
          hasStrongRosterRef.current = true;
          if (nextSig !== lastVisualSigRef.current) {
            lastVisualSigRef.current = nextSig;
            setState(mergedLocal);
          }
          if (isViable(mergedLocal)) {
            lastGoodRef.current = mergedLocal;
            saveLastGood(mergedLocal);
          }
        }
        /** 관리자 iframe 미리보기 — LS donors 기준으로 엑셀 금액을 매 sync 마다 재계산 */
        if (
          !opts?.forceFull &&
          !preferServerOnlyRef.current &&
          (isAdminDashboardPreviewEmbed() || isEmbeddedInSameOriginAdminFrame())
        ) {
          const peek = readLocalStateIfExists();
          if (peek && (peek.updatedAt || 0) > 0 && hasMeaningfulMemberRoster(peek)) {
            const syncedPeek = applyOverlayDonationSync(peek);
            const peekSig = buildOverlaySyncSignature(syncedPeek);
            lastUpdatedRef.current = Math.max(
              lastUpdatedRef.current,
              syncedPeek.updatedAt || peek.updatedAt || 0
            );
            lastDonorRevRef.current = Math.max(
              lastDonorRevRef.current,
              readDonorRankingsRevision(syncedPeek)
            );
            if (peekSig !== lastVisualSigRef.current) {
              lastVisualSigRef.current = peekSig;
            }
            setState(syncedPeek);
            if (isViable(syncedPeek)) {
              lastGoodRef.current = syncedPeek;
              saveLastGood(syncedPeek);
            }
            return;
          }
        }
        const needRosterHydration = !hasStrongRosterRef.current;
        /**
         * OBS(preferServerOnly)도 매 tick forceFull 금지 — since/304로 본문·서버 부하를 줄인다.
         * 최초 로스터 미확보·명시 forceFull(SSE/visibility)만 전체 수신.
         */
        const forceFull = Boolean(opts?.forceFull) || needRosterHydration;
        const data = await loadStateFromApi(userId, {
          pick: "overlay-donors",
          ifUpdatedSince: forceFull ? 0 : overlaySinceRef.current,
          forceFull,
        });
        /** 304·일시 실패: 이미 동기화된 화면을 restoreLastGood 으로 깜빡이지 않음 */
        if (!data) {
          if (overlaySinceRef.current > 0 || lastGoodRef.current) return;
          restoreLastGood();
          return;
        }
        const remoteRosterRev = Number(data?.membersRosterUpdatedAt || 0);
        const lastRosterRev = Number(lastGoodRef.current?.membersRosterUpdatedAt || 0);
        if (remoteRosterRev > 0 && remoteRosterRev > lastRosterRev) {
          membersRosterSyncUntilRef.current = Date.now() + 45_000;
        }
        const remoteRev = Math.max(data?.updatedAt || 0, readDonorRankingsRevision(data || ({} as AppState)));
        const remoteStrong = hasMeaningfulMemberRoster(data);
        let remoteForApply = data;
        if (data && lastGoodRef.current && !preferServerOnlyRef.current) {
          const localReset = Number(lastGoodRef.current.settlementResetAt || 0);
          const remoteReset = Number(data.settlementResetAt || 0);
          if (remoteReset <= localReset) {
            const localDonors = Array.isArray(lastGoodRef.current.donors) ? lastGoodRef.current.donors : [];
            const remoteDonors = Array.isArray(data.donors) ? data.donors : [];
            const localIds = new Set(localDonors.map((d) => String(d.id || "")).filter(Boolean));
            const remoteIds = new Set(remoteDonors.map((d) => String(d.id || "")).filter(Boolean));
            const hasLocalOnly = localDonors.some((d) => {
              const id = String(d.id || "");
              return Boolean(id) && !remoteIds.has(id);
            });
            const hasRemoteOnly = remoteDonors.some((d) => {
              const id = String(d.id || "");
              return Boolean(id) && !localIds.has(id);
            });
            if (hasLocalOnly && hasRemoteOnly) {
              remoteForApply = mergeDonationApplyBase(data, lastGoodRef.current) ?? data;
            } else if (
              !hasLocalOnly &&
              !hasRemoteOnly &&
              localDonors.length > 0 &&
              donorsListContentDiffers(localDonors, remoteDonors)
            ) {
              remoteForApply = {
                ...data,
                donors: mergeDonorsForMultiTabSave(remoteDonors, localDonors, {
                  incomingUpdatedAt: Number(data.updatedAt || 0),
                  existingUpdatedAt: Number(lastGoodRef.current.updatedAt || 0),
                }),
              };
            }
          }
        }
        const remoteRicher = Boolean(
          remoteForApply && isRicherDonationSnapshot(remoteForApply, lastGoodRef.current)
        );
        /** 서버에 멤버가 늘어난 경우(추가) — last-good 로스터로 막지 않되, 금액이 빈약하면 last-good 금액을 합침 */
        const trustMemberRosterSync =
          Boolean(opts?.membersRosterSync) || Date.now() < membersRosterSyncUntilRef.current;
        let localRosterGrowPending =
          Boolean(remoteForApply) &&
          Boolean(lastGoodRef.current) &&
          isLocalMemberRosterGrowOverRemote(lastGoodRef.current, remoteForApply!);
        let rosterGrowMerged = false;
        /** 추가 SSE 직후 stale GET — last-good/LS 상위집합을 remote에 병합 */
        if (trustMemberRosterSync && localRosterGrowPending && remoteForApply && lastGoodRef.current) {
          remoteForApply = {
            ...remoteForApply,
            members: mergeMemberRosterPreservingAmounts(
              remoteForApply.members || [],
              lastGoodRef.current.members
            ),
            memberPositions:
              lastGoodRef.current.memberPositions ?? remoteForApply.memberPositions,
            rankPositionLabels:
              lastGoodRef.current.rankPositionLabels ?? remoteForApply.rankPositionLabels,
            updatedAt: Math.max(
              Number(lastGoodRef.current.updatedAt || 0),
              Number(remoteForApply.updatedAt || 0)
            ),
          };
          rosterGrowMerged = true;
          localRosterGrowPending = false;
        }
        const remoteAddedMembers =
          Boolean(remoteForApply) &&
          Boolean(lastGoodRef.current) &&
          isMemberRosterStrictSuperset(
            remoteForApply!.members,
            lastGoodRef.current!.members
          );
        /**
         * 멤버 추가 직후: 서버 GET이 옛(짧은) 로스터면 last-good/LS 상위집합을 유지.
         * 멤버 삭제 SSE 직후에는 짧은 서버 로스터를 localHint 로 되돌리지 않음.
         */
        const remoteRosterShrinkEarly =
          Boolean(remoteForApply) &&
          Boolean(lastGoodRef.current) &&
          isServerAuthoritativeMemberRosterShrink(lastGoodRef.current, remoteForApply!);
        if (
          remoteForApply &&
          preferServerOnlyRef.current &&
          !remoteRosterShrinkEarly
        ) {
          const localHint =
            lastGoodRef.current &&
            isMemberRosterStrictSuperset(
              lastGoodRef.current.members,
              remoteForApply.members || []
            )
              ? lastGoodRef.current
              : readLocalStateIfExists();
          if (
            localHint &&
            isMemberRosterStrictSuperset(localHint.members, remoteForApply.members || [])
          ) {
            const localAt = Number(localHint.updatedAt || 0);
            const ageMs = Date.now() - localAt;
            if (localAt > 0 && ageMs >= 0 && ageMs < 120_000) {
              remoteForApply = {
                ...remoteForApply,
                members: mergeMemberRosterPreservingAmounts(
                  remoteForApply.members || [],
                  localHint.members
                ),
                memberPositions: localHint.memberPositions ?? remoteForApply.memberPositions,
                rankPositionLabels:
                  localHint.rankPositionLabels ?? remoteForApply.rankPositionLabels,
                updatedAt: Math.max(localAt, Number(remoteForApply.updatedAt || 0)),
              };
            }
          }
        }
        if (
          remoteAddedMembers &&
          remoteForApply &&
          lastGoodRef.current &&
          isRicherDonationSnapshot(lastGoodRef.current, remoteForApply)
        ) {
          const goodDonors = normalizeDonorsArray(lastGoodRef.current.donors);
          const remoteDonors = normalizeDonorsArray(remoteForApply.donors);
          remoteForApply = {
            ...remoteForApply,
            members: mergeMemberRosterPreservingAmounts(
              lastGoodRef.current.members,
              remoteForApply.members
            ),
            donors: remoteDonors.length > 0 ? remoteDonors : goodDonors,
          };
        }
        /**
         * OBS: 서버에 후원·금액이 있으면 last-good 옛 값을 버리지 않고 서버를 따름.
         * 멤버 삭제 SSE(membersRosterSync) 직후에는 의도적 짧은 로스터만 poorer 로 막지 않음.
         */
        const remoteRosterShrink =
          Boolean(remoteForApply) &&
          Boolean(lastGoodRef.current) &&
          isServerAuthoritativeMemberRosterShrink(lastGoodRef.current, remoteForApply!);
        const rejectPoorer =
          !remoteRosterShrink &&
          !remoteAddedMembers &&
          !(trustMemberRosterSync && localRosterGrowPending) &&
          !(trustMemberRosterSync && remoteRosterShrink) &&
          (preferServerOnlyRef.current
            ? shouldKeepStaleOverlayOverRemote(lastGoodRef.current, remoteForApply)
            : shouldRejectPoorerDonationRemote(lastGoodRef.current, remoteForApply));
        const shouldApplyRemote =
          !!remoteForApply &&
          !shouldKeepLastGoodInsteadOf(remoteForApply, STATE_PICK_OVERLAY_DONORS, lastGoodRef.current) &&
          !rejectPoorer &&
          (Boolean(opts?.forceFull) ||
            preferServerOnlyRef.current ||
            remoteAddedMembers ||
            remoteRosterShrink ||
            rosterGrowMerged ||
            remoteRev > overlaySinceRef.current ||
            remoteRicher ||
            (needRosterHydration && remoteStrong) ||
            (preferServerOnlyRef.current && !isEmptyDonationRemote(remoteForApply)));
        if (shouldApplyRemote && remoteForApply) {
          /** donors 는 있는데 members 합계가 비면 엑셀만 0 — 순위와 맞추기 */
          const toApply = applyOverlayDonationSync(remoteForApply);
          const appliedStrong = hasMeaningfulMemberRoster(toApply);
          const hasDonationData =
            normalizeDonorsArray(toApply.donors).length > 0 ||
            (toApply.members || []).some(
              (m) => Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)) > 0
            );
          const nextSig = buildOverlaySyncSignature(toApply);
          lastUpdatedRef.current = toApply.updatedAt || 0;
          lastDonorRevRef.current = readDonorRankingsRevision(toApply);
          if (appliedStrong || (preferServerOnlyRef.current && hasDonationData)) {
            hasStrongRosterRef.current = true;
          }
          if (nextSig !== lastVisualSigRef.current) {
            lastVisualSigRef.current = nextSig;
            setState(toApply);
          }
          if (isViable(toApply) && appliedStrong) {
            lastGoodRef.current = toApply;
            saveLastGood(toApply);
          } else if (preferServerOnlyRef.current && hasDonationData) {
            /** placeholder 로스터여도 OBS 세션 last-good으로 서버 스냅샷 유지 */
            lastGoodRef.current = toApply;
          }
        } else if (!localNow && !data) {
          restoreLastGood();
        }
      } catch {
        const localNow = preferServerOnlyRef.current ? null : readLocalStateIfExists();
        if (!localNow || !hasMeaningfulMemberRoster(localNow)) {
          restoreLastGood();
        }
      } finally {
        syncingRef.current = false;
        if (pendingForceSyncRef.current) {
          pendingForceSyncRef.current = false;
          void syncOnce({ forceFull: true });
        }
      }
    };
    const { schedule, cancel: cancelStateUpdatedSchedule } = createStateUpdatedScheduler(
      () => {
        void syncOnceRef.current();
      },
      { debounceMs: DONOR_STATE_UPDATED_DEBOUNCE_MS, maxWaitMs: DONOR_STATE_UPDATED_MAX_WAIT_MS }
    );
    scheduleStateUpdatedRef.current = schedule;
    syncOnceRef.current = syncOnce;
    const applyLocalMemberRosterIfNewer = (localNow: AppState | null): "grew" | "shrunk" | false => {
      if (!localNow || !Array.isArray(localNow.members) || localNow.members.length === 0) {
        return false;
      }
      if (shouldKeepLastGoodInsteadOf(localNow, STATE_PICK_OVERLAY_DONORS, lastGoodRef.current)) {
        return false;
      }
      const good = lastGoodRef.current;
      const localStamp = Math.max(
        Number(localNow.membersRosterUpdatedAt || 0),
        Number(localNow.updatedAt || 0)
      );
      const goodStamp = Math.max(
        Number(good?.membersRosterUpdatedAt || 0),
        Number(good?.updatedAt || 0)
      );
      const rosterGrew =
        !good ||
        (isMemberRosterStrictSuperset(localNow.members, good.members || []) &&
          localStamp >= goodStamp);
      const rosterShrunk =
        Boolean(good) &&
        hasMeaningfulMemberRoster(localNow) &&
        isMemberRosterStrictSuperset(good!.members || [], localNow.members) &&
        membersDifferByIds(good!.members || [], localNow.members) &&
        localStamp >= goodStamp;
      if (!rosterGrew && !rosterShrunk) return false;
      if (!hasMeaningfulMemberRoster(localNow)) return false;
      /**
       * 추가: last-good 금액 유지하며 로스터 확장.
       * 삭제: localNow id 집합을 따르고 남은 멤버 금액만 last-good 에서 보강.
       */
      const withRoster =
        good && membersDifferByIds(good.members || [], localNow.members)
          ? {
              ...localNow,
              members: mergeMemberRosterPreservingAmounts(good.members || [], localNow.members),
              donors:
                normalizeDonorsArray(localNow.donors).length > 0
                  ? localNow.donors
                  : good.donors,
              memberPositions: localNow.memberPositions ?? good.memberPositions,
              rankPositionLabels: localNow.rankPositionLabels ?? good.rankPositionLabels,
            }
          : localNow;
      const syncedLocal = applyOverlayDonationSync(withRoster);
      const nextSig = buildOverlaySyncSignature(syncedLocal);
      lastUpdatedRef.current = Math.max(
        lastUpdatedRef.current,
        Number(syncedLocal.updatedAt || localNow.updatedAt || 0)
      );
      if (nextSig !== lastVisualSigRef.current) {
        lastVisualSigRef.current = nextSig;
        setState(syncedLocal);
      }
      if (isViable(syncedLocal)) {
        lastGoodRef.current = syncedLocal;
        saveLastGood(syncedLocal);
      }
      return rosterShrunk ? "shrunk" : "grew";
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      const localNow = readLocalStateIfExists();
      const rosterApply = applyLocalMemberRosterIfNewer(localNow);
      if (rosterApply === "grew") {
        void syncOnceRef.current({ forceFull: true, membersRosterSync: true });
        return;
      }
      if (rosterApply === "shrunk") {
        return;
      }
      if (preferServerOnlyRef.current) {
        void syncOnceRef.current({ forceFull: true });
        return;
      }
      if (
        localNow &&
        hasMeaningfulMemberRoster(localNow) &&
        localNow.updatedAt &&
        localNow.updatedAt > lastUpdatedRef.current &&
        !shouldKeepLastGoodInsteadOf(localNow, STATE_PICK_OVERLAY_DONORS, lastGoodRef.current)
      ) {
        const syncedLocal = applyOverlayDonationSync(localNow);
        const nextSig = buildOverlaySyncSignature(syncedLocal);
        lastUpdatedRef.current = syncedLocal.updatedAt || localNow.updatedAt;
        if (nextSig !== lastVisualSigRef.current) {
          lastVisualSigRef.current = nextSig;
          setState(syncedLocal);
        }
        if (isViable(syncedLocal)) {
          lastGoodRef.current = syncedLocal;
          saveLastGood(syncedLocal);
        }
      } else {
        void syncOnceRef.current();
      }
    };
    const adminPreview =
      isAdminDashboardPreviewEmbed() || isEmbeddedInSameOriginAdminFrame();
    const liveSyncPoll =
      shouldSuppressOverlaySseConnection() ||
      isExternalOverlayBroadcastHost() ||
      isOverlayServerAuthoritativeUrl();
    const pollMs = adminPreview
      ? DEFAULT_ADMIN_PREVIEW_POLL_MS
      : liveSyncPoll
        ? readOverlayLiveSyncPollMs()
        : readDonationListsOverlayPollMs();
    let stopPoll: (() => void) | undefined;
    if (pollMs > 0) {
      stopPoll = startStaggeredOverlayPoll(
        () => void syncOnceRef.current(),
        pollMs,
        `overlay-excel:${userId || "default"}`
      );
    }
    window.addEventListener("storage", onStorage);
    const unsubscribeLocal = subscribeBroadcastStateLocalUpdated((detail) => {
      if (!overlayUserIdsMatch(userId, detail.userId)) return;
      const localNow = readLocalBroadcastState(userId) || readLocalStateIfExists();
      /** 멤버 추가·삭제: richer 가드·preferServerOnly 보다 먼저 로스터 반영 */
      const rosterApply = applyLocalMemberRosterIfNewer(localNow);
      if (rosterApply === "grew") {
        void syncOnceRef.current({ forceFull: true, membersRosterSync: true });
        return;
      }
      if (rosterApply === "shrunk") {
        return;
      }
      if (preferServerOnlyRef.current) {
        void syncOnceRef.current({ forceFull: true });
        return;
      }
      if (!localNow || shouldKeepLastGoodInsteadOf(localNow, STATE_PICK_OVERLAY_DONORS, lastGoodRef.current)) return;
      if (!hasMeaningfulMemberRoster(localNow)) {
        void syncOnceRef.current();
        return;
      }
      /**
       * 구 LS가 이미 맞은 투네·계좌를 덮지 않음 — 서버 force sync로 보정.
       * 단, 수동 삭제처럼 더 최신 LS 가 의도적으로 줄어든 경우 forceFull(빈/구 서버)로
       * 엑셀표를 0 초기화하지 않고 로컬 삭제를 그대로 적용한다.
       */
      if (lastGoodRef.current && isRicherDonationSnapshot(lastGoodRef.current, localNow)) {
        if (isNewerIntentionalDonationShrink(localNow, lastGoodRef.current)) {
          const mergedLocal = applyOverlayDonationSync(localNow);
          const nextSig = buildOverlaySyncSignature(mergedLocal);
          lastUpdatedRef.current = Math.max(lastUpdatedRef.current, mergedLocal.updatedAt || 0);
          lastDonorRevRef.current = Math.max(
            lastDonorRevRef.current,
            readDonorRankingsRevision(mergedLocal)
          );
          if (nextSig !== lastVisualSigRef.current) {
            lastVisualSigRef.current = nextSig;
            setState(mergedLocal);
          }
          if (isViable(mergedLocal)) {
            lastGoodRef.current = mergedLocal;
            saveLastGood(mergedLocal);
          }
          return;
        }
        void syncOnceRef.current({ forceFull: true });
        return;
      }
      const syncedLocal = applyOverlayDonationSync(localNow);
      const nextSig = buildOverlaySyncSignature(syncedLocal);
      lastUpdatedRef.current = Math.max(lastUpdatedRef.current, syncedLocal.updatedAt || 0);
      lastDonorRevRef.current = Math.max(
        lastDonorRevRef.current,
        readDonorRankingsRevision(syncedLocal)
      );
      if (nextSig !== lastVisualSigRef.current) {
        lastVisualSigRef.current = nextSig;
        setState(syncedLocal);
      }
      if (isViable(syncedLocal)) {
        lastGoodRef.current = syncedLocal;
        saveLastGood(syncedLocal);
      }
    });
    void syncOnce();
    return () => {
      cancelStateUpdatedSchedule();
      scheduleStateUpdatedRef.current = null;
      stopPoll?.();
      window.removeEventListener("storage", onStorage);
      unsubscribeLocal();
    };
  }, [enabled, userId, loadLastGood, readLocalStateIfExists, saveLastGood, mergeKeepingStrongRoster, restoreLastGood]);

  return { state, ready: state !== null };
}

function useCountUp(value: number, durationMs = 600) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;
    prevValueRef.current = to;
    if (durationMs <= 0 || Math.abs(to - from) < 1) {
      setDisplay(to);
      return;
    }
    startRef.current = performance.now();
    const loop = (t: number) => {
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) rafRef.current = requestAnimationFrame(loop);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      setDisplay(to);
    };
  }, [value, durationMs]);

  return display;
}

function OverlayTableNumCell({
  value,
  format,
  animate,
  className,
  style,
}: {
  value: number;
  format: (n: number) => string;
  animate: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const safe = Math.max(0, Math.round(Number(value) || 0));
  const display = useCountUp(safe, animate ? 600 : 0);
  return (
    <span className={className} style={style}>
      {format(animate ? display : safe)}
    </span>
  );
}

function useElapsed(startTs: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startTs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startTs]);
  if (!startTs) return null;
  const diff = Math.max(0, Math.floor((now - startTs) / 1000));
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const sec = diff % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function useServerTimer(timer: AppState["generalTimer"] | null): { text: string | null; paused: boolean; remainingSeconds: number | null } {
  const timerRef = useRef(timer);
  timerRef.current = timer;
  const lastStableRef = useRef<{ remaining: number; paused: boolean } | null>(null);
  const holdUntilRef = useRef(0);
  const [remaining, setRemaining] = useState<number>(() => {
    const initial = timer ? getEffectiveRemainingTime(timer) : 0;
    if (timer && (initial > 0 || !timer.isActive)) {
      lastStableRef.current = { remaining: initial, paused: !timer.isActive };
    }
    return initial;
  });
  const timerKey = timer
    ? `${timer.remainingTime}:${timer.isActive}:${timer.lastUpdated}`
    : "none";

  useEffect(() => {
    if (!timer) return;
    holdUntilRef.current = 0;
    const tick = () => {
      const current = timerRef.current;
      if (!current) return;
      const eff = getEffectiveRemainingTime(current);
      if (eff > 0 || !current.isActive) {
        lastStableRef.current = { remaining: eff, paused: !current.isActive };
        holdUntilRef.current = 0;
        setRemaining(eff);
      } else if (lastStableRef.current && lastStableRef.current.remaining > 0 && current.isActive) {
        /** 동기화 직후 일시적 0 — 최대 1.5초만 직전 표시 유지 (1초 영구 고정 방지) */
        if (!holdUntilRef.current) holdUntilRef.current = Date.now() + 1500;
        if (Date.now() < holdUntilRef.current) {
          setRemaining(lastStableRef.current.remaining);
        } else {
          lastStableRef.current = { remaining: 0, paused: false };
          setRemaining(0);
        }
      } else {
        setRemaining(eff);
      }
    };
    tick();
    if (!timer.isActive) return;
    const id = window.setInterval(tick, 250);
    return () => clearInterval(id);
  }, [timerKey]);

  if (!timer) {
    const held = lastStableRef.current;
    if (!held) return { text: null, paused: false, remainingSeconds: null };
    const safe = Math.max(0, held.remaining);
    const h = Math.floor(safe / 3600);
    const m = Math.floor((safe % 3600) / 60);
    const sec = safe % 60;
    return {
      text: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`,
      paused: held.paused,
      remainingSeconds: safe,
    };
  }
  const safe = Math.max(0, remaining);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const sec = safe % 60;
  return {
    text: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`,
    paused: !timer.isActive,
    remainingSeconds: safe,
  };
}

function formatTimerText(elapsed: string | null, remainingSeconds?: number | null, showHours = false): string | null {
  if (remainingSeconds != null && Number.isFinite(remainingSeconds)) {
    return formatTimerClockText(remainingSeconds, showHours);
  }
  if (!elapsed) return null;
  const parts = elapsed.split(":").map((x) => parseInt(x, 10));
  if (parts.some((x) => Number.isNaN(x))) return elapsed;
  const h = parts.length === 3 ? parts[0] : 0;
  const m = parts.length >= 2 ? parts[parts.length - 2] : 0;
  const sec = parts[parts.length - 1] ?? 0;
  const totalSec = h * 3600 + m * 60 + sec;
  return formatTimerClockText(totalSec, showHours);
}

type ThemeId = "default" | "excel" | "excelLive" | "excelBlue" | "excelSlate" | "excelAmber" | "excelGold" | "excelRose" | "excelNavy" | "excelTeal" | "excelPurple" | "excelEmerald" | "excelOrange" | "excelIndigo" | "neon" | "retro" | "minimal" | "rpg" | "pastel" | "neonExcel" | "rainbow" | "sunset" | "ocean" | "forest" | "aurora" | "violet" | "coral" | "mint" | "lava" | "ice";

const TABLE_BG_RGB: Record<string, [number, number, number]> = {
  default: [15, 20, 30],
  excel: [15, 20, 30],
  excelLive: [15, 20, 30],
  excelBlue: [15, 20, 30],
  excelAmber: [15, 20, 30],
  excelGold: [8, 8, 12],
  excelRose: [15, 20, 30],
  excelTeal: [15, 20, 30],
  excelPurple: [15, 20, 30],
  excelEmerald: [15, 20, 30],
  excelOrange: [15, 20, 30],
  excelIndigo: [15, 20, 30],
  excelSlate: [15, 20, 30],
  excelNavy: [15, 20, 30],
  pastel: [15, 20, 30],
  neonExcel: [15, 20, 30],
};
const defaultTableBgRgb: [number, number, number] = [15, 20, 30];

function resolveTableSheetRgb(
  theme: ThemeId,
  overrideHex?: string
): [number, number, number] {
  if (overrideHex) {
    const parsed = parseHexRgb(overrideHex);
    if (parsed) return parsed;
  }
  return TABLE_BG_RGB[theme] ?? defaultTableBgRgb;
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const norm = hex.trim();
  if (!/^#[0-9a-fA-F]{3,8}$/.test(norm)) return null;
  if (norm.length === 4) {
    return [
      parseInt(norm[1] + norm[1], 16),
      parseInt(norm[2] + norm[2], 16),
      parseInt(norm[3] + norm[3], 16),
    ];
  }
  if (norm.length >= 7) {
    return [
      parseInt(norm.slice(1, 3), 16),
      parseInt(norm.slice(3, 5), 16),
      parseInt(norm.slice(5, 7), 16),
    ];
  }
  return null;
}

function clampCssAlpha(alpha: number): number {
  return Math.max(0, Math.min(1, alpha));
}

/** rgba/rgb/hex → rgba(..., alpha). 표 불투명도와 행·헤더 배경을 일치시킬 때 사용 */
function applyAlphaToCssColor(input: string, alpha: number): string {
  const a = clampCssAlpha(alpha);
  const trimmed = String(input || "").trim();
  const rgbaMatch = trimmed.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/i
  );
  if (rgbaMatch) {
    return a >= 1
      ? `rgb(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]})`
      : `rgba(${rgbaMatch[1]}, ${rgbaMatch[2]}, ${rgbaMatch[3]}, ${a})`;
  }
  const hex = trimmed.startsWith("#") ? trimmed : trimmed ? `#${trimmed}` : "";
  const hexRgb = hex ? parseHexRgb(hex) : null;
  if (hexRgb) {
    return a >= 1 ? `rgb(${hexRgb.join(", ")})` : `rgba(${hexRgb.join(", ")}, ${a})`;
  }
  return trimmed;
}

function isLightTextHex(hex: string): boolean {
  const rgb = parseHexRgb(hex);
  if (!rgb) return true;
  return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 >= 140;
}

/** 밝은 배경(흰 시트) 위 진한 글자용 — 흰색 기본 강제 대신 테마/시트에 맞춤 */
const TABLE_TEXT_OUTLINE_LIGHT_ON_DARK =
  "-1px -1px 0 rgba(6, 12, 24, 0.95), 1px -1px 0 rgba(6, 12, 24, 0.95), -1px 1px 0 rgba(6, 12, 24, 0.95), 1px 1px 0 rgba(6, 12, 24, 0.95), 0 2px 6px rgba(0,0,0,0.42)";
const TABLE_TEXT_OUTLINE_DARK_ON_LIGHT =
  "0 1px 2px rgba(255,255,255,0.92), 0 0 1px rgba(15,23,42,0.42), 0 1px 3px rgba(0,0,0,0.16)";
const TABLE_NUMERIC_OUTLINE_LIGHT_ON_DARK =
  "-1px -1px 0 rgba(6, 12, 24, 0.92), 1px -1px 0 rgba(6, 12, 24, 0.92), -1px 1px 0 rgba(6, 12, 24, 0.92), 1px 1px 0 rgba(6, 12, 24, 0.92), 0 0 3px rgba(6, 12, 24, 0.55), 0 2px 6px rgba(0, 0, 0, 0.45)";
const TABLE_NUMERIC_OUTLINE_DARK_ON_LIGHT =
  "0 1px 2px rgba(255,255,255,0.88), 0 0 1px rgba(15,23,42,0.38), 0 1px 3px rgba(0,0,0,0.14)";
/** Studio Glass — 방송 표 크롬 (다크 글래스 + violet/blue 액센트) */
const TABLE_BROADCAST_PANEL_BORDER = "rgba(255, 255, 255, 0.12)";
const TABLE_BROADCAST_PANEL_BG = "rgba(15, 20, 30, 0.70)";
/** 테마 자동(본문·헤더) — OBS 기본 흰색(+어두운 외곽선). 검은 글자는 본문 글자색에서 지정 */
const TABLE_BROADCAST_TEXT_AUTO = "#ffffff";
const TABLE_BROADCAST_PANEL_SHADOW = "0 8px 32px 0 rgba(0, 0, 0, 0.37)";
/** 엑셀 계열 본문(이름·금액) — OBS 기본은 흰색 */
const EXCEL_BODY_TEXT_DEFAULT = "#ffffff";
const EXCEL_BODY_TEXT_ON_LIGHT = EXCEL_BODY_TEXT_DEFAULT;
const EXCEL_BODY_TEXT_ON_DARK = EXCEL_BODY_TEXT_DEFAULT;
const EXCEL_LIGHT_NAME_CLS = "text-white font-semibold";
const EXCEL_LIGHT_ACCOUNT_CLS =
  "text-white font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden";
const EXCEL_LIGHT_TOON_CLS =
  "text-white/90 font-semibold whitespace-nowrap font-mono tabular-nums overflow-hidden";
const EXCEL_DARK_NAME_CLS = "text-white font-semibold";
const EXCEL_DARK_ACCOUNT_CLS =
  "text-white font-bold whitespace-nowrap font-mono tabular-nums overflow-hidden";
const EXCEL_DARK_TOON_CLS =
  "text-white/90 font-semibold whitespace-nowrap font-mono tabular-nums overflow-hidden";

const THEMES: Record<ThemeId, {
  label: string;
  memberCls: string;
  nameCls: string;
  accountCls: string;
  toonCls: string;
  totalCls: string;
  totalWrapCls: string;
  rowCls: string;
  tableCls: string;
  headerCls: string;
  goalBarBg: string;
  goalBarFill: string;
  goalText: string;
  goalWrap: string;
  tickerCls: string;
  timerCls: string;
}> = {
  default: {
    label: "스튜디오 글래스",
    memberCls: "font-bold tracking-tight",
    nameCls: "text-white font-semibold studio-text-shadow",
    accountCls: "text-white font-bold studio-text-shadow",
    toonCls: "text-white/90 font-semibold studio-text-shadow",
    totalCls: "font-extrabold text-white studio-text-shadow",
    totalWrapCls: "bg-[rgba(15,20,30,0.7)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio shadow-glass",
    rowCls: "px-2 py-1 bg-white/[0.04] hover:bg-white/[0.08] transition-colors",
    tableCls: "bg-[rgba(15,20,30,0.55)] border border-white/12 rounded-studio overflow-hidden border-collapse backdrop-blur-studio shadow-glass",
    headerCls: "bg-gradient-to-r from-studio-violet/80 to-studio-blue/80 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-white/10",
    goalBarFill: "bg-gradient-to-r from-studio-violet to-studio-blue",
    goalText: "text-white font-bold studio-text-shadow",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] rounded-studio p-1 backdrop-blur-studio shadow-glass",
    tickerCls: "text-white font-semibold studio-text-shadow",
    timerCls: "font-mono text-white/90 studio-text-shadow",
  },
  excel: {
    label: "엑셀(녹색)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white studio-text-shadow",
    totalWrapCls: "bg-[rgba(33,115,70,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "px-2 py-1 align-middle bg-white/[0.03]",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(33,115,70,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-white/10",
    goalBarFill: "bg-[#217346]",
    goalText: "text-white font-mono font-bold studio-text-shadow",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-studio-mint font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelLive: {
    label: "방송 엑셀(청록·줄무늬)",
    memberCls: "font-mono font-semibold",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white studio-text-shadow",
    totalWrapCls: "bg-[rgba(26,82,118,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "px-2 py-1 align-middle bg-white/[0.03]",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(26,82,118,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-white/10",
    goalBarFill: "bg-[#1a5276]",
    goalText: "text-white font-mono font-bold studio-text-shadow",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-sky-300 font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelBlue: {
    label: "엑셀(파랑)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(37,99,235,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "px-2 py-1 align-middle bg-white/[0.03]",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(37,99,235,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-white/10",
    goalBarFill: "bg-[#2563eb]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-[#2563eb] font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelSlate: {
    label: "엑셀(슬레이트)",
    memberCls: "font-mono",
    nameCls: EXCEL_DARK_NAME_CLS,
    accountCls: EXCEL_DARK_ACCOUNT_CLS,
    toonCls: EXCEL_DARK_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(51,65,85,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "px-2 py-1 align-middle bg-white/[0.03]",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(51,65,85,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-700",
    goalBarFill: "bg-slate-500",
    goalText: "text-slate-200 font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-slate-300 font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelAmber: {
    label: "엑셀(앰버)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(217,119,6,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "border border-amber-200 px-2 py-1 align-middle bg-amber-50",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(217,119,6,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-amber-200",
    goalBarFill: "bg-[#d97706]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-[#d97706] font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelGold: {
    label: "엑셀(웹후원 골드)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[#ffc107] border border-[#ffc107] px-2 py-1",
    rowCls: "px-2 py-1 align-middle",
    tableCls: "bg-transparent border-collapse overflow-visible",
    headerCls: "bg-[#ffc107] text-[#1a1408] font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-amber-900/40",
    goalBarFill: "bg-[#ffc107]",
    goalText: "text-[#ffc107] font-mono font-bold",
    goalWrap: "border border-[#ffc107]/50 bg-transparent p-1 rounded-studio",
    tickerCls: "text-[#ffc107] font-mono font-bold",
    timerCls: "font-mono text-white bg-black/80 px-2 rounded-lg border border-[#ffc107]",
  },
  excelRose: {
    label: "엑셀(로즈)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(225,29,72,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "border border-rose-200 px-2 py-1 align-middle bg-rose-50",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(225,29,72,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-rose-200",
    goalBarFill: "bg-[#e11d48]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-[#e11d48] font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelNavy: {
    label: "엑셀(네이비)",
    memberCls: "font-mono",
    nameCls: EXCEL_DARK_NAME_CLS,
    accountCls: EXCEL_DARK_ACCOUNT_CLS,
    toonCls: EXCEL_DARK_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(30,58,138,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "px-2 py-1 align-middle bg-white/[0.03]",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(30,58,138,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-600",
    goalBarFill: "bg-[#1e40af]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-sky-300 font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelTeal: {
    label: "엑셀(틸)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(13,148,136,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "border border-teal-200 px-2 py-1 align-middle bg-teal-50",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(13,148,136,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-teal-200",
    goalBarFill: "bg-[#0d9488]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-[#0d9488] font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelPurple: {
    label: "엑셀(퍼플)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(124,58,237,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "border border-purple-200 px-2 py-1 align-middle bg-purple-50",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(124,58,237,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-purple-200",
    goalBarFill: "bg-[#7c3aed]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-[#7c3aed] font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelEmerald: {
    label: "엑셀(에메랄드)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(5,150,105,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "border border-emerald-200 px-2 py-1 align-middle bg-emerald-50",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(5,150,105,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-emerald-200",
    goalBarFill: "bg-[#059669]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-[#059669] font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelOrange: {
    label: "엑셀(오렌지)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(234,88,12,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "border border-orange-200 px-2 py-1 align-middle bg-orange-50",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(234,88,12,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-orange-200",
    goalBarFill: "bg-[#ea580c]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-[#ea580c] font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  excelIndigo: {
    label: "엑셀(인디고)",
    memberCls: "font-mono",
    nameCls: EXCEL_LIGHT_NAME_CLS,
    accountCls: EXCEL_LIGHT_ACCOUNT_CLS,
    toonCls: EXCEL_LIGHT_TOON_CLS,
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-[rgba(79,70,229,0.72)] border border-white/12 px-2 py-1 rounded-studio backdrop-blur-studio",
    rowCls: "border border-indigo-200 px-2 py-1 align-middle bg-indigo-50",
    tableCls: "bg-[rgba(15,20,30,0.55)] border-collapse backdrop-blur-studio shadow-glass rounded-studio overflow-hidden",
    headerCls: "bg-[rgba(79,70,229,0.72)] text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-indigo-200",
    goalBarFill: "bg-[#4f46e5]",
    goalText: "text-white font-mono font-bold",
    goalWrap: "border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 rounded-studio backdrop-blur-studio",
    tickerCls: "text-[#4f46e5] font-mono font-bold",
    timerCls: "font-mono text-white/80 bg-white/10 px-2 rounded-studio",
  },
  neon: {
    label: "네온",
    memberCls: "font-black tracking-wide",
    nameCls: "text-cyan-300 studio-text-shadow",
    accountCls: "text-fuchsia-400 studio-text-shadow tabular-nums overflow-hidden",
    toonCls: "text-yellow-300 studio-text-shadow tabular-nums overflow-hidden",
    totalCls: "font-black text-lime-300 studio-text-shadow",
    totalWrapCls: "bg-neutral-900/90 border border-cyan-500/50 px-2 py-1 rounded",
    rowCls: "border-b border-cyan-500/30 px-2 py-1 bg-black/40",
    tableCls: "bg-black/60 border border-cyan-500/50 rounded-lg overflow-hidden border-collapse shadow-lg",
    headerCls: "bg-gradient-to-r from-cyan-600/80 to-fuchsia-600/80 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-neutral-900/80 border border-cyan-500/40",
    goalBarFill: "bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-lime-400 shadow-glass",
    goalText: "text-white font-black studio-text-shadow",
    goalWrap: "border border-cyan-500/40 bg-black/60 rounded p-1",
    tickerCls: "text-cyan-300 font-bold studio-text-shadow",
    timerCls: "font-mono text-fuchsia-300 studio-text-shadow",
  },
  retro: {
    label: "레트로",
    memberCls: "font-mono font-bold",
    nameCls: "text-amber-100",
    accountCls: "text-green-400",
    toonCls: "text-green-600",
    totalCls: "font-mono font-bold text-green-300",
    totalWrapCls: "border-2 border-green-500/60 bg-black/70 px-4 py-2 rounded",
    rowCls: "border-b border-green-500/40 px-2 py-1 bg-black/50",
    tableCls: "bg-black/70 border-2 border-green-500/60 rounded overflow-hidden border-collapse shadow-lg",
    headerCls: "bg-green-800/90 text-amber-100 font-bold px-2 py-1 border-b border-green-500 text-sm",
    goalBarBg: "bg-black/80 border border-green-500/50",
    goalBarFill: "bg-green-500",
    goalText: "text-green-300 font-mono font-bold",
    goalWrap: "border border-green-500/50 bg-black/70",
    tickerCls: "text-green-400 font-mono",
    timerCls: "font-mono text-green-300/80",
  },
  minimal: {
    label: "미니멀",
    memberCls: "font-light tracking-widest",
    nameCls: "text-white/90",
    accountCls: "text-white/70",
    toonCls: "text-white/40",
    totalCls: "font-thin text-white/80 tracking-[0.2em]",
    totalWrapCls: "bg-white/5 border border-white/10 px-2 py-1",
    rowCls: "border-b border-white/5 px-2 py-1",
    tableCls: "bg-black/30 border border-white/10 rounded overflow-hidden border-collapse",
    headerCls: "bg-white/10 text-white/80 font-light px-2 py-1 text-sm tracking-wider",
    goalBarBg: "bg-white/10",
    goalBarFill: "bg-white/50",
    goalText: "text-white/70 font-light tracking-wider",
    goalWrap: "border border-white/10 bg-black/30 rounded p-1",
    tickerCls: "text-white/60 font-light",
    timerCls: "font-mono text-white/40 font-light",
  },
  rpg: {
    label: "RPG",
    memberCls: "font-bold",
    nameCls: "text-yellow-200 studio-text-shadow",
    accountCls: "text-red-400",
    toonCls: "text-sky-400",
    totalCls: "font-extrabold text-yellow-300",
    totalWrapCls: "bg-gradient-to-r from-amber-900/80 via-amber-800/80 to-amber-900/80 border-2 border-yellow-600/70 px-4 py-2 rounded-lg shadow-glass",
    rowCls: "bg-slate-900/70 border-b border-slate-600/50 px-3 py-1",
    tableCls: "bg-slate-900/90 border-2 border-yellow-600/60 rounded-lg overflow-hidden border-collapse shadow-lg",
    headerCls: "bg-gradient-to-r from-amber-800 to-yellow-700 text-yellow-200 font-bold px-3 py-1 border-b border-yellow-600/70 text-sm",
    goalBarBg: "bg-slate-900/80 border-2 border-yellow-700/60 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-red-600 via-orange-500 to-yellow-400 rounded-lg shadow-glass",
    goalText: "text-yellow-200 font-extrabold studio-text-shadow",
    goalWrap: "bg-slate-900/70 border border-yellow-700/50 rounded-lg p-1",
    tickerCls: "text-yellow-300 font-bold",
    timerCls: "font-mono text-sky-300",
  },
  pastel: {
    label: "파스텔",
    memberCls: "font-semibold studio-text-shadow",
    nameCls: "text-white font-semibold studio-text-shadow",
    accountCls: "text-white font-medium tabular-nums studio-text-shadow",
    toonCls: "text-white/85 tabular-nums studio-text-shadow",
    totalCls: "font-bold text-white studio-text-shadow",
    totalWrapCls: "rounded-studio border border-white/12 bg-[rgba(15,20,30,0.7)] px-3 py-1 backdrop-blur-studio shadow-glass",
    rowCls: "px-2 py-1 align-middle bg-white/[0.03]",
    tableCls: "overflow-hidden rounded-studio border border-white/12 border-collapse bg-[rgba(15,20,30,0.55)] shadow-glass backdrop-blur-studio",
    headerCls: "bg-gradient-to-r from-studio-violet/70 to-studio-blue/70 px-2 py-1 text-sm font-bold text-white studio-text-shadow",
    goalBarBg: "rounded-full border border-white/12 bg-white/10 backdrop-blur-studio",
    goalBarFill: "rounded-full bg-gradient-to-r from-studio-violet to-studio-blue",
    goalText: "font-semibold text-white studio-text-shadow",
    goalWrap: "rounded-studio border border-white/12 bg-[rgba(15,20,30,0.55)] p-1 backdrop-blur-studio shadow-glass",
    tickerCls: "font-semibold text-white studio-text-shadow",
    timerCls: "font-mono text-white/90 studio-text-shadow",
  },
  neonExcel: {
    label: "네온 엑셀",
    memberCls: "font-mono font-bold",
    nameCls: "text-white",
    accountCls: "text-center text-slate-400 font-mono whitespace-nowrap",
    toonCls: "text-right text-slate-400 font-mono whitespace-nowrap",
    totalCls: "font-mono font-black text-cyan-300 tabular-nums whitespace-nowrap",
    totalWrapCls: "bg-[rgba(15,20,30,0.7)] px-1 py-1 border-t border-studio-blue/50 rounded-studio",
    rowCls: "bg-slate-900/40 py-1.5 px-1 border-b border-slate-800 last:border-none",
    tableCls: "border border-white/12 bg-[rgba(15,20,30,0.55)] rounded-studio overflow-hidden backdrop-blur-studio shadow-glass",
    headerCls: "bg-cyan-900/30 text-cyan-300 font-mono py-1 px-1 border-b border-cyan-500/50 uppercase",
    goalBarBg: "bg-black/60 border border-cyan-500/30 rounded",
    goalBarFill: "bg-gradient-to-r from-cyan-500 to-fuchsia-500 shadow-glass",
    goalText: "text-cyan-300 font-mono font-bold",
    goalWrap: "border border-cyan-500/30 bg-black/40 rounded p-1",
    tickerCls: "text-cyan-300 font-mono font-bold",
    timerCls: "font-mono text-cyan-400 studio-text-shadow",
  },
  rainbow: {
    label: "무지개",
    memberCls: "font-bold",
    nameCls: "text-white studio-text-shadow",
    accountCls: "text-amber-200 tabular-nums",
    toonCls: "text-cyan-200 tabular-nums",
    totalCls: "font-black text-white studio-text-shadow",
    totalWrapCls: "bg-gradient-to-r from-red-500 via-orange-500 via-yellow-500 via-green-500 via-blue-500 to-purple-500 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-white/20 px-2 py-1 bg-black/50",
    tableCls: "bg-black/70 border-2 border-white/30 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-red-600 via-orange-500 via-yellow-500 via-green-500 via-blue-600 to-purple-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-black/60 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-red-500 via-orange-400 via-yellow-400 via-green-400 via-blue-500 to-purple-500 rounded-lg shadow-glass",
    goalText: "text-white font-bold studio-text-shadow",
    goalWrap: "border border-white/20 bg-black/60 rounded-lg p-1",
    tickerCls: "text-amber-200 font-bold",
    timerCls: "font-mono text-cyan-300",
  },
  sunset: {
    label: "일몰",
    memberCls: "font-semibold",
    nameCls: "text-orange-100",
    accountCls: "text-amber-200 tabular-nums",
    toonCls: "text-rose-300 tabular-nums",
    totalCls: "font-bold text-yellow-100",
    totalWrapCls: "bg-gradient-to-r from-orange-600 via-rose-500 to-purple-600 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-orange-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-orange-950/80 border border-orange-500/40 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-orange-600 to-rose-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-orange-500 via-rose-500 to-purple-500 rounded-lg shadow-glass",
    goalText: "text-orange-100 font-bold",
    goalWrap: "border border-orange-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-amber-200 font-semibold",
    timerCls: "font-mono text-rose-300",
  },
  ocean: {
    label: "오션",
    memberCls: "font-semibold",
    nameCls: "text-cyan-100",
    accountCls: "text-sky-300 tabular-nums",
    toonCls: "text-teal-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-cyan-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-cyan-950/60 border border-cyan-500/50 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-cyan-400 via-blue-400 to-indigo-500 rounded-lg shadow-glass",
    goalText: "text-cyan-100 font-bold",
    goalWrap: "border border-cyan-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-cyan-300 font-semibold",
    timerCls: "font-mono text-sky-300",
  },
  forest: {
    label: "포레스트",
    memberCls: "font-semibold",
    nameCls: "text-emerald-100",
    accountCls: "text-lime-300 tabular-nums",
    toonCls: "text-green-400 tabular-nums",
    totalCls: "font-bold text-lime-100",
    totalWrapCls: "bg-gradient-to-r from-emerald-600 via-green-500 to-teal-600 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-emerald-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-emerald-950/60 border border-emerald-500/50 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-emerald-500 via-green-400 to-teal-500 rounded-lg shadow-glass",
    goalText: "text-emerald-100 font-bold",
    goalWrap: "border border-emerald-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-lime-300 font-semibold",
    timerCls: "font-mono text-emerald-300",
  },
  aurora: {
    label: "오로라",
    memberCls: "font-semibold",
    nameCls: "text-purple-100",
    accountCls: "text-fuchsia-300 tabular-nums",
    toonCls: "text-cyan-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-purple-500 via-fuchsia-500 via-cyan-500 to-emerald-500 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-purple-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 via-purple-950/50 to-cyan-950/40 border border-purple-500/50 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-purple-600 via-fuchsia-500 to-cyan-500 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-purple-400 via-fuchsia-400 via-cyan-400 to-emerald-400 rounded-lg shadow-glass",
    goalText: "text-purple-100 font-bold",
    goalWrap: "border border-purple-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-fuchsia-300 font-semibold",
    timerCls: "font-mono text-cyan-300",
  },
  violet: {
    label: "바이올렛",
    memberCls: "font-semibold",
    nameCls: "text-violet-100",
    accountCls: "text-purple-300 tabular-nums",
    toonCls: "text-fuchsia-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-violet-600 via-purple-500 to-fuchsia-600 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-violet-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-violet-950/70 border border-violet-500/50 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-violet-500 via-purple-400 to-fuchsia-500 rounded-lg shadow-glass",
    goalText: "text-violet-100 font-bold",
    goalWrap: "border border-violet-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-purple-300 font-semibold",
    timerCls: "font-mono text-fuchsia-300",
  },
  coral: {
    label: "코랄",
    memberCls: "font-semibold",
    nameCls: "text-rose-100",
    accountCls: "text-orange-300 tabular-nums",
    toonCls: "text-pink-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-rose-500 via-orange-400 to-amber-500 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-rose-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-rose-950/60 border border-rose-500/50 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-rose-600 to-amber-500 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-rose-500 via-orange-400 to-amber-400 rounded-lg shadow-glass",
    goalText: "text-rose-100 font-bold",
    goalWrap: "border border-rose-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-orange-300 font-semibold",
    timerCls: "font-mono text-pink-300",
  },
  mint: {
    label: "민트",
    memberCls: "font-semibold",
    nameCls: "text-teal-100",
    accountCls: "text-emerald-300 tabular-nums",
    toonCls: "text-cyan-300 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-500 px-4 py-2 rounded-lg shadow-lg",
    rowCls: "border-b border-teal-500/30 px-2 py-1 bg-slate-900/70",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-teal-950/60 border border-teal-500/50 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-teal-600 to-cyan-500 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400 rounded-lg shadow-glass",
    goalText: "text-teal-100 font-bold",
    goalWrap: "border border-teal-500/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-emerald-300 font-semibold",
    timerCls: "font-mono text-cyan-300",
  },
  lava: {
    label: "라바",
    memberCls: "font-bold",
    nameCls: "text-red-100",
    accountCls: "text-orange-300 tabular-nums",
    toonCls: "text-yellow-300 tabular-nums",
    totalCls: "font-black text-yellow-100",
    totalWrapCls: "bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 px-4 py-2 rounded-lg shadow-glass",
    rowCls: "border-b border-red-500/40 px-2 py-1 bg-slate-900/80",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-red-950/70 border-2 border-red-500/60 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-red-600 via-orange-500 to-yellow-500 text-white font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-red-500 via-orange-400 to-yellow-400 rounded-lg shadow-glass",
    goalText: "text-red-100 font-bold",
    goalWrap: "border border-red-500/50 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-orange-300 font-bold",
    timerCls: "font-mono text-yellow-300",
  },
  ice: {
    label: "아이스",
    memberCls: "font-semibold",
    nameCls: "text-sky-100",
    accountCls: "text-cyan-200 tabular-nums",
    toonCls: "text-blue-200 tabular-nums",
    totalCls: "font-bold text-white",
    totalWrapCls: "bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-400 px-4 py-2 rounded-lg shadow-glass",
    rowCls: "border-b border-cyan-400/30 px-2 py-1 bg-slate-900/80",
    tableCls: "bg-gradient-to-b from-slate-900/95 to-cyan-950/50 border border-cyan-400/50 rounded-xl overflow-hidden border-collapse shadow-glass",
    headerCls: "bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 text-slate-900 font-bold px-2 py-1 text-sm",
    goalBarBg: "bg-slate-800/80 rounded-lg",
    goalBarFill: "bg-gradient-to-r from-cyan-300 via-sky-300 to-blue-400 rounded-lg shadow-glass",
    goalText: "text-sky-100 font-bold",
    goalWrap: "border border-cyan-400/40 bg-slate-900/80 rounded-lg p-1",
    tickerCls: "text-cyan-200 font-semibold",
    timerCls: "font-mono text-sky-300",
  },
};

function PersonalGoalBoard({
  items,
  themeId,
  fontSize,
}: {
  items: Array<{ id: string; name: string; current: number; goal: number; pct: number }>;
  themeId: "goalClassic" | "goalNeon";
  fontSize: number;
}) {
  const palette = themeId === "goalNeon"
    ? ["#7C4DFF", "#FFD54F", "#FF4D8D", "#63E6BE", "#4FC3F7", "#FFB74D"]
    : ["#8C7DFF", "#F7D44A", "#E45C8B", "#6FC1FF", "#7ED39E", "#FDBA74"];
  const cardClass = themeId === "goalNeon"
    ? "bg-slate-900/85 border border-cyan-300/40 shadow-glass"
    : "bg-slate-800/90 border border-white/20";
  const dimTextClass = themeId === "goalNeon" ? "text-cyan-100/80" : "text-white/75";
  const currentTextClass = themeId === "goalNeon" ? "text-white" : "text-white";
  const barBgClass = themeId === "goalNeon" ? "bg-slate-700/80" : "bg-slate-600/60";
  const num = (n: number) => Math.max(0, Math.round(n)).toLocaleString("ko-KR");

  return (
    <div className="min-w-[300px] max-w-[440px]">
      {items.length === 0 && (
        <div className={`rounded ${cardClass} p-2 ${dimTextClass}`} style={{ fontSize: Math.max(10, Math.round(fontSize * 0.72)) }}>
          목표(원) 입력된 멤버가 없습니다.
        </div>
      )}
      <div className="space-y-3">
        {items.map((it, idx) => {
          const accent = palette[idx % palette.length];
          const remain = Math.max(0, it.goal - it.current);
          const barH = Math.max(16, Math.round(fontSize * 0.55));
          return (
          <div key={it.id} className={`overlay-goal-card rounded-xl ${cardClass}`} style={{ padding: "0.75rem 1rem" }}>
            <div className="flex items-center justify-between gap-3 flex-wrap" style={{ paddingBottom: "0.5rem" }}>
              <span
                className="px-3 py-1 rounded-md border font-bold tracking-wide text-white shrink-0"
                style={{ borderColor: accent, fontSize: Math.max(14, Math.round(fontSize * 0.72)), minWidth: 90 }}
              >
                {it.name}
              </span>
              <span className={dimTextClass} style={{ fontSize: Math.max(12, Math.round(fontSize * 0.66)) }}>
                남은 금액: {num(remain)}
              </span>
              <span className={dimTextClass} style={{ fontSize: Math.max(12, Math.round(fontSize * 0.66)) }}>
                {Math.round(it.pct)}%
              </span>
            </div>
            <div className="flex items-center justify-end gap-2" style={{ paddingBottom: "0.5rem" }}>
              <span className={currentTextClass} style={{ color: accent, fontWeight: 800, fontSize: Math.max(14, Math.round(fontSize * 0.72)) }}>
                {num(it.current)}원
              </span>
              <span className={dimTextClass} style={{ fontSize: Math.max(12, Math.round(fontSize * 0.66)) }}>
                / {num(it.goal)}
              </span>
            </div>
            <div className={`overlay-goal-bar ${barBgClass} overflow-hidden`} style={{ height: barH, borderRadius: 999 }}>
              <div style={{ width: `${it.pct}%`, height: "100%", background: accent, borderRadius: 999 }} />
            </div>
          </div>
        )})}
      </div>
    </div>
  );
}

function DonorTicker({ donors, theme, fontSize, color, bgColor, bgOpacity, full, duration, gap, limit, unit, locale, placeholderText, previewGuide, tickerTheme, tickerGlow, tickerShadow }: { donors: Donor[]; theme: typeof THEMES.default; fontSize: number; color?: string; bgColor?: string; bgOpacity?: number; full?: boolean; duration?: number; gap?: number; limit?: number; unit?: string; locale?: string; placeholderText?: string; previewGuide?: boolean; tickerTheme?: string; tickerGlow?: number; tickerShadow?: number }) {
  const recent = useMemo(() => {
    const lim = Math.max(1, limit || 5);
    const sorted = donors.slice().sort((a, b) => b.at - a.at);
    const byName = new Map<string, { name: string; at: number; account: number; toon: number }>();
    for (const d of sorted) {
      if ((d.target || "account") === "toon") continue;
      const key = (d.name || "무명").trim() || "무명";
      const prev = byName.get(key);
      if (!prev) {
        byName.set(key, {
          name: key,
          at: d.at || 0,
          account: (d.amount || 0),
          toon: 0,
        });
        continue;
      }
      byName.set(key, {
        name: key,
        at: Math.max(prev.at, d.at || 0),
        account: prev.account + (d.amount || 0),
        toon: prev.toon,
      });
    }
    return Array.from(byName.values())
      .sort((a, b) => b.at - a.at)
      .slice(0, lim);
  }, [donors, limit]);
  const stream = useMemo(() => {
    if (!recent.length) return [];
    const minItems = Math.max(24, (limit || 5) * 10);
    const out: { name: string; at: number; account: number; toon: number }[] = [];
    while (out.length < minItems) out.push(...recent);
    return out.slice(0, minItems);
  }, [recent, limit]);

  const runtimeTickerCfg = typeof window !== "undefined" ? (window as any).__overlayTickerConfig : null;
  const shouldShowGuide = typeof previewGuide === "boolean"
    ? previewGuide
    : (runtimeTickerCfg && typeof runtimeTickerCfg.previewGuide === "boolean")
      ? runtimeTickerCfg.previewGuide
      : (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("previewGuide") === "true" : false);
  const tickerThemeValue = tickerTheme || (runtimeTickerCfg?.tickerTheme || (typeof window !== "undefined"
    ? (new URLSearchParams(window.location.search).get("tickerTheme") || "auto")
    : "auto"));
  const tickerGlowValue = typeof tickerGlow === "number"
    ? Math.max(0, Math.min(100, tickerGlow))
    : (typeof runtimeTickerCfg?.tickerGlow === "number")
      ? Math.max(0, Math.min(100, runtimeTickerCfg.tickerGlow))
      : (typeof window !== "undefined" ? Math.max(0, Math.min(100, parseInt(new URLSearchParams(window.location.search).get("tickerGlow") || "45", 10))) : 45);
  const tickerShadowValue = typeof tickerShadow === "number"
    ? Math.max(0, Math.min(100, tickerShadow))
    : (typeof runtimeTickerCfg?.tickerShadow === "number")
      ? Math.max(0, Math.min(100, runtimeTickerCfg.tickerShadow))
      : (typeof window !== "undefined" ? Math.max(0, Math.min(100, parseInt(new URLSearchParams(window.location.search).get("tickerShadow") || "35", 10))) : 35);
  const baseTickerThemeStyle: React.CSSProperties =
    tickerThemeValue === "neon"
      ? { color: "#8cf4ff", fontWeight: 700 }
      : tickerThemeValue === "warm"
      ? { color: "#ffd28a", fontWeight: 700 }
      : tickerThemeValue === "ice"
      ? { color: "#c5e9ff", fontWeight: 700 }
      : tickerThemeValue === "mono"
      ? { color: "#e5e7eb", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", fontWeight: 700 }
      : tickerThemeValue === "accent"
      ? { color: "#fcd34d", fontWeight: 700 }
      : {};
  const colorWithAlpha = (hex: string, alpha: number): string => {
    const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return hex;
    const raw = m[1];
    const normalized = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
  };
  const normalizeColorWithAlpha = (input: string, alpha: number): string => {
    const trimmed = input.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("#")) return colorWithAlpha(trimmed, alpha);
    const rgb = trimmed.match(/^rgb\(\s*([^\)]*)\s*\)$/i);
    if (rgb) {
      return `rgba(${rgb[1]}, ${Math.max(0, Math.min(1, alpha))})`;
    }
    const rgba = trimmed.match(/^rgba\(\s*([^\)]*)\s*\)$/i);
    if (rgba) {
      const parts = rgba[1].split(",").map((p) => p.trim());
      if (parts.length >= 3) {
        return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${Math.max(0, Math.min(1, alpha))})`;
      }
    }
    return trimmed;
  };
  const glowColor = (color || (typeof baseTickerThemeStyle.color === "string" ? baseTickerThemeStyle.color : "")) as string;
  const glowBlur = Math.round((tickerGlowValue / 100) * 16);
  const shadowBlur = Math.round((tickerShadowValue / 100) * 8);
  const shadowAlpha = (tickerShadowValue / 100) * 0.72;
  const glowAlpha = (tickerGlowValue / 100) * 0.65;
  const shadowParts: string[] = [];
  if (shadowBlur > 0) shadowParts.push(`0 1px ${shadowBlur}px rgba(0, 0, 0, ${shadowAlpha.toFixed(2)})`);
  if (glowBlur > 0 && glowColor) {
    shadowParts.push(`0 0 ${glowBlur}px ${colorWithAlpha(glowColor, glowAlpha)}`);
  }
  const tickerThemeStyle: React.CSSProperties = {
    ...baseTickerThemeStyle,
    ...(shadowParts.length ? { textShadow: shadowParts.join(", ") } : {}),
  };
  const backgroundOpacity = Math.max(0, Math.min(100, bgOpacity ?? 0)) / 100;
  const tickerBackground =
    bgColor && backgroundOpacity > 0 ? normalizeColorWithAlpha(bgColor, backgroundOpacity) : "";
  const tickerContainerStyle: React.CSSProperties = {
    fontSize,
    width: "100%",
    ...(tickerBackground
      ? {
          background: tickerBackground,
          borderRadius: 8,
          padding: "0.12em 0.3em",
        }
      : {}),
  };
  const amountText = (d: { account: number; toon: number }) => {
    const f = (n: number) => {
      const base = full
        ? formatDonorsAmount(n, "full", locale || "ko-KR")
        : formatManThousand(n);
      return unit ? `${base} ${unit}` : base;
    };
    const accountPart = d.account > 0 ? f(d.account) : "";
    const toonPart = d.toon > 0 ? `(${f(d.toon)})` : "";
    if (accountPart && toonPart) return `${accountPart} ${toonPart}`;
    return accountPart || toonPart || "0";
  };
  if (!recent.length) {
    if (!shouldShowGuide) return null;
    return (
      <div className="overflow-hidden whitespace-nowrap" style={tickerContainerStyle}>
        <div className={theme.tickerCls} style={{ ...tickerThemeStyle, ...(color ? { color } : {}) }}>
          {placeholderText || "후원티커는 이곳에 출력됩니다."}
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden whitespace-nowrap" style={tickerContainerStyle}>
      <div
        className="inline-block"
        style={{
          ...tickerThemeStyle,
          ...(color ? { color } : {}),
          animation: `ticker ${Math.max(10, duration || 60)}s linear infinite`,
        }}
      >
        {stream.map((d, i) => (
          <span
            key={`${d.name}-${d.at}-${i}`}
            className={theme.tickerCls}
            style={{ marginLeft: gap ?? 10, marginRight: gap ?? 10, ...(color ? { color } : {}) }}
          >
            ♥ {d.name} {amountText(d)}
          </span>
        ))}
        {stream.map((d, i) => (
          <span
            key={`dup-${d.name}-${d.at}-${i}`}
            className={theme.tickerCls}
            style={{ marginLeft: gap ?? 10, marginRight: gap ?? 10, ...(color ? { color } : {}) }}
          >
            ♥ {d.name} {amountText(d)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Timer({
  elapsed,
  fontSize,
  fontFamily,
  fontColor,
  bgColor,
  borderColor,
  outlineColor,
  outlineWidth,
  bgOpacity,
}: {
  elapsed: string | null;
  fontSize: number;
  fontFamily?: string;
  fontColor?: string;
  bgColor?: string;
  borderColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  bgOpacity?: number;
}) {
  if (!elapsed) return null;
  /** 관리자 「기본」(빈 값) = 흰 글자·흰 배경(투명도) — color picker placeholder(#ffffff)와 일치 */
  const effectiveFontColor = (fontColor || "").trim() || "#ffffff";
  const effectiveOutlineColor = outlineColor && outlineColor.trim() ? outlineColor : "rgba(6, 12, 24, 0.95)";
  const effectiveOutlineWidth = Number.isFinite(outlineWidth) ? Math.max(0, Math.min(3, outlineWidth as number)) : 0.8;
  const opacity = Math.max(0, Math.min(100, bgOpacity ?? 40));
  const noBackground = isTimerBackgroundHidden(bgColor, opacity);
  const hideBorder = noBackground || isTimerBorderVisuallyHidden(bgColor, borderColor, opacity);
  const backgroundColor = noBackground ? "transparent" : applyTimerBackgroundOpacity(bgColor, opacity);
  const resolvedBorderColor = hideBorder
    ? "transparent"
    : applyTimerBackgroundOpacity(borderColor || bgColor, opacity);
  const { padX, padY } = getTimerPillPaddingPx(fontSize);
  const fontFamilyCss = resolveTimerFontFamilyCss(fontFamily);
  /** 배경 없음 = pill·테두리·글자 외곽선 모두 제거(숫자만) */
  const showTextOutline = !noBackground;
  const textOutlineStyle = showTextOutline
    ? {
        textShadow: `0 0 1px ${effectiveOutlineColor}, 0 1px 0 ${effectiveOutlineColor}, 0 -1px 0 ${effectiveOutlineColor}, 1px 0 0 ${effectiveOutlineColor}, -1px 0 0 ${effectiveOutlineColor}`,
        WebkitTextStroke: `${effectiveOutlineWidth}px ${effectiveOutlineColor}`,
        paintOrder: "stroke fill" as const,
      }
    : {
        textShadow: "none",
        WebkitTextStroke: "0 transparent",
      };
  const pillMinHeight = Math.round(fontSize * 1.1 + padY * 2);
  return (
    <div
      className={`inline-flex min-w-[4.5ch] items-center justify-center ${noBackground ? "" : "rounded-full backdrop-blur-md"}`}
      style={{
        boxSizing: "border-box",
        padding: `${padY}px ${padX}px`,
        ...(hideBorder
          ? {
              borderWidth: 0,
              borderStyle: "none",
              minHeight: pillMinHeight,
            }
          : {
              borderColor: resolvedBorderColor,
              borderWidth: TIMER_PILL_BORDER_PX,
              borderStyle: "solid",
            }),
        backgroundColor,
      }}
      suppressHydrationWarning
    >
      <span
        className="font-bold tabular-nums"
        style={{
          fontFamily: fontFamilyCss,
          fontSize,
          lineHeight: 1.1,
          color: effectiveFontColor,
          ...textOutlineStyle,
        }}
      >
        {elapsed}
      </span>
    </div>
  );
}

function OverlayInner() {
  const rawSp = useSearchParams();
  const rawUserId = (rawSp.get("u") || "").trim();
  const hostObs = isOverlayBroadcastHost(rawSp);
  const userId = resolveScopedOverlayUserId(rawUserId);
  const isAdminPreview =
    rawSp.get("adminPreviewEmbed") === "1" || rawSp.get("hubPreview") === "1";
  const adminPreviewDonors = useAdminPreviewDonorsOverride(isAdminPreview, userId);
  const snapKey = (rawSp.get("snapKey") || "").trim();
  const snap = tryReadSnapshotFromStorage(snapKey || null) || tryDecodeSnapshot(rawSp.get("snap"));
  const { state: remoteState, ready: remoteReady } = useRemoteState(userId || undefined, !snap && Boolean(userId));
  const s = snap || remoteState;
  const ready = !!snap || remoteReady;
  const [localPresets, setLocalPresets] = useState<OverlayPresetLike[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const perUserKey = overlayPresetsStorageKey(userId);
      const raw =
        window.localStorage.getItem(perUserKey) ||
        window.localStorage.getItem("excel-broadcast-overlay-presets");
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as OverlayPresetLike[]) : [];
    } catch {
      return [];
    }
  });
  const readLocalPresets = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      const perUserKey = overlayPresetsStorageKey(userId);
      const raw = window.localStorage.getItem(perUserKey)
        || window.localStorage.getItem("excel-broadcast-overlay-presets");
      if (!raw) {
        setLocalPresets([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setLocalPresets(parsed as OverlayPresetLike[]);
    } catch {
      setLocalPresets([]);
    }
  }, [userId]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    readLocalPresets();
    const perUserKey = overlayPresetsStorageKey(userId);
    const onStorage = (e: StorageEvent) => {
      if (e.key === perUserKey || e.key === "excel-broadcast-overlay-presets") readLocalPresets();
    };
    window.addEventListener("storage", onStorage);
    const unsubscribePresets = subscribeOverlayPresetsLocalUpdated(() => readLocalPresets());
    return () => {
      window.removeEventListener("storage", onStorage);
      unsubscribePresets();
    };
  }, [userId, readLocalPresets]);
  const membersRemote = useMemo(() => {
    if (!ready || !s) return ensureMembers([]);
    const localSnap =
      isAdminPreview && typeof window !== "undefined"
        ? readLocalBroadcastState(userId)
        : null;
    /** 후원순위(donors)는 되는데 엑셀(members)만 0인 스냅샷 — 표시 직전 재동기화 */
    const donors =
      isAdminPreview && adminPreviewDonors !== undefined
        ? (adminPreviewDonors as Donor[])
        : Array.isArray(s.donors)
          ? s.donors
          : [];
    if (donors.length > 0) {
      const base = { ...(s as AppState), donors };
      return ensureMembers(
        repairMemberTotalsForDonorRoster(syncMemberTotalsFromDonors(base), base).members
      );
    }
    /** 관리자 미리보기 — 서버 donors 비었을 때 부모 탭 LS 스냅샷 사용 */
    if (isAdminPreview && localSnap) {
      const lbDonors = normalizeDonorsArray(localSnap.donors);
      if (lbDonors.length > 0) {
        const base = {
          ...(s as AppState),
          donors: lbDonors,
          members: localSnap.members ?? s.members,
        };
        return ensureMembers(
          repairMemberTotalsForDonorRoster(syncMemberTotalsFromDonors(base), base).members
        );
      }
      if (totalCombined(localSnap) > 0) {
        return ensureMembers(localSnap.members ?? s.members);
      }
    }
    return ensureMembers(s.members);
  }, [ready, s, isAdminPreview, adminPreviewDonors, userId]);
  const donorsRemote = useMemo(() => (ready && s ? s.donors : []), [ready, s]);
  const missions = useMemo(() => {
    const raw = ready && s ? (s.missions || []) : [];
    const base = ensureMissionItems(raw);
    if (base.length > 0) return base;
    const spLocal = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const preview = spLocal.get("previewGuide") === "true";
    const pId = (spLocal.get("p") || "").trim();
    let showMissionEffective = (spLocal.get("showMission") || "").toLowerCase() === "true";
    if (!showMissionEffective && s) {
      const presets = (s as any).overlayPresets || [];
      let active: any = null;
      if (pId) active = presets.find((x: any) => x.id === pId) || null;
      if (!active) {
        const prefId = (s as any).overlaySettings?.currentPresetId;
        if (prefId) active = presets.find((x: any) => x.id === prefId) || null;
        if (!active && Array.isArray(presets) && presets.length) active = presets[0];
      }
      showMissionEffective = Boolean(active?.showMission);
    }
    // 관리자 프리뷰(iframe)에서만 미션이 비었을 때 예시 표시
    if (preview) showMissionEffective = true;
    if (showMissionEffective && preview) {
      return [
        { id: "mis_ph_1", title: "예시 미션 · 셋리스트 요청", price: "2만", isHot: true },
        { id: "mis_ph_2", title: "즉흥 노래 한 곡", price: "3만" },
        { id: "mis_ph_3", title: "게임 미션 클리어 도전", price: "5만" },
      ] as MissionItem[];
    }
    return base;
  }, [ready, s]);
  const overlayPresets = useMemo(() => {
    const remote = ready && s && Array.isArray(s.overlayPresets) ? (s.overlayPresets as OverlayPresetLike[]) : [];
    return mergeOverlayPresetsForOverlayView(remote, localPresets, rawSp);
  }, [ready, s, localPresets, rawSp]);
  const memberPositionsMap = useMemo<Record<string, string>>(
    () => ((ready && s && typeof (s as AppState).memberPositions === "object") ? ((s as AppState).memberPositions || {}) : {}),
    [ready, s]
  );
  const memberPositionMode = useMemo<"fixed" | "rankLinked">(
    () => ((ready && s && (s as AppState).memberPositionMode === "rankLinked") ? "rankLinked" : "fixed"),
    [ready, s]
  );
  const rankPositionLabels = useMemo<string[]>(
    () => ((ready && s && Array.isArray((s as AppState).rankPositionLabels)) ? (s as AppState).rankPositionLabels : []),
    [ready, s]
  );
  const presetId = (rawSp.get("p") || "").trim();
  const activePreset = useMemo(() => {
    if (presetId) return overlayPresets.find((x) => x.id === presetId) || null;
    const preferredId = ready && s && (s as any).overlaySettings?.currentPresetId;
    if (preferredId) {
      const byPreferred = overlayPresets.find((x) => x.id === preferredId);
      if (byPreferred) return byPreferred;
    }
    return overlayPresets.length ? overlayPresets[0] : null;
  }, [presetId, overlayPresets, ready, s]);
  const lastStablePresetRef = useRef<OverlayPresetLike | null>(null);
  const lastStableTimerStyleRef = useRef<ResolvedTimerOverlayStyle | null>(null);
  const timerStyleEmptySinceRef = useRef<number | null>(null);
  /** OBS: 프리셋 필드가 잠깐 빠질 때만 직전 값 유지. 명시 false는 항상 반영 */
  const restroomColumnLatchRef = useRef<boolean | null>(null);
  if (activePreset) {
    lastStablePresetRef.current = lastStablePresetRef.current
      ? mergeDonationTablePresetFields(activePreset, lastStablePresetRef.current)
      : activePreset;
  }
  const effectivePreset = activePreset || lastStablePresetRef.current;
  const presetParams = useMemo(() => presetToParams(effectivePreset), [effectivePreset]);
  const hostParam = (rawSp.get("host") || "").toLowerCase();
  const externalHost = hostParam === "prism" || hostParam === "obs" || hostParam === "external";
  const sp = useMemo(
    () => ({
      get: (key: string) =>
        resolveLivePresetStyleParam(key, rawSp, presetParams, { ready }) ?? "",
    }),
    [rawSp, presetParams, ready]
  );
  // OBS/Prism는 렌더러 특성상 텍스트·transform 미세 떨림이 발생하기 쉬워 기본 안전 모드 ON.
  const externalSafeMode = externalHost && (rawSp.get("externalSafe") || "true").toLowerCase() !== "false";
  // 강제 고정 모드: 미세 떨림 원인(자동 맞춤/스케일/모션)을 진단용으로 일괄 차단한다.
  const stableMode = (sp.get("stable") || "false").toLowerCase() === "true";
  const demoMode = ((sp.get("demo") || "").toLowerCase() === "true") || ((sp.get("test") || "").toLowerCase() === "true");
  useEffect(() => {
    let cancelled = false;
    if (!presetId) return;
    const needFetch = presetId && (!activePreset || (overlayPresets.length === 0 && localPresets.length === 0));
    if (!needFetch) return;
    const q = new URLSearchParams();
    q.set("user", userId);
    fetch(`/api/overlays?${q.toString()}`, { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (cancelled) return;
        if (data && Array.isArray(data.overlayPresets)) {
          try { window.localStorage.setItem("excel-broadcast-overlay-presets", JSON.stringify(data.overlayPresets)); } catch {}
          setLocalPresets(data.overlayPresets as OverlayPresetLike[]);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [presetId, userId, activePreset, overlayPresets.length, localPresets.length]);
  const parsePct = (raw: string | null, fallback: number) => {
    if (raw === null || raw.trim() === "") return fallback;
    const n = Number.parseFloat(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, n));
  };
  const fitWidthToViewport = (px: number, margin = 24) => `min(${Math.max(1, Math.round(px))}px, calc(100vw - ${margin}px))`;

  const compact = (sp.get("compact") || "false").toLowerCase() === "true";
  const autoFont = !stableMode && (sp.get("autoFont") || "false").toLowerCase() === "true";
  const tight = (sp.get("tight") || "false").toLowerCase() === "true";
  const verticalParam = (sp.get("vertical") || "false").toLowerCase() === "true";
  const [isVertical, setIsVertical] = useState(
    () => verticalParam || (typeof window !== "undefined" && window.innerHeight > window.innerWidth)
  );
  useEffect(() => {
    if (verticalParam) { setIsVertical(true); return; }
    const check = () => setIsVertical(typeof window !== "undefined" && window.innerHeight > window.innerWidth);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [verticalParam]);
  const fitBase = Math.max(240, Math.min(1600, parseInt(sp.get("fitBase") || (isVertical ? "400" : "480"), 10)));
  const fitMinMember = Math.max(8, Math.min(40, parseInt(sp.get("fitMinMember") || (isVertical ? "22" : "10"), 10)));
  const fitMaxMember = Math.max(fitMinMember, Math.min(80, parseInt(sp.get("fitMaxMember") || (isVertical ? "44" : "24"), 10)));
  // OBS/Prism도 프리셋 scale 핫리로드(`OVERLAY_LIVE_PRESET_STYLE_KEYS`) — 컴팩트 URL에 scale 없음
  const scaleRaw = sp.get("scale");
  const parsedScale = Math.max(0.5, Math.min(4, parseFloat(scaleRaw || (isVertical ? "1" : (compact ? "0.9" : "1")))));
  const scale = stableMode ? 1 : parsedScale;
  const hasExplicitScale = scaleRaw !== "";
  const memberSize = Math.max(10, Math.min(80, parseInt(sp.get("memberSize") || (compact ? "16" : (isVertical ? "40" : "24")), 10)));
  const totalSize = Math.max(14, Math.min(160, parseInt(sp.get("totalSize") || (isVertical ? "48" : "30"), 10)));
  const dense = (sp.get("dense") || "false").toLowerCase() === "true";
  const layoutMode = (sp.get("layout") || "center-fixed").toLowerCase();
  const centerFixed = layoutMode === "center-fixed" || layoutMode === "center";
  const anchor = centerFixed ? "cc" : (sp.get("anchor") || "cc").toLowerCase();
  const tableFree = (sp.get("tableFree") || "false").toLowerCase() === "true";
  const tableXParam = sp.get("tableX");
  const tableYParam = sp.get("tableY");
  const hasTableFreePos = centerFixed ? false : (tableFree || (tableXParam !== null && tableYParam !== null));
  const tableMarginTop = parseInt(sp.get("tableMarginTop") || "0", 10) || 0;
  const tableMarginRight = parseInt(sp.get("tableMarginRight") || "0", 10) || 0;
  const tableMarginBottom = parseInt(sp.get("tableMarginBottom") || "0", 10) || 0;
  const tableMarginLeft = parseInt(sp.get("tableMarginLeft") || "0", 10) || 0;
  const sumAnchor = (sp.get("sumAnchor") || "bc").toLowerCase();
  const sumXParam = sp.get("sumX");
  const sumYParam = sp.get("sumY");
  const hasFreePos = centerFixed ? false : (sumXParam !== null && sumYParam !== null);
  const sumX = hasFreePos ? parsePct(sumXParam, 50) : 0;
  const sumY = hasFreePos ? parsePct(sumYParam, 90) : 0;
  const themeId: ThemeId = "default";
  const baseTheme = THEMES.default;
  const totalHeaderLabel = "합계";
  const resolvePresetBool = (key: string, defaultVal: boolean): boolean => {
    const fromUrl = rawSp.get(key);
    if (fromUrl === "true") return true;
    if (fromUrl === "false") return false;
    if (effectivePreset && isDonationTableBoolKey(key)) {
      const resolved = resolveDonationTableColumnsOptions(effectivePreset);
      return resolved[key as keyof typeof resolved] as boolean;
    }
    if (effectivePreset && typeof (effectivePreset as Record<string, unknown>)[key] === "boolean") {
      return (effectivePreset as Record<string, boolean>)[key]!;
    }
    const fromPreset = presetParams.get(key);
    if (fromPreset === "true") return true;
    if (fromPreset === "false") return false;
    return defaultVal;
  };
  const resolvePresetLabel = (
    key: "accountHeaderLabel" | "toonHeaderLabel" | "restroomHeaderLabel",
    fallback: string
  ): string => {
    const fromPreset = ready ? String((effectivePreset as Record<string, unknown> | null)?.[key] || "").trim() : "";
    const merged = (fromPreset || rawSp.get(key) || presetParams.get(key) || fallback).trim() || fallback;
    /** 구 프리셋「캐쉬후원」→「계좌」 */
    if (key === "accountHeaderLabel" && (merged === "캐쉬후원" || merged === "캐시후원")) return "계좌";
    return merged;
  };
  const resolveThemeId = (key: string): ThemeId => {
    const raw = (sp.get(key) || "auto").trim();
    if (raw === "auto" || !raw) {
      if (key === "membersTheme" || key === "totalTheme" || key === "tickerBaseTheme" || key === "missionTheme") {
        const fromPresetKey = String(
          (effectivePreset as Record<string, unknown> | null)?.[key] || ""
        ).trim();
        if (
          fromPresetKey &&
          fromPresetKey !== "auto" &&
          Object.prototype.hasOwnProperty.call(THEMES, fromPresetKey)
        ) {
          return fromPresetKey as ThemeId;
        }
        const presetTheme = String((effectivePreset as { theme?: string })?.theme || "").trim();
        if (presetTheme && Object.prototype.hasOwnProperty.call(THEMES, presetTheme)) {
          return presetTheme as ThemeId;
        }
      }
      return "default";
    }
    if (Object.prototype.hasOwnProperty.call(THEMES, raw)) {
      return raw as ThemeId;
    }
    return "default";
  };
  const membersThemeId = resolveThemeId("membersTheme");
  const excelMemberAccent = resolveExcelMemberTableAccent(membersThemeId);
  const useBroadcastTableChrome = !isExcelMemberTableTheme(membersThemeId);
  const totalThemeId = resolveThemeId("totalTheme");
  const tickerBaseThemeId = resolveThemeId("tickerBaseTheme");
  const missionThemeId = resolveThemeId("missionTheme");
  const membersTheme = THEMES[membersThemeId];
  const totalTheme = THEMES[totalThemeId];
  const tickerBaseTheme = THEMES[tickerBaseThemeId];
  const missionTheme = THEMES[missionThemeId];
  const missionThemeVariant = (() => {
    const excelThemes = ["excel", "excelLive", "excelBlue", "excelSlate", "excelAmber", "excelGold", "excelRose", "excelNavy", "excelTeal", "excelPurple", "excelEmerald", "excelOrange", "excelIndigo"];
    return excelThemes.includes(missionThemeId) ? "excel" : (["rainbow", "sunset", "ocean", "forest", "aurora", "violet", "coral", "mint", "lava", "ice"].includes(missionThemeId) ? "neon" : missionThemeId);
  })() as "default" | "excel" | "neon" | "retro" | "minimal" | "rpg" | "pastel" | "neonExcel";

  const timerTypeRaw = (
    sp.get("timerType") ||
    sp.get("timertype") ||
    sp.get("timer") ||
    sp.get("type") ||
    ""
  ).trim();
  const timerOnlyMode = Boolean(timerTypeRaw);
  const timerType = useMemo<"general" | null>(() => {
    if (!timerTypeRaw) return null;
    const normalized = timerTypeRaw.toLowerCase();
    if (normalized === "general" || normalized === "generaltimer" || normalized === "timer") return "general";
    return null;
  }, [timerTypeRaw]);
  const tableOnly = timerOnlyMode ? false : (sp.get("tableOnly") === "true");
  const showGoalRequested = (() => {
    const raw = sp.get("showGoal");
    if (raw === "true") return true;
    if (raw === "false") return false;
    return Boolean(activePreset?.showGoal);
  })();
  // tableOnly가 켜져 있어도 목표바를 명시적으로 켠 프리셋/URL에서는 목표바를 우선한다.
  const effectiveTableOnly = tableOnly && !showGoalRequested;
  const showMembers = effectiveTableOnly ? true : (timerOnlyMode ? false : (sp.get("showMembers") !== "false"));
  const showTotal = effectiveTableOnly ? true : (timerOnlyMode ? false : (sp.get("showTotal") !== "false"));
  const showCombinedColumn = resolvePresetBool("showCombinedColumn", true);
  const showContributionColumn = resolvePresetBool("showContributionColumn", true);
  const showRestroomColumn = (() => {
    const url = (rawSp.get("showRestroomColumn") || "").toLowerCase();
    if (url === "false") {
      restroomColumnLatchRef.current = false;
      return false;
    }
    if (url === "true") {
      restroomColumnLatchRef.current = true;
      return true;
    }
    const mergedPreset = effectivePreset
      ? mergeDonationTablePresetFields(effectivePreset, lastStablePresetRef.current)
      : lastStablePresetRef.current;
    /** 프리셋에 명시된 true/false는 즉시 반영(관리자 체크 해제 포함) */
    if (mergedPreset && typeof mergedPreset.showRestroomColumn === "boolean") {
      restroomColumnLatchRef.current = mergedPreset.showRestroomColumn;
      return mergedPreset.showRestroomColumn;
    }
    const resolved = mergedPreset
      ? resolveDonationTableColumnsOptions(mergedPreset).showRestroomColumn
      : true;
    /** OBS·ready 전: 필드 누락 깜빡임만 latch로 방지 */
    if (hostObs && !ready && restroomColumnLatchRef.current != null) {
      return restroomColumnLatchRef.current;
    }
    restroomColumnLatchRef.current = resolved;
    return resolved;
  })();
  const showContributionSum = showContributionColumn && resolvePresetBool("showContributionSum", true);
  const showTableSumRow = (() => {
    if (ready && effectivePreset && typeof effectivePreset.showTableSumRow === "boolean") {
      return effectivePreset.showTableSumRow;
    }
    const v = rawSp.get("showTableSumRow") ?? presetParams.get("showTableSumRow");
    if (v === "true") return true;
    if (v === "false") return false;
    return showTotal;
  })();
  const accountHeaderLabel = resolvePresetLabel("accountHeaderLabel", "계좌");
  const toonHeaderLabel = resolvePresetLabel("toonHeaderLabel", "투네");
  const restroomHeaderLabel = resolvePresetLabel("restroomHeaderLabel", "화장실");
  const showGoal = (() => {
    if (effectiveTableOnly) return false;
    const raw = sp.get("showGoal");
    if (timerOnlyMode) return raw === "true";
    if (raw === "true") return true;
    if (raw === "false") return false;
    // URL에 설정이 없으면 프리셋 값을 따름
    return Boolean(activePreset?.showGoal);
  })();
  const showTicker = false;
  const tickerInMembers = false;
  const tickerInPersonalGoal = false;
  const tickerInGoal = false;
  const hasContextTicker = false;
  const showTimerRaw = (sp.get("showTimer") || "").toLowerCase();
  const showTimer = (() => {
    if (effectiveTableOnly) return false;
    if (timerOnlyMode) return showTimerRaw !== "false";
    if (showTimerRaw === "true") return true;
    if (showTimerRaw === "false") return false;
    return Boolean(activePreset?.showTimer);
  })();
  const goal = useMemo(() => {
    const fromPreset = Number((activePreset as any)?.goal || 0);
    const presetGoalOk = Number.isFinite(fromPreset) && fromPreset > 0;
    /** Prism/OBS 등(`host`): 저장된 프리셋이 우선 → 자동 목표 상향 후 새로고침해도 반영됨(URL의 goal= 고정 해제) */
    if (externalHost && ready && presetGoalOk) return Math.floor(fromPreset);
    const fromMerged = parseInt(sp.get("goal") || "0", 10);
    if (Number.isFinite(fromMerged) && fromMerged > 0) return fromMerged;
    if (presetGoalOk) return Math.floor(fromPreset);
    return 0;
  }, [sp, activePreset, externalHost, ready]);
  const goalLabel = (sp.get("goalLabel") || (activePreset as any)?.goalLabel || "후원").trim();
  const goalWidth = useMemo(() => {
    const fromUrl = parseInt(sp.get("goalWidth") || "0", 10);
    if (Number.isFinite(fromUrl) && fromUrl > 0) return Math.max(200, Math.min(800, fromUrl));
    const fromPreset = Number((activePreset as any)?.goalWidth || 0);
    if (Number.isFinite(fromPreset) && fromPreset > 0) return Math.max(200, Math.min(800, Math.floor(fromPreset)));
    return 400;
  }, [sp, activePreset]);
  const goalAnchor = (sp.get("goalAnchor") || "bc").toLowerCase();
  const showTeamBattle = (() => {
    const raw = (sp.get("showTeamBattle") || "").trim().toLowerCase();
    if (raw === "true") return true;
    if (raw === "false") return false;
    return Boolean(activePreset?.showTeamBattle);
  })();
  const teamBattleAnchor = (sp.get("teamBattleAnchor") || activePreset?.teamBattleAnchor || "tc").toLowerCase();
  const personalGoalAnchor = (sp.get("personalGoalAnchor") || "tl").toLowerCase();
  const personalGoalLimit = Math.max(1, Math.min(12, parseInt(sp.get("personalGoalLimit") || "3", 10)));
  const personalGoalTheme = (sp.get("personalGoalTheme") || "goalClassic") as "goalClassic" | "goalNeon";
  const personalGoalFree = (sp.get("personalGoalFree") || "false").toLowerCase() === "true";
  const personalGoalXParam = sp.get("personalGoalX");
  const personalGoalYParam = sp.get("personalGoalY");
  const hasPersonalGoalFreePos = centerFixed ? false : (personalGoalFree || (personalGoalXParam !== null && personalGoalYParam !== null));
  const personalGoalX = hasPersonalGoalFreePos ? parsePct(personalGoalXParam, 78) : 0;
  const personalGoalY = hasPersonalGoalFreePos ? parsePct(personalGoalYParam, 82) : 0;
  const goalCurrent = useMemo(() => {
    const fromUrlRaw = sp.get("goalCurrent");
    if (fromUrlRaw !== null) {
      const fromUrl = parseInt(fromUrlRaw || "0", 10);
      return Math.max(0, Number.isFinite(fromUrl) ? fromUrl : 0);
    }
    const fromPreset = Number((activePreset as any)?.goalCurrent || NaN);
    if (Number.isFinite(fromPreset) && fromPreset >= 0) return Math.floor(fromPreset);
    return null;
  }, [sp, activePreset]);
  const timerStart = sp.get("timerStart") ? parseInt(sp.get("timerStart")!, 10) : null;
  const timerAnchorParam = (sp.get("timerAnchor") || "").trim().toLowerCase();
  const timerAnchor = timerAnchorParam || (timerOnlyMode ? "cc" : "tr");
  const tickerAnchor = (sp.get("tickerAnchor") || "bc").toLowerCase();
  const tickerWidth = Math.max(200, Math.min(1200, parseInt(sp.get("tickerWidth") || "600", 10)));
  const tickerXParam = sp.get("tickerX");
  const tickerYParam = sp.get("tickerY");
  const hasTickerFreePos = centerFixed ? false : (tickerXParam !== null && tickerYParam !== null);
  const tickerX = hasTickerFreePos ? parsePct(tickerXParam, 50) : 0;
  const tickerY = hasTickerFreePos ? parsePct(tickerYParam, 86) : 0;
  const showMission = (() => {
    if (effectiveTableOnly) return false;
    if (timerOnlyMode) return sp.get("showMission") === "true";
    const raw = sp.get("showMission");
    if (raw === "true") return true;
    if (raw === "false") return false;
    // URL에 설정이 없으면 프리셋 값을 따름(프리뷰/외부 호스트 모두)
    return Boolean(activePreset?.showMission);
  })();
  // 미션 관련 세부 옵션은 외부 호스트 여부에 따라 프리셋 또는 URL에서 해석
  const confettiMilestoneMan = (() => {
    const raw = (sp.get("confettiMilestone") || "").trim();
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(1, Math.min(1000, n)) : 0;
  })();

  const resolvedTimerType = useMemo<"general" | null>(() => {
    if (timerType) return timerType;
    return timerOnlyMode ? "general" : null;
  }, [timerOnlyMode, timerType]);
  const timerFromState = useMemo(() => {
    if (!s) return null;
    if (!resolvedTimerType) return null;
    return s.generalTimer;
  }, [resolvedTimerType, s]);
  const matchTimerFromState = useMemo(() => {
    if (!s) return null;
    return s.matchTimer ?? s.generalTimer;
  }, [s]);
  const timerStyleFromState = useMemo(() => {
    if (!s) return null;
    if (resolvedTimerType) {
      return s.timerDisplayStyles?.[resolvedTimerType] || s.timerDisplayStyles?.general || null;
    }
    return s.timerDisplayStyles?.general || null;
  }, [resolvedTimerType, s]);
  const timerStyleResolved = useMemo(() => {
    /** 배경/테두리 없음 — state 가 정본이면 stale ref·프리셋 fallback 없이 즉시 반영 */
    if (timerStyleFromState && isHiddenTimerDisplayStyle(timerStyleFromState)) {
      const hiddenOnly = applyHiddenTimerStyleFromState(
        resolveTimerOverlayStyle(rawSp, effectivePreset, timerStyleFromState, {
          ready,
          timerOnlyDefaultShowHours: timerOnlyMode,
        }),
        timerStyleFromState
      );
      lastStableTimerStyleRef.current = hiddenOnly;
      timerStyleEmptySinceRef.current = null;
      return hiddenOnly;
    }
    const resolvedBase = resolveTimerOverlayStyle(rawSp, effectivePreset, timerStyleFromState, {
      ready,
      timerOnlyDefaultShowHours: timerOnlyMode,
    });
    /** timerDisplayStyles 가 정본 — 프리셋·URL·stale ref 가 배경/테두리/투명도를 덮지 않게 */
    const next = applyHiddenTimerStyleFromState(resolvedBase, timerStyleFromState);
    const stateHiddenBg =
      timerStyleFromState &&
      isTimerBackgroundHidden(
        timerStyleFromState.bgColor,
        timerStyleFromState.bgOpacity ?? next.bgOpacity ?? 40
      );
    const stateHiddenBorder =
      timerStyleFromState &&
      isTimerBorderVisuallyHidden(
        timerStyleFromState.bgColor,
        timerStyleFromState.borderColor,
        timerStyleFromState.bgOpacity ?? next.bgOpacity ?? 40
      );
    if (timerOverlayStyleHasCustomColors(next) || stateHiddenBg || stateHiddenBorder) {
      lastStableTimerStyleRef.current = next;
      timerStyleEmptySinceRef.current = null;
      return next;
    }
    /** 다른 옵션 저장·동기화로 잠깐 기본색이 오면 색만 유지 — 글꼴·크기·시:분:초는 최신 반영 */
    if (lastStableTimerStyleRef.current) {
      const now = Date.now();
      if (timerStyleEmptySinceRef.current == null) timerStyleEmptySinceRef.current = now;
      if (now - timerStyleEmptySinceRef.current < 2800) {
        const merged = {
          ...lastStableTimerStyleRef.current,
          fontFamily: next.fontFamily,
          design: next.design,
          showHours: next.showHours,
          scalePercent: next.scalePercent,
          outlineWidth: next.outlineWidth,
        };
        /** 배경/테두리 없음 — state·next hidden 유지, stale bgOpacity 로 pill 복원 방지 */
        const keepHiddenFrom = (
          src: { bgColor?: string; borderColor?: string; outlineColor?: string; bgOpacity?: number } | null
        ) => {
          if (!src) return merged;
          const op = src.bgOpacity ?? merged.bgOpacity ?? 40;
          if (isTimerBackgroundHidden(src.bgColor, op)) {
            return {
              ...merged,
              bgColor: src.bgColor || "transparent",
              borderColor: src.borderColor || "transparent",
              outlineColor: src.outlineColor ?? "",
              bgOpacity: src.bgOpacity ?? 0,
            };
          }
          if (isTimerBorderVisuallyHidden(src.bgColor ?? merged.bgColor, src.borderColor, op)) {
            return { ...merged, borderColor: src.borderColor || "transparent", bgOpacity: op };
          }
          return { ...merged, bgOpacity: op };
        };
        if (
          isTimerBackgroundHidden(next.bgColor, next.bgOpacity) ||
          isTimerBackgroundHidden(timerStyleFromState?.bgColor, timerStyleFromState?.bgOpacity ?? 40)
        ) {
          return applyHiddenTimerStyleFromState(
            keepHiddenFrom(
              isTimerBackgroundHidden(next.bgColor, next.bgOpacity) ? next : timerStyleFromState
            ),
            timerStyleFromState
          );
        }
        if (
          isTimerBorderVisuallyHidden(next.bgColor, next.borderColor, next.bgOpacity) ||
          (timerStyleFromState &&
            isTimerBorderVisuallyHidden(
              timerStyleFromState.bgColor,
              timerStyleFromState.borderColor,
              timerStyleFromState.bgOpacity ?? 40
            ))
        ) {
          return applyHiddenTimerStyleFromState(
            keepHiddenFrom(
              isTimerBorderVisuallyHidden(next.bgColor, next.borderColor, next.bgOpacity)
                ? next
                : timerStyleFromState
            ),
            timerStyleFromState
          );
        }
        return applyHiddenTimerStyleFromState(
          { ...merged, bgOpacity: next.bgOpacity },
          timerStyleFromState
        );
      }
      lastStableTimerStyleRef.current = null;
      timerStyleEmptySinceRef.current = null;
    }
    return applyHiddenTimerStyleFromState(next, timerStyleFromState);
  }, [rawSp, effectivePreset, timerStyleFromState, ready, timerOnlyMode]);
  const timerShowHours = timerStyleResolved.showHours;
  const timerDesign = normalizeTimerDesign(timerStyleResolved.design);
  const timerFontFamily = timerStyleResolved.fontFamily;
  const timerFontColor = timerStyleResolved.fontColor;
  const timerBgColor = timerStyleResolved.bgColor;
  const timerBorderColor = timerStyleResolved.borderColor;
  const timerOutlineColor = timerStyleResolved.outlineColor;
  const timerOutlineWidth = timerStyleResolved.outlineWidth;
  const timerBgOpacity = timerStyleResolved.bgOpacity;
  const timerScalePercent = timerStyleResolved.scalePercent;
  const timerFontSize = resolveCircularImageTimerFontSize({
    timerOnlyMode,
    memberSizePx: memberSize,
    scalePercent: timerScalePercent,
  });
  useEffect(() => {
    if (showTimer) ensureTimerGoogleFontsLoaded();
  }, [showTimer, timerFontFamily]);
  const matchTimerAllowed = useMemo(() => {
    if (!s?.matchTimerEnabled) return true;
    return s.matchTimerEnabled.match !== false;
  }, [s]);
  const generalTimerAllowed = useMemo(() => {
    if (!s?.matchTimerEnabled) return true;
    return s.matchTimerEnabled.general;
  }, [s]);
  const effectiveTimerAllowed = timerOnlyMode ? generalTimerAllowed : matchTimerAllowed;
  const serverTimer = useServerTimer(timerFromState);
  const matchServerTimer = useServerTimer(matchTimerFromState);
  const elapsed = useElapsed(timerStart);
  const timerBaseText = serverTimer.text || elapsed || (timerOnlyMode ? "00:00:00" : null);
  const timerText = formatTimerText(timerBaseText, serverTimer.remainingSeconds, timerShowHours);
  const matchTimerBaseText = matchServerTimer.text || null;
  const matchTimerText = formatTimerText(
    matchTimerBaseText,
    matchServerTimer.remainingSeconds,
    timerShowHours
  );

  const teamBattleBoard = useMemo(() => {
    const mb = s?.mealBattle;
    if (!showTeamBattle || !mb?.teamBattleEnabled) return null;
    const teamAIds = new Set(mb.teamAMemberIds || []);
    const teamBIds = new Set(mb.teamBMemberIds || []);
    const memberById = new Map((s?.members || []).map((m) => [m.id, m]));
    const positions = s?.memberPositions || {};
    const participants = (mb.participants || []).filter((p) => {
      const m = memberById.get(p.memberId);
      if (!m) return false;
      return !isOperatingSettlementMember(m, positions);
    });
    let aScore = 0;
    let bScore = 0;
    const aNames: string[] = [];
    const bNames: string[] = [];
    for (const p of participants) {
      if (teamAIds.has(p.memberId)) {
        aScore += Math.max(0, Number(p.score) || 0);
        aNames.push(String(p.name || "").trim() || p.memberId);
      } else if (teamBIds.has(p.memberId)) {
        bScore += Math.max(0, Number(p.score) || 0);
        bNames.push(String(p.name || "").trim() || p.memberId);
      }
    }
    if (aNames.length === 0 && bNames.length === 0) return null;
    return {
      aScore,
      bScore,
      aNames: aNames.join(","),
      bNames: bNames.join(","),
      useRaw: mealBattleUsesRawDonationScore(mb),
    };
  }, [s?.mealBattle, s?.members, s?.memberPositions, showTeamBattle]);

  // 숫자 컬럼 가독성 우선: 이름 기본 폭을 확보하고 계좌·투네 열을 넓혀 백만원대 겹침을 줄인다(URL nameCh·bankCh·toonCh 로 조정 가능).
  const nameCh = Math.max(4, Math.min(40, parseInt(sp.get("nameCh") || (compact ? "7" : (isVertical ? "11" : "7")), 10)));
  const nameGrow = (sp.get("nameGrow") || "true").toLowerCase() === "true";
  const currencyFull = (sp.get("currencyFull") || "false").toLowerCase() === "true";
  const nameMaxCh = Math.max(nameCh, Math.min(80, parseInt(sp.get("nameMaxCh") || String(nameCh + 8), 10)));
  const donorsFormat = useMemo(() => {
    const fromPresetStyle = sp.get("donorsFormat");
    if (fromPresetStyle === "full" || fromPresetStyle === "short") return fromPresetStyle;
    if (ready && s?.donorsFormat) return s.donorsFormat === "full" ? "full" : "short";
    const urlFmt = (rawSp.get("donorsFormat") || "").trim();
    if (urlFmt === "full" || urlFmt === "short") return urlFmt;
    return "short";
  }, [sp, rawSp, ready, s?.donorsFormat]);
  const fullAmountMode = donorsFormat === "full" || currencyFull;
  // 기본 열 폭: 백만원(2,000,000=9자) + 아웃라인 여유. URL bankCh·toonCh 로 조정 가능.
  const defBankCh = (sp.get("bankCh") && parseInt(sp.get("bankCh")!, 10)) || (fullAmountMode ? (compact ? 12 : 14) : (compact ? 10 : 11));
  const defToonCh = (sp.get("toonCh") && parseInt(sp.get("toonCh")!, 10)) || (fullAmountMode ? (compact ? 12 : 14) : (compact ? 10 : 11));
  const defTotalCh = (sp.get("totalCh") && parseInt(sp.get("totalCh")!, 10)) || (fullAmountMode ? (compact ? 11 : 13) : (compact ? 6 : 7));
  const contributionChParam = externalHost ? rawSp.get("contributionCh") : sp.get("contributionCh");
  const defContributionCh =
    (contributionChParam && parseInt(contributionChParam, 10)) || (fullAmountMode ? (compact ? 10 : 11) : (compact ? 10 : 11));
  const bankChBase = Math.max(8, Math.min(24, defBankCh));
  const toonChBase = Math.max(8, Math.min(24, defToonCh));
  const totalChBase = Math.max(6, Math.min(22, defTotalCh));
  /** 순위 열: 헤더「순위」·「#12」 등이 잘리지 않도록 `ch` 하한 확보(URL `rankCh`) */
  const rankColCh = Math.max(6, Math.min(12, parseInt(sp.get("rankCh") || "6", 10)));
  /** 기여도 열: 우측 이격은 줄이되, 방송 합성 환경에서 마지막 열 잘림이 나지 않게 최소폭을 보장 */
  const contributionChBase = Math.max(10, Math.min(18, defContributionCh));
  const restroomChParam = externalHost ? rawSp.get("restroomCh") : sp.get("restroomCh");
  const defRestroomCh =
    (restroomChParam && parseInt(restroomChParam, 10)) || (compact ? 6 : 7);
  const restroomChBase = Math.max(5, Math.min(12, defRestroomCh));
  const showSideDonors = false;
  const donorsSide = (sp.get("donorsSide") || "right").toLowerCase();
  const donorsWidth = Math.max(120, Math.min(600, parseInt(sp.get("donorsWidth") || "220", 10)));
  const donorsSize = Math.max(10, Math.min(60, parseInt(sp.get("donorsSize") || String(Math.round(memberSize * 0.9)), 10)));
  const donorsColor = sp.get("donorsColor") || undefined;
  const donorsBgColor = sp.get("donorsBgColor") || undefined;
  const accountColor = sp.get("accountColor") || undefined;
  const toonColor = sp.get("toonColor") || undefined;
  const contributionColorRaw = resolveContributionColor(rawSp, effectivePreset, { ready });
  const tableRowEvenBgRaw = resolveTableRowEvenBg(rawSp, effectivePreset, { ready });
  const tableRowOddBgRaw = resolveTableRowOddBg(rawSp, effectivePreset, { ready });
  const tablePanelBorderColorRaw = resolveTablePanelBorderColor(rawSp, effectivePreset, { ready });
  const tableTextColorRaw = resolveTableTextColor(rawSp, effectivePreset, { ready });
  const totalTextColorRaw = resolveTotalTextColor(rawSp, effectivePreset, { ready });
  const tableBgColorRaw = resolveTableBgColor(rawSp, effectivePreset, { ready });
  const tableHeaderBgColorRaw = resolveTableHeaderBgColor(rawSp, effectivePreset, { ready });
  const tableHeaderTextColorRaw = resolveTableHeaderTextColor(rawSp, effectivePreset, { ready });
  const tableLineColorRaw = resolveTableLineColor(rawSp, effectivePreset, { ready });
  const tableVerticalLines = resolveTableVerticalLines(rawSp, effectivePreset, { ready });
  const tableGridLines = resolveTableGridLines(rawSp, effectivePreset, { ready });
  const excelRankTop3Style = useMemo(
    () => resolveExcelRankTop3Style(rawSp, effectivePreset, { ready }),
    [rawSp, effectivePreset, ready]
  );
  const tableSheetRgb = resolveTableSheetRgb(membersThemeId, tableBgColorRaw || undefined);
  const donorsBgOpacity = Math.max(0, Math.min(100, parseInt(sp.get("donorsBgOpacity") || "0", 10)));
  const showBottomDonors = false;
  const effectiveShowTicker = false;
  const donorsGap = Math.max(0, Math.min(48, parseInt(sp.get("donorsGap") || (tight ? "8" : "16"), 10)));
  const donorsSpeed = Math.max(10, Math.min(7200, parseFloat(sp.get("donorsSpeed") || "60"))); // seconds per loop (기본 60초, 최대 2시간)
  const donorsLimit = Math.max(1, Math.min(50, parseInt(sp.get("donorsLimit") || "8", 10)));
  const donorsUnit = sp.get("donorsUnit") || sp.get("currencyUnit") || "";
  const currencyLocale = sp.get("currencyLocale") || "ko-KR";
  const previewGuide = sp.get("previewGuide") === "true";
  const tickerThemeCfg = sp.get("tickerTheme") || "auto";
  const tickerGlowCfg = Math.max(0, Math.min(100, parseInt(sp.get("tickerGlow") || "45", 10)));
  const tickerShadowCfg = Math.max(0, Math.min(100, parseInt(sp.get("tickerShadow") || "35", 10)));
  const tableBgOpacity = (() => {
    const rawUrl = (sp.get("tableBgOpacity") || "").trim();
    const rawPreset = String((activePreset as any)?.tableBgOpacity || "").trim();
    const raw = rawUrl || rawPreset;
    if (!raw) {
      const neonThemes = ["rainbow", "sunset", "ocean", "forest", "aurora", "violet", "coral", "mint", "lava", "ice"];
      return neonThemes.includes(membersThemeId) ? 92 : 100;
    }
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
  })();
  const goalOpacity = (() => {
    const rawUrl = (sp.get("goalOpacity") || "").trim();
    const rawPreset = String((activePreset as any)?.goalOpacity || "").trim();
    const raw = rawUrl || rawPreset;
    if (!raw) return 100;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 100;
  })();
  const goalOpacityAffectsText = (() => {
    const rawUrl = (sp.get("goalOpacityText") || "").trim().toLowerCase();
    if (rawUrl === "true") return true;
    if (rawUrl === "false") return false;
    const rawPreset = String((activePreset as any)?.goalOpacityText ?? "").trim().toLowerCase();
    if (rawPreset === "true") return true;
    if (rawPreset === "false") return false;
    return false;
  })();
  const goalTextColor = resolveGoalTextColor(rawSp, effectivePreset, { ready });
  const goalFontSizePx = resolveGoalFontSizePx(rawSp, effectivePreset, { ready });
  const goalTextOutlineColor = resolveGoalTextOutlineColor(rawSp, effectivePreset, { ready });
  const goalTextOutlineWidthPx = resolveGoalTextOutlineWidthPx(rawSp, effectivePreset, { ready });
  const goalBarBgColor = resolveGoalBarBgColor(rawSp, effectivePreset, { ready });
  const goalBarFillColor = resolveGoalBarFillColorParam(rawSp, effectivePreset, { ready });
  const goalFontFamilyCss = resolveGoalFontFamilyCss(rawSp, effectivePreset, { ready });
  const goalBarAnimationMode = resolveGoalBarAnimationMode(rawSp, effectivePreset, { ready });
  const goalBarGifUrl = resolveGoalBarGifUrl(rawSp, effectivePreset, { ready });
  const goalBarGifOpacity = resolveGoalBarGifOpacity(rawSp, effectivePreset, { ready });
  const goalBarGifBrightness = resolveGoalBarGifBrightness(rawSp, effectivePreset, { ready });
  const showGoalBarGif = !stableMode && Boolean(goalBarGifUrl);
  const overlayTextSharpRender = resolveOverlayTextSharpRender(rawSp, effectivePreset, {
    ready,
    defaultSharpOnBroadcast: shouldDefaultSharpRenderOnBroadcastHost(rawSp),
  });
  const goalFontWeight = resolveGoalFontWeight(rawSp, effectivePreset, { ready });
  const tableTextOutlineColor = resolveTableTextOutlineColor(rawSp, effectivePreset, { ready });
  const tableTextOutlineWidthPx = resolveTableTextOutlineWidthPx(rawSp, effectivePreset, { ready });
  const tableHeaderTextOutlineColor = resolveTableHeaderTextOutlineColor(rawSp, effectivePreset, { ready });
  const tableHeaderTextOutlineWidthPx = resolveTableHeaderTextOutlineWidthPx(rawSp, effectivePreset, { ready });
  const tableFontWeight = resolveTableFontWeight(rawSp, effectivePreset, { ready });
  const tableHeaderFontWeight = Math.min(900, tableFontWeight + 100);
  const tableFontFamilyId = resolveTableFontFamilyId(rawSp, effectivePreset, { ready });
  const tableFontFamilyCss = resolveTableFontFamilyCss(tableFontFamilyId);
  const donationListsCfg = normalizeDonationListsOverlayConfig(s?.donationListsOverlayConfig);
  const tableBgGifUrl = (
    (sp.get("tableBgGifUrl") || "").trim() ||
    (donationListsCfg.isBgEnabled ? donationListsCfg.bgGifUrl.trim() : "") ||
    String((activePreset as any)?.tableBgGifUrl || "").trim()
  );
  const tableBgGifOpacity = (() => {
    const rawUrl = (sp.get("tableBgGifOpacity") || "").trim();
    const rawFromLists = donationListsCfg.isBgEnabled ? String(donationListsCfg.bgOpacity) : "";
    const rawPreset = String((activePreset as any)?.tableBgGifOpacity || "").trim();
    const raw = rawUrl || rawFromLists || rawPreset;
    if (!raw) return 45;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 45;
  })();
  const tableBgGifBrightness = (() => {
    const rawUrl = (sp.get("tableBgGifBrightness") || "").trim();
    const rawPreset = String((activePreset as any)?.tableBgGifBrightness || "").trim();
    const raw = rawUrl || rawPreset;
    if (!raw) return 100;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? Math.max(40, Math.min(200, n)) : 100;
  })();
  const totalLineVisible = (() => {
    const raw = (sp.get("totalLineVisible") || "").trim().toLowerCase();
    return raw === "true";
  })();
  const showTableBgGif = !stableMode && Boolean(tableBgGifUrl);
  const tableBgAnimated = useMemo(() => resolveAnimatedSourceForEmbed(tableBgGifUrl), [tableBgGifUrl]);
  const tableFrameUrl = resolveTableFrameUrl(rawSp, effectivePreset, { ready });
  const tableFrameEnabled = resolveTableFrameEnabled(rawSp, effectivePreset, { ready });
  const tableFrameOpacity = resolveTableFrameOpacity(rawSp, effectivePreset, { ready });
  const tableFrameInsetPx = resolveTableFrameInsetPx(rawSp, effectivePreset, { ready });
  const showTableFrame = !stableMode && tableFrameEnabled;
  useEffect(() => {
    if (typeof window === "undefined") return;
    (window as any).__overlayTickerConfig = {
      previewGuide,
      tickerTheme: tickerThemeCfg,
      tickerGlow: tickerGlowCfg,
      tickerShadow: tickerShadowCfg,
    };
  }, [previewGuide, tickerThemeCfg, tickerGlowCfg, tickerShadowCfg]);
  // Keep member/total amount format aligned with donor ticker format.
  const fmt = (n: number) =>
    donorsFormat === "full"
      ? formatDonorsAmount(n, "full", currencyLocale)
      : formatManThousand(n);
  const fmtTotalCell = (n: number) => fmt(n);
  const stripBg = (cls: string) =>
    cls
      // Remove any solid bg-* utilities
      .replace(/\bbg-[^\s]+/g, "bg-transparent")
      // Remove gradient-related utilities so they don't apply per-cell
      .replace(/\bbg-gradient-[^\s]+/g, "")
      .replace(/\bfrom-[^\s]+/g, "")
      .replace(/\bvia-[^\s]+/g, "")
      .replace(/\bto-[^\s]+/g, "");
  const stripBorder = (cls: string) =>
    cls
      .replace(/\bborder(?:-[trblxy])?(?:-[^\s]+)?/g, "")
      .replace(/\brounded(?:-[^\s]+)?/g, "")
      .replace(/\bshadow(?:-[^\s]+)?/g, "")
      .replace(/\s+/g, " ")
      .trim();
  const hasTableTextColorOverride = /^#[0-9a-fA-F]{3,8}$/.test(tableTextColorRaw);
  const hasTotalTextColorOverride = /^#[0-9a-fA-F]{3,8}$/.test(totalTextColorRaw);
  const hasTableHeaderTextColorOverride = /^#[0-9a-fA-F]{3,8}$/.test(tableHeaderTextColorRaw);
  const hasTableHeaderBgColorOverride = /^#[0-9a-fA-F]{3,8}$/.test(tableHeaderBgColorRaw);
  /** 테마 자동 = 흰색(+외곽선). 검은 글자는 본문/헤더 글자색에서 직접 지정 */
  const tableTextIsLight = hasTableTextColorOverride
    ? isLightTextHex(tableTextColorRaw)
    : true;
  const tableThemeAutoTextColor = TABLE_BROADCAST_TEXT_AUTO;
  const totalRowTextColor = hasTotalTextColorOverride
    ? totalTextColorRaw
    : tableThemeAutoTextColor;
  /** 본문 글자색(헤더·총합 행 제외) */
  const tableBodyForcedTextColorCss = hasTableTextColorOverride
    ? `
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row) td,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row) td span,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row) td strong,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row) td .overlay-cell-text-inner {
          color: ${tableTextColorRaw} !important;
        }`
    : "";
  const tableTotalForcedTextColorCss =
    hasTotalTextColorOverride || hasTableTextColorOverride
      ? `
        .overlay-root .overlay-elegant-table .overlay-total-row td,
        .overlay-root .overlay-elegant-table .overlay-total-row td span,
        .overlay-root .overlay-elegant-table .overlay-total-row td .overlay-cell-text-inner {
          color: ${totalRowTextColor} !important;
        }`
      : "";
  /** 헤더(상단) 글자색 — 본문 tableTextColor 와 분리 */
  const tableHeaderForcedTextColorCss = hasTableHeaderTextColorOverride
    ? `
        .overlay-root .overlay-elegant-table thead td,
        .overlay-root .overlay-elegant-table thead td span,
        .overlay-root .overlay-elegant-table thead td strong,
        .overlay-root .overlay-elegant-table thead td .overlay-cell-text-inner {
          color: ${tableHeaderTextColorRaw} !important;
        }`
    : "";
  const tableForcedTextColorCss = `${tableBodyForcedTextColorCss}${tableTotalForcedTextColorCss}${tableHeaderForcedTextColorCss}`;
  /** 테마 자동: 방송 테마 본문·헤더 기본 흰색(엑셀 테마는 별도 excelAutoBodyTextCss) */
  const tableAutoTextColorCss =
    useBroadcastTableChrome && !hasTableTextColorOverride && !hasTableHeaderTextColorOverride
      ? `
        .overlay-root .overlay-elegant-table td,
        .overlay-root .overlay-elegant-table thead td,
        .overlay-root .overlay-elegant-table thead td span,
        .overlay-root .overlay-elegant-table thead td strong,
        .overlay-root .overlay-elegant-table tbody td span,
        .overlay-root .overlay-elegant-table tbody td strong,
        .overlay-root .overlay-elegant-table tbody td .overlay-cell-text-inner {
          color: ${tableThemeAutoTextColor} !important;
        }`
      : useBroadcastTableChrome && !hasTableHeaderTextColorOverride && hasTableTextColorOverride
        ? `
        .overlay-root .overlay-elegant-table thead td,
        .overlay-root .overlay-elegant-table thead td span,
        .overlay-root .overlay-elegant-table thead td strong,
        .overlay-root .overlay-elegant-table thead td .overlay-cell-text-inner {
          color: ${tableThemeAutoTextColor} !important;
        }`
        : "";
  /** 엑셀 테마: 본문 기본 흰색(헤더·총합 행 테마 유지). 테마 자동=흰색 */
  const excelReadableBodyText = EXCEL_BODY_TEXT_ON_DARK;
  const excelAutoBodyTextCss =
    !useBroadcastTableChrome && !hasTableTextColorOverride
      ? `
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row) td,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row) td span,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row) td strong,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row) td .overlay-cell-text-inner {
          color: ${excelReadableBodyText} !important;
        }`
      : "";
  const tableBodyTextStroke =
    (hasTableTextColorOverride ? isLightTextHex(tableTextColorRaw) : true) && !externalSafeMode
      ? "0.75px rgba(6, 12, 24, 0.95)"
      : "0";
  const stripTextColor = (cls: string) =>
    hasTableTextColorOverride || hasTableHeaderTextColorOverride || Boolean(excelAutoBodyTextCss)
      ? cls.replace(/\btext-[^\s]+/g, "").replace(/\s+/g, " ").trim()
      : cls;
  /** GIF 모드에서도 관리자 tableBgOpacity(0~100)를 그대로 반영 */
  const tableTintAlpha = Math.max(0, Math.min(1, tableBgOpacity / 100));
  /** 100% + GIF 없음 → 완전 불투명(rgb). GIF 있으면 선명도 슬라이더로 시트를 투명하게 해 뒤 애니메이션이 보이게 */
  const tableSheetFullyOpaque = tableBgOpacity >= 100 && !showTableBgGif;
  const tableGifClarity = Math.max(0, Math.min(100, tableBgGifOpacity)) / 100;
  const effectiveTableTintAlpha = showTableBgGif
    ? Math.max(0.04, Math.min(tableTintAlpha, 1 - tableGifClarity * 0.95))
    : tableSheetFullyOpaque
      ? 1
      : tableTintAlpha;
  /** 본문 시트 배경 — 100%일 때 rgb()로 OBS/Prism 합성 투명 이슈 완화 */
  const tableBodySheetBgCss = tableSheetFullyOpaque
    ? `rgb(${tableSheetRgb.join(", ")})`
    : `rgba(${tableSheetRgb.join(", ")}, ${effectiveTableTintAlpha})`;
  /** 미리보기와 동일하게 항상 시트 틴트+colgroup 경로 사용 → 테이블 클래스 배경·테두리는 제거 */
  const effectiveTableCls = stripBorder(stripBg(membersTheme.tableCls));
  // Strip row backgrounds for tinted/GIF sheet; keep header & total bar colors when shown.
  // 행 사이 가로 구분선은 헤더(테두리 없음)와 일관성을 위해 제거 → 순위 없음(—) 행 위·아래가 동일하게 보임.
  const effectiveRowCls = stripBorder(stripBg(stripTextColor(membersTheme.rowCls)));
  const effectiveNameCls = stripTextColor(membersTheme.nameCls);
  const effectiveAccountCls = stripTextColor(membersTheme.accountCls);
  const effectiveToonCls = stripTextColor(membersTheme.toonCls);
  /** 멤버 표 thead: 테마별 색 띠·테두리 없이 텍스트만 (방송 오버레이용) */
  const effectiveHeaderCls = stripBorder(stripBg(stripTextColor(membersTheme.headerCls)));
  const lockWidth = (sp.get("lockWidth") || "false").toLowerCase() === "true";
  const effectiveNameGrow = lockWidth ? false : nameGrow;
  const scaledMainStyle: React.CSSProperties = {};
  const BASE_W = isVertical ? 1080 : 1920;
  const BASE_H = isVertical ? 1920 : 1080;
  const viewportSize = useOverlayViewportSize();
  const mobileBroadcast = isNarrowBroadcastViewport(viewportSize.w, viewportSize.h);
  const mobileCanvasFitScale = useMemo(
    () =>
      mobileBroadcast
        ? computeReadableCanvasScale(BASE_W, BASE_H, viewportSize.w, viewportSize.h, memberSize)
        : 1,
    [mobileBroadcast, BASE_W, BASE_H, viewportSize.w, viewportSize.h, memberSize]
  );
  const responsiveGoalWidth = useMemo(
    () => clampWidthToViewport(goalWidth, viewportSize.w),
    [goalWidth, viewportSize.w]
  );
  const renderW = sp.get("renderWidth") ? parseInt(sp.get("renderWidth")!, 10) : null;
  const renderH = sp.get("renderHeight") ? parseInt(sp.get("renderHeight")!, 10) : null;
  const isPreviewGuide = sp.get("previewGuide") === "true";
  const autoFitParam = externalHost ? rawSp.get("autoFit") : sp.get("autoFit");
  const autoFitRaw = ((autoFitParam || "none").toLowerCase()) as "none" | "width" | "height" | "contain" | "cover";
  const autoFit = stableMode ? "none" : autoFitRaw;
  const zoomModeParam = externalHost ? rawSp.get("zoomMode") : sp.get("zoomMode");
  const zoomMode = (
    (zoomModeParam || (externalHost ? "neutral" : "follow")).toLowerCase() as "follow" | "invert" | "neutral"
  );
  const fitPin = centerFixed ? "cc" : ((sp.get("fitPin") || "cc").toLowerCase() as "cc" | "tl" | "tr" | "bl" | "br" | "tc" | "bc" | "cl" | "cr");
  const showGuide = (sp.get("guide") || "false").toLowerCase() === "true";
  const boxMode = (sp.get("box") || "full").toLowerCase() as "full" | "tight";
  const noCrop = (sp.get("noCrop") || "true").toLowerCase() !== "false";
  const useRenderDims = isPreviewGuide && Number.isFinite(renderW) && Number.isFinite(renderH) && renderW! > 0 && renderH! > 0;
  const [viewportScale, setViewportScale] = useState(1);
  const [containLimitScale, setContainLimitScale] = useState(1);
  const baseViewportRef = useRef<{ w: number; h: number } | null>(null);
  const [centerZoomScale, setCenterZoomScale] = useState(1);
  useEffect(() => {
    if (!centerFixed) { setCenterZoomScale(1); return; }
    // Prism/OBS 등 외부 호스트는 고정 캔버스이며 visualViewport/윈도우 변화에 맞출 필요가 없다.
    // 잦은 scale 갱신이 transform: scale()을 흔들리게 만드는 주요 원인이 됨.
    if (externalHost) { setCenterZoomScale(1); return; }
    if (typeof window === "undefined") return;
    if (!baseViewportRef.current) {
      baseViewportRef.current = { w: window.innerWidth, h: window.innerHeight };
    }
    const update = () => {
      const vv: any = (window as any).visualViewport;
      let s = 1;
      if (vv && typeof vv.scale === "number") {
        s = vv.scale || 1;
      } else {
        const b = baseViewportRef.current!;
        const sx = window.innerWidth / Math.max(1, b.w);
        const sy = window.innerHeight / Math.max(1, b.h);
        s = Math.min(sx, sy);
      }
      const nextScale = Math.max(0.1, Math.min(8, Math.round(s * 1000) / 1000));
      setCenterZoomScale((prev) => (Math.abs(prev - nextScale) < 0.01 ? prev : nextScale));
    };
    update();
    const vv: any = (window as any).visualViewport;
    vv?.addEventListener?.("resize", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener?.("resize", update);
      window.removeEventListener("resize", update);
    };
  }, [centerFixed, externalHost]);
  // 외부 호스트 판단 이후에 미션 옵션을 계산
  const missionAnchor = (externalHost && activePreset?.missionAnchor)
    ? String(activePreset.missionAnchor).toLowerCase()
    : (sp.get("missionAnchor") || "bc").toLowerCase();
  const missionWidth = Math.max(
    400,
    Math.min(
      1600,
      parseInt(
        (externalHost && activePreset?.missionWidth)
          ? String(activePreset.missionWidth)
          : (sp.get("missionWidth") || "800"),
        10,
      ),
    ),
  );
  const missionDuration = Math.max(
    15,
    Math.min(
      60,
      parseInt(
        (externalHost && activePreset?.missionDuration)
          ? String(activePreset.missionDuration)
          : (sp.get("missionDuration") || "25"),
        10,
      ),
    ),
  );
  const missionFontSize = Math.max(
    10,
    Math.min(
      80,
      parseInt(
        (externalHost && activePreset?.missionFontSize)
          ? String(activePreset.missionFontSize)
          : (sp.get("missionFontSize") || "18"),
        10,
      ),
    ),
  );
  const missionBgOpacityCfg = Math.max(
    0,
    Math.min(
      100,
      parseInt(
        (externalHost && activePreset?.missionBgOpacity)
          ? String(activePreset.missionBgOpacity)
          : (sp.get("missionBgOpacity") || "85"),
        10,
      ),
    ),
  );
  const missionBgColorCfg =
    ((externalHost && activePreset?.missionBgColor)
      ? String(activePreset.missionBgColor)
      : (sp.get("missionBgColor") || "")).trim() || undefined;
  const missionItemColorCfg =
    ((externalHost && activePreset?.missionItemColor)
      ? String(activePreset.missionItemColor)
      : (sp.get("missionItemColor") || "")).trim() || undefined;
  const missionTitleColorCfg =
    ((externalHost && activePreset?.missionTitleColor)
      ? String(activePreset.missionTitleColor)
      : (sp.get("missionTitleColor") || "")).trim() || undefined;
  const missionTitleTextCfg =
    ((externalHost && (activePreset as any)?.missionTitleText)
      ? String((activePreset as any).missionTitleText)
      : (sp.get("missionTitleText") || "")).trim() || "MISSION";
  const missionTitleEffectCfg = (
    (externalHost && (activePreset as any)?.missionTitleEffect)
      ? String((activePreset as any).missionTitleEffect)
      : (sp.get("missionTitleEffect") || "none")
  ) as "none" | "blink" | "pulse" | "glow" | "sparkle" | "gradient" | "rainbow" | "shadow";
  const missionEffectCfg = (
    (externalHost && (activePreset as any)?.missionEffect)
      ? String((activePreset as any).missionEffect)
      : (sp.get("missionEffect") || "none")
  ) as "none" | "blink" | "pulse" | "glow";
  const missionEffectHotOnlyCfg = (
    (externalHost && (activePreset as any)?.missionEffectHotOnly)
      ? String((activePreset as any).missionEffectHotOnly) === "true"
      : (sp.get("missionEffectHotOnly") === "true")
  );
  const missionDisplayMode = (externalHost && (activePreset as any)?.missionDisplayMode)
    ? String((activePreset as any).missionDisplayMode)
    : ((sp.get("displayMode") || "horizontal") as "horizontal" | "vertical-slot");
  const missionVisibleCount = Math.max(
    1,
    Math.min(
      6,
      parseInt(
        (externalHost && (activePreset as any)?.missionVisibleCount)
          ? String((activePreset as any).missionVisibleCount)
          : (sp.get("visibleCount") || "3"),
        10,
      ),
    ),
  );
  const missionSpeedSec = Math.max(
    1,
    Math.min(
      120,
      parseFloat(
        (externalHost && (activePreset as any)?.missionSpeed)
          ? String((activePreset as any).missionSpeed)
          : (sp.get("missionSpeed") || (missionDisplayMode === "horizontal" ? "25" : "2")),
      ),
    ),
  );
  const missionGapSizePx = Math.max(
    0,
    Math.min(
      48,
      parseInt(
        (externalHost && (activePreset as any)?.missionGapSize)
          ? String((activePreset as any).missionGapSize)
          : (sp.get("gapSize") || "8"),
        10,
      ),
    ),
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const enableAuto = ((isPreviewGuide && !centerFixed && !(tableFree || (tableXParam !== null && tableYParam !== null))) || autoFit !== "none");
    if (!enableAuto) { setViewportScale(1); return; }
    const update = () => {
      const w = useRenderDims ? renderW! : window.innerWidth;
      const h = useRenderDims ? renderH! : window.innerHeight;
      const sx = w / BASE_W;
      const sy = h / BASE_H;
      let s = 1;
      switch (autoFit) {
        case "width": s = sx; break;
        case "height": s = sy; break;
        case "cover": s = Math.max(sx, sy); break;
        case "contain": s = Math.min(sx, sy); break;
        default: s = Math.min(sx, sy); break;
      }
      s = Math.max(0.1, s);
      setViewportScale(s);
      setContainLimitScale(Math.max(0.1, Math.min(sx, sy)));
    };
    update();
    if (!useRenderDims) {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    return () => {};
  }, [isPreviewGuide, centerFixed, tableFree, tableXParam, tableYParam, autoFit, useRenderDims, renderW, renderH, BASE_W, BASE_H]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [contentW, setContentW] = useState<number>(BASE_W);
  const [contentH, setContentH] = useState<number>(BASE_H);
  const lastContentSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      const last = lastContentSizeRef.current;
      if (
        externalHost &&
        last.w > 0 &&
        Math.abs(w - last.w) < 2 &&
        Math.abs(h - last.h) < 2
      ) {
        return;
      }
      lastContentSizeRef.current = { w, h };
      setContentW(w);
      setContentH(h);
    };
    updateSize();
    const ro = new (window as any).ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [externalHost]);
  const [autoMemberSize, setAutoMemberSize] = useState(memberSize);
  const [autoTotalSize, setAutoTotalSize] = useState(totalSize);
  const [autoDonorSize, setAutoDonorSize] = useState(donorsSize);
  const tableBoxRef = useRef<HTMLDivElement | HTMLTableElement | null>(null);
  /** 멤버 표만 너비 기준으로 자동 폰트 축소(티커 등 형제 폭 제외) */
  const memberTableClampRef = useRef<HTMLDivElement | null>(null);
  const [memberTableFitFactor, setMemberTableFitFactor] = useState(1);
  const memberTableFitPrevRef = useRef(1);
  const [donorBoxWidth, setDonorBoxWidth] = useState<number | null>(null);
  const lastDonorBoxWRef = useRef<number | null>(null);
  const contextualTickerWidth = donorBoxWidth ? Math.max(donorBoxWidth, tickerWidth) : tickerWidth;
  useEffect(() => {
    if (!autoFont) return;
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const width = el.clientWidth || fitBase;
      const factor = width / fitBase;
      const m = Math.round(memberSize * factor);
      const t = Math.round(totalSize * factor);
      const d = Math.round(donorsSize * factor);
      setAutoMemberSize(Math.max(fitMinMember, Math.min(fitMaxMember, m)));
      setAutoTotalSize(Math.max(fitMinMember, Math.min(Math.max(fitMaxMember, 40), t)));
      setAutoDonorSize(Math.max(fitMinMember, Math.min(fitMaxMember, d)));
    };
    update();
    const ro = new (window as any).ResizeObserver(update);
    ro.observe(el);
    return () => { try { ro.disconnect(); } catch {} };
  }, [autoFont, memberSize, totalSize, donorsSize, fitBase, fitMinMember, fitMaxMember]);
  const mSize = autoFont ? autoMemberSize : memberSize;
  const tSize = autoFont ? autoTotalSize : totalSize;
  const dSize = autoFont ? autoDonorSize : donorsSize;

  const members = useMemo(() => {
    if (demoMode) {
      return [
        { id: "demo-1", name: "멤버1", account: 320000, toon: 110000, contribution: 45000, goal: 700000, operating: false },
        { id: "demo-2", name: "멤버2", account: 240000, toon: 90000, contribution: 30000, goal: 650000, operating: false },
        { id: "demo-3", name: "멤버3", account: 170000, toon: 70000, contribution: 15000, goal: 500000, operating: false },
      ] as Member[];
    }
    /** 미리보기 로딩 중 default 멤버1·2·3 폴백 금지 — 테마 변경 시 가짜 목록에 고착되던 원인 */
    return membersRemote;
  }, [demoMode, membersRemote]);
  /** 총합 행: 화면에 그리는 `members` 기준(데모·스냅샷·API 불일치 시 0 방지) */
  const sumAccount = useMemo(
    () => members.reduce((sum, m) => sum + Math.max(0, Number(m.account || 0)), 0),
    [members]
  );
  const sumToon = useMemo(
    () => members.reduce((sum, m) => sum + Math.max(0, Number(m.toon || 0)), 0),
    [members]
  );
  const sumCombined = useMemo(() => sumAccount + sumToon, [sumAccount, sumToon]);
  const rounded = useMemo(() => roundToThousand(sumCombined), [sumCombined]);
  const donors = useMemo(() => {
    if (demoMode) {
      return [
        { id: "d1", name: "후원자A", amount: 120000, memberId: "demo-1", at: Date.now() - 120000, target: "account" },
        { id: "d2", name: "후원자B", amount: 90000, memberId: "demo-2", at: Date.now() - 90000, target: "toon" },
        { id: "d3", name: "후원자C", amount: 70000, memberId: "demo-3", at: Date.now() - 60000, target: "account" },
      ] as Donor[];
    }
    return donorsRemote;
  }, [demoMode, donorsRemote]);
  const personalGoals = useMemo(() => {
    return members
      .filter((m) => (m.goal || 0) > 0)
      .map((m) => {
        const goal = Math.max(0, m.goal || 0);
        const current = Math.max(0, (m.account || 0) + (m.toon || 0));
        const pct = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
        return { id: m.id, name: m.name, current, goal, pct };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, personalGoalLimit);
  }, [members, personalGoalLimit]);
  const liveGoalCurrent = useMemo(
    () => members.reduce((sum, m) => sum + Math.max(0, Number(m.account || 0)) + Math.max(0, Number(m.toon || 0)), 0),
    [members]
  );
  useGoalPresetAutoEscalate({
    enabled:
      !demoMode &&
      !isPreviewGuide &&
      !snap &&
      goal > 0 &&
      Boolean(activePreset?.id),
    userId,
    presetId: activePreset?.id ?? null,
    activePreset,
    goalAmount: goal,
    liveTotal: liveGoalCurrent,
    overlayPresets,
    skipPersist: !ready,
  });
  const resolvedMemberRoles = useMemo<Record<string, string>>(() => {
    if (memberPositionMode !== "rankLinked") return memberPositionsMap;
    const roleMap: Record<string, string> = {};
    const representative = members.find((m) => (memberPositionsMap[m.id] || "").trim() === "대표") || null;
    const orderIndex = buildMemberCreationOrderIndex(members);
    const others = members
      .filter((m) => !representative || m.id !== representative.id)
      .sort((a, b) => compareMembersByDonationTotal(a, b, orderIndex));
    if (representative) roleMap[representative.id] = "대표";
    const startIdx = representative ? 1 : 0;
    others.forEach((m, idx) => {
      const rankIdx = idx + startIdx;
      const label = String(rankPositionLabels[rankIdx] || "").trim() || (rankIdx === 0 ? "대표" : "");
      if (label) roleMap[m.id] = label;
    });
    return roleMap;
  }, [memberPositionMode, memberPositionsMap, members, rankPositionLabels]);
  const getMemberRole = useCallback((m: Member) => resolvedMemberRoles[m.id] || "", [resolvedMemberRoles]);
  const pinnedFilter = useCallback(
    (m: Member) => Boolean(m.operating) || /운영비/i.test(m.name) || /운영비/i.test(getMemberRole(m)),
    [getMemberRole]
  );
  /**
   * 기여도 숫자: 저장된 contribution 우선.
   * 기본 공식(100/100)이고 값이 0인데 계좌+투네 합이 있으면 레거시 폴백.
   * 가중치 공식이면 account+toon 폴백 금지.
   */
  const allowContributionTotalFallback = isDefaultContributionFormula(s?.contributionFormula);
  const getContributionValueForMember = useCallback((m: Member) => {
    const raw = (m as Member & { contribution?: unknown }).contribution;
    let parsed = typeof raw === "number" ? raw : Number(typeof raw === "string" ? String(raw).replace(/,/g, "").trim() : raw);
    const total = Math.max(0, Number(m.account || 0) + Number(m.toon || 0));
    if (!Number.isFinite(parsed)) return allowContributionTotalFallback ? total : 0;
    const c = Math.max(0, Math.floor(parsed));
    if (allowContributionTotalFallback && c === 0 && total > 0) return total;
    return c;
  }, [allowContributionTotalFallback]);
  const getRestroomValueForMember = useCallback((m: Member) => {
    return normalizeRestroomCount((m as Member & { restroom?: unknown }).restroom);
  }, []);
  const fmtRestroom = useCallback((n: number) => formatRestroomDisplay(n), []);
  /** 운영비(핀) 제외 멤버 기여도 합 — 총합 행과 정산 분배 기준에 맞춤 */
  const sumContribution = useMemo(
    () =>
      members
        .filter((m) => !pinnedFilter(m))
        .reduce((sum, m) => sum + getContributionValueForMember(m), 0),
    [members, pinnedFilter, getContributionValueForMember]
  );
  /** 실제 표시 문자열 길이에 맞춰 숫자 열 `ch` 하한을 올림(표 전체 폭은 고정·셀 overflow visible) */
  const amountDisplayMinCh = useMemo(() => {
    if (!showMembers) return 0;
    const amounts: number[] = [];
    for (const m of members) {
      amounts.push(
        Number(m.account || 0),
        Number(m.toon || 0),
        Number(m.account || 0) + Number(m.toon || 0),
        getContributionValueForMember(m)
      );
      if (showRestroomColumn) {
        const rv = getRestroomValueForMember(m);
        amounts.push(isRestroomUnlimited(rv) ? 1 : rv);
      }
    }
    if (ready) {
      amounts.push(sumAccount, sumToon, rounded, sumContribution);
    }
    const maxLen = maxOverlayAmountDisplayLength(amounts, donorsFormat, currencyLocale);
    /** 아웃라인·백만원대에서 이름 열과 붙지 않게 ch 여유 */
    const outlinePad = (tableTextOutlineWidthPx ?? 0) > 1 ? 2 : 1;
    const millionPad = amounts.some((a) => a >= 1_000_000) ? 2 : 0;
    return maxLen > 0 ? maxLen + 1 + outlinePad + millionPad : 0;
  }, [
    showMembers,
    members,
    donorsFormat,
    currencyLocale,
    ready,
    sumAccount,
    sumToon,
    rounded,
    sumContribution,
    getContributionValueForMember,
    getRestroomValueForMember,
    showRestroomColumn,
    tableTextOutlineWidthPx,
  ]);
  const bankCh = Math.max(8, Math.min(24, Math.max(bankChBase, amountDisplayMinCh)));
  const toonCh = Math.max(8, Math.min(24, Math.max(toonChBase, amountDisplayMinCh)));
  const totalCh = Math.max(6, Math.min(22, Math.max(totalChBase, amountDisplayMinCh)));
  const contributionCh = Math.max(11, Math.min(24, Math.max(contributionChBase, amountDisplayMinCh)));
  const restroomCh = Math.max(5, Math.min(12, Math.max(restroomChBase, showRestroomColumn ? 3 : 0)));
  useEffect(() => {
    const el = tableBoxRef.current;
    if (!el) return;
    const update = () => {
      const raw = Math.round(el.getBoundingClientRect().width);
      const prev = lastDonorBoxWRef.current;
      if (externalHost && prev !== null && Math.abs(raw - prev) < 2) return;
      lastDonorBoxWRef.current = raw;
      setDonorBoxWidth(raw);
    };
    update();
    const ro = new (window as any).ResizeObserver(update);
    ro.observe(el);
    return () => { try { ro.disconnect(); } catch {} };
  }, [showMembers, themeId, mSize, nameCh, bankCh, toonCh, totalCh, lockWidth, effectiveNameGrow, externalHost]);
  const showPersonalGoal = useMemo(() => {
    const raw = sp.get("showPersonalGoal");
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (timerOnlyMode) return false;
    const presetHas = typeof (activePreset as any)?.showPersonalGoal === "boolean";
    if (presetHas) return Boolean((activePreset as any).showPersonalGoal);
    if (isPreviewGuide || externalHost) return true;
    if (effectiveTableOnly) return false;
    return personalGoals.length > 0;
  }, [sp, timerOnlyMode, effectiveTableOnly, activePreset, personalGoals.length, isPreviewGuide, externalHost]);
  const fallbackShowGoal =
    !showMembers &&
    !showTotal &&
    !showGoal &&
    !showPersonalGoal &&
    !showTimer &&
    !showMission &&
    goal > 0;

  const unpinned = useMemo(() => members.filter((m) => !pinnedFilter(m)), [members, pinnedFilter]);
  const pinned = useMemo(() => members.filter(pinnedFilter), [members, pinnedFilter]);
  /** 운영비 행은 순위·기여도 표시 규칙만 다르게 하고, URL/프리셋 옵션과 무관하게 항상 표에 포함한다. */
  const visiblePinned = pinned;
  const hasRoleColumn = useMemo(
    () => members.some((m) => getMemberRole(m).trim().length > 0),
    [members, getMemberRole]
  );
  const ranked = useMemo(
    () => buildOverlayRankedMembers(unpinned, memberPositionsMap, getMemberRole, members),
    [unpinned, memberPositionsMap, getMemberRole, members]
  );
  /**
   * 엑셀표 인원 변동 대응:
   * - 5명 이하: 우측 스플릿 제거(단일 패널)
   * - 6명 이상: "원래(처음 스플릿 시점) 좌측 슬롯 수"를 유지하고,
   *   우측부터 멤버가 빠지는 것처럼 보이도록 부족한 칸은 placeholder 행으로 채움.
   */
  const excelSplitKeepLeftCountRef = useRef<number | null>(null);
  const excelSplitEnabled = ranked.length > OVERLAY_HALF_SPLIT_MIN_COUNT;
  const excelDesiredLeftCount = Math.ceil(ranked.length / 2);
  if (!excelSplitEnabled) {
    excelSplitKeepLeftCountRef.current = null;
  } else {
    const prev = excelSplitKeepLeftCountRef.current;
    excelSplitKeepLeftCountRef.current = prev == null ? excelDesiredLeftCount : Math.max(prev, excelDesiredLeftCount);
  }
  const excelLeftCount = excelSplitKeepLeftCountRef.current ?? excelDesiredLeftCount;
  const excelRightTargetCount = excelLeftCount;

  const excelPlaceholderMember: Member = { id: "__excel_placeholder__", name: "", account: 0, toon: 0, operating: false };
  const excelMakePlaceholderRows = (n: number) =>
    Array.from({ length: Math.max(0, n) }).map((_, idx) => ({
      m: { ...excelPlaceholderMember, id: `${excelPlaceholderMember.id}_${idx}` },
      rank: null as number | null,
      __excelPlaceholder: true,
    }));

  const memberTablePanels = !excelSplitEnabled
    ? [{ key: "single", ranked, includePinned: true, includeTotal: true }]
    : [
        {
          key: "left",
          ranked: [
            ...ranked.slice(0, excelLeftCount),
            ...excelMakePlaceholderRows(Math.max(0, excelLeftCount - ranked.slice(0, excelLeftCount).length)),
          ] as any,
          includePinned: false,
          includeTotal: false,
        },
        {
          key: "right",
          ranked: [
            ...ranked.slice(excelLeftCount),
            ...excelMakePlaceholderRows(Math.max(0, excelRightTargetCount - ranked.slice(excelLeftCount).length)),
          ] as any,
          includePinned: true,
          includeTotal: true,
        },
      ];

  const memberTableFitSig = useMemo(() => {
    /** 직급 열 너비(`roleColEm`)와 동일 — CJK는 `ch`보다 `em`이 안전 */
    const roleColFit = Math.max(
      5,
      Math.min(
        10,
        members.reduce((max, m) => {
          const len = getMemberRole(m).length;
          return Math.max(max, len > 0 ? len * 1.25 + 2.6 : 5);
        }, 5)
      )
    );
    const cols = hasRoleColumn
      ? `${rankColCh}|${roleColFit}|${nameCh}|${bankCh}|${toonCh}|${totalCh}|${contributionCh}${showRestroomColumn ? `|${restroomCh}` : ""}`
      : `${rankColCh}|${nameCh}|${bankCh}|${toonCh}|${totalCh}|${contributionCh}${showRestroomColumn ? `|${restroomCh}` : ""}`;
    const rows = ranked
      .map(({ m }) =>
        `${m.account}|${m.toon}|${getContributionValueForMember(m)}${showRestroomColumn ? `|${getRestroomValueForMember(m)}` : ""}`
      )
      .join(";");
    const pinRows = visiblePinned.map((m) => `${m.account}|${m.toon}|0`).join(";");
    return `${cols}#${rows}~${pinRows}`;
  }, [
    ranked,
    visiblePinned,
    hasRoleColumn,
    nameCh,
    bankCh,
    toonCh,
    totalCh,
    contributionCh,
    restroomCh,
    showRestroomColumn,
    getRestroomValueForMember,
    rankColCh,
    members,
    getMemberRole,
    getContributionValueForMember,
  ]);

  /**
   * 순위·숫자 피드백(row FLIP, 행 플래시, 카운트업):
   * - 기본 ON (2인 이상 unpinned)
   * - OBS에서도 externalSafeMode와 별개 — URL `rowMotion=false`로만 끔
   */
  const rowMotionParamRaw = rawSp.get("rowMotion");
  const rowMotionParam = externalHost ? rowMotionParamRaw : sp.get("rowMotion");
  const rowMotionExplicit =
    rowMotionParam !== null && String(rowMotionParam).trim() !== "";
  const rowMotionRequested =
    !stableMode &&
    (rowMotionExplicit
      ? String(rowMotionParam).toLowerCase() === "true"
      : true);
  const rowMotionEnabled = rowMotionRequested && unpinned.length > 1;

  /** URL에 memberSize가 있거나 tableFit=off → 관리자가 지정한 px를 OBS에서도 그대로 쓰기 */
  const lockMemberTableFontSize = useMemo(() => {
    const fitRaw = (rawSp.get("tableFit") || "").trim().toLowerCase();
    if (fitRaw === "off" || fitRaw === "false" || fitRaw === "0") return true;
    const ms = (rawSp.get("memberSize") || "").trim();
    return ms.length > 0 && Number.isFinite(parseInt(ms, 10));
  }, [rawSp]);

  useLayoutEffect(() => {
    if (!showMembers) return;
    if (lockMemberTableFontSize) {
      if (memberTableFitPrevRef.current !== 1) {
        memberTableFitPrevRef.current = 1;
        setMemberTableFitFactor(1);
      }
      return;
    }
    if (externalSafeMode) {
      // OBS/Prism 하드 고정 모드: 프레임 범위 내에 표 전체가 들어오도록 1회(및 리사이즈 시) 고정 비율만 계산
      const clampEl = memberTableClampRef.current;
      const table = tableBoxRef.current as HTMLTableElement | null;
      if (!clampEl || !table) return;
      const updateSafeFit = () => {
        const padStyle = getComputedStyle(clampEl);
        const padX =
          (parseFloat(padStyle.paddingLeft) || 0) + (parseFloat(padStyle.paddingRight) || 0);
        const avail = Math.max(0, clampEl.clientWidth - padX);
        if (avail < 8) return;
        const prevMax = table.style.maxWidth;
        const prevInlineFont = table.style.fontSize;
        try {
          table.style.maxWidth = "none";
          table.style.fontSize = `${mSize}px`;
          void table.offsetWidth;
          const measured = Math.max(table.scrollWidth, table.getBoundingClientRect().width);
          if (!Number.isFinite(measured) || measured <= 0) return;
          // 마지막 열 클리핑 방지를 위해 10px 안전 여유를 둔다.
          const raw = (avail - 10) / measured;
          const safeFitMin = mobileBroadcast ? 0.58 : 0.75;
          const next = Math.max(safeFitMin, Math.min(1, Math.floor(raw * 100) / 100));
          if (Math.abs(next - memberTableFitPrevRef.current) < 0.005) return;
          memberTableFitPrevRef.current = next;
          setMemberTableFitFactor(next);
        } finally {
          table.style.maxWidth = prevMax;
          if (prevInlineFont) table.style.fontSize = prevInlineFont;
          else table.style.removeProperty("font-size");
        }
      };
      updateSafeFit();
      const ro = new ResizeObserver(() => updateSafeFit());
      ro.observe(clampEl);
      return () => ro.disconnect();
    }
    const clampEl = memberTableClampRef.current;
    const table = tableBoxRef.current as HTMLTableElement | null;
    if (!clampEl || !table) return;

    const run = () => {
      const padStyle = getComputedStyle(clampEl);
      const padX =
        (parseFloat(padStyle.paddingLeft) || 0) + (parseFloat(padStyle.paddingRight) || 0);
      const avail = Math.max(0, clampEl.clientWidth - padX);
      if (avail < 8) return;
      /** `maxWidth:100%`로 테이블이 눌리면 scrollWidth≈clientWidth가 되어 축소 탐색이 무력화됨 → 측정 중만 해제 */
      const prevMax = table.style.maxWidth;
      table.style.maxWidth = "none";
      let lo = 0.08;
      let hi = 1;
      let best = lo;
      const minPx = 4;
      /** 헤더 text-stroke·그림자가 scrollWidth 밖으로 살짝 나가는 여유(마지막 열 잘림 방지) */
      const widthMarginPx = 36;
      const maxAvail = Math.max(4, avail - widthMarginPx);
      const measureWidth = () => {
        const rectW = table.getBoundingClientRect().width;
        return Math.max(table.scrollWidth, rectW);
      };
      try {
        for (let i = 0; i < 22; i++) {
          const mid = (lo + hi) / 2;
          const fs = Math.max(minPx, Math.round(mSize * mid));
          table.style.fontSize = `${fs}px`;
          void table.offsetWidth;
          if (measureWidth() <= maxAvail) {
            best = mid;
            lo = mid;
          } else {
            hi = mid;
          }
        }
        /**
         * 이진 탐색 하한에서도 간헐적으로 1~2px 넘는 경우(브라우저 반올림/스트로크)에 대비한 최종 안전 보정.
         * 범위 내 완전 포함을 우선한다.
         */
        let guard = 0;
        while (guard < 8) {
          const fs = Math.max(minPx, Math.floor(mSize * best));
          table.style.fontSize = `${fs}px`;
          void table.offsetWidth;
          if (measureWidth() <= maxAvail) break;
          best = Math.max(0.04, best - 0.02);
          guard += 1;
        }
      } finally {
        table.style.maxWidth = prevMax;
        table.style.removeProperty("font-size");
      }
      const prevFit = memberTableFitPrevRef.current;
      if (Math.abs(best - prevFit) < 0.008) return;
      memberTableFitPrevRef.current = best;
      setMemberTableFitFactor(best);
    };

    run();
    const ro = new ResizeObserver(() => run());
    ro.observe(clampEl);
    return () => {
      ro.disconnect();
      try {
        table.style.removeProperty("font-size");
      } catch {
        /* noop */
      }
    };
  }, [showMembers, mSize, memberTableFitSig, externalSafeMode, lockMemberTableFontSize, mobileBroadcast]);

  const allOrderKeys = [...ranked.map(({ m }) => m.id), ...visiblePinned.map((m) => `${m.id}-p`)];
  const setRowRef = useFlip(allOrderKeys, 500, rowMotionEnabled);

  const prevTotalsRef = useRef<Map<string, number>>(new Map());
  const [changedIds, setChangedIds] = useState<Set<string>>(new Set());
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (!rowMotionEnabled) {
      prevTotalsRef.current = new Map(
        members.map((m) => [m.id, (m.account || 0) + (m.toon || 0)])
      );
      setChangedIds(new Set());
      isInitialMount.current = false;
      return;
    }
    const next = new Map<string, number>();
    const changed = new Set<string>();
    for (const m of members) {
      const total = (m.account || 0) + (m.toon || 0);
      const prev = prevTotalsRef.current.get(m.id);
      next.set(m.id, total);
      if (!isInitialMount.current && prev !== undefined && prev !== total) {
        changed.add(m.id);
      }
    }
    isInitialMount.current = false;
    prevTotalsRef.current = next;
    if (changed.size > 0) {
      setChangedIds(changed);
      const t = setTimeout(() => setChangedIds(new Set()), 800);
      return () => clearTimeout(t);
    }
  }, [members, rowMotionEnabled]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("overlay-page");
    body.classList.add("overlay-page");
    html.style.background = "transparent";
    body.style.background = "transparent";
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.margin = "0";
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    html.style.height = "100%";
    body.style.height = "100%";
    html.style.width = "100%";
    body.style.width = "100%";
    return () => {
      html.classList.remove("overlay-page");
      body.classList.remove("overlay-page");
      html.style.background = "";
      body.style.background = "";
      html.style.overflow = "";
      body.style.overflow = "";
      body.style.margin = "";
      html.style.overscrollBehavior = "";
      body.style.overscrollBehavior = "";
      html.style.height = "";
      body.style.height = "";
      html.style.width = "";
      body.style.width = "";
      body.classList.remove("overlay-vertical");
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isVertical) document.body.classList.add("overlay-vertical");
    else document.body.classList.remove("overlay-vertical");
    return () => document.body.classList.remove("overlay-vertical");
  }, [isVertical]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (mobileBroadcast) document.body.classList.add("overlay-mobile-broadcast");
    else document.body.classList.remove("overlay-mobile-broadcast");
    return () => document.body.classList.remove("overlay-mobile-broadcast");
  }, [mobileBroadcast]);

  const confettiLastMilestoneRef = useRef<number>(0);
  useEffect(() => {
    if (confettiMilestoneMan <= 0) return;
    const milestoneWon = confettiMilestoneMan * 10000;
    const curr = Math.floor(rounded / milestoneWon);
    const prev = confettiLastMilestoneRef.current;
    if (curr > prev && prev >= 0) {
      confettiLastMilestoneRef.current = curr;
      import("canvas-confetti").then(({ default: confetti }) => {
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
      });
    } else if (curr >= 0) {
      confettiLastMilestoneRef.current = curr;
    }
  }, [rounded, confettiMilestoneMan]);

  const posClass = (a: string) =>
    a === "cc" || a === "center" ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" :
    a === "tr" ? "top-4 right-4" :
    a === "bl" ? "bottom-4 left-4" :
    a === "br" ? "bottom-4 right-4" :
    a === "tc" ? "top-4 left-1/2 -translate-x-1/2" :
    a === "bc" ? "bottom-4 left-1/2 -translate-x-1/2" :
    "top-4 left-4";

  const listPosStyle: React.CSSProperties | undefined = hasTableFreePos
    ? { left: `${parsePct(tableXParam, 50)}%`, top: `${parsePct(tableYParam, 50)}%`, transform: "translate(-50%, -50%)" }
    : {
        marginTop: tableMarginTop,
        marginRight: tableMarginRight,
        marginBottom: tableMarginBottom,
        marginLeft: tableMarginLeft,
      };
  const listPosClass =
    centerFixed || previewGuide || hasTableFreePos ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" :
    anchor === "cc" || anchor === "center" ? "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" :
    anchor === "tc" ? "top-0 left-1/2 -translate-x-1/2" :
    anchor === "bc" ? "bottom-0 left-1/2 -translate-x-1/2" :
    anchor === "tr" ? "top-0 right-0 items-end text-right" :
    anchor === "bl" ? "bottom-0 left-0" :
    anchor === "br" ? "bottom-0 right-0 items-end text-right" :
    "left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2";

  const sumPosStyle: React.CSSProperties | undefined = hasFreePos
    ? { left: `${sumX}%`, top: `${sumY}%`, transform: "translate(-50%, -50%)" }
    : undefined;
  const sumPosClass = hasFreePos ? "" : posClass(sumAnchor);
  const personalGoalPosClass = posClass(personalGoalAnchor);
  const renderPersonalGoal = () => {
    const content = (
      <>
        <PersonalGoalBoard items={personalGoals} themeId={personalGoalTheme} fontSize={memberSize} />
      </>
    );
    if (hasPersonalGoalFreePos) {
      return (
        <div className="absolute inset-0 pointer-events-none z-[9985]">
          <div className="absolute pointer-events-auto" style={{ left: `${personalGoalX}%`, top: `${personalGoalY}%`, transform: "translate(-50%, -50%)" }}>
            {content}
          </div>
        </div>
      );
    }
    return <div className={`absolute ${personalGoalPosClass} z-[9985]`}>{content}</div>;
  };
  const responsiveTickerWidth = fitWidthToViewport(tickerWidth);
  const tickerPosStyle: React.CSSProperties | undefined = hasTickerFreePos
    ? { left: `${tickerX}%`, top: `${tickerY}%`, transform: "translate(-50%, -50%)", width: responsiveTickerWidth }
    : { width: responsiveTickerWidth };
  const tickerPosClass = hasTickerFreePos ? "" : posClass(tickerAnchor);

    /** 직급: `ch`는 한글 글자 폭과 어긋나 「대표」 둘째 글자가 잘려 작아 보일 수 있음 → `em` 사용 */
    const roleColEm = Math.max(
      5,
      Math.min(
        10,
        members.reduce((max, m) => {
          const len = getMemberRole(m).length;
          return Math.max(max, len > 0 ? len * 1.25 + 2.6 : 5);
        }, 5)
      )
    );
    const excelGridCols = [
      `${rankColCh}ch`,
      ...(hasRoleColumn ? [`${roleColEm}em`] : []),
      `${nameCh}ch`,
      `${bankCh}ch`,
      `${toonCh}ch`,
      ...(showCombinedColumn ? [`${totalCh}ch`] : []),
      ...(showContributionColumn ? [`${contributionCh}ch`] : []),
      ...(showRestroomColumn ? [`${restroomCh}ch`] : []),
    ];
    /** 숫자 자리 증가로 표 전체가 밀려 나가지 않도록 너비 상한 고정 */
    const excelTableWidthCalc = excelGridCols.join(" + ");
    const isExcelLiveTheme = membersThemeId === "excelLive";
    const isExcelGoldChrome = isExcelGoldTableTheme(membersThemeId);
    const tableHeaderLineColor =
      tableLineColorRaw ||
      excelMemberAccent?.headerBorder ||
      resolveTableThemePanelBorderCss(membersThemeId) ||
      TABLE_BROADCAST_PANEL_BORDER;
    const tableTotalLineColor =
      tableLineColorRaw ||
      excelMemberAccent?.totalRowBorder ||
      resolveTableThemeTotalBorderCss(membersThemeId);
    const tableGridLineWidthPx = overlayTableGridLineWidthPx(Boolean(externalHost));
    const tableGridLineColor = tableLineColorRaw || tableHeaderLineColor;
    const tablePanelShadow = isExcelGoldChrome
      ? "none"
      : tableGridLines
        ? excelMemberAccent?.panelShadow ?? TABLE_BROADCAST_PANEL_SHADOW
        : "none";
    const tableRowEvenBgCss =
      tableRowEvenBgRaw || resolveTableThemeRowStripeCss(membersThemeId, "even");
    const tableRowOddBgCss =
      tableRowOddBgRaw || resolveTableThemeRowStripeCss(membersThemeId, "odd");
    const contributionColorCss =
      contributionColorRaw ||
      excelMemberAccent?.contributionColor ||
      resolveTableThemeContributionColorCss(membersThemeId);
    const excelGoldRankChrome =
      isExcelGoldChrome && !isExcelRankTop3TextMode(excelRankTop3Style.mode);
    const tablePanelBorderCss =
      tablePanelBorderColorRaw ||
      excelMemberAccent?.panelBorder ||
      tableLineColorRaw ||
      "";
    const excelZebraEnabled =
      Boolean(excelMemberAccent) &&
      Boolean(tableRowOddBgCss && tableRowOddBgCss !== "transparent");
    const excelMemberTableClass = excelMemberAccent
      ? `${isExcelLiveTheme ? " excel-live-table" : " excel-member-table"}${isExcelGoldChrome ? " excel-gold-table" : ""}${excelZebraEnabled ? " excel-zebra-table" : ""}`
      : "";
    const themeAutoHeaderBgCss = resolveTableThemeHeaderBgCss(membersThemeId);
    const excelHeaderBgCss = hasTableHeaderBgColorOverride
      ? applyAlphaToCssColor(tableHeaderBgColorRaw, effectiveTableTintAlpha)
      : isExcelGoldChrome
        ? themeAutoHeaderBgCss
        : applyAlphaToCssColor(themeAutoHeaderBgCss, effectiveTableTintAlpha);
    const excelHeaderTextCss =
      tableHeaderTextColorRaw ||
      excelMemberAccent?.headerText ||
      TABLE_BROADCAST_TEXT_AUTO;
    const excelMemberTableStyle: React.CSSProperties | undefined = excelMemberAccent
      ? {
          ["--excel-header-bg" as string]: excelHeaderBgCss,
          ["--excel-header-text" as string]: excelHeaderTextCss,
          ["--excel-header-border" as string]: tableHeaderLineColor,
          ["--excel-total-border" as string]: tableTotalLineColor,
          ...(excelZebraEnabled
            ? {
                ["--excel-row-even" as string]: tableRowEvenBgCss,
                ["--excel-row-odd" as string]: tableRowOddBgCss,
              }
            : {}),
        }
      : undefined;
    const excelLiveTotalRowBg = tableBgColorRaw
      ? applyAlphaToCssColor(
          `rgb(${tableSheetRgb.map((c) => Math.max(0, Math.min(255, Math.round(c * 0.97)))).join(", ")})`,
          effectiveTableTintAlpha
        )
      : applyAlphaToCssColor("rgb(15, 20, 30)", effectiveTableTintAlpha);
    const broadcastTheadBg = hasTableHeaderBgColorOverride
      ? applyAlphaToCssColor(tableHeaderBgColorRaw, effectiveTableTintAlpha)
      : applyAlphaToCssColor(themeAutoHeaderBgCss, effectiveTableTintAlpha);
    const broadcastTheadTextCss = tableHeaderTextColorRaw || TABLE_BROADCAST_TEXT_AUTO;
    let effectiveScale = centerFixed || hasTableFreePos
      ? (scale * (zoomMode === "neutral" ? 1 : (zoomMode === "invert" ? (1 / centerZoomScale) : centerZoomScale)))
      : (externalHost ? scale : (viewportScale * scale));
    if (mobileCanvasFitScale < 0.999) {
      effectiveScale *= mobileCanvasFitScale;
    }
    if (noCrop && !hasExplicitScale) {
      effectiveScale = Math.min(effectiveScale, containLimitScale);
    }
    const justify =
      externalHost ? "center" :
      centerFixed ? "center" :
      fitPin === "tl" || fitPin === "cl" || fitPin === "bl" ? "flex-start" :
      fitPin === "tr" || fitPin === "cr" || fitPin === "br" ? "flex-end" :
      "center";
    const align =
      externalHost ? "center" :
      centerFixed ? "center" :
      fitPin === "tl" || fitPin === "tc" || fitPin === "tr" ? "flex-start" :
      fitPin === "bl" || fitPin === "bc" || fitPin === "br" ? "flex-end" :
      "center";
    const FIT_W = boxMode === "tight" ? Math.max(1, contentW) : BASE_W;
    const FIT_H = boxMode === "tight" ? Math.max(1, contentH) : BASE_H;
    const viewportWrapperStyle: React.CSSProperties = {
      position: "fixed",
      inset: 0,
      overflow: "hidden",
      display: "flex",
      alignItems: align as any,
      justifyContent: justify as any,
      width: "100%",
      height: "100%",
      background: "transparent",
    };
    const viewportInnerStyle: React.CSSProperties = {
      position: "relative",
      width: (centerFixed || externalHost) ? BASE_W : FIT_W,
      height: (centerFixed || externalHost) ? BASE_H : FIT_H,
      flexShrink: 0,
    };
    const origin = centerFixed ? "center center" :
      fitPin === "tl" ? "left top" :
      fitPin === "tr" ? "right top" :
      fitPin === "bl" ? "left bottom" :
      fitPin === "br" ? "right bottom" :
      fitPin === "tc" ? "center top" :
      fitPin === "bc" ? "center bottom" :
      fitPin === "cl" ? "left center" :
      fitPin === "cr" ? "right center" :
      "center center";
    const freezeScaleInExternalHost =
      mobileCanvasFitScale >= 0.999 &&
      (externalSafeMode ||
        (externalHost &&
          !hasExplicitScale &&
          Math.abs(effectiveScale - 1) < 0.02));
    const scaleCss = Number.isFinite(effectiveScale)
      ? snapOverlayScaleForCrispLines(Number(effectiveScale))
      : 1;
    const scaleTransform = `scale(${scaleCss})`;
    const scaleStyleTag = freezeScaleInExternalHost
      ? null
      : (
        <style dangerouslySetInnerHTML={{ __html: `
          .overlay-scale-target {
            transform: ${scaleTransform} !important;
            -webkit-transform: ${scaleTransform} !important;
            transform-origin: ${origin} !important;
            -webkit-font-smoothing: antialiased;
            text-rendering: geometricPrecision;
          }
        ` }} />
      );
    const nameWrapCls = "truncate";
    const tfTable = memberTableFitFactor;
    const mobileMinFontPx = mobileBroadcast ? 17 : externalHost ? 15 : 8;
    let memberFontPx = Math.max(mobileMinFontPx, Math.round(mSize * tfTable));
    if (mobileBroadcast && mobileCanvasFitScale < 0.999) {
      memberFontPx = ensureCanvasFontPx(memberFontPx, mobileCanvasFitScale, mobileMinFontPx);
    }
    const mobileReadableOutline = mobileBroadcast;
    const tableRowPadY = Math.round(memberFontPx * 0.42);
    const tableRowPadX = Math.round(memberFontPx * 0.48);
    const tableRowMinH = Math.round(memberFontPx * 1.78);
    const tableOutlineDisabled = tableTextOutlineWidthPx === 0;
    const resolvedTableOutlineColor =
      tableTextOutlineColor || DEFAULT_OVERLAY_TEXT_OUTLINE_COLOR;
    const outlineSharp = Boolean(overlayTextSharpRender || externalHost);
    /**
     * OBS CEF에서 -webkit-text-stroke 는 가장/스케일과 겹치면 뭉개져 보임.
     * 선명 모드여도 stroke는 끄고, blur 없는 shadow 링만 사용(관리자 프리뷰와 동일 선명도).
     */
    const obsStrokeDisabled = externalSafeMode;
    const tableBroadcastOutline = buildBroadcastTextOutlineStyle({
      fontSizePx: memberFontPx,
      outlineColor: resolvedTableOutlineColor,
      outlineWidthPx: tableTextOutlineWidthPx,
      sharp: outlineSharp,
    });
    const tableOutlineShadowCss = tableOutlineDisabled
      ? "none"
      : buildBroadcastTextOutlineShadowCss({
          outlineColor: resolvedTableOutlineColor,
          outlineWidthPx: tableTextOutlineWidthPx,
          sharp: outlineSharp,
        }) ||
        String(
          tableBroadcastOutline.textShadow ||
            (tableTextIsLight ? TABLE_TEXT_OUTLINE_LIGHT_ON_DARK : TABLE_TEXT_OUTLINE_DARK_ON_LIGHT)
        );
    const tableHeaderOutlineDisabled = tableHeaderTextOutlineWidthPx === 0;
    const resolvedTableHeaderOutlineColor =
      tableHeaderTextOutlineColor || resolvedTableOutlineColor;
    const tableHeaderBroadcastOutline = buildBroadcastTextOutlineStyle({
      fontSizePx: memberFontPx,
      outlineColor: resolvedTableHeaderOutlineColor,
      outlineWidthPx: tableHeaderTextOutlineWidthPx,
      sharp: outlineSharp,
    });
    const tableHeaderOutlineShadowCss = tableHeaderOutlineDisabled
      ? "none"
      : buildBroadcastTextOutlineShadowCss({
          outlineColor: resolvedTableHeaderOutlineColor,
          outlineWidthPx: tableHeaderTextOutlineWidthPx,
          sharp: outlineSharp,
        }) ||
        String(
          tableHeaderBroadcastOutline.textShadow ||
            (tableTextIsLight ? TABLE_TEXT_OUTLINE_LIGHT_ON_DARK : TABLE_TEXT_OUTLINE_DARK_ON_LIGHT)
        );
    const tableHeaderStrokeCss = obsStrokeDisabled
      ? "0"
      : String(tableHeaderBroadcastOutline.WebkitTextStroke || "0");
    const excelTheadTextShadow = tableHeaderOutlineShadowCss;
    const excelTheadStroke = tableHeaderOutlineDisabled ? "0" : tableHeaderStrokeCss;
    const tableNumericOutlineShadowCss = tableOutlineShadowCss;
    const tableStrokeCss = obsStrokeDisabled
      ? "0"
      : String(tableBroadcastOutline.WebkitTextStroke || tableBodyTextStroke || "0");
    const tableTextRenderingCss =
      outlineSharp || !externalHost ? "geometricPrecision" : "auto";
    const broadcastTheadCss = useBroadcastTableChrome
      ? `
        .overlay-root .overlay-elegant-table thead td {
          background: ${broadcastTheadBg} !important;
          color: ${broadcastTheadTextCss} !important;
          font-weight: ${tableHeaderFontWeight} !important;
          text-shadow: ${tableOutlineShadowCss} !important;
          -webkit-text-stroke: ${tableStrokeCss} !important;
          paint-order: stroke fill;
          border: none !important;
          box-shadow: ${
            tableGridLines
              ? overlayTableHairlineShadow(tableHeaderLineColor, { bottom: true }, tableGridLineWidthPx)
              : "none"
          } !important;
        }
        .overlay-root .overlay-elegant-table thead td.overlay-col-rank,
        .overlay-root .overlay-elegant-table thead td.overlay-col-role,
        .overlay-root .overlay-elegant-table thead td.overlay-col-name,
        .overlay-root .overlay-elegant-table thead td.overlay-col-account,
        .overlay-root .overlay-elegant-table thead td.overlay-col-toon,
        .overlay-root .overlay-elegant-table thead td.overlay-col-total,
        .overlay-root .overlay-elegant-table thead td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table thead td.overlay-col-restroom {
          background: ${broadcastTheadBg} !important;
          color: ${broadcastTheadTextCss} !important;
        }
        .overlay-root .overlay-elegant-table thead td span,
        .overlay-root .overlay-elegant-table thead td strong {
          color: ${broadcastTheadTextCss} !important;
        }
        .overlay-root .overlay-elegant-table .overlay-total-row td {
          border: none !important;
          box-shadow: ${
            tableGridLines
              ? overlayTableHairlineShadow(tableTotalLineColor, { top: true }, tableGridLineWidthPx)
              : "none"
          } !important;
        }`
      : `
        .overlay-root .overlay-elegant-table.excel-member-table thead td,
        .overlay-root .overlay-elegant-table.excel-live-table thead td {
          background: var(--excel-header-bg) !important;
          color: var(--excel-header-text) !important;
          font-weight: ${tableHeaderFontWeight} !important;
          text-shadow: ${excelTheadTextShadow} !important;
          -webkit-text-stroke: ${excelTheadStroke} !important;
          paint-order: stroke fill;
          border: none !important;
          box-shadow: ${
            tableGridLines
              ? overlayTableHairlineShadow("var(--excel-header-border)", { bottom: true }, tableGridLineWidthPx)
              : "none"
          } !important;
        }
        .overlay-root .overlay-elegant-table.excel-member-table thead td span,
        .overlay-root .overlay-elegant-table.excel-member-table thead td strong,
        .overlay-root .overlay-elegant-table.excel-live-table thead td span,
        .overlay-root .overlay-elegant-table.excel-live-table thead td strong {
          color: var(--excel-header-text) !important;
          text-shadow: ${excelTheadTextShadow} !important;
          -webkit-text-stroke: ${excelTheadStroke} !important;
          paint-order: stroke fill;
        }
        .overlay-root .overlay-elegant-table.excel-member-table .overlay-total-row td,
        .overlay-root .overlay-elegant-table.excel-live-table .overlay-total-row td {
          border: none !important;
          box-shadow: ${
            tableGridLines
              ? overlayTableHairlineShadow("var(--excel-total-border)", { top: true }, tableGridLineWidthPx)
              : "none"
          } !important;
        }`;
    /** OBS·Prism: stroke 생략 — blur 없는 shadow 링만(프리뷰·OBS 동일) */
    const overlayCellOutlineStyle: React.CSSProperties = tableOutlineDisabled
      ? { fontWeight: tableFontWeight, textRendering: tableTextRenderingCss as React.CSSProperties["textRendering"] }
      : {
          textShadow: tableOutlineShadowCss,
          WebkitTextStroke: obsStrokeDisabled ? 0 : tableBroadcastOutline.WebkitTextStroke,
          paintOrder: "stroke fill",
          fontWeight: tableFontWeight,
          textRendering: tableTextRenderingCss as React.CSSProperties["textRendering"],
        };
    const mergeRankTop3TextStyle = (
      base: React.CSSProperties,
      gradientText: boolean | undefined,
      cellStyle?: Record<string, string>
    ): React.CSSProperties => {
      if (gradientText) {
        return {
          fontWeight: base.fontWeight,
          ...(cellStyle as React.CSSProperties),
        };
      }
      return {
        ...base,
        ...(cellStyle as React.CSSProperties),
      };
    };
    const overlayTotalRowCls = `${effectiveRowCls} font-semibold`;
    const centerFixedStyle = centerFixed ? (
      <style dangerouslySetInnerHTML={{ __html: `
        html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
        .overlay-center-fixed table.overlay-elegant-table .overlay-row td,
        .overlay-center-fixed table.overlay-elegant-table thead td { font-size: ${memberFontPx}px !important; min-height: ${tableRowMinH}px !important; line-height: 1.35 !important; padding: ${tableRowPadY}px ${tableRowPadX}px !important; }
        .overlay-center-fixed table.overlay-elegant-table .overlay-total-row td { font-size: ${memberFontPx}px !important; min-height: ${tableRowMinH}px !important; padding: ${tableRowPadY}px ${tableRowPadX}px !important; font-weight: ${tableFontWeight} !important; }
        /* 시트 불투명도는 바깥 wrapper(tableBodySheetBgCss)만 담당 — table에 불투명/반투명 깔면 슬라이더가 안 먹음 */
        .overlay-center-fixed table { background: transparent !important; }
        .overlay-center-fixed table.overlay-elegant-table td { container-type: inline-size; white-space: nowrap !important; overflow: visible !important; }
      ` }} />
    ) : null;
    const colorOverrideStyle =
      !hasTableTextColorOverride && (accountColor || toonColor) ? (
        <style
          dangerouslySetInnerHTML={{
            __html: [
              accountColor &&
                `.overlay-root tr:not(.overlay-total-row) .overlay-account-cell { color: ${accountColor} !important; }`,
              toonColor &&
                `.overlay-root tr:not(.overlay-total-row) .overlay-toon-cell { color: ${toonColor} !important; }`,
            ]
              .filter(Boolean)
              .join("\n"),
          }}
        />
      ) : null;
    const contributionColorStyle = contributionColorCss ? (
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row):not(.overlay-excel-placeholder) td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row):not(.overlay-excel-placeholder) td.overlay-col-contribution span,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row):not(.overlay-excel-placeholder) td.overlay-col-contribution strong,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row):not(.overlay-excel-placeholder) td.overlay-col-contribution .overlay-cell-text-inner,
        .overlay-root .overlay-elegant-table tbody tr:not(.overlay-total-row):not(.overlay-excel-placeholder) td.overlay-col-contribution .overlay-num-cell-inner {
          color: ${contributionColorCss} !important;
          -webkit-text-fill-color: ${contributionColorCss} !important;
          font-weight: 700 !important;
        }
        /* td 배경은 건드리지 않음(줄무늬 유지). 숫자 안쪽만 알약 제거 */
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution .overlay-num-cell-inner,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution .overlay-cell-text-inner,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution span,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution strong {
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
          border-radius: 0 !important;
          border: none !important;
          outline: none !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          min-width: 0 !important;
          box-shadow: none !important;
        }`,
        }}
      />
    ) : (
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution .overlay-num-cell-inner,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution .overlay-cell-text-inner {
          background: transparent !important;
          background-color: transparent !important;
          border-radius: 0 !important;
          border: none !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          min-width: 0 !important;
          box-shadow: none !important;
        }`,
        }}
      />
    );
    /** OBS/Prism: stroke 대신 다층 shadow만 씀(숫자 열에도 동일 적용) */
    const overlayNumericOutlineShadow = tableNumericOutlineShadowCss;
    const numericNoWrapStyle = (
      <style dangerouslySetInnerHTML={{ __html: `
        .overlay-root .overlay-elegant-table .overlay-num-cell-inner,
        .overlay-root .overlay-elegant-table .overlay-cell-text-inner {
          display: inline-block;
          min-width: max-content;
          max-width: 100%;
          overflow: visible;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
          vertical-align: middle;
          text-shadow: ${overlayNumericOutlineShadow} !important;
          -webkit-text-stroke: ${tableOutlineDisabled || obsStrokeDisabled ? "0" : tableStrokeCss} !important;
          paint-order: stroke fill !important;
          -webkit-font-smoothing: antialiased;
          text-rendering: ${tableTextRenderingCss} !important;
        }
        .overlay-root .overlay-elegant-table td.overlay-col-name .overlay-cell-text-inner {
          white-space: nowrap;
          max-width: 100%;
          display: inline-block;
          text-align: center;
        }
        .overlay-root .overlay-account-cell,
        .overlay-root .overlay-toon-cell,
        .overlay-root td.overlay-col-total,
        .overlay-root td.overlay-col-contribution,
        .overlay-root td.overlay-col-restroom {
          white-space: nowrap !important;
          /* stroke·shadow 가 셀 밖으로 살짝도 잘리지 않게 (hidden이면 하단이 잘림) */
          overflow: visible !important;
          vertical-align: middle;
        }
        .overlay-root .overlay-account-cell .overlay-num-cell-inner,
        .overlay-root .overlay-toon-cell .overlay-num-cell-inner,
        .overlay-root td.overlay-col-total .overlay-num-cell-inner,
        .overlay-root td.overlay-col-contribution .overlay-num-cell-inner,
        .overlay-root td.overlay-col-restroom .overlay-num-cell-inner {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          max-width: 100%;
          overflow: visible;
          line-height: 1.4;
          /* 두꺼운 stroke/shadow 하단이 셀 경계에 닿지 않도록 상하 여유 */
          padding-block: 0.18em;
          vertical-align: middle;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
        }
      ` }} />
    );
  const tableVisualStyle = (
      <style dangerouslySetInnerHTML={{ __html: `
        .overlay-root .overlay-elegant-table {
          border-radius: 8px !important;
          overflow: visible;
          border: none !important;
          box-shadow: none;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
          ${externalHost ? "contain: layout style;" : ""}
        }
        ${
          tableFontFamilyCss
            ? `
        .overlay-root .overlay-elegant-table,
        .overlay-root .overlay-elegant-table thead td,
        .overlay-root .overlay-elegant-table tbody td,
        .overlay-root .overlay-elegant-table td span,
        .overlay-root .overlay-elegant-table td strong,
        .overlay-root .overlay-elegant-table td .overlay-cell-text-inner,
        .overlay-root .overlay-elegant-table td .overlay-num-cell-inner {
          font-family: ${tableFontFamilyCss} !important;
        }`
            : ""
        }
        .overlay-root .overlay-elegant-table {
          background: transparent !important;
          background-color: transparent !important;
        }
        .overlay-root .overlay-elegant-table thead td,
        .overlay-root .overlay-elegant-table tbody td {
          border: none !important;
          border-bottom: none !important;
          border-top: none !important;
          outline: none !important;
          padding: ${tableRowPadY}px ${tableRowPadX}px !important;
          min-height: ${tableRowMinH}px !important;
          line-height: 1.35 !important;
          font-weight: ${tableFontWeight} !important;
          letter-spacing: -0.01em;
        }
        .overlay-root .overlay-elegant-table thead td,
        .overlay-root .overlay-elegant-table .overlay-total-row td {
          text-shadow: ${tableOutlineShadowCss} !important;
          -webkit-text-stroke: ${tableStrokeCss} !important;
          paint-order: stroke fill;
        }
        .overlay-root .overlay-elegant-table:not(.excel-zebra-table) tbody tr.overlay-row td {
          background: transparent !important;
          background-image: none !important;
          /* 셀 그리드 선은 overlayTableCellGridCss(box-shadow)로 그림 — 여기서 지우지 않음 */
          text-shadow: ${tableOutlineShadowCss} !important;
          -webkit-text-stroke: ${tableOutlineDisabled || obsStrokeDisabled ? "0" : tableStrokeCss} !important;
          paint-order: stroke fill !important;
        }
        .overlay-root .overlay-elegant-table:not(.excel-zebra-table) td {
          transition: ${externalHost || stableMode ? "none" : "filter 180ms ease, transform 180ms ease, background-size 220ms ease"};
          background: transparent !important;
          -webkit-font-smoothing: antialiased;
          text-rendering: ${tableTextRenderingCss};
        }
        .overlay-root .overlay-elegant-table.excel-zebra-table td {
          transition: ${externalHost || stableMode ? "none" : "filter 180ms ease, transform 180ms ease, background-size 220ms ease"};
          -webkit-font-smoothing: antialiased;
          text-rendering: ${tableTextRenderingCss};
        }
        ${tableForcedTextColorCss}
        ${tableAutoTextColorCss}
        ${excelAutoBodyTextCss}
        ${broadcastTheadCss}
        ${
          useBroadcastTableChrome
            ? `
        .overlay-root .overlay-elegant-table thead td span,
        .overlay-root .overlay-elegant-table thead td strong {
          text-shadow: ${tableOutlineShadowCss} !important;
          -webkit-text-stroke: ${tableStrokeCss} !important;
        }`
            : ""
        }
        .overlay-root .overlay-elegant-table tbody td span:not(.overlay-rank-fx-colorShift):not(.overlay-rank-fx-rainbow):not(.overlay-rank-fx-glow):not(.overlay-rank-fx-sparkle),
        .overlay-root .overlay-elegant-table tbody td strong {
          text-shadow: ${tableOutlineShadowCss} !important;
          -webkit-text-stroke: ${tableStrokeCss} !important;
          paint-order: stroke fill;
          font-weight: ${tableFontWeight} !important;
        }
        .overlay-root .overlay-elegant-table:not(.excel-zebra-table) tbody tr:not(.overlay-total-row) td {
          background: transparent !important;
        }
        /* 세로 OBS(mobile-broadcast)에서도 시트 배경만 보이게 — 셸 줄무늬보다 우선 */
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table:not(.excel-zebra-table) tbody tr.overlay-row td,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table:not(.excel-zebra-table) tbody tr.overlay-row:nth-child(odd) td,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table:not(.excel-zebra-table) tbody tr.overlay-row:nth-child(even) td {
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
        }
        .overlay-root .overlay-elegant-table.pastel-member-table tbody tr.overlay-row:nth-child(odd) td,
        .overlay-root .overlay-elegant-table.pastel-member-table tbody tr.overlay-row:nth-child(even) td {
          background: transparent !important;
        }
        .overlay-root .overlay-elegant-table:not(.excel-live-table):not(.pastel-member-table):not(.excel-zebra-table) tbody tr.overlay-row td {
          background: transparent !important;
        }
        .overlay-root .overlay-elegant-table.excel-live-table thead td {
          color: var(--excel-header-text) !important;
          border: none !important;
          box-shadow: ${
            tableGridLines
              ? overlayTableHairlineShadow("var(--excel-header-border)", { bottom: true }, tableGridLineWidthPx)
              : "none"
          } !important;
        }
        .overlay-root .overlay-elegant-table.excel-live-table thead td.overlay-col-rank,
        .overlay-root .overlay-elegant-table.excel-live-table thead td.overlay-col-role,
        .overlay-root .overlay-elegant-table.excel-live-table thead td.overlay-col-name,
        .overlay-root .overlay-elegant-table.excel-live-table thead td.overlay-col-account,
        .overlay-root .overlay-elegant-table.excel-live-table thead td.overlay-col-toon,
        .overlay-root .overlay-elegant-table.excel-live-table thead td.overlay-col-total,
        .overlay-root .overlay-elegant-table.excel-live-table thead td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table.excel-live-table thead td.overlay-col-restroom {
          background: var(--excel-header-bg) !important;
        }
        .overlay-root .overlay-elegant-table.excel-live-table tbody tr.overlay-row:nth-child(odd) td,
        .overlay-root .overlay-elegant-table.excel-live-table tbody tr.overlay-row:nth-child(even) td,
        .overlay-root .overlay-elegant-table.excel-member-table:not(.excel-zebra-table) tbody tr.overlay-row td {
          background: transparent !important;
          border: none !important;
        }
        .overlay-root .overlay-elegant-table.excel-member-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td {
          background: var(--excel-row-odd, rgba(255, 255, 255, 0.14)) !important;
          border: none !important;
        }
        .overlay-root .overlay-elegant-table.excel-member-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td {
          background: var(--excel-row-even, rgba(255, 255, 255, 0.06)) !important;
          border: none !important;
        }
        .overlay-root .overlay-elegant-table.excel-member-table.excel-zebra-table thead td {
          background: var(--excel-header-bg) !important;
          color: var(--excel-header-text) !important;
        }
        .overlay-root .overlay-elegant-table.excel-live-table .overlay-total-row td {
          border: none !important;
          box-shadow: ${
            tableGridLines
              ? overlayTableHairlineShadow("rgba(26, 82, 118, 0.45)", { top: true }, tableGridLineWidthPx)
              : "none"
          } !important;
          background: ${excelLiveTotalRowBg} !important;
        }
        ${
          tableGridLines && tableLineColorRaw
            ? `
        .overlay-root .overlay-elegant-table.excel-live-table thead td {
          border: none !important;
          box-shadow: ${overlayTableHairlineShadow(tableLineColorRaw, { bottom: true }, tableGridLineWidthPx)} !important;
        }
        .overlay-root .overlay-elegant-table.excel-live-table .overlay-total-row td {
          border: none !important;
          box-shadow: ${overlayTableHairlineShadow(tableLineColorRaw, { top: true }, tableGridLineWidthPx)} !important;
        }
        `
            : ""
        }
        ${
          externalSafeMode
            ? `
        /* OBS 안정 모드: 텍스트 셀 transition·장식 애니만 차단 — 순위 행 FLIP·플래시는 유지 */
        .overlay-root .overlay-elegant-table td,
        .overlay-root .overlay-elegant-table thead td {
          transition: none !important;
        }
        .overlay-root .animate-neonPulse {
          animation: none !important;
        }
        ${
          mobileBroadcast
            ? ""
            : `
        .overlay-root .overlay-scale-target,
        .overlay-root .overlay-elegant-table,
        .overlay-root .overlay-elegant-table tr:not(.overlay-row),
        .overlay-root .overlay-elegant-table td,
        .overlay-root .overlay-elegant-table td .overlay-num-cell-inner {
          transform: none !important;
          -webkit-transform: none !important;
        }
        .overlay-root .overlay-elegant-table tbody tr.overlay-row {
          transition: transform 500ms cubic-bezier(0.2, 0.7, 0.2, 1) !important;
        }
        .overlay-root .overlay-elegant-table tbody tr.overlay-row.animate-row-flash {
          animation: rowFlash 0.8s ease-out forwards !important;
        }`
        }
        .overlay-root .overlay-elegant-table thead td,
        .overlay-root .overlay-elegant-table .overlay-total-row td {
          container-type: normal !important;
          font-size: ${memberFontPx}px !important;
          line-height: 1.35 !important;
          -webkit-text-stroke: 0 !important;
          /* OBS CEF: stroke 대신 blur 없는 shadow 링(프리뷰와 동일 선명도) */
          text-shadow: ${tableOutlineShadowCss} !important;
          text-rendering: geometricPrecision !important;
        }
        .overlay-root .overlay-elegant-table tbody tr.overlay-row td {
          container-type: normal !important;
          font-size: ${memberFontPx}px !important;
          line-height: 1.35 !important;
          -webkit-text-stroke: 0 !important;
          text-shadow: none !important;
          text-rendering: geometricPrecision !important;
        }
        .overlay-root .overlay-elegant-table tbody td span:not(.overlay-rank-fx-colorShift):not(.overlay-rank-fx-rainbow):not(.overlay-rank-fx-glow):not(.overlay-rank-fx-sparkle),
        .overlay-root .overlay-elegant-table tbody td strong,
        .overlay-root .overlay-elegant-table thead td span,
        .overlay-root .overlay-elegant-table thead td strong {
          -webkit-text-stroke: 0 !important;
          text-shadow: ${tableOutlineShadowCss} !important;
          text-rendering: geometricPrecision !important;
          -webkit-font-smoothing: antialiased;
        }
        .overlay-root .overlay-elegant-table .overlay-total-row td {
          font-size: ${memberFontPx}px !important;
          line-height: 1.35 !important;
        }
        `
            : ""
        }
        /* 총합 행: 셀마다 그라데이션 박스 제거 → 본문과 동일한 시트색(excelLive는 위에서 별도 지정)
         * 구분선은 아래 overlayTableCellGridCss 가 최종 적용 */
        .overlay-root .overlay-elegant-table .overlay-total-row td {
          background: transparent !important;
          background-image: none !important;
          backdrop-filter: none !important;
          -webkit-backdrop-filter: none !important;
          border: none !important;
          border-bottom: none !important;
          padding: ${tableRowPadY}px ${tableRowPadX}px !important;
          font-size: ${memberFontPx}px !important;
          font-weight: ${tableFontWeight} !important;
          vertical-align: middle;
        }
        .overlay-root .overlay-elegant-table.excel-live-table .overlay-total-row td {
          background: ${excelLiveTotalRowBg} !important;
        }
        .overlay-root .overlay-elegant-table:not(.excel-live-table):not(.pastel-member-table) tbody tr.overlay-total-row td {
          /* 방송 크롬: 헤더와 같은 분홍 띠 — 선은 흰 헤어라인으로 대비 */
          background: ${useBroadcastTableChrome ? broadcastTheadBg : tableBodySheetBgCss} !important;
        }
        ${
          /**
           * totalLineVisible=false 기본값은 “합계열 강조 선 OFF”용.
           * 셀 그리드 구조선까지 지우면 총합 행·합계열 구분선이 통째로 사라지므로
           * box-shadow 를 여기서 비우지 않는다(아래 overlayTableCellGridCss 가 담당).
           */
          ""
        }
        /* 마지막 열(기여도·화장실): 합성 환경에서 stroke로 인한 우측 1~2px 잘림 방지 */
        .overlay-root .overlay-elegant-table thead td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table thead td.overlay-col-restroom,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-restroom {
          ${externalSafeMode
            ? `-webkit-text-stroke: 0 !important; text-shadow: ${tableNumericOutlineShadowCss} !important;`
            : `-webkit-text-stroke: ${tableTextIsLight ? "0.55px rgba(6, 12, 24, 0.92)" : "0"} !important; text-shadow: ${tableNumericOutlineShadowCss} !important;`}
        }
        .overlay-root .overlay-elegant-table td.overlay-col-contribution .overlay-num-cell-inner,
        .overlay-root .overlay-elegant-table td.overlay-col-restroom .overlay-num-cell-inner {
          transform: ${externalSafeMode ? "translateX(0)" : "translateX(0)"};
        }
        /* 순위·기여도·화장실 헤더: 고정 폭 칸에서 스트로크·굵은 글자가 칸 경계에서 잘리지 않도록 */
        .overlay-root .overlay-elegant-table thead td.overlay-col-rank,
        .overlay-root .overlay-elegant-table thead td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table thead td.overlay-col-restroom {
          overflow: visible !important;
        }
        /* 순위 헤더는 바디 셀과 좌우 위치가 일치해야 한다(텍스트가 칸 안에서 동일 위치). */
        .overlay-root .overlay-elegant-table thead td.overlay-col-rank,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-rank {
          text-align: center !important;
        }
        /* 이름: 계좌·투네·합계와 동일하게 가운데 정렬 */
        .overlay-root .overlay-elegant-table thead td.overlay-col-name,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-name {
          text-align: center !important;
        }
        /* 좌측 텍스트 칸들(순위/직급/이름)이 너무 붙어 보이지 않도록 헤더·바디 모두 좌우 여유를 둔다.
           기본 셀 패딩(0.25em)으로는 글자가 서로 붙은 것처럼 보임 → 각 칸당 0.55em 확보. */
        .overlay-root .overlay-elegant-table thead td.overlay-col-rank,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-rank,
        .overlay-root .overlay-elegant-table thead td.overlay-col-role,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-role,
        .overlay-root .overlay-elegant-table thead td.overlay-col-name,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-name {
          padding-left: 0.55em !important;
          padding-right: 0.55em !important;
        }
        /* 직급↔이름 사이는 한 칸 더 넓게: 직급 우측 패딩을 추가로 늘려 시각 분리. */
        .overlay-root .overlay-elegant-table thead td.overlay-col-role,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-role {
          padding-right: 0.95em !important;
        }
        .overlay-root .overlay-elegant-table thead td.overlay-col-name,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-name {
          padding-left: 0.75em !important;
          padding-right: 0.75em !important;
        }
        /* 이름 ↔ 계좌/투네: 백만원대·두꺼운 아웃라인에서도 붙지 않게 금액 열 좌측 여백 */
        .overlay-root .overlay-elegant-table thead td.overlay-col-account,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-account,
        .overlay-root .overlay-elegant-table thead td.overlay-col-toon,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-toon {
          padding-left: 0.75em !important;
          padding-right: 0.75em !important;
          text-align: center !important;
        }
        .overlay-root .overlay-elegant-table thead td.overlay-col-total,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-total {
          padding-left: 0.75em !important;
          padding-right: 0.75em !important;
          text-align: center !important;
        }
        /* 마지막 열(기여도·화장실): 너무 오른쪽으로 밀려 보이지 않게 투네/합계 열과 유사한 간격으로 조정 */
        .overlay-root .overlay-elegant-table thead td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table thead td.overlay-col-restroom,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-restroom {
          padding-left: 0.42em !important;
          padding-right: 0.62em !important;
          overflow: visible !important;
        }
        .overlay-root .overlay-elegant-table thead td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table thead td.overlay-col-restroom,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-restroom {
          text-align: center !important;
        }
        /* 직급: ellipsis+hidden 은 스트로크 있는 한글(대표 등) 끝 글자가 잘려 작아 보임 → 가운데 정렬·잘림 없음 */
        .overlay-root .overlay-elegant-table thead td.overlay-col-role,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-role {
          overflow: visible !important;
          text-overflow: clip !important;
          text-align: center !important;
        }
        .overlay-root .overlay-elegant-table tbody td.overlay-col-role,
        .overlay-root .overlay-elegant-table tbody td.overlay-col-role .overlay-role-label {
          -webkit-text-stroke: ${tableOutlineDisabled ? "0" : tableStrokeCss} !important;
          paint-order: stroke fill !important;
          text-shadow: ${overlayNumericOutlineShadow} !important;
        }
        .overlay-root .overlay-elegant-table tbody td.overlay-col-role .overlay-role-label {
          display: inline-block;
          max-width: 100%;
          white-space: nowrap;
          vertical-align: middle;
          letter-spacing: 0.04em;
        }
        /* 순위·직급 공란: 폭 고정 + 가운데 정렬(하이픈 미표시).
           inline-flex 로 span 안의 글자 자체를 가운데 배치해, 셀 내 text-align 과 무관하게 행마다 같은 X 위치에 떨어지게 한다. */
        .overlay-root .overlay-elegant-table tbody td .overlay-rank-mark {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 1.2em;
          height: 1em;
          line-height: 1;
          font-weight: ${tableFontWeight};
          font-feature-settings: "tnum" 1;
          letter-spacing: 0;
          vertical-align: middle;
        }
        .overlay-root .overlay-elegant-table tbody td.overlay-col-rank {
          text-align: center !important;
        }
        ${
          isExcelRankTop3TextMode(excelRankTop3Style.mode)
            ? EXCEL_RANK_TOP3_EFFECTS_CSS
            : ""
        }
        ${
          stableMode || externalHost
            ? ""
            : `
        .overlay-root .overlay-elegant-table tbody tr:hover td {
          filter: brightness(1.06) saturate(1.03);
          transform: scale(1.009);
        }
        `
        }
        /* table-layout:fixed + col 너비 안에서 이름 열만 말줄임이 안정적으로 적용되도록 */
        .overlay-root .overlay-elegant-table td.overlay-col-name {
          max-width: 0;
        }
        ${
          externalHost
            ? `
        /* OBS/Prism: 호버 시 미세 scale/filter 가 포커스·합성과 겹치며 떨림처럼 보일 수 있음 */
        .overlay-root .overlay-elegant-table tbody tr:hover td {
          filter: none !important;
          transform: none !important;
        }
        .overlay-root .overlay-scale-target {
          -webkit-backface-visibility: hidden;
          backface-visibility: hidden;
          /* 스케일 합성 시 표 선이 흐려지지 않게 */
          -webkit-font-smoothing: antialiased;
          text-rendering: geometricPrecision;
        }
        `
            : ""
        }
        /* 헤더·본문·총합 셀 그리드(가로·세로). OBS 스케일에서도 선이 남도록 마지막에 적용 */
        ${
          isExcelGoldChrome
            ? ""
            : overlayTableCellGridCss({
                lineColor: tableGridLineColor,
                widthPx: tableGridLineWidthPx,
                headerBottomExtraPx: tableGridLineWidthPx + 1,
                /** 총합 행이 헤더와 같은 분홍 계열일 때 분홍 선이 묻히지 않게 */
                totalRowLineColor: tableLineColorRaw || "rgba(255, 255, 255, 0.72)",
                emphasizeTotalColumn: totalLineVisible,
                gridLines: tableGridLines,
                verticalLines: tableVerticalLines,
              })
        }
        ${
          isExcelGoldChrome
            ? `
        .overlay-root .overlay-elegant-table.excel-gold-table {
          border-radius: 0 !important;
          overflow: visible !important;
          border: none !important;
          box-shadow: none !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table thead td,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table thead td {
          background: var(--excel-header-bg, #ffc107) !important;
          background-clip: padding-box !important;
          border-top: 4px solid transparent !important;
          border-bottom: 4px solid transparent !important;
          box-shadow: none !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table thead td:first-child,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table thead td:first-child {
          border-left: 10px solid transparent !important;
          border-top-left-radius: 999px !important;
          border-bottom-left-radius: 999px !important;
          border-top-right-radius: 0 !important;
          border-bottom-right-radius: 0 !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table thead td:last-child,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table thead td:last-child {
          border-right: 10px solid transparent !important;
          border-top-right-radius: 999px !important;
          border-bottom-right-radius: 999px !important;
          border-top-left-radius: 0 !important;
          border-bottom-left-radius: 0 !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table tbody td span:not(.overlay-rank-fx-colorShift):not(.overlay-rank-fx-rainbow):not(.overlay-rank-fx-glow):not(.overlay-rank-fx-sparkle),
        .overlay-root .overlay-elegant-table.excel-gold-table tbody td strong,
        .overlay-root .overlay-elegant-table.excel-gold-table tbody td .overlay-cell-text-inner,
        .overlay-root .overlay-elegant-table.excel-gold-table tbody td .overlay-num-cell-inner {
          text-shadow: ${tableOutlineShadowCss} !important;
          -webkit-text-stroke: ${tableOutlineDisabled || obsStrokeDisabled ? "0" : tableStrokeCss} !important;
          paint-order: stroke fill !important;
        }
        /* 행마다 떨어진 둥근 pill: 투명 테두리로 홈을 내고 background-clip으로 채움만 둥글게 */
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row td,
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row:nth-child(odd) td,
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row:nth-child(even) td,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row td,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row:nth-child(odd) td,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row:nth-child(even) td {
          border-top: 3px solid transparent !important;
          border-bottom: 3px solid transparent !important;
          box-shadow: none !important;
          outline: none !important;
          background-clip: padding-box !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row td:first-child,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row td:first-child,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td:first-child,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td:first-child,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row td:first-child,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td:first-child,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td:first-child {
          border-left: 10px solid transparent !important;
          border-top-left-radius: 999px !important;
          border-bottom-left-radius: 999px !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row td:last-child,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row td:last-child,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td:last-child,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td:last-child,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row td:last-child,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td:last-child,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td:last-child {
          border-right: 10px solid transparent !important;
          border-top-right-radius: 999px !important;
          border-bottom-right-radius: 999px !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td {
          background: var(--excel-row-odd, rgba(255, 255, 255, 0.16)) !important;
          background-clip: padding-box !important;
          border-top: 3px solid transparent !important;
          border-bottom: 3px solid transparent !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td {
          background: var(--excel-row-even, rgba(255, 255, 255, 0.08)) !important;
          background-clip: padding-box !important;
          border-top: 3px solid transparent !important;
          border-bottom: 3px solid transparent !important;
        }
        /* 기여도: 칸·숫자 알약 배경 제거 — 글자색만 구분 (위 contributionColorStyle) */
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td.overlay-col-contribution,
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td.overlay-col-contribution,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-row td.overlay-col-contribution,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td.overlay-col-contribution,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td.overlay-col-contribution {
          background-image: none !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td.overlay-col-contribution,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(odd) td.overlay-col-contribution {
          background: var(--excel-row-odd, rgba(255, 255, 255, 0.16)) !important;
          background-clip: padding-box !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td.overlay-col-contribution,
        body.overlay-mobile-broadcast .overlay-root .overlay-elegant-table.excel-gold-table.excel-zebra-table tbody tr.overlay-row:nth-child(even) td.overlay-col-contribution {
          background: var(--excel-row-even, rgba(255, 255, 255, 0.08)) !important;
          background-clip: padding-box !important;
        }
        .overlay-root .overlay-elegant-table tbody td.overlay-col-contribution .overlay-num-cell-inner,
        .overlay-root .overlay-elegant-table.excel-gold-table tbody td.overlay-col-contribution .overlay-num-cell-inner,
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr:not(.overlay-total-row) td.overlay-col-contribution .overlay-num-cell-inner {
          background: transparent !important;
          background-color: transparent !important;
          background-image: none !important;
          border-radius: 0 !important;
          border: none !important;
          outline: none !important;
          padding-left: 0 !important;
          padding-right: 0 !important;
          min-width: 0 !important;
          box-shadow: none !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-excel-placeholder td .overlay-cell-text-inner,
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-excel-placeholder td .overlay-num-cell-inner {
          color: transparent !important;
          background: transparent !important;
        }
        ${
          excelGoldRankChrome
            ? EXCEL_GOLD_RANK_TEXT_COLORS.map((color, idx) => {
                const n = idx + 1;
                return `
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-excel-rank-${n}:not(.overlay-excel-placeholder) td.overlay-col-rank .overlay-cell-text-inner,
        .overlay-root .overlay-elegant-table.excel-gold-table tbody tr.overlay-excel-rank-${n}:not(.overlay-excel-placeholder) td.overlay-col-name .overlay-cell-text-inner {
          color: ${color} !important;
          -webkit-text-fill-color: ${color} !important;
          text-shadow: ${tableOutlineShadowCss} !important;
          -webkit-text-stroke: ${tableOutlineDisabled || obsStrokeDisabled ? "0" : tableStrokeCss} !important;
          paint-order: stroke fill !important;
        }`;
              }).join("")
            : ""
        }
        .overlay-root .overlay-elegant-table.excel-gold-table .overlay-total-row td {
          background: rgba(255, 193, 7, 0.18) !important;
          box-shadow: none !important;
          border: none !important;
        }
        `
            : ""
        }
        .overlay-root .overlay-elegant-table {
          border-collapse: separate !important;
          border-spacing: 0 !important;
        }
        .overlay-root .overlay-elegant-table.excel-gold-table {
          border-spacing: 0 6px !important;
        }
      ` }} />
    );
    const goalTextColorStyle = (
      <style
        dangerouslySetInnerHTML={{
          __html: `
        .overlay-root .overlay-goal-bar-widget .overlay-goal-bar-text {
          color: ${goalTextColor} !important;
          -webkit-text-fill-color: ${goalTextColor} !important;
          -webkit-font-smoothing: antialiased;
          text-rendering: optimizeLegibility;
          ${overlayTextSharpRender ? `text-rendering: geometricPrecision !important;` : ""}
          ${goalFontFamilyCss ? `font-family: ${goalFontFamilyCss} !important;` : ""}
        }
      `,
        }}
      />
    );
    // Preset id가 있어도 원격 상태 준비 전까지만 잠시 대기한다.
    // 준비 이후에도 preset을 못 찾으면(삭제/누락) 기본 렌더로 폴백해야 화면이 비지 않는다.
    const waitForPreset = Boolean(presetId) && !activePreset && !ready;
    if (waitForPreset) {
      return <div className="overlay-root" style={{ position: "fixed", inset: 0, background: "transparent" }} />;
    }

    return (
      <div style={viewportWrapperStyle} className={`overlay-root ${centerFixed ? "overlay-center-fixed" : ""}`}>
        {scaleStyleTag}
        {centerFixedStyle}
        {colorOverrideStyle}
        {numericNoWrapStyle}
        {tableVisualStyle}
        {contributionColorStyle}
        {goalTextColorStyle}
        {showGuide && (
          <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 9998 }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "rgba(0,255,200,0.4)" }} />
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 1, background: "rgba(0,255,200,0.2)" }} />
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 1, background: "rgba(0,255,200,0.2)" }} />
            <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 1, background: "rgba(0,255,200,0.2)" }} />
            <div style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(0,200,255,0.2)" }} />
            <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(0,200,255,0.2)" }} />
            <div style={{ position: "absolute", top: 8, left: 8, color: "rgba(255,255,255,0.8)", fontSize: 12, fontFamily: "system-ui, sans-serif" }}>
              GUIDE ON — autoFit={autoFit}
            </div>
          </div>
        )}
        <div style={viewportInnerStyle} className="overlay-scale-target">
          <main className="transparent-bg no-select" style={{ ...scaledMainStyle, minHeight: FIT_H, width: FIT_W, background: "transparent" }}>
        {showMembers && (ready || isPreviewGuide || externalHost) && (
          <div className={`absolute ${listPosClass}`} style={{ maxWidth: FIT_W, maxHeight: FIT_H, minWidth: 0, ...listPosStyle }}>
            <div ref={containerRef} className="flex min-w-0 items-start gap-3" style={{ width: "fit-content", maxWidth: FIT_W }}>
              {showSideDonors && donorsSide === "left" && (
                <div style={{ width: donorsWidth }}>
                  <DonorTicker donors={donors} theme={tickerBaseTheme} fontSize={dSize} color={donorsColor} bgColor={donorsBgColor} bgOpacity={donorsBgOpacity} full={donorsFormat ? donorsFormat === "full" : currencyFull} duration={donorsSpeed} gap={donorsGap} limit={donorsLimit} unit={donorsUnit} locale={currencyLocale} />
                </div>
              )}
              <div
                ref={memberTableClampRef}
                className="relative min-w-0 flex-1 overflow-visible"
                style={{ borderRadius: 0 }}
              >
                {showTableBgGif ? (
                  tableBgAnimated.kind === "video" ? (
                    <video
                      src={tableBgAnimated.src}
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                      style={{ opacity: tableBgGifOpacity / 100, filter: `brightness(${tableBgGifBrightness}%)` }}
                      autoPlay
                      muted
                      loop
                      playsInline
                      preload="auto"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tableBgAnimated.src}
                      alt=""
                      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                      style={{ opacity: tableBgGifOpacity / 100, filter: `brightness(${tableBgGifBrightness}%)` }}
                      loading="eager"
                      decoding="async"
                    />
                  )
                ) : null}
                <div className="relative z-[1]">
                <div
                  className="relative"
                  style={showTableFrame ? { padding: tableFrameInsetPx } : undefined}
                >
                  {showTableFrame ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={tableFrameUrl}
                      alt=""
                      className="pointer-events-none absolute inset-0 z-0 h-full w-full object-fill"
                      style={{ opacity: tableFrameOpacity / 100 }}
                      loading="eager"
                      decoding="async"
                    />
                  ) : null}
                <div
                  className={`relative ${showTableFrame ? "" : isExcelGoldChrome ? "overflow-visible" : "overflow-visible"}`}
                  style={{
                    zIndex: 2,
                    borderRadius: showTableFrame ? 0 : isExcelGoldChrome ? 12 : 14,
                    border:
                      !showTableFrame && tablePanelBorderCss
                        ? `${isExcelGoldChrome ? 1 : 2}px solid ${tablePanelBorderCss}`
                        : !showTableFrame && isExcelGoldChrome
                          ? "1px solid #ffc107"
                          : "none",
                    boxShadow: showTableFrame || isExcelGoldChrome ? "none" : tablePanelShadow || "none",
                    padding: isExcelGoldChrome && !showTableFrame ? "6px 0 8px" : 0,
                    /** 웹후원 골드: 표 뒤 큰 패널 없음. 그 외 테마는 기존 시트/글래스 */
                    backgroundColor: isExcelGoldChrome
                      ? "transparent"
                      : tableBodySheetBgCss || TABLE_BROADCAST_PANEL_BG,
                    backdropFilter: showTableFrame || isExcelGoldChrome ? undefined : "blur(14px)",
                    WebkitBackdropFilter: showTableFrame || isExcelGoldChrome ? undefined : "blur(14px)",
                    overflow: "visible",
                    /** translateZ(0) 는 OBS CEF에서 서브픽셀 블러를 유발 → 외부 호스트에서는 생략 */
                    ...(externalHost
                      ? {}
                      : {
                          transform: "translateZ(0)",
                          WebkitBackfaceVisibility: "hidden" as const,
                          backfaceVisibility: "hidden" as const,
                        }),
                  }}
                >
                    <div
                      ref={tableBoxRef as any}
                      className="flex flex-row items-stretch"
                      style={{ width: "fit-content" }}
                    >
                    {memberTablePanels.map((panel, panelIdx) => (
                    <table
                      key={panel.key}
                      className={`${effectiveTableCls} overlay-elegant-table${membersThemeId === "pastel" ? " pastel-member-table" : ""}${excelMemberTableClass}`}
                      style={{
                        fontSize: memberFontPx,
                        borderSpacing: 0,
                        borderCollapse: "separate",
                        tableLayout: "fixed",
                        overflow: isExcelGoldChrome ? "visible" : undefined,
                        width: `calc(${excelTableWidthCalc})`,
                        ...(excelSplitEnabled && panelIdx === 0
                          ? {
                              borderRight: `1px solid ${
                                tablePanelBorderCss ||
                                excelMemberAccent?.panelBorder ||
                                tableGridLineColor
                              }`,
                            }
                          : {}),
                        ...excelMemberTableStyle,
                      }}
                    >
                  <colgroup>
                    {excelGridCols.map((w, idx) => (
                      <col key={`excel-col-${idx}`} style={{ width: w }} />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <td className={`${effectiveHeaderCls} overlay-col-rank overlay-rank-cell text-center`}>순위</td>
                      {hasRoleColumn && <td className={`${effectiveHeaderCls} overlay-col-role`} style={{ whiteSpace: "nowrap" }}>직급</td>}
                      <td className={`${effectiveHeaderCls} overlay-col-name text-center`}>이름</td>
                      <td className={`${effectiveHeaderCls} overlay-col-account text-center`}>{accountHeaderLabel}</td>
                      <td className={`${effectiveHeaderCls} overlay-col-toon text-center`}>{toonHeaderLabel}</td>
                      {showCombinedColumn && (
                        <td className={`${effectiveHeaderCls} overlay-col-total text-center`}>{totalHeaderLabel}</td>
                      )}
                      {showContributionColumn && (
                        <td className={`${effectiveHeaderCls} overlay-col-contribution text-center`} title="관리자「기여도 기록부」값. 후원만 반영된 경우 계좌+투네 합으로 표시. 운영비 행은 기여도 미표시(—), 총합은 운영비 제외 합산.">
                          기여도
                        </td>
                      )}
                      {showRestroomColumn && (
                        <td className={`${effectiveHeaderCls} overlay-col-restroom text-center`} title="관리자「화장실 기록부」수동 기록. 후원 자동 반영 없음.">
                          {restroomHeaderLabel}
                        </td>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {panel.ranked.map((row: any) => {
                      const isPlaceholder = Boolean(row.__excelPlaceholder);
                      const m: Member = row.m;
                      const rank: number | null = row.rank;
                      if (isPlaceholder) {
                        return (
                          <tr
                            key={m.id}
                            className={`overlay-row overlay-excel-placeholder ${rowMotionEnabled ? "transition-transform will-change-transform" : ""}`}
                          >
                            <td className={`${effectiveRowCls} overlay-col-rank text-center overlay-rank-cell`}>
                              <span className="overlay-rank-mark overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                                {" "}
                              </span>
                            </td>
                            {hasRoleColumn && (
                              <td className={`${effectiveRowCls} overlay-col-role`} style={{ whiteSpace: "nowrap" }}>
                                <span className="overlay-rank-mark">{" "}</span>
                              </td>
                            )}
                            <td className={`${effectiveRowCls} overlay-col-name text-center ${effectiveNameCls} ${nameWrapCls}`}>
                              <span className={`overlay-cell-text-inner ${nameWrapCls}`} style={overlayCellOutlineStyle}>
                                {" "}
                              </span>
                            </td>
                            <td className={`${effectiveRowCls} overlay-col-account ${effectiveAccountCls} overlay-account-cell text-center`}>
                              <span className="overlay-num-cell-inner overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                                {" "}
                              </span>
                            </td>
                            <td className={`${effectiveRowCls} overlay-col-toon ${effectiveToonCls} overlay-toon-cell text-center`}>
                              <span className="overlay-num-cell-inner overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                                {" "}
                              </span>
                            </td>
                            {showCombinedColumn && (
                              <td className={`${effectiveRowCls} overlay-col-total text-center font-bold`}>
                                <span className="overlay-num-cell-inner overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                                  {" "}
                                </span>
                              </td>
                            )}
                            {showContributionColumn && (
                              <td className={`${effectiveRowCls} overlay-col-contribution text-center font-semibold`}>
                                <span className="overlay-num-cell-inner overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                                  {" "}
                                </span>
                              </td>
                            )}
                            {showRestroomColumn && (
                              <td className={`${effectiveRowCls} overlay-col-restroom text-center font-semibold`}>
                                <span className="overlay-num-cell-inner overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                                  {" "}
                                </span>
                              </td>
                            )}
                          </tr>
                        );
                      }

                      const donationTotal = Math.max(
                        0,
                        Math.round(Number(m.account) || 0) + Math.round(Number(m.toon) || 0)
                      );
                      const top3Row = resolveExcelRankTop3RowStyle(rank, excelRankTop3Style, { donationTotal });
                      const excelGoldRankCls =
                        isExcelGoldChrome && typeof rank === "number" && rank >= 1 && rank <= 3
                          ? ` overlay-excel-rank-${rank}`
                          : "";
                      return (
                        <tr
                          key={m.id}
                          ref={rowMotionEnabled ? setRowRef(m.id) : undefined}
                          className={`overlay-row${excelGoldRankCls} ${rowMotionEnabled ? "transition-transform will-change-transform" : ""} ${rowMotionEnabled && changedIds.has(m.id) ? "animate-row-flash" : ""}`}
                        >
                          <td className={`${effectiveRowCls} overlay-col-rank text-center overlay-rank-cell`}>
                            {rank == null ? (
                              <span className="overlay-rank-mark overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                                {" "}
                              </span>
                            ) : (
                              <span
                                className={`overlay-cell-text-inner ${top3Row.rankCellClass || ""}`}
                                style={mergeRankTop3TextStyle(
                                  overlayCellOutlineStyle,
                                  top3Row.gradientText,
                                  top3Row.rankCellStyle
                                )}
                              >
                                {top3Row.rankLabel}
                              </span>
                            )}
                          </td>
                          {hasRoleColumn && (
                            <td
                              className={`${effectiveRowCls} overlay-col-role`}
                              style={{
                                whiteSpace: "nowrap",
                              }}
                            >
                              {getMemberRole(m) ? (
                                <span className="overlay-role-label" style={overlayCellOutlineStyle}>
                                  {getMemberRole(m)}
                                </span>
                              ) : (
                                <span className="overlay-rank-mark">{" "}</span>
                              )}
                            </td>
                          )}
                          <td className={`${effectiveRowCls} overlay-col-name text-center ${effectiveNameCls} ${nameWrapCls}`}>
                            <span
                              className={`overlay-cell-text-inner ${nameWrapCls} ${top3Row.nameCellClass || ""}`}
                              style={mergeRankTop3TextStyle(
                                overlayCellOutlineStyle,
                                top3Row.gradientText,
                                top3Row.nameCellStyle
                              )}
                            >
                              {m.name}
                            </span>
                          </td>
                          <td className={`${effectiveRowCls} overlay-col-account ${effectiveAccountCls} overlay-account-cell text-center`}>
                            <OverlayTableNumCell
                              value={m.account}
                              format={fmt}
                              animate={rowMotionEnabled}
                              className="overlay-num-cell-inner overlay-cell-text-inner"
                              style={overlayCellOutlineStyle}
                            />
                          </td>
                          <td className={`${effectiveRowCls} overlay-col-toon ${effectiveToonCls} overlay-toon-cell text-center`}>
                            <OverlayTableNumCell
                              value={m.toon}
                              format={fmt}
                              animate={rowMotionEnabled}
                              className="overlay-num-cell-inner overlay-cell-text-inner"
                              style={overlayCellOutlineStyle}
                            />
                          </td>
                          {showCombinedColumn && (
                            <td className={`${effectiveRowCls} overlay-col-total text-center font-bold`}>
                              <OverlayTableNumCell
                                value={m.account + m.toon}
                                format={fmtTotalCell}
                                animate={rowMotionEnabled}
                                className="overlay-num-cell-inner overlay-cell-text-inner"
                                style={overlayCellOutlineStyle}
                              />
                            </td>
                          )}
                          {showContributionColumn && (
                            <td className={`${effectiveRowCls} overlay-col-contribution text-center font-semibold`}>
                              <OverlayTableNumCell
                                value={getContributionValueForMember(m)}
                                format={fmt}
                                animate={rowMotionEnabled}
                                className="overlay-num-cell-inner overlay-cell-text-inner"
                                style={overlayCellOutlineStyle}
                              />
                            </td>
                          )}
                          {showRestroomColumn && (
                            <td className={`${effectiveRowCls} overlay-col-restroom text-center font-semibold`}>
                              {isRestroomUnlimited(getRestroomValueForMember(m)) ? (
                                <span className="overlay-num-cell-inner overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                                  {fmtRestroom(RESTROOM_UNLIMITED)}
                                </span>
                              ) : (
                                <OverlayTableNumCell
                                  value={getRestroomValueForMember(m)}
                                  format={fmtRestroom}
                                  animate={rowMotionEnabled}
                                  className="overlay-num-cell-inner overlay-cell-text-inner"
                                  style={overlayCellOutlineStyle}
                                />
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {panel.includePinned ? visiblePinned.map((m) => (
                      <tr
                        key={m.id + "-p"}
                        ref={rowMotionEnabled ? setRowRef(m.id + "-p") : undefined}
                        className={`overlay-row ${rowMotionEnabled ? "transition-transform will-change-transform" : ""} ${rowMotionEnabled && changedIds.has(m.id) ? "animate-row-flash" : ""}`}
                      >
                        <td className={`${effectiveRowCls} overlay-col-rank text-center overlay-rank-cell`}>
                          <span className="overlay-rank-mark overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                            {" "}
                          </span>
                        </td>
                        {hasRoleColumn && (
                          <td className={`${effectiveRowCls} overlay-col-role`}>
                            <span className="overlay-rank-mark overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                              {" "}
                            </span>
                          </td>
                        )}
                        <td className={`${effectiveRowCls} overlay-col-name text-center ${effectiveNameCls} ${nameWrapCls}`}>
                          <span className={`overlay-cell-text-inner ${nameWrapCls}`} style={overlayCellOutlineStyle}>
                            {m.name}
                          </span>
                        </td>
                        <td className={`${effectiveRowCls} overlay-col-account ${effectiveAccountCls} overlay-account-cell text-center`}>
                          <OverlayTableNumCell
                            value={m.account}
                            format={fmt}
                            animate={rowMotionEnabled}
                            className="overlay-num-cell-inner overlay-cell-text-inner"
                            style={overlayCellOutlineStyle}
                          />
                        </td>
                        <td className={`${effectiveRowCls} overlay-col-toon ${effectiveToonCls} overlay-toon-cell text-center`}>
                          <OverlayTableNumCell
                            value={m.toon}
                            format={fmt}
                            animate={rowMotionEnabled}
                            className="overlay-num-cell-inner overlay-cell-text-inner"
                            style={overlayCellOutlineStyle}
                          />
                        </td>
                        {showCombinedColumn && (
                          <td className={`${effectiveRowCls} overlay-col-total text-center font-bold`}>
                            <OverlayTableNumCell
                              value={m.account + m.toon}
                              format={fmtTotalCell}
                              animate={rowMotionEnabled}
                              className="overlay-num-cell-inner overlay-cell-text-inner"
                              style={overlayCellOutlineStyle}
                            />
                          </td>
                        )}
                        {showContributionColumn && (
                          <td className={`${effectiveRowCls} overlay-col-contribution text-center font-semibold`}>
                            <span className="overlay-num-cell-inner overlay-cell-text-inner overlay-rank-mark" style={overlayCellOutlineStyle}>
                              {" "}
                            </span>
                          </td>
                        )}
                        {showRestroomColumn && (
                          <td className={`${effectiveRowCls} overlay-col-restroom text-center font-semibold`}>
                            {isRestroomUnlimited(getRestroomValueForMember(m)) ? (
                              <span className="overlay-num-cell-inner overlay-cell-text-inner" style={overlayCellOutlineStyle}>
                                {fmtRestroom(RESTROOM_UNLIMITED)}
                              </span>
                            ) : (
                              <OverlayTableNumCell
                                value={getRestroomValueForMember(m)}
                                format={fmtRestroom}
                                animate={rowMotionEnabled}
                                className="overlay-num-cell-inner overlay-cell-text-inner"
                                style={overlayCellOutlineStyle}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    )) : null}
                    {panel.includeTotal && showTableSumRow && ready && (
                      <tr className="overlay-total-row">
                        <td className={`${overlayTotalRowCls} overlay-col-rank`} colSpan={hasRoleColumn ? 2 : 1}>총합</td>
                        <td className={`${overlayTotalRowCls} overlay-col-name`} />
                        <td className={`${overlayTotalRowCls} overlay-col-account overlay-account-cell text-center`}>
                          <OverlayTableNumCell
                            value={sumAccount}
                            format={fmt}
                            animate={rowMotionEnabled}
                            className="overlay-num-cell-inner overlay-cell-text-inner"
                            style={overlayCellOutlineStyle}
                          />
                        </td>
                        <td className={`${overlayTotalRowCls} overlay-col-toon overlay-toon-cell text-center`}>
                          <OverlayTableNumCell
                            value={sumToon}
                            format={fmt}
                            animate={rowMotionEnabled}
                            className="overlay-num-cell-inner overlay-cell-text-inner"
                            style={overlayCellOutlineStyle}
                          />
                        </td>
                        {showCombinedColumn && (
                          <td className={`${overlayTotalRowCls} overlay-col-total text-center`}>
                            <OverlayTableNumCell
                              value={sumCombined}
                              format={fmt}
                              animate={rowMotionEnabled}
                              className="overlay-num-cell-inner overlay-cell-text-inner"
                              style={overlayCellOutlineStyle}
                            />
                          </td>
                        )}
                        {showContributionColumn && showContributionSum && (
                          <td className={`${overlayTotalRowCls} overlay-col-contribution text-center`}>
                            <OverlayTableNumCell
                              value={sumContribution}
                              format={fmt}
                              animate={rowMotionEnabled}
                              className="overlay-num-cell-inner overlay-cell-text-inner"
                              style={overlayCellOutlineStyle}
                            />
                          </td>
                        )}
                        {showContributionColumn && !showContributionSum && (
                          <td className={`${overlayTotalRowCls} overlay-col-contribution text-center`} />
                        )}
                        {showRestroomColumn && (
                          <td className={`${overlayTotalRowCls} overlay-col-restroom text-center`} />
                        )}
                      </tr>
                    )}
                  </tbody>
                </table>
                    ))}
                    </div>
                  </div>
                </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {showTeamBattle && teamBattleBoard && (ready || isPreviewGuide || externalHost) && (
          <div
            className={`absolute ${posClass(teamBattleAnchor)} z-[9000]`}
            style={{ width: "min(92vw, 680px)" }}
          >
            <BattleTeamColumnBoard
              leftScore={teamBattleBoard.aScore}
              rightScore={teamBattleBoard.bScore}
              leftMemberLabel={teamBattleBoard.aNames}
              rightMemberLabel={teamBattleBoard.bNames}
              gapSuffix={teamBattleBoard.useRaw ? "원" : ""}
              timerSlot={
                matchTimerAllowed && matchTimerText ? (
                  <div
                    className={`inline-flex items-center justify-center rounded-md px-2.5 py-0.5 font-black tabular-nums text-white ring-1 ring-white/15 ${
                      matchServerTimer.paused ? "bg-neutral-700/90" : "bg-neutral-950/85"
                    } text-lg sm:text-xl`}
                  >
                    <span suppressHydrationWarning>{matchTimerText}</span>
                  </div>
                ) : null
              }
            />
          </div>
        )}
        {(showGoal || fallbackShowGoal) && (ready || isPreviewGuide || externalHost) && goal > 0 && (
          <div className={`absolute ${posClass(goalAnchor)}`}>
            <GoalBar
              current={liveGoalCurrent}
              goal={goal}
              label={goalLabel}
              width={responsiveGoalWidth}
              opacityPercent={goalOpacity}
              opacityAffectsText={goalOpacityAffectsText}
              textColor={goalTextColor}
              fontSizePx={goalFontSizePx}
              textOutlineColor={goalTextOutlineColor}
              textOutlineWidthPx={goalTextOutlineWidthPx}
              barBgColor={goalBarBgColor}
              barFillColor={goalBarFillColor}
              barGifUrl={showGoalBarGif ? goalBarGifUrl : undefined}
              barGifOpacity={goalBarGifOpacity}
              barGifBrightness={goalBarGifBrightness}
              fontFamilyCss={goalFontFamilyCss}
              animationMode={goalBarAnimationMode}
              fontWeight={goalFontWeight}
              sharpRender={overlayTextSharpRender}
              amountFormat={donorsFormat}
              locale={currencyLocale}
            />
          </div>
        )}
        {showPersonalGoal && (ready || isPreviewGuide || externalHost) && (
          renderPersonalGoal()
        )}
        {showTimer &&
          effectiveTimerAllowed &&
          (ready || isPreviewGuide || externalHost) &&
          !(showTeamBattle && teamBattleBoard) && (
          <div className={`absolute ${posClass(timerAnchor)} z-[10000]`}>
            {timerDesign === "flip-countdown" ? (
              <FlipCountdownTimer
                remainingSeconds={serverTimer.remainingSeconds}
                showHours={timerShowHours}
                fontSize={timerFontSize}
                fontFamily={timerFontFamily}
                fontColor={timerFontColor}
                bgColor={timerBgColor}
                bgOpacity={timerBgOpacity}
                sharpRender={overlayTextSharpRender}
              />
            ) : timerDesign === "led-matrix" ? (
              <LedMatrixTimer
                remainingSeconds={serverTimer.remainingSeconds}
                showHours={timerShowHours}
                fontSize={timerFontSize}
                fontColor={timerFontColor}
                bgColor={timerBgColor}
                borderColor={timerBorderColor}
                bgOpacity={timerBgOpacity}
              />
            ) : isImageFrameTimerDesign(timerDesign) ? (
              <CircularImageTimer
                remainingSeconds={serverTimer.remainingSeconds}
                showHours={timerShowHours}
                design={timerDesign}
                fontSize={timerFontSize}
                fontFamily={timerFontFamily}
                fontColor={timerFontColor}
              />
            ) : (
              <Timer
                elapsed={timerText}
                fontSize={timerFontSize}
                fontFamily={timerFontFamily}
                fontColor={timerFontColor}
                bgColor={timerBgColor}
                borderColor={timerBorderColor}
                outlineColor={timerOutlineColor}
                outlineWidth={timerOutlineWidth}
                bgOpacity={timerBgOpacity}
              />
            )}
          </div>
        )}
        {showMission && (ready || isPreviewGuide) && missions.length > 0 && (
          <div className={`absolute ${posClass(externalHost ? "cc" : missionAnchor)} z-[9990] pointer-events-none`} style={{ width: fitWidthToViewport(missionWidth) }}>
            <div className="pointer-events-auto">
              {missionDisplayMode === "vertical-slot" ? (
                <MissionBoardSlot
                  missions={missions}
                  fontSize={missionFontSize}
                  themeVariant={missionThemeVariant}
                  titleText={missionTitleTextCfg}
                  visibleCount={missionVisibleCount}
                  speed={missionSpeedSec}
                  gapSize={missionGapSizePx}
                  bgOpacity={missionBgOpacityCfg}
                  bgColor={missionBgColorCfg}
                  itemColor={missionItemColorCfg}
                  titleColor={missionTitleColorCfg}
                  titleEffect={missionTitleEffectCfg}
                />
              ) : (
                <MissionBoard
                  missions={missions}
                  fontSize={missionFontSize}
                  themeVariant={missionThemeVariant}
                  titleText={missionTitleTextCfg}
                  duration={missionSpeedSec}
                  bgOpacity={missionBgOpacityCfg}
                  bgColor={missionBgColorCfg}
                  itemColor={missionItemColorCfg}
                  titleColor={missionTitleColorCfg}
                  titleEffect={missionTitleEffectCfg}
                  effect={missionEffectCfg}
                  effectHotOnly={missionEffectHotOnlyCfg}
                />
              )}
            </div>
          </div>
        )}
        {!hostObs && !rawUserId ? (
          <div className="fixed top-2 left-2 z-[9999] px-2 py-0.5 rounded bg-amber-600/90 text-white text-[11px] font-semibold shadow">
            인증 누락: 기본 계정 사용 중
          </div>
        ) : null}
          </main>
        </div>
      </div>
    );
  }

export default function OverlayPage() {
  return (
    <Suspense>
      <OverlayToonationRelayHost />
      <OverlayInner />
    </Suspense>
  );
}
