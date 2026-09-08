import type { RouletteState, Member } from "@/types";
import type { AppState } from "@/lib/state";
import {
  normalizeOverlayPresetDonationGoals,
  isDonationInitGoalResetPatch,
  mergeOverlayPresetsPreservingEscalatedGoals,
} from "@/lib/goal-preset-math";
import { DEFAULT_SIG_INVENTORY } from "@/lib/constants";
import {
  DEFAULT_DONOR_RANKINGS_FULL_THEME,
  hasExpandedSigInventory,
  hasMeaningfulMemberRoster,
  hasCustomTimerDisplayStyles,
  isDefaultLikeDonorRankingsTheme,
  isDefaultLikeOverlayPresets,
  isDefaultLikeTimerDisplayStyle,
  isDefaultPlaceholderMemberList,
  isShrunkToDefaultSigInventory,
  membersDifferByIds,
  isMemberRosterStrictSuperset,
  mergeOverlaySettingsPreservingObsText,
  normalizeRouletteState,
  normalizeSigRolling,
} from "@/lib/state";
import type { SigItem } from "@/types";
import {
  mergeMemberRosterPreservingAmounts,
  mergeManualMemberFieldsFromPatch,
  resolveMembersAgainstZeroWipe,
} from "@/lib/member-roster-merge";
import { isManualOverlaySessionId } from "@/lib/sig-sales-manual-round";
import { createModuleLogger } from "@/lib/logger";
import { isRouletteLocked } from "@/app/api/roulette/roulette-lock";
import { mergeGeneralTimerPreferEffective } from "@/lib/timer-utils";
import { shouldBlockHighSocietyRegression, syncHighSocietyMemberWidthSnapshotInState } from "@/lib/high-society";
import { normalizeTerritoryLogs, mergeTerritoryLogsFromPatch } from "@/lib/territory-utils";
import { memberCombinedTotal } from "@/shell/state/state-freshness.guard";

export const logger = createModuleLogger('API/State');

export function buildStateUpdatedSsePayload(
  body: Partial<AppState> & {
    donorsAuthoritative?: boolean;
    donorsReplace?: boolean;
    settlementReset?: boolean;
    membersAuthoritative?: boolean;
    clearSigInventory?: boolean;
    clearSigSoldOutStamp?: boolean;
  },
  persisted: AppState,
  updatedAt: number,
  membersAuthoritative: boolean
): Record<string, unknown> {
  const pl: Record<string, unknown> = {
    type: "state_updated",
    updatedAt,
  };
  const donorRankingsUpdatedAt = Number(persisted.donorRankingsUpdatedAt || 0);
  if (donorRankingsUpdatedAt > 0) pl.donorRankingsUpdatedAt = donorRankingsUpdatedAt;
  const settlementResetAt = Number(persisted.settlementResetAt || 0);
  if (settlementResetAt > 0) pl.settlementResetAt = settlementResetAt;
  if (membersAuthoritative) pl.membersRosterUpdatedAt = updatedAt;

  let timerDisplayStylesUpdated = false;
  let generalTimerUpdated = false;
  try {
    timerDisplayStylesUpdated =
      body.timerDisplayStyles != null && typeof body.timerDisplayStyles === "object";
    generalTimerUpdated =
      (body.generalTimer != null && typeof body.generalTimer === "object") ||
      (body.matchTimer != null && typeof body.matchTimer === "object");
  } catch {
    /* noop */
  }
  if (timerDisplayStylesUpdated) pl.timerDisplayStylesUpdatedAt = updatedAt;
  if (generalTimerUpdated) pl.generalTimerUpdatedAt = updatedAt;

  return pl;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge<T>(base: T, patch: Partial<T>): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) {
    return (patch as T) ?? base;
  }
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    if (isPlainObject(cur) && isPlainObject(v)) {
      out[k] = deepMerge(cur, v);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function mergeRouletteUiPrefsOntoCurrent(
  current: RouletteState | undefined,
  patchRs: Partial<RouletteState> | undefined
): RouletteState {
  const out = normalizeRouletteState(current);
  if (!patchRs || typeof patchRs !== "object") return out;
  if (patchRs.menuCount !== undefined) {
    const n = Number(patchRs.menuCount);
    if (Number.isFinite(n)) {
      out.menuCount = Math.max(5, Math.min(20, Math.floor(n)));
    }
  }
  if (typeof patchRs.menuFillFromAllActive === "boolean") {
    out.menuFillFromAllActive = patchRs.menuFillFromAllActive;
  }
  if (patchRs.overlayOpacity !== undefined) {
    const o = Number(patchRs.overlayOpacity);
    if (Number.isFinite(o)) {
      out.overlayOpacity = Math.max(0.4, Math.min(1, o));
    }
  }
  if (patchRs.sigResultScalePct !== undefined) {
    const p = Number(patchRs.sigResultScalePct);
    if (Number.isFinite(p)) {
      out.sigResultScalePct = Math.max(50, Math.min(100, Math.floor(p)));
    }
  }
  if (Array.isArray(patchRs.historyLogs)) {
    out.historyLogs = patchRs.historyLogs
      .filter((x) => x && typeof x === "object")
      .slice(0, 50) as RouletteState["historyLogs"];
  }
  return out;
}

export function looksLikeAccidentalDefaultSigInventory(
  patch: SigItem[],
  base: SigItem[] | null | undefined
): boolean {
  if (!hasExpandedSigInventory(base)) return false;
  if (!Array.isArray(patch) || patch.length === 0) return false;
  if (patch.length > DEFAULT_SIG_INVENTORY.length + 3) return false;
  const defaultIds = new Set(DEFAULT_SIG_INVENTORY.map((x) => x.id));
  return patch.every((x) => defaultIds.has(String(x.id || "")));
}

export function mergePartialState(
  base: AppState,
  patch: Partial<AppState> & {
    settlementReset?: boolean;
    clearSigSoldOutStamp?: boolean;
    clearSigInventory?: boolean;
    membersAuthoritative?: boolean;
  },
  userId: string
): AppState {
  const next: AppState = {
    ...base,
    ...patch,
    matchTimerEnabled: patch.matchTimerEnabled
      ? deepMerge(base.matchTimerEnabled, patch.matchTimerEnabled)
      : base.matchTimerEnabled,
    timerDisplayStyles: patch.timerDisplayStyles
      ? deepMerge(base.timerDisplayStyles, patch.timerDisplayStyles)
      : base.timerDisplayStyles,
    sigSalesMemberPresets: patch.sigSalesMemberPresets
      ? deepMerge(base.sigSalesMemberPresets, patch.sigSalesMemberPresets)
      : base.sigSalesMemberPresets,
  };

  const patchSettlementReset = patch.settlementReset === true;
  const membersAuthoritative = patch.membersAuthoritative === true;
  if (!("members" in patch)) next.members = base.members;
  else if (patchSettlementReset || isDonationInitGoalResetPatch(patch)) {
    next.members = patch.members as Member[];
  } else if (membersAuthoritative) {
    next.members = mergeMemberRosterPreservingAmounts(
      base.members || [],
      patch.members as Member[]
    );
  } else if (
    base.settlementResetAt &&
    memberCombinedTotal(base.members) === 0 &&
    memberCombinedTotal(patch.members) > 0
  ) {
    next.members = base.members;
    logger.warn("members amount restore blocked after settlement reset", { userId });
  } else if (
    Array.isArray(patch.members) &&
    isDefaultPlaceholderMemberList(patch.members) &&
    hasMeaningfulMemberRoster(base)
  ) {
    next.members = base.members;
    next.memberPositions = base.memberPositions;
    logger.warn("members placeholder wipe blocked (theme/preset save)", { userId });
  } else if (Array.isArray(patch.members) && !isDonationInitGoalResetPatch(patch)) {
    const baseMembers = base.members || [];
    const patchMembers = patch.members as Member[];
    if (
      patchMembers.length < baseMembers.length ||
      (baseMembers.length > 0 &&
        membersDifferByIds(baseMembers, patchMembers) &&
        isMemberRosterStrictSuperset(baseMembers, patchMembers))
    ) {
      next.members = mergeManualMemberFieldsFromPatch(baseMembers, patchMembers);
      logger.warn("members non-authoritative shrink blocked", {
        userId,
        baseCount: baseMembers.length,
        patchCount: patchMembers.length,
      });
    } else {
      const zero = resolveMembersAgainstZeroWipe({
        baseMembers,
        patchMembers,
      });
      if (zero.blockedWipe) {
        next.members = zero.members;
        logger.warn(
          zero.rosterChanged
            ? "members zero wipe blocked — roster change accepted, amounts preserved"
            : "members zero wipe blocked — restroom/contribution merged from patch",
          { userId }
        );
      } else if (membersDifferByIds(baseMembers, patchMembers)) {
        next.members = mergeMemberRosterPreservingAmounts(baseMembers, patchMembers);
      }
    }
  }
  if (
    Array.isArray(patch.members) &&
    !patchSettlementReset &&
    !membersAuthoritative &&
    !isDonationInitGoalResetPatch(patch) &&
    Array.isArray(next.members)
  ) {
    const before = next.members;
    next.members = mergeManualMemberFieldsFromPatch(before, patch.members as Member[]);
    const nameChanged = before.some((b, i) => b.name !== next.members[i]?.name);
    if (nameChanged) {
      logger.info("members identity merged from patch", { userId });
    }
  }
  if (!("memberPositions" in patch)) next.memberPositions = base.memberPositions;
  else if (membersAuthoritative || patchSettlementReset) {
    next.memberPositions = patch.memberPositions as AppState["memberPositions"];
  }
  if (!("memberPositionMode" in patch)) next.memberPositionMode = base.memberPositionMode;
  if (!("rankPositionLabels" in patch)) next.rankPositionLabels = base.rankPositionLabels;
  if (!("donorRankingsTheme" in patch)) next.donorRankingsTheme = base.donorRankingsTheme;
  else if (
    patch.donorRankingsTheme &&
    isDefaultLikeDonorRankingsTheme(patch.donorRankingsTheme as AppState["donorRankingsTheme"]) &&
    !isDefaultLikeDonorRankingsTheme(base.donorRankingsTheme)
  ) {
    next.donorRankingsTheme = base.donorRankingsTheme;
    logger.warn("donorRankingsTheme default wipe blocked", { userId });
  }
  if (!("donorRankingsFullTheme" in patch)) next.donorRankingsFullTheme = base.donorRankingsFullTheme;
  else if (
    patch.donorRankingsFullTheme &&
    isDefaultLikeDonorRankingsTheme(
      patch.donorRankingsFullTheme as AppState["donorRankingsFullTheme"],
      DEFAULT_DONOR_RANKINGS_FULL_THEME
    ) &&
    !isDefaultLikeDonorRankingsTheme(base.donorRankingsFullTheme, DEFAULT_DONOR_RANKINGS_FULL_THEME)
  ) {
    next.donorRankingsFullTheme = base.donorRankingsFullTheme;
    logger.warn("donorRankingsFullTheme default wipe blocked", { userId });
  }
  if (
    "timerDisplayStyles" in patch &&
    hasCustomTimerDisplayStyles(base.timerDisplayStyles) &&
    isDefaultLikeTimerDisplayStyle(
      (patch.timerDisplayStyles as AppState["timerDisplayStyles"] | undefined)?.general
    )
  ) {
    const patchGeneral = (patch.timerDisplayStyles as AppState["timerDisplayStyles"] | undefined)
      ?.general;
    const baseGeneral = base.timerDisplayStyles?.general;
    if (patchGeneral && baseGeneral) {
      next.timerDisplayStyles = {
        ...base.timerDisplayStyles!,
        general: {
          ...baseGeneral,
          ...(patchGeneral.outlineWidth !== undefined
            ? { outlineWidth: patchGeneral.outlineWidth }
            : {}),
          ...(patchGeneral.outlineColor !== undefined
            ? { outlineColor: patchGeneral.outlineColor }
            : {}),
          ...(patchGeneral.showHours !== undefined ? { showHours: patchGeneral.showHours } : {}),
          ...(patchGeneral.fontFamily !== undefined ? { fontFamily: patchGeneral.fontFamily } : {}),
          ...(patchGeneral.scalePercent !== undefined
            ? { scalePercent: patchGeneral.scalePercent }
            : {}),
          ...(patchGeneral.design !== undefined
            ? { design: patchGeneral.design }
            : {}),
          ...(patchGeneral.fontColor !== undefined
            ? { fontColor: patchGeneral.fontColor }
            : {}),
          ...(patchGeneral.bgColor !== undefined ? { bgColor: patchGeneral.bgColor } : {}),
          ...(patchGeneral.borderColor !== undefined
            ? { borderColor: patchGeneral.borderColor }
            : {}),
          ...(patchGeneral.bgOpacity !== undefined ? { bgOpacity: patchGeneral.bgOpacity } : {}),
        },
      };
    } else {
      next.timerDisplayStyles = base.timerDisplayStyles;
    }
    logger.warn("timerDisplayStyles default wipe blocked", { userId });
  }
  if (!("donorRankingsPresets" in patch)) next.donorRankingsPresets = base.donorRankingsPresets;
  if (!("donorRankingsPresetId" in patch)) next.donorRankingsPresetId = base.donorRankingsPresetId;
  if (!("donorsFormat" in patch)) next.donorsFormat = base.donorsFormat;
  if (!("forbiddenWords" in patch)) next.forbiddenWords = base.forbiddenWords;
  if (!("missions" in patch)) next.missions = base.missions;
  if (!("sigInventory" in patch)) {
    next.sigInventory = base.sigInventory;
  } else if (
    Array.isArray(patch.sigInventory) &&
    patch.clearSigInventory !== true &&
    (looksLikeAccidentalDefaultSigInventory(patch.sigInventory, base.sigInventory) ||
      (isShrunkToDefaultSigInventory(patch.sigInventory) &&
        hasExpandedSigInventory(base.sigInventory)))
  ) {
    next.sigInventory = base.sigInventory;
    logger.warn("sigInventory 기본 프리셋 덮어쓰기 차단", {
      userId,
      baseLen: base.sigInventory?.length ?? 0,
      patchLen: patch.sigInventory.length,
    });
  }
  if (!("sigSoldOutStampUrl" in patch)) {
    next.sigSoldOutStampUrl = base.sigSoldOutStampUrl;
  } else if (
    String(base.sigSoldOutStampUrl || "").trim() &&
    !String((patch as AppState).sigSoldOutStampUrl || "").trim() &&
    patch.clearSigSoldOutStamp !== true &&
    patch.settlementReset !== true
  ) {
    next.sigSoldOutStampUrl = base.sigSoldOutStampUrl;
    logger.warn("sigSoldOutStampUrl empty wipe blocked", { userId });
  }
  if (!("sigSalesExcludedIds" in patch)) next.sigSalesExcludedIds = base.sigSalesExcludedIds;
  if (!("overlayPresets" in patch)) {
    next.overlayPresets = base.overlayPresets;
  } else if (isDonationInitGoalResetPatch(patch)) {
    next.overlayPresets = patch.overlayPresets as AppState["overlayPresets"];
  } else if (
    isDefaultLikeOverlayPresets(patch.overlayPresets) &&
    !isDefaultLikeOverlayPresets(base.overlayPresets)
  ) {
    next.overlayPresets = base.overlayPresets;
    logger.warn("overlayPresets default wipe blocked", { userId });
  } else {
    next.overlayPresets = mergeOverlayPresetsPreservingEscalatedGoals(
      base.overlayPresets,
      patch.overlayPresets
    ) as AppState["overlayPresets"];
  }
  if ("overlaySettings" in patch && patch.overlaySettings != null && typeof patch.overlaySettings === "object") {
    const baseOs =
      base.overlaySettings && typeof base.overlaySettings === "object"
        ? (base.overlaySettings as Record<string, unknown>)
        : {};
    const patchOs = patch.overlaySettings as Record<string, unknown>;
    next.overlaySettings = mergeOverlaySettingsPreservingObsText(baseOs, patchOs);
  } else if (!("overlaySettings" in patch)) {
    next.overlaySettings = base.overlaySettings;
  }
  if (!("sigMatch" in patch)) next.sigMatch = base.sigMatch;
  if (!("sigMatchSettings" in patch)) next.sigMatchSettings = base.sigMatchSettings;
  if (!("highSocietySettings" in patch)) {
    next.highSocietySettings = base.highSocietySettings;
  } else if (
    patch.highSocietySettings &&
    shouldBlockHighSocietyRegression(base.highSocietySettings, patch.highSocietySettings)
  ) {
    next.highSocietySettings = base.highSocietySettings;
    logger.warn("highSocietySettings default wipe blocked", { userId });
  }
  if (!("territoryLogs" in patch)) {
    next.territoryLogs = base.territoryLogs;
  } else if (Array.isArray(patch.territoryLogs)) {
    next.territoryLogs = mergeTerritoryLogsFromPatch(base.territoryLogs, patch.territoryLogs);
  }
  if (!("donors" in patch)) {
    next.donors = base.donors;
  } else if (
    // ==================== Fix⑯_EmptyDonorsMembers_ShrinkGuard (스트레스 테스트 발견 치명적 Bug) ====================
    // ROOT CAUSE: 브라우저가 localStorage 없는 새 유저 URL(?u=stress-tester-din)으로 접속시 SSR 초기 빈 state [] 를 POST
    //   → patch.donors = [] 이고 base.donors = 819건 richer 상태에서 무조건 덮어쓰면서 1200건 후원 데이터 전부 유실 Bug 재현
    // GUARD RULE: 아래 4가지 조건 모두 만족하면 incoming 빈 donors patch를 REJECT 하고 base.donors 그대로 보존
    //   ① patch.donors 가 빈 array (length 0)
    //   ② base.donors 가 유의미하게 존재 (10건 이상 OR 총후원액 ≥ 1000원)
    //   ③ 명시적 정산 리셋 아님 (patchSettlementReset !== true)  → 정산 리셋시는 당연히 0건으로 만들어야 하니 허용
    //   ④ 암묵적 정산 리셋 증거 없음 (next.settlementResetAt 이 base 보다 미래 시점으로 상승 AND 멤버합 0원) → 허용
    // 결과: 정산 리셋 의도가 없는 빈 array patch는 무조건 REJECT → 데이터 유실 원천 봉쇄
    Array.isArray(patch.donors) &&
    patch.donors.length === 0 &&
    !patchSettlementReset &&
    (() => {
      const baseDonors = Array.isArray(base.donors) ? base.donors : [];
      const baseDonorCount = baseDonors.length;
      const baseDonorTotal = baseDonors.reduce((s, d) => s + Number(d?.amount || 0), 0);
      const baseHasRichDonors = baseDonorCount >= 10 || baseDonorTotal >= 1000;
      if (!baseHasRichDonors) return false;
      const baseResetAt = Number(base.settlementResetAt || 0);
      const nextResetAt = Number(next.settlementResetAt || patch.settlementResetAt || 0);
      const patchMemberTotal = (Array.isArray(patch.members) ? patch.members : []).reduce(
        (s, m) => s + Number(m?.account || 0) + Number(m?.toon || 0),
        0
      );
      const isImplicitSettlementReset =
        nextResetAt > baseResetAt && nextResetAt > 0 && patchMemberTotal < 0.1;
      // 정산 리셋 증거 있으면 → 빈 donors 허용 (의도한 동작)
      if (isImplicitSettlementReset) return false;
      // 그 외 모든 경우 → incoming 빈 donors REJECT, base.donors 보존
      next.donors = base.donors;
      logger.warn("Fix⑯ donors empty-shrink-guard REJECTED incoming [] patch, preserved base donors", {
        userId,
        baseCount: baseDonorCount,
        baseTotal: Math.round(baseDonorTotal),
        baseResetAt,
        nextResetAt,
        patchMemberTotal: Math.round(patchMemberTotal),
      });
      return true;
    })()
  ) {
    // guard body = 위 IIFE에서 이미 next.donors = base.donors 로 치환 완료했으므로 추가 작업 없음
  }
  // ==================== End Fix⑯_ShrinkGuard ====================
  if (!("mealBattle" in patch)) next.mealBattle = base.mealBattle;
  if (!("mealMatch" in patch)) next.mealMatch = base.mealMatch;
  if (!("mealMatchSettings" in patch)) next.mealMatchSettings = base.mealMatchSettings;
  if ("generalTimer" in patch && patch.generalTimer != null) {
    next.generalTimer = mergeGeneralTimerPreferEffective(base.generalTimer, patch.generalTimer as AppState["generalTimer"]);
  } else if (!("generalTimer" in patch)) {
    next.generalTimer = base.generalTimer;
  }
  if ("matchTimer" in patch && patch.matchTimer != null) {
    next.matchTimer = mergeGeneralTimerPreferEffective(
      base.matchTimer ?? base.generalTimer,
      patch.matchTimer as AppState["matchTimer"]
    );
  } else if (!("matchTimer" in patch)) {
    next.matchTimer = base.matchTimer;
  }
  if (!("donorRankingsOverlayConfig" in patch)) next.donorRankingsOverlayConfig = base.donorRankingsOverlayConfig;
  if (!("donorRankingsFullOverlayConfig" in patch))
    next.donorRankingsFullOverlayConfig = base.donorRankingsFullOverlayConfig;
  if (!("donationListsOverlayConfig" in patch)) next.donationListsOverlayConfig = base.donationListsOverlayConfig;
  if (!("sigRolling" in patch)) next.sigRolling = base.sigRolling ?? normalizeSigRolling(null);
  if (!("sigRollingMeta" in patch)) next.sigRollingMeta = base.sigRollingMeta ?? {};

  const patchRsEarly =
    patch.rouletteState != null && typeof patch.rouletteState === "object"
      ? (patch.rouletteState as Partial<RouletteState>)
      : null;
  const baseStartedAt = Number(base.rouletteState?.startedAt || 0);
  const patchStartedAt = Number(patchRsEarly?.startedAt || 0);
  const patchHasRollingFlag = typeof patchRsEarly?.isRolling === "boolean";
  const patchReloadNonce = Number(patchRsEarly?.overlayReloadNonce || 0);
  const baseReloadNonce = Number(base.rouletteState?.overlayReloadNonce || 0);
  const manualNonceAdvanced =
    patchRsEarly != null &&
    isManualOverlaySessionId(patchRsEarly.sessionId) &&
    patchReloadNonce > baseReloadNonce;
  const canApplyPatchRouletteState =
    "rouletteState" in patch &&
    !isRouletteLocked(userId) &&
    (manualNonceAdvanced ||
      (Number.isFinite(patchStartedAt) &&
        (patchStartedAt > baseStartedAt ||
          (patchStartedAt === baseStartedAt && patchHasRollingFlag))));
  if (!canApplyPatchRouletteState) {
    next.rouletteState = base.rouletteState;
  }

  if ("rouletteState" in patch && patch.rouletteState != null && typeof patch.rouletteState === "object") {
    const patchRs = patch.rouletteState as Partial<RouletteState>;
    const isManualRoulettePatch =
      isManualOverlaySessionId(patchRs.sessionId) &&
      (patchRs.phase === "LANDED" ||
        patchRs.phase === "CONFIRMED" ||
        patchRs.phase === "CONFIRM_PENDING" ||
        (patchRs.phase === "IDLE" && manualNonceAdvanced));
    if (isManualRoulettePatch && canApplyPatchRouletteState) {
      const mergedRs = {
        ...(next.rouletteState || base.rouletteState),
        ...patchRs,
      };
      if (patchRs.phase === "IDLE" && manualNonceAdvanced) {
        mergedRs.selectedSigs = undefined;
        mergedRs.results = undefined;
        mergedRs.result = null;
        mergedRs.oneShotResult = null;
      }
      next.rouletteState = normalizeRouletteState(mergedRs);
    } else {
      next.rouletteState = mergeRouletteUiPrefsOntoCurrent(next.rouletteState, patchRs);
    }
  }

  if (!patchSettlementReset) {
    const baseReset = Number(base.settlementResetAt || 0);
    const patchReset = Number(next.settlementResetAt || 0);
    // ==================== FixA_settlementResetAt_MonotonicIncrease (2026-09-08 hotfix-6-10-3) ====================
    // ROOT CAUSE 봉쇄: settlementResetAt은 시간이 거꾸로 가지 않으므로 단조증가(MAX)만 적용. 절대 undefined 로 날리지 않는다.
    // (이전 코드는 baseReset=0 이면 resetAt을 undefined 로 날려 → 리셋시점 유실 → 과거 후원이 리셋 후 유효후원으로 오판 → 쓰레기값 누적 Bug)
    const finalReset = Math.max(baseReset, patchReset);
    // 암묵적 정산 리셋 증거: donors=빈 배열 AND 멤버 금액합=0 AND patchReset>baseReset → 정산 리셋 플래그로 취급해 patchReset 허용
    const donorEmpty = Array.isArray(next.donors) && next.donors.length === 0;
    const memZero = Array.isArray(next.members) && next.members.reduce((s, m) => s + (Number(m.account || 0) + Number(m.toon || 0)), 0) < 0.1;
    const implicitReset = donorEmpty && memZero && patchReset > baseReset && patchReset > 0;
    if (patchReset !== baseReset) {
      if (patchReset > baseReset && !implicitReset) {
        // 정산 리셋 플래그 없고 암묵적 증거도 없으면 → MAX 값 쓰되 경고만 로그 (이전처럼 상승 차단 ❌ → 리셋 시점을 절대 과거로 돌리지 않음)
        logger.warn("settlementResetAt raise accepted without explicit settlementReset flag (monotonic max guard)", {
          userId,
          baseReset,
          patchReset,
          finalReset,
          implicitReset,
        });
      }
      // finalReset = MAX(baseReset, patchReset). 절대 undefined 사용 금지! baseReset=0 patchReset=0 이면 0 유지.
      next.settlementResetAt = finalReset > 0 ? finalReset : (baseReset > 0 ? baseReset : (patchReset > 0 ? patchReset : 0));
    }
    // ==================== End FixA ====================
  }

  return next;
}

export function applyDonationGoalPresetNormalization(state: AppState): AppState {
  const presets = normalizeOverlayPresetDonationGoals(
    Array.isArray(state.overlayPresets) ? state.overlayPresets : []
  );
  return { ...state, overlayPresets: presets as AppState["overlayPresets"] };
}
