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
import { normalizeRestroomCount } from "@/lib/restroom-utils";
import {
  defaultState,
  DEFAULT_DONOR_RANKINGS_FULL_THEME,
  filterDonorsAfterSettlementReset,
  hasExpandedSigInventory,
  hasMeaningfulMemberRoster,
  hasCustomTimerDisplayStyles,
  isDefaultLikeDonorRankingsTheme,
  isDefaultLikeTimerDisplayStyle,
  isDefaultPlaceholderMemberList,
  isShrunkToDefaultSigInventory,
  mergeDonorsForMultiTabSave,
  mergeOverlaySettingsPreservingObsText,
  normalizeDonorsArray,
  normalizeRouletteState,
  normalizeSigRolling,
  totalCombined,
} from "@/lib/state";
import type { SigItem } from "@/types";
import { sanitizeAppStateWheelDemo } from "@/lib/sig-wheel-demo-pool";
import { dedupeDonorRows, syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import { isManualOverlaySessionId } from "@/lib/sig-sales-manual-round";
import { createModuleLogger } from "@/lib/logger";
import { isLegacyMigrationTargetUserId } from "@/lib/legacy-migration";
import { pickFresherAppState } from "@/lib/app-state-freshness";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { isRouletteLocked } from "../roulette/roulette-lock";
import { mergeGeneralTimerPreferEffective } from "@/lib/timer-utils";
import { getUserIdFromRequest } from "../_shared/user-id";
import { getRedisEnv } from "../_shared/upstash";
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

/** 서버 장애·defaultState 저장 시 애교·댄스 등 8개 프리셋만으로 전체 목록이 지워지는 사고 방지 */
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

/** 계좌·투네 0 리셋 차단 시에도 화장실·수동 기여도는 patch 반영 */
function mergeManualMemberFieldsFromPatch(baseMembers: Member[], patchMembers: Member[]): Member[] {
  const patchById = new Map(patchMembers.map((m) => [m.id, m]));
  return (baseMembers || []).map((baseM) => {
    const patchM = patchById.get(baseM.id);
    if (!patchM) return baseM;
    return {
      ...baseM,
      restroom: normalizeRestroomCount(patchM.restroom),
      contribution:
        typeof patchM.contribution === "number" && Number.isFinite(patchM.contribution)
          ? Math.max(0, Math.floor(patchM.contribution))
          : baseM.contribution,
    };
  });
}

function mergePartialState(
  base: AppState,
  patch: Partial<AppState> & { settlementReset?: boolean; clearSigSoldOutStamp?: boolean },
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
  if (!("members" in patch)) next.members = base.members;
  else if (patchSettlementReset || isDonationInitGoalResetPatch(patch)) {
    next.members = patch.members as Member[];
  } else if (
    base.settlementResetAt &&
    memberCombinedTotal(base.members) === 0 &&
    memberCombinedTotal(patch.members) > 0
  ) {
    next.members = base.members;
    logger.warn("members amount restore blocked after settlement reset", { userId });
  } else if (
    Array.isArray(patch.members) &&
    !isDonationInitGoalResetPatch(patch) &&
    (base.members || []).some((m) => (m.account || 0) + (m.toon || 0) > 0) &&
    patch.members.every((m) => (m.account || 0) + (m.toon || 0) === 0)
  ) {
    next.members = mergeManualMemberFieldsFromPatch(base.members || [], patch.members as Member[]);
    logger.warn("members zero wipe blocked — restroom/contribution merged from patch", { userId });
  } else if (
    Array.isArray(patch.members) &&
    isDefaultPlaceholderMemberList(patch.members) &&
    hasMeaningfulMemberRoster(base)
  ) {
    next.members = base.members;
    next.memberPositions = base.memberPositions;
    logger.warn("members placeholder wipe blocked (theme/preset save)", { userId });
  }
  if (!("memberPositions" in patch)) next.memberPositions = base.memberPositions;
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
    next.timerDisplayStyles = base.timerDisplayStyles;
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
  if (!("mealBattle" in patch)) next.mealBattle = base.mealBattle;
  if (!("mealMatch" in patch)) next.mealMatch = base.mealMatch;
  if (!("mealMatchSettings" in patch)) next.mealMatchSettings = base.mealMatchSettings;
  if ("generalTimer" in patch && patch.generalTimer != null) {
    next.generalTimer = mergeGeneralTimerPreferEffective(base.generalTimer, patch.generalTimer as AppState["generalTimer"]);
  } else if (!("generalTimer" in patch)) {
    next.generalTimer = base.generalTimer;
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

export async function GET(req: Request) {
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
    const { base, token } = getRedisEnv();
    if (!base || !token) {
      let state = applyDonationGoalPresetNormalization(
        getServerMemoryAppState(userId) || defaultState()
      );
      if (!getServerMemoryAppState(userId)) {
        logger.warn('Redis 미설정 - 메모리만 사용 (서버 재시작 시 데이터 초기화됨. UPSTASH_REDIS_* 환경변수 설정 권장)');
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
    /** 투네 후원 직후 메모리가 Redis보다 앞서면 메모리 우선 — 첫 후원 엑셀 지연 방지 */
    const effective =
      pickFresherAppState(state, memState) || state || memState || defaultState();
    if (!state && !memState) {
      logger.warn('Redis/메모리 모두 비어있음 - 기본값 반환 (서버 재시작 시 발생. Redis 설정 권장)', { userId });
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
    const fallback = applyDonationGoalPresetNormalization(
      getServerMemoryAppState(userId) || defaultState()
    );
    return new Response(JSON.stringify(bodyForPick(fallback)), {
      headers: { "Content-Type": "application/json", [HDR_STATE_STORAGE]: "memory" },
      status: 200,
    });
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
    const body = (await req.json()) as Partial<AppState> & {
      donorsAuthoritative?: boolean;
      settlementReset?: boolean;
    };
    const donorsAuthoritative = body.donorsAuthoritative === true;
    const settlementReset = body.settlementReset === true;
    const { base, token } = getRedisEnv();
    let existing: AppState | null = null;
    if (base && token) {
      existing = await upstashGet<AppState>(stateKey(userId));
    } else {
      existing = getServerMemoryAppState(userId);
    }
    const baseState = existing || defaultState();
    let donorsInPatch = Array.isArray(body.donors);
    const donationInitReset = settlementReset || isDonationInitGoalResetPatch(body);
    const resetAt = Number(baseState.settlementResetAt || 0);
    const incomingDonorsRaw = donorsInPatch ? normalizeDonorsArray(body.donors) : [];
    const incomingDonorsFiltered =
      resetAt > 0 && !settlementReset && !donorsAuthoritative && donorsInPatch
        ? filterDonorsAfterSettlementReset(incomingDonorsRaw, resetAt)
        : incomingDonorsRaw;
    if (
      resetAt > 0 &&
      !settlementReset &&
      !donorsAuthoritative &&
      donorsInPatch &&
      incomingDonorsRaw.length > incomingDonorsFiltered.length
    ) {
      logger.warn("pre-reset donors dropped from stale save", {
        userId,
        dropped: incomingDonorsRaw.length - incomingDonorsFiltered.length,
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
    const mergedDonors = donorsInPatch
      ? donationInitReset
        ? []
        : donorsAuthoritative
          ? incomingDonorsFiltered
          : mergeDonorsForMultiTabSave(incomingDonorsFiltered, baseState.donors, {
            incomingUpdatedAt: Number(body.updatedAt || 0),
            existingUpdatedAt: Number(baseState.updatedAt || 0),
            donorsAuthoritative,
          })
      : baseState.donors;
    let safeMergedDonors = mergedDonors;
    if (
      donorsInPatch &&
      !donorsAuthoritative &&
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
    const merged = mergePartialState(baseState, bodyForMerge, userId);
    const dedupedDonors = donorsInPatch ? dedupeDonorRows(safeMergedDonors) : normalizeDonorsArray(baseState.donors);
    /**
     * 글자색·테마 등 시각 PATCH(members/donors 미포함)에서는
     * syncMemberTotalsFromDonors 를 돌리지 않는다.
     * 서버 donors 가 비어 있을 때 members 금액을 0으로 재계산해 버리는 회귀를 막는다.
     */
    const draft: AppState =
      donorsInPatch || "members" in bodyForMerge
        ? syncMemberTotalsFromDonors({ ...merged, donors: dedupedDonors })
        : { ...merged, donors: dedupedDonors };
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
    const next: AppState = sanitizeAppStateWheelDemo({
      ...escalated,
      ...(settlementReset ? { settlementResetAt: resetStamp } : {}),
    });

    if (hasExpandedSigInventory(next.sigInventory)) {
      void saveSigInventoryBackup(userId, next.sigInventory);
    }

    /** 후원 금액 — 재시작·메인 상태 유실 대비 별도 백업. 정산/전체삭제 시 빈 백업으로 교체 */
    if (settlementReset || (donorsAuthoritative && normalizeDonorsArray(next.donors).length === 0)) {
      void clearDonationRosterBackup(userId, next.settlementResetAt);
    } else if (normalizeDonorsArray(next.donors).length > 0 || totalCombined(next) > 0) {
      void saveDonationRosterBackup(userId, next);
    }

    if (!base || !token) {
      setServerMemoryAppState(userId, next);
      logger.info('메모리 상태 업데이트', { updatedAt: next.updatedAt });
      return new Response(
        JSON.stringify({
          ok: true,
          updatedAt: next.updatedAt,
          donorRankingsUpdatedAt: next.donorRankingsUpdatedAt,
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

    const ok = await upstashSet(stateKey(userId), next);
    logger.info('Redis 상태 업데이트', { updatedAt: next.updatedAt, success: ok, userId });
    // Redis 오류 시에도 방송 중단 방지를 위해 메모리에 저장 후 200 반환
    if (!ok) {
      setServerMemoryAppState(userId, next);
      logger.warn('Redis 업데이트 실패로 메모리에 기록', { updatedAt: next.updatedAt, userId });
    } else {
      setServerMemoryAppState(userId, next);
    }
    return new Response(
      JSON.stringify({
        ok: true,
        updatedAt: next.updatedAt,
        donorRankingsUpdatedAt: next.donorRankingsUpdatedAt,
        fallback: ok ? undefined : "memory",
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
    // 예외 발생 시에도 메모리에 저장 시도
    let memUpdatedAt: number | undefined;
    try {
      const body = (await req.json()) as AppState;
      const memNext = { ...body, updatedAt: Date.now() };
      memUpdatedAt = memNext.updatedAt;
      setServerMemoryAppState(userId, memNext);
      logger.warn('예외 발생으로 메모리에 기록', { updatedAt: memNext.updatedAt, userId });
    } catch {}
    return new Response(
      JSON.stringify({
        ok: true,
        fallback: "memory",
        ...(typeof memUpdatedAt === "number" ? { updatedAt: memUpdatedAt } : {}),
      }),
      {
        headers: { "Content-Type": "application/json" },
        status: 200,
      }
    );
  }
}
