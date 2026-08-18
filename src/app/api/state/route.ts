export const revalidate = 0;

import type { RouletteState, Member } from "@/types";
import type { AppState } from "@/lib/state";
import {
  applyDonationGoalEscalationToState,
  isDonationInitGoalResetPatch,
  mergeOverlayPresetsPreservingEscalatedGoals,
  normalizeOverlayPresetDonationGoals,
} from "@/lib/goal-preset-math";
import { DEFAULT_SIG_INVENTORY } from "@/lib/constants";
import {
  defaultState,
  DEFAULT_DONOR_RANKINGS_FULL_THEME,
  applySettlementResetDonorPipeline,
  rebumpDonorsPastSettlementReset,
  coalesceSettlementResetAt,
  hasExpandedSigInventory,
  hasMeaningfulMemberRoster,
  hasCustomTimerDisplayStyles,
  isDefaultLikeDonorRankingsTheme,
  isDefaultLikeOverlayPresets,
  isDefaultLikeTimerDisplayStyle,
  isDefaultPlaceholderMemberList,
  isShrunkToDefaultSigInventory,
  mergeDonorsForMultiTabSave,
  isIntentionalDonorListShrink,
  isDonorListMemberReassignment,
  membersDifferByIds,
  isMemberRosterStrictSuperset,
  mergeOverlaySettingsPreservingObsText,
  normalizeDonorsArray,
  normalizeRouletteState,
  normalizeSigRolling,
  shouldBlockAccidentalEmptyOverwrite,
  totalCombined,
} from "@/lib/state";
import type { SigItem } from "@/types";
import { sanitizeAppStateWheelDemo } from "@/lib/sig-wheel-demo-pool";
import {
  dedupeDonorRows,
  repairMemberTotalsForDonorRoster,
  syncMemberTotalsFromDonors,
} from "@/lib/donation/apply-donation-state";
import { guardMemberTotalsAgainstAccidentalZeroWipe, shouldRefuseMassEmptyAuthoritativeDonorWipe } from "@/lib/donation/zero-wipe-guard";
import { isGroupSplitDonorListMutation } from "@/lib/donation/group-split-donation";
import {
  mergeManualMemberFieldsFromPatch,
  mergeMemberRosterPreservingAmounts,
  resolveMembersAgainstZeroWipe,
} from "@/lib/member-roster-merge";
import { isManualOverlaySessionId } from "@/lib/sig-sales-manual-round";
import { createModuleLogger } from "@/lib/logger";
import { isLegacyMigrationTargetUserId } from "@/lib/legacy-migration";
import { pickFresherAppState } from "@/lib/app-state-freshness";
import { coalesceAppStateRedisAndMemory } from "@/lib/app-state-server-load";
import { saveAppStateForRoulette } from "../roulette/edge-state-store";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { isRouletteLocked } from "../roulette/roulette-lock";
import { mergeGeneralTimerPreferEffective } from "@/lib/timer-utils";
import { getUserIdFromRequest } from "../_shared/user-id";
import { getPersistentKvLastError, isPersistentKvConfigured, ensureMysqlKvBackend } from "../_shared/upstash";
import {
  upstashGetAppStateJson,
  upstashSetAppStateJson,
} from "../_shared/upstash-app-state";
import {
  enrichAppStateWithSigInventoryBackup,
  saveSigInventoryBackup,
} from "@/lib/sig-inventory-backup";
import {
  clearDonationRosterBackup,
  enrichAppStateWithDonationRosterBackup,
  saveDonationRosterBackup,
} from "@/lib/donation-roster-backup";
import { shouldBlockHighSocietyRegression } from "@/lib/high-society";

const logger = createModuleLogger('API/State');

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";

function getUserId(req: Request): string | null {
  return getUserIdFromRequest(req);
}

function stateKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge<T>(base: T, patch: Partial<T>): T {
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

/** 클라이언트가 보낸 rouletteState 에서 메뉴 수·UI 설정만 현재 서버 상태 위에 얹음(스핀 결과 필드는 무시) */
function mergeRouletteUiPrefsOntoCurrent(
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

function applyDonationGoalPresetNormalization(state: AppState): AppState {
  const presets = normalizeOverlayPresetDonationGoals(
    Array.isArray(state.overlayPresets) ? state.overlayPresets : []
  );
  return { ...state, overlayPresets: presets as AppState["overlayPresets"] };
}

/** 서버 장애·defaultState 저장 시 기본(한방 시그만) 목록으로 커스텀 시그 전체가 지워지는 사고 방지 */
function looksLikeAccidentalDefaultSigInventory(
  patch: SigItem[],
  base: SigItem[] | null | undefined
): boolean {
  if (!hasExpandedSigInventory(base)) return false;
  if (!Array.isArray(patch) || patch.length === 0) return false;
  if (patch.length > DEFAULT_SIG_INVENTORY.length + 3) return false;
  const defaultIds = new Set(DEFAULT_SIG_INVENTORY.map((x) => x.id));
  return patch.every((x) => defaultIds.has(String(x.id || "")));
}

function memberCombinedTotal(members: Member[] | undefined): number {
  return (members || []).reduce((sum, m) => sum + (m.account || 0) + (m.toon || 0), 0);
}

function mergePartialState(
  base: AppState,
  patch: Partial<AppState> & {
    settlementReset?: boolean;
    clearSigSoldOutStamp?: boolean;
    membersAuthoritative?: boolean;
  },
  userId: string
): AppState {
  const next: AppState = {
    ...base,
    ...patch,
    // 중첩 객체는 deep merge로 처리
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

  // patch에 없는 필드가 undefined로 덮이지 않도록 보정
  const patchSettlementReset = patch.settlementReset === true;
  const membersAuthoritative = patch.membersAuthoritative === true;
  if (!("members" in patch)) next.members = base.members;
  else if (patchSettlementReset || isDonationInitGoalResetPatch(patch)) {
    next.members = patch.members as Member[];
  } else if (membersAuthoritative) {
    /**
     * 멤버 추가·삭제 권위: 로스터(id·순서)는 patch 를 따르되,
     * 기존 멤버 금액이 0으로 오면 base 금액을 유지(후원 있는 상태 멤버 추가 시 엑셀 초기화 방지).
     */
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
    /**
     * 테마·시그 등 비권한 저장이 짧은 members 로 서버 로스터를 덮지 않음.
     * (멤버 추가 직후 stale PATCH 가 추가분을 지우는 회귀 — 축소는 membersAuthoritative 만)
     */
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
        /** 금액 있는 추가·개명 — patch 로스터를 따르되 base 금액 보존 */
        next.members = mergeMemberRosterPreservingAmounts(baseMembers, patchMembers);
      }
      /** else: 동일 id·금액 있음 → spread 의 patch.members 유지 후 아래 identity merge */
    }
  }
  /**
   * 금액 가드/부분 병합 후에도 patch의 실멤버명·목표·운영비는 항상 반영.
   * base 기준으로 병합해 비권한 축소가 다시 끼어들지 않게 한다.
   */
  if (
    Array.isArray(patch.members) &&
    !patchSettlementReset &&
    !membersAuthoritative &&
    !isDonationInitGoalResetPatch(patch) &&
    Array.isArray(next.members)
  ) {
    const before = next.members;
    /** 이미 base 상위집합을 지킨 경우 before 가 base — patch 필드만 얹음 */
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
      /** 색상·hidden 기본 wipe 는 막되, 표시 옵션은 patch 반영 */
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
    /** 다른 PC·시각 저장의 빈 값이 커스텀 판매완료 도장을 지우지 않음 */
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

  // rouletteState는 /api/roulette/spin, /api/roulette/finish 전용으로 관리한다.
  // Edge 런타임에서는 인메모리 lock이 인스턴스 간 공유되지 않아 /api/state 저장과 경합할 수 있으므로
  // /api/state 경로에서 들어온 rouletteState는 "더 최신 startedAt"인 경우에만 제한적으로 반영한다.
  // 대부분의 일반 저장은 base를 유지해 스핀 상태 덮어쓰기를 방지한다.
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
      /** 수동 IDLE 리셋 — spread만으로는 selectedSigs가 남을 수 있어 명시 클리어 */
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

  /**
   * 사용자 명시 settlementReset 없이 settlementResetAt 상승 금지.
   * (클라이언트가 Date.now() 를 실어 보내 후원이 자동 필터·초기화되는 경로 차단)
   */
  if (!patchSettlementReset) {
    const baseReset = Number(base.settlementResetAt || 0);
    const patchReset = Number(next.settlementResetAt || 0);
    if (patchReset !== baseReset) {
      next.settlementResetAt = baseReset > 0 ? baseReset : undefined;
      if (patchReset > baseReset) {
        logger.warn("settlementResetAt raise blocked without settlementReset flag", {
          userId,
          baseReset,
          patchReset,
        });
      }
    }
  }

  return next;
}

async function upstashGet<T = unknown>(key: string): Promise<T | null> {
  return upstashGetAppStateJson<T>(key);
}

async function upstashSet(key: string, value: unknown) {
  return upstashSetAppStateJson(key, value);
}

import { computeDonorRankingsUpdatedAt } from "@/lib/donor-rankings-rev";
import {
  parseStateApiPick,
  projectStateForGetPick,
  revisionForStatePick,
  STATE_PICK_SIG_INVENTORY,
} from "@/lib/state-api-pick";

function overlayPickEnabled(): boolean {
  const v = process.env.STATE_API_OVERLAY_PICK?.trim().toLowerCase();
  return !(v === "0" || v === "false" || v === "off");
}

/** 클라이언트가 라이브 동기화 이슈(멀티 인스턴스·메모리 폴백)를 구분할 수 있도록 */
const HDR_STATE_STORAGE = "X-Broadcast-State-Storage";

function parseSinceParam(req: Request): number {
  try {
    const n = Number(new URL(req.url).searchParams.get("since") || 0);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

function stateNotModifiedResponse(storage: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      "Cache-Control": "no-store, max-age=0, s-maxage=0",
      [HDR_STATE_STORAGE]: storage,
    },
  });
}

/** KV 장애 시 빈 defaultState 를 200으로 주면 클라이언트가 엑셀/후원을 자동 초기화함 */
function stateUnavailableResponse(reason: string): Response {
  return new Response(JSON.stringify({ error: "state_unavailable", reason, retry: true }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0, s-maxage=0",
      [HDR_STATE_STORAGE]: "unavailable",
    },
  });
}

/** 정산 리셋 없이 엑셀·후원을 통째로 비우는 POST 로 보이는지 */
function looksLikeEmptyRosterPersist(
  body: Partial<AppState> & { membersAuthoritative?: boolean },
  donorsInPatch: boolean,
  incomingDonorCount: number
): boolean {
  const donorsEmpty = !donorsInPatch || incomingDonorCount === 0;
  if (!donorsEmpty) return false;
  if (!("members" in body)) return incomingDonorCount === 0 && donorsInPatch;
  const members = body.members;
  if (!Array.isArray(members)) return true;
  if (isDefaultPlaceholderMemberList(members)) return true;
  /** 실멤버명 로스터는 금액 0이어도(추가만 한 상태) 빈 초기화가 아님 */
  if (hasMeaningfulMemberRoster({ members } as AppState)) return false;
  if (body.membersAuthoritative === true) return false;
  return memberCombinedTotal(members) === 0;
}

export async function GET(req: Request) {
  await ensureMysqlKvBackend();
  const since = parseSinceParam(req);
  const userId = getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  let pickMode: ReturnType<typeof parseStateApiPick> = null;
  try {
    pickMode = parseStateApiPick(new URL(req.url).searchParams.get("pick") || "");
    if (pickMode && pickMode !== STATE_PICK_SIG_INVENTORY && !overlayPickEnabled()) pickMode = null;
  } catch {
    pickMode = null;
  }
  const bodyForPick = (state: AppState) => {
    const cleaned = sanitizeAppStateWheelDemo(state);
    return pickMode ? projectStateForGetPick(cleaned, pickMode, userId) : cleaned;
  };
  const revisionAt = (state: AppState) =>
    pickMode ? revisionForStatePick(state, pickMode) : state.updatedAt || 0;
  const isNotModified = (state: AppState) => since > 0 && revisionAt(state) <= since;
  try {
    const kvOk = isPersistentKvConfigured();
    if (!kvOk) {
      let state = applyDonationGoalPresetNormalization(
        getServerMemoryAppState(userId) || defaultState()
      );
      if (!getServerMemoryAppState(userId)) {
        logger.warn(
          "영속 저장소 미설정 - 메모리만 사용 (서버 재시작 시 초기화. DATABASE_URL 또는 UPSTASH_REDIS_* 설정)"
        );
      }
      try {
        const donationEnriched = await enrichAppStateWithDonationRosterBackup(userId, state);
        if (donationEnriched.restoredFromBackup) {
          state = applyDonationGoalPresetNormalization(donationEnriched.state);
          setServerMemoryAppState(userId, state);
          logger.warn("후원 금액 디스크/백업에서 복구 (메모리 모드)", {
            userId,
            donors: normalizeDonorsArray(state.donors).length,
            total: totalCombined(state),
          });
        }
      } catch (err) {
        logger.error("후원 백업 복구 실패 (메모리 모드)", err);
      }
      logger.debug('메모리 상태 반환', { membersCount: state.members.length, donorsCount: state.donors.length });
      if (isNotModified(state)) {
        return stateNotModifiedResponse("memory");
      }
      return new Response(JSON.stringify(bodyForPick(state)), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
          [HDR_STATE_STORAGE]: "memory",
        },
      });
    }

    let state = await upstashGet<AppState>(stateKey(userId));
    if (!state || !Array.isArray(state.members)) {
      if (isLegacyMigrationTargetUserId(userId)) {
        const legacy = await upstashGet<AppState>(STORAGE_KEY_LEGACY);
        if (legacy && (Array.isArray(legacy.members) || Array.isArray(legacy.overlayPresets))) {
          await upstashSet(stateKey(userId), legacy);
          state = legacy;
          logger.info('기존 데이터 계정으로 마이그레이션', { userId });
        }
      }
    }
    const memState = getServerMemoryAppState(userId);
    /** Redis·메모리 donors union — pickFresher 만 쓰면 split·수동 계좌가 유실될 수 있음 */
    let effective =
      coalesceAppStateRedisAndMemory(state, memState) ||
      pickFresherAppState(state, memState) ||
      state ||
      memState ||
      null;
    if (!effective) {
      const kvErr = await getPersistentKvLastError();
      if (kvErr) {
        logger.error("KV 조회 실패 — 빈 defaultState 반환 금지 (엑셀/후원 자동 초기화 방지)", {
          userId,
          kvErr,
        });
        return stateUnavailableResponse("kv_read_failed");
      }
      logger.warn(
        "Redis/메모리 모두 비어있음 - 기본값 반환 (신규 계정 또는 키 없음)",
        { userId }
      );
      effective = defaultState();
    }
    let mergedForResponse = applyDonationGoalPresetNormalization(effective as AppState);
    /** 위에서 이미 동일 키로 조회한 `effective`를 쓴다. GET당 Upstash 2회 호출은 지연·대기열을 키워 pending 폭주에 기여함 */
    try {
      const rouletteStateSource = effective as AppState;
      if (rouletteStateSource?.rouletteState) {
        const rs = rouletteStateSource.rouletteState;
        const effectiveRs = (effective as AppState).rouletteState;
        const curStarted = Number(effectiveRs?.startedAt || 0);
        const rouletteStarted = Number(rs?.startedAt || 0);
        const srcCleanIdle =
          (rs.phase || "IDLE") === "IDLE" &&
          !rs.isRolling &&
          !(rs.selectedSigs && rs.selectedSigs.length > 0) &&
          !rs.oneShotResult;
        const effectiveLooksBusy =
          (effectiveRs?.phase || "IDLE") !== "IDLE" ||
          Boolean(effectiveRs?.isRolling) ||
          Boolean(effectiveRs?.selectedSigs && effectiveRs.selectedSigs.length > 0) ||
          Boolean(effectiveRs?.oneShotResult);
        const shouldUseRouletteState =
          Boolean(rs.isRolling) ||
          rouletteStarted >= curStarted ||
          (srcCleanIdle && effectiveLooksBusy);
        if (shouldUseRouletteState) {
          mergedForResponse = {
            ...(effective as AppState),
            rouletteState: rs,
          };
        }
      }
    } catch {}

    mergedForResponse = applyDonationGoalPresetNormalization(mergedForResponse);

    try {
      const sigEnriched = await enrichAppStateWithSigInventoryBackup(userId, mergedForResponse);
      if (sigEnriched.restoredFromBackup) {
        mergedForResponse = { ...mergedForResponse, sigInventory: sigEnriched.sigInventory };
        logger.warn("sigInventory Redis 백업에서 복구", {
          userId,
          count: sigEnriched.sigInventory.length,
        });
        void upstashSetAppStateJson(stateKey(userId), mergedForResponse);
      }
    } catch (err) {
      logger.error("sigInventory 백업 복구 실패", err);
    }

    try {
      const donationEnriched = await enrichAppStateWithDonationRosterBackup(
        userId,
        mergedForResponse
      );
      if (donationEnriched.restoredFromBackup) {
        mergedForResponse = applyDonationGoalPresetNormalization(donationEnriched.state);
        setServerMemoryAppState(userId, mergedForResponse);
        logger.warn("후원 금액 백업에서 복구", {
          userId,
          donors: normalizeDonorsArray(mergedForResponse.donors).length,
          total: totalCombined(mergedForResponse),
        });
        void upstashSetAppStateJson(stateKey(userId), mergedForResponse);
      }
    } catch (err) {
      logger.error("후원 백업 복구 실패", err);
    }

    /** donors 있는데 members 합계 0이면 GET 응답·메모리에서 맞춤(Prism 엑셀 미반영 방지) */
    if (normalizeDonorsArray(mergedForResponse.donors).length > 0) {
      const synced = syncMemberTotalsFromDonors(mergedForResponse);
      if (totalCombined(synced) !== totalCombined(mergedForResponse)) {
        mergedForResponse = synced;
        setServerMemoryAppState(userId, synced);
        void upstashSetAppStateJson(stateKey(userId), synced);
      } else {
        mergedForResponse = synced;
      }
    }

    if (isNotModified(mergedForResponse)) {
      return stateNotModifiedResponse("redis");
    }

    logger.debug('Redis 상태 반환', { hasState: !!state, usedMemory: !!getServerMemoryAppState(userId), userId });
    return new Response(JSON.stringify(bodyForPick(mergedForResponse)), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        [HDR_STATE_STORAGE]: "redis",
      },
    });
  } catch (error) {
    logger.error('상태 조회 실패', error);
    const mem = getServerMemoryAppState(userId);
    if (mem && (normalizeDonorsArray(mem.donors).length > 0 || totalCombined(mem) > 0 || hasMeaningfulMemberRoster(mem))) {
      const fallback = applyDonationGoalPresetNormalization(mem);
      return new Response(JSON.stringify(bodyForPick(fallback)), {
        headers: { "Content-Type": "application/json", [HDR_STATE_STORAGE]: "memory" },
        status: 200,
      });
    }
    /** 빈 defaultState 를 200으로 주면 관리자/오버레이가 엑셀·후원을 자동 초기화함 */
    return stateUnavailableResponse("get_exception");
  }
}

export async function POST(req: Request) {
  let userId: string | null = null;
  try {
    userId = getUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    await ensureMysqlKvBackend();
    const body = (await req.json()) as Partial<AppState> & {
      donorsAuthoritative?: boolean;
      donorsReplace?: boolean;
      settlementReset?: boolean;
      membersAuthoritative?: boolean;
    };
    const donorsAuthoritative = body.donorsAuthoritative === true;
    const donorsReplace = body.donorsReplace === true;
    const settlementReset = body.settlementReset === true;
    const membersAuthoritative = body.membersAuthoritative === true;
    const kvOk = isPersistentKvConfigured();
    const memExisting = getServerMemoryAppState(userId);
    let existing: AppState | null = null;
    if (kvOk) {
      const raw = await upstashGet<AppState>(stateKey(userId));
      existing = coalesceAppStateRedisAndMemory(raw, memExisting);
    } else {
      existing = memExisting;
    }
    const baseState = existing || defaultState();
    let donorsInPatch = Array.isArray(body.donors);
    const donationInitReset = settlementReset || isDonationInitGoalResetPatch(body);
    const resetAt = Number(baseState.settlementResetAt || 0);
    const incomingDonorsRaw = donorsInPatch ? normalizeDonorsArray(body.donors) : [];
    /**
     * 수동 삭제·합산·단체짠 저장: 리셋 이전 at 는 rebump 후 filter.
     * filter 만 하면 남은 후원까지 전량 탈락 → 엑셀표 0 초기화.
     */
    let incomingDonorsFiltered =
      resetAt > 0 && !settlementReset && donorsInPatch
        ? applySettlementResetDonorPipeline(incomingDonorsRaw, resetAt)
        : incomingDonorsRaw;
    /**
     * MySQL/Redis 일시 장애로 existing 을 못 읽은 채 빈 후원·플레이스홀더 멤버를
     * persist 하면 복구 후 엑셀/후원이 통째로 초기화됨 — 명시 리셋만 허용.
     */
    if (kvOk && !existing && !settlementReset && !donationInitReset) {
      const kvErr = await getPersistentKvLastError();
      if (kvErr && looksLikeEmptyRosterPersist(body, donorsInPatch, incomingDonorsFiltered.length)) {
        logger.error("refused empty roster persist while KV unavailable", {
          userId,
          kvErr,
        });
        return new Response(
          JSON.stringify({ error: "state_unavailable", reason: "kv_down_refuse_empty", retry: true }),
          {
            status: 503,
            headers: { "Content-Type": "application/json", [HDR_STATE_STORAGE]: "unavailable" },
          }
        );
      }
    }
    if (
      resetAt > 0 &&
      !settlementReset &&
      donorsInPatch &&
      incomingDonorsRaw.length > incomingDonorsFiltered.length
    ) {
      logger.warn("pre-reset donors dropped from stale save", {
        userId,
        dropped: incomingDonorsRaw.length - incomingDonorsFiltered.length,
        donorsAuthoritative,
      });
    }
    /** 멤버 삭제(membersAuthoritative + 로스터 축소): donors 는 그대로 유지(orphan memberId 허용). */
    const patchMembersForRoster = Array.isArray(body.members) ? (body.members as Member[]) : null;
    const memberRosterShrunk =
      membersAuthoritative &&
      patchMembersForRoster != null &&
      patchMembersForRoster.length < (baseState.members?.length ?? 0);
    if (memberRosterShrunk && patchMembersForRoster) {
      logger.info("member roster shrink — donors preserved", {
        userId,
        memberCount: patchMembersForRoster.length,
        donorCount: normalizeDonorsArray(baseState.donors).length,
      });
    }
    /**
     * HARD GUARD: 명시적 settlementReset/donorsAuthoritative 없이는
     * 서버에 있는 후원을 빈 배열·축소본으로 덮지 않는다.
     */
    const baseDonorsNorm = normalizeDonorsArray(baseState.donors);
    if (
      donorsInPatch &&
      !donorsAuthoritative &&
      !settlementReset &&
      !donationInitReset &&
      baseDonorsNorm.length > 0 &&
      (incomingDonorsFiltered.length === 0 ||
        incomingDonorsFiltered.length < baseDonorsNorm.length)
    ) {
      logger.warn("refused accidental donor wipe — keeping base donors", {
        userId,
        baseCount: baseDonorsNorm.length,
        incomingCount: incomingDonorsFiltered.length,
      });
      donorsInPatch = false;
    }
    /**
     * donorsAuthoritative 라도 삭제(shrink)·단체짠 나누기(donorsReplace)·정산 리셋이 아니면
     * Redis 기존 donors 와 union — 수동 합산이 직전 투네를 지우지 않게.
     */
    /**
     * 다건 후원을 한 번에 빈 배열로 덮는 authoritative 저장은
     * 사용자 명시 정산 리셋(settlementReset/donationInit) 없이 허용하지 않음.
     * 단건 삭제(1→0)만 예외.
     */
    const highSocietySettingsInPatch =
      body.highSocietySettings &&
      typeof body.highSocietySettings === "object";
    const massEmptyAuthoritativeWipe = shouldRefuseMassEmptyAuthoritativeDonorWipe({
      donorsAuthoritative,
      settlementReset,
      donationInitReset,
      donorsInPatch,
      incomingDonorCount: incomingDonorsFiltered.length,
      baseDonorCount: baseDonorsNorm.length,
      highSocietySettingsInPatch: Boolean(highSocietySettingsInPatch),
    });
    if (massEmptyAuthoritativeWipe) {
      logger.warn("refused mass empty authoritative wipe without settlementReset", {
        userId,
        baseCount: baseDonorsNorm.length,
        highSocietySettingsInPatch,
      });
      donorsInPatch = false;
    }
    const authoritativeReplace =
      donorsAuthoritative &&
      !massEmptyAuthoritativeWipe &&
      (settlementReset ||
        donationInitReset ||
        donorsReplace ||
        isGroupSplitDonorListMutation(incomingDonorsFiltered) ||
        isDonorListMemberReassignment(incomingDonorsFiltered, baseDonorsNorm) ||
        isIntentionalDonorListShrink(
          incomingDonorsFiltered,
          baseDonorsNorm,
          Number(body.updatedAt || 0),
          Number(baseState.updatedAt || 0)
        ));
    const mergedDonors = donorsInPatch
      ? donationInitReset
        ? []
        : authoritativeReplace
          ? incomingDonorsFiltered
          : mergeDonorsForMultiTabSave(incomingDonorsFiltered, baseState.donors, {
              incomingUpdatedAt: Number(body.updatedAt || 0),
              existingUpdatedAt: Number(baseState.updatedAt || 0),
            })
      : baseState.donors;
    let safeMergedDonors = mergedDonors;
    if (
      donorsInPatch &&
      !authoritativeReplace &&
      !settlementReset &&
      !donationInitReset &&
      Array.isArray(baseState.donors) &&
      baseState.donors.length > 0
    ) {
      const baseCount = baseState.donors.length;
      const mergedCount = safeMergedDonors.length;
      if (mergedCount === 0 || mergedCount < baseCount) {
        const recovered = mergeDonorsForMultiTabSave(incomingDonorsFiltered, baseState.donors, {
          incomingUpdatedAt: Number(body.updatedAt || 0),
          existingUpdatedAt: Number(baseState.updatedAt || 0),
        });
        if (recovered.length > mergedCount) {
          logger.warn("blocked accidental donor loss on save", {
            userId,
            baseCount,
            mergedCount,
            recovered: recovered.length,
            donorsAuthoritative,
          });
          safeMergedDonors = recovered;
        }
      }
    }
    /** donors 필드를 무시하기로 했으면 body에서도 제거해 mergePartialState 가 건드리지 않게 함 */
    const bodyForMerge =
      !donorsInPatch && Array.isArray(body.donors)
        ? (() => {
            const { donors: _drop, ...rest } = body;
            return rest;
          })()
        : body;
    const merged = mergePartialState(
      baseState,
      {
        ...bodyForMerge,
        ...(membersAuthoritative ? { membersAuthoritative: true as const } : {}),
        ...(settlementReset ? { settlementReset: true as const } : {}),
      },
      userId
    );
    const dedupedDonors = donorsInPatch ? dedupeDonorRows(safeMergedDonors) : normalizeDonorsArray(baseState.donors);
    /**
     * 글자색·테마 등 시각 PATCH(members/donors 미포함)에서는
     * syncMemberTotalsFromDonors 를 돌리지 않는다.
     * 서버 donors 가 비어 있을 때 members 금액을 0으로 재계산해 버리는 회귀를 막는다.
     * 멤버만 보낸 경우에도 donors 가 있을 때만 sync — 없으면 merge 가 보존한 금액 유지.
     */
    let draft: AppState =
      donorsInPatch ||
      ("members" in bodyForMerge && normalizeDonorsArray(dedupedDonors).length > 0)
        ? guardMemberTotalsAgainstAccidentalZeroWipe(
            syncMemberTotalsFromDonors({ ...merged, donors: dedupedDonors }),
            baseState
          )
        : { ...merged, donors: dedupedDonors };
    /**
     * donorsAuthoritative + donors 있음인데 멤버 합계가 donors 와 어긋나면 로스터 재동기화.
     * 멤버 추가·삭제(authoritative / id 집합 변경)는 옛 donors 매칭으로 로스터를 되돌리지 않음.
     */
    if (donorsInPatch && normalizeDonorsArray(dedupedDonors).length > 0) {
      const bodyMembers = Array.isArray(body.members) ? ({ members: body.members } as AppState) : null;
      const rosterReplaced =
        membersAuthoritative ||
        (Array.isArray(merged.members) &&
          Array.isArray(baseState.members) &&
          membersDifferByIds(merged.members, baseState.members) &&
          Number(merged.updatedAt || 0) >= Number(baseState.updatedAt || 0));
      draft = rosterReplaced
        ? guardMemberTotalsAgainstAccidentalZeroWipe(
            syncMemberTotalsFromDonors({ ...merged, donors: dedupedDonors }),
            baseState
          )
        : guardMemberTotalsAgainstAccidentalZeroWipe(
            repairMemberTotalsForDonorRoster(draft, baseState, bodyMembers),
            baseState
          );
    }
    const donorRankingsUpdatedAt = computeDonorRankingsUpdatedAt(
      baseState,
      draft,
      body,
      donorsInPatch
    );
    const normalized = applyDonationGoalPresetNormalization({
      ...draft,
      donorRankingsUpdatedAt,
      updatedAt: Date.now(),
    });
    const escalated = donationInitReset
      ? normalized
      : applyDonationGoalEscalationToState(normalized);
    const resetStamp = Date.now();
    let next: AppState = sanitizeAppStateWheelDemo({
      ...escalated,
      ...(settlementReset
        ? {
            settlementResetAt: coalesceSettlementResetAt({
              settlementReset: true,
              resetStamp,
            }),
          }
        : {}),
    });
    /** 최종 저장 직전 — 서버에 남은 리셋 시각·후원 필터를 강제 (다른 브라우저 구 스냅샷 대비) */
    const effectiveResetAt = coalesceSettlementResetAt({
      baseResetAt: Number(baseState.settlementResetAt || 0),
      patchResetAt: Number(next.settlementResetAt || 0),
      settlementReset,
      resetStamp,
    });
    if (effectiveResetAt > 0 && Number(next.settlementResetAt || 0) !== effectiveResetAt) {
      next = { ...next, settlementResetAt: effectiveResetAt };
    }
    if (!settlementReset && effectiveResetAt > 0) {
      const before = normalizeDonorsArray(next.donors);
      const after = applySettlementResetDonorPipeline(before, effectiveResetAt);
      const rebumped = rebumpDonorsPastSettlementReset(before, effectiveResetAt);
      const atChanged = rebumped.some((d, i) => Number(d.at) !== Number(before[i]?.at));
      if (after.length !== before.length || atChanged) {
        next = syncMemberTotalsFromDonors({ ...next, donors: after });
        if (after.length !== before.length) {
          logger.warn("pre-reset donors stripped before persist", {
            userId,
            dropped: before.length - after.length,
          });
        }
      }
    }

    /** 명시 리셋 없이 남은 멤버 금액만 0으로 떨어지면 서버 정본 금액·donors 로 복구 */
    if (!settlementReset && !donationInitReset) {
      const beforeGuard = next;
      next = guardMemberTotalsAgainstAccidentalZeroWipe(next, baseState);
      if (next !== beforeGuard && totalCombined(next) > totalCombined(beforeGuard)) {
        logger.warn("blocked accidental member total zero wipe before persist", {
          userId,
          beforeTotal: totalCombined(beforeGuard),
          afterTotal: totalCombined(next),
        });
      }
    }

    if (hasExpandedSigInventory(next.sigInventory)) {
      void saveSigInventoryBackup(userId, next.sigInventory);
    }

    /** 후원 금액 — 재시작·메인 상태 유실 대비 별도 백업. 리셋·의도적 전체 비움 시 백업도 비움 */
    if (settlementReset) {
      await clearDonationRosterBackup(userId, next.settlementResetAt);
    } else if (normalizeDonorsArray(next.donors).length === 0 && totalCombined(next) <= 0) {
      if (donorsAuthoritative || authoritativeReplace) {
        void clearDonationRosterBackup(userId, next.settlementResetAt);
      }
    } else if (normalizeDonorsArray(next.donors).length > 0 || totalCombined(next) > 0) {
      void saveDonationRosterBackup(userId, next);
    }

    if (!isPersistentKvConfigured()) {
      let memNext = next;
      if (donorsInPatch) {
        memNext = await saveAppStateForRoulette(userId, next, {
          donorsMode: authoritativeReplace ? "replace" : "add",
          allowEmptyRosterWipe: settlementReset || donationInitReset,
        });
      } else {
        const memExisting = getServerMemoryAppState(userId);
        if (
          !settlementReset &&
          !donationInitReset &&
          memExisting &&
          shouldBlockAccidentalEmptyOverwrite(memExisting, next)
        ) {
          logger.warn("refused accidental empty persist (memory mode)", { userId });
          memNext = {
            ...next,
            members: memExisting.members,
            memberPositions: memExisting.memberPositions ?? next.memberPositions,
            donors: memExisting.donors,
            settlementResetAt: memExisting.settlementResetAt,
          };
        }
        setServerMemoryAppState(userId, memNext);
      }
      logger.info('메모리 상태 업데이트', { updatedAt: memNext.updatedAt });
      return new Response(
        JSON.stringify({
          ok: true,
          updatedAt: memNext.updatedAt,
          donorRankingsUpdatedAt: memNext.donorRankingsUpdatedAt,
        }),
        {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
        status: 200,
      });
    }

    let persistedNext = next;
    let redisFallback: "memory" | undefined;
    if (donorsInPatch) {
      persistedNext = await saveAppStateForRoulette(userId, next, {
        donorsMode: authoritativeReplace ? "replace" : "add",
        allowEmptyRosterWipe: settlementReset || donationInitReset,
      });
      logger.info('Redis 상태 업데이트 (roulette pipeline)', {
        updatedAt: persistedNext.updatedAt,
        donorsMode: authoritativeReplace ? "replace" : "add",
        userId,
      });
    } else {
      const memExisting = getServerMemoryAppState(userId);
      const blockEmpty =
        !settlementReset &&
        !donationInitReset &&
        memExisting &&
        shouldBlockAccidentalEmptyOverwrite(memExisting, next);
      const toPersist = blockEmpty
        ? {
            ...next,
            members: memExisting.members,
            memberPositions: memExisting.memberPositions ?? next.memberPositions,
            donors: memExisting.donors,
            settlementResetAt: memExisting.settlementResetAt,
          }
        : next;
      if (blockEmpty) {
        logger.warn("refused accidental empty persist on non-donor PATCH", { userId });
      }
      const ok = await upstashSet(stateKey(userId), toPersist);
      logger.info('Redis 상태 업데이트', { updatedAt: toPersist.updatedAt, success: ok, userId });
      if (!ok) {
        setServerMemoryAppState(userId, toPersist);
        redisFallback = "memory";
        logger.warn('Redis 업데이트 실패로 메모리에 기록', { updatedAt: toPersist.updatedAt, userId });
      } else {
        setServerMemoryAppState(userId, toPersist);
      }
      persistedNext = toPersist;
    }
    return new Response(
      JSON.stringify({
        ok: true,
        updatedAt: persistedNext.updatedAt,
        donorRankingsUpdatedAt: persistedNext.donorRankingsUpdatedAt,
        fallback: redisFallback,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control":
            "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
        status: 200,
      }
    );
  } catch (error) {
    logger.error('상태 업데이트 실패', error);
    /**
     * 예외 시 body 를 무가드로 메모리에 쓰면 빈/플레이스홀더가 정본이 됨.
     * 실패로 응답하고 메모리·KV 는 건드리지 않음.
     */
    return new Response(JSON.stringify({ ok: false, error: "persist_failed", retry: true }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
}
