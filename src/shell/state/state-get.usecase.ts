import type { AppState } from "@/lib/state";
import { normalizeOverlayPresetDonationGoals } from "@/lib/goal-preset-math";
import {
  defaultState,
  normalizeDonorsArray,
  totalCombined,
  hasMeaningfulMemberRoster,
  hasExpandedSigInventory,
  isShrunkToDefaultSigInventory,
  filterDonorsAfterSettlementReset,
} from "@/lib/state";
import { sanitizeAppStateWheelDemo } from "@/lib/sig-wheel-demo-pool";
import { syncMemberTotalsFromDonors } from "@/lib/donation/apply-donation-state";
import { shouldSuppressAutoRosterRestore } from "@/lib/intentional-donation-clear";
import { createModuleLogger } from "@/lib/logger";
import { isLegacyMigrationTargetUserId } from "@/lib/legacy-migration";
import { pickFresherAppState } from "@/lib/app-state-freshness";
import {
  coalesceAppStateRedisAndMemory,
  loadAppStateForUserId,
  peekAppStateKvCache,
  seedAppStateKvCache,
} from "@/lib/app-state-server-load";
import {
  upstashGetAppStateJson,
  upstashSetAppStateJson,
} from "@/app/api/_shared/upstash-app-state";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import {
  ensureMysqlKvBackend,
  isPersistentKvConfigured,
  isRedisConfigured,
  getPersistentKvLastError,
} from "@/app/api/_shared/upstash";
import { isMysqlKvConfigured, mysqlKvPeekRevision } from "@/app/api/_shared/mysql-kv";
import { enrichAppStateWithSigInventoryBackup } from "@/lib/sig-inventory-backup";
import { enrichAppStateWithDonationRosterBackup } from "@/lib/donation-roster-backup";
import { loadDailyLogForUserId } from "@/lib/daily-log-server-load";
import { DAILY_LOG_SHARD_DAYS_DEFAULT } from "@/lib/daily-log-shard";
import { enrichAppStateFromDailyLogWhenDonorsMissing } from "@/lib/state-restore";

import {
  getUserId,
  stateKey,
  parseSinceParam,
  parseFastHydrateParam,
  hasWarmServerState,
  stateNotModifiedResponse,
  stateUnavailableResponse,
  overlayPickEnabled,
  persistentStateStorageHeader,
  HDR_STATE_STORAGE,
  STORAGE_KEY_LEGACY,
} from "@/shell/state/state-freshness.guard";
import {
  parseStateApiPick,
  projectStateForGetPick,
  revisionForStatePick,
  STATE_PICK_OVERLAY,
  STATE_PICK_OVERLAY_DONORS,
  STATE_PICK_DONOR_RANKINGS,
  STATE_PICK_OBS_TEXT,
  STATE_PICK_SIG_INVENTORY,
  STATE_PICK_SIG_SALES,
} from "@/shell/state/state-pick.mapper";

const logger = createModuleLogger('API/State');

async function upstashGet<T = unknown>(key: string): Promise<T | null> {
  return upstashGetAppStateJson<T>(key);
}

async function upstashSet(key: string, value: unknown) {
  return upstashSetAppStateJson(key, value);
}

function applyDonationGoalPresetNormalization(state: AppState): AppState {
  const presets = normalizeOverlayPresetDonationGoals(
    Array.isArray(state.overlayPresets) ? state.overlayPresets : []
  );
  return { ...state, overlayPresets: presets as AppState["overlayPresets"] };
}

export async function GET(req: Request) {
  const HANDLER_TOTAL_TIMEOUT_MS = 16_000;
  let abortTimer: ReturnType<typeof setTimeout> | null = null;
  const fallbackOnTimeout = async (): Promise<Response> => {
    const userId = getUserId(req);
    const memFallback = getServerMemoryAppState(userId);
    if (memFallback && Array.isArray(memFallback.members)) {
      const body = applyDonationGoalPresetNormalization(memFallback);
      let pickMode: ReturnType<typeof parseStateApiPick> = null;
      try {
        pickMode = parseStateApiPick(new URL(req.url).searchParams.get("pick") || "");
        if (pickMode && pickMode !== STATE_PICK_SIG_INVENTORY && !overlayPickEnabled()) pickMode = null;
      } catch { pickMode = null; }
      const cleaned = sanitizeAppStateWheelDemo(body);
      return new Response(JSON.stringify(pickMode ? projectStateForGetPick(cleaned, pickMode, userId ?? "") : cleaned), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          [HDR_STATE_STORAGE]: "memory-fallback-timeout",
          "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        },
      });
    }
    return stateUnavailableResponse("handler_timeout_fallback");
  };
  const timeoutPromise = new Promise<Response>((resolve) => {
    abortTimer = setTimeout(() => {
      console.error(`[state/route] GET total timeout after ${HANDLER_TOTAL_TIMEOUT_MS}ms — returning memory fallback immediately (zero-hang guarantee)`);
      void fallbackOnTimeout().then(resolve).catch(() => resolve(stateUnavailableResponse("handler_timeout_fallback")));
    }, HANDLER_TOTAL_TIMEOUT_MS);
  });
  const workPromise = (async () => {
    try { return await handleStateGetInner(req); }
    finally { if (abortTimer) { clearTimeout(abortTimer); abortTimer = null; } }
  })();
  return Promise.race([workPromise, timeoutPromise]);
}

async function handleStateGetInner(req: Request): Promise<Response> {
  if (!isRedisConfigured()) {
    await ensureMysqlKvBackend();
  }
  const since = parseSinceParam(req);
  const userId = getUserId(req);
  const fastHydrate = parseFastHydrateParam(req);
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
    if (since > 0 && kvOk && !isRedisConfigured() && isMysqlKvConfigured()) {
      const memEarly = getServerMemoryAppState(userId);
      const memRev = memEarly ? revisionAt(memEarly) : 0;
      const pickUsesDedicatedRevision =
        pickMode === STATE_PICK_OBS_TEXT ||
        pickMode === STATE_PICK_DONOR_RANKINGS ||
        pickMode === STATE_PICK_OVERLAY_DONORS ||
        pickMode === STATE_PICK_OVERLAY ||
        pickMode === STATE_PICK_SIG_SALES;
      if (pickUsesDedicatedRevision && memEarly && memRev > 0 && memRev <= since) {
        return stateNotModifiedResponse("mysql-rev");
      }
      if (!(memRev > since)) {
        const dbRev = await mysqlKvPeekRevision(stateKey(userId));
        if (dbRev !== null && dbRev <= since && memRev <= since) {
          return stateNotModifiedResponse("mysql-rev");
        }
      }
    }
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
        if (!shouldSuppressAutoRosterRestore(state)) {
          const donationEnriched = await enrichAppStateWithDonationRosterBackup(userId, state, {
            persistBackup: false,
          });
          if (donationEnriched.restoredFromBackup) {
            state = applyDonationGoalPresetNormalization(donationEnriched.state);
            setServerMemoryAppState(userId, state);
            logger.warn("후원 금액 디스크/백업에서 복구 (메모리 모드)", {
              userId,
              donors: normalizeDonorsArray(state.donors).length,
              total: totalCombined(state),
            });
          }
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

    if (fastHydrate && since === 0 && !pickMode) {
      const memFast = getServerMemoryAppState(userId);
      const cached = peekAppStateKvCache(userId);
      const warm =
        coalesceAppStateRedisAndMemory(cached, memFast) ||
        pickFresherAppState(cached, memFast) ||
        memFast ||
        cached;
      if (hasWarmServerState(warm)) {
        let merged = applyDonationGoalPresetNormalization(syncMemberTotalsFromDonors(warm));
        if (memFast !== warm) setServerMemoryAppState(userId, merged);
        seedAppStateKvCache(userId, merged);
        return new Response(JSON.stringify(bodyForPick(merged)), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control":
              "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
            [HDR_STATE_STORAGE]: persistentStateStorageHeader(),
          },
        });
      }
    }

    let state = await loadAppStateForUserId(userId);
    if (!state || !Array.isArray(state.members)) {
      if (isLegacyMigrationTargetUserId(userId)) {
        const legacy = await upstashGet<AppState>(STORAGE_KEY_LEGACY);
        if (legacy && (Array.isArray(legacy.members) || Array.isArray(legacy.overlayPresets))) {
          await upstashSet(stateKey(userId), legacy);
          state = legacy;
          seedAppStateKvCache(userId, legacy);
          logger.info('기존 데이터 계정으로 마이그레이션', { userId });
        }
      }
    }
    const memState = getServerMemoryAppState(userId);
    let effective =
      coalesceAppStateRedisAndMemory(state, memState) ||
      pickFresherAppState(state, memState) ||
      state ||
      memState ||
      null;
    if (!effective) {
      const kvErr = await getPersistentKvLastError();
      if (kvErr) {
        if (
          memState &&
          (normalizeDonorsArray(memState.donors).length > 0 ||
            totalCombined(memState) > 0 ||
            hasMeaningfulMemberRoster(memState))
        ) {
          logger.warn(
            "KV 조회 실패 — 서버 메모리 warm state fallback (엑셀/후원 자동 초기화 방지)",
            { userId, kvErr }
          );
          const fallback = applyDonationGoalPresetNormalization(memState);
          return new Response(JSON.stringify(bodyForPick(fallback)), {
            headers: {
              "Content-Type": "application/json",
              [HDR_STATE_STORAGE]: "memory-fallback",
              "Cache-Control":
                "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
            },
          });
        }
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

    const donorsHealthyEarly =
      normalizeDonorsArray(mergedForResponse.donors).length > 0 &&
      totalCombined(mergedForResponse) > 0;
    const skipSigEnrichForPick =
      pickMode === STATE_PICK_OVERLAY ||
      pickMode === STATE_PICK_OVERLAY_DONORS ||
      pickMode === STATE_PICK_DONOR_RANKINGS ||
      pickMode === STATE_PICK_OBS_TEXT;
    if (since > 0 && donorsHealthyEarly && isNotModified(mergedForResponse)) {
      if (
        skipSigEnrichForPick ||
        (hasExpandedSigInventory(mergedForResponse.sigInventory) &&
          !isShrunkToDefaultSigInventory(mergedForResponse.sigInventory))
      ) {
        return stateNotModifiedResponse(persistentStateStorageHeader());
      }
    }

    const storageHdr = persistentStateStorageHeader();

    if (!fastHydrate) {
      const needSigBackup =
        !skipSigEnrichForPick &&
        (isShrunkToDefaultSigInventory(mergedForResponse.sigInventory) ||
          !hasExpandedSigInventory(mergedForResponse.sigInventory));
      const donorsNow = normalizeDonorsArray(mergedForResponse.donors);
      const needDonationBackup =
        (donorsNow.length === 0 || totalCombined(mergedForResponse) <= 0) &&
        !shouldSuppressAutoRosterRestore(mergedForResponse);

      const [sigEnriched, donationEnriched] = await Promise.all([
        needSigBackup
          ? enrichAppStateWithSigInventoryBackup(userId, mergedForResponse, {
              persistBackup: false,
            }).catch((err) => {
              logger.error("sigInventory 백업 복구 실패", err);
              return null;
            })
          : Promise.resolve(null),
        needDonationBackup
          ? enrichAppStateWithDonationRosterBackup(userId, mergedForResponse, {
              persistBackup: false,
            }).catch((err) => {
              logger.error("후원 백업 복구 실패", err);
              return null;
            })
          : Promise.resolve(null),
      ]);

      if (sigEnriched?.restoredFromBackup) {
        mergedForResponse = { ...mergedForResponse, sigInventory: sigEnriched.sigInventory };
        logger.warn("sigInventory Redis 백업에서 복구", {
          userId,
          count: sigEnriched.sigInventory.length,
        });
        setServerMemoryAppState(userId, mergedForResponse);
      }
      if (donationEnriched?.restoredFromBackup) {
        mergedForResponse = applyDonationGoalPresetNormalization(donationEnriched.state);
        setServerMemoryAppState(userId, mergedForResponse);
        logger.warn("후원 금액 백업에서 복구", {
          userId,
          donors: normalizeDonorsArray(mergedForResponse.donors).length,
          total: totalCombined(mergedForResponse),
        });
      }

      if (
        since === 0 &&
        normalizeDonorsArray(mergedForResponse.donors).length === 0 &&
        !shouldSuppressAutoRosterRestore(mergedForResponse)
      ) {
        try {
          const dailyLog = await loadDailyLogForUserId(userId, {
            recentDays: DAILY_LOG_SHARD_DAYS_DEFAULT,
          });
          const fromLog = enrichAppStateFromDailyLogWhenDonorsMissing(
            mergedForResponse,
            dailyLog
          );
          if (normalizeDonorsArray(fromLog.donors).length > 0) {
            mergedForResponse = syncMemberTotalsFromDonors(fromLog);
            setServerMemoryAppState(userId, mergedForResponse);
            logger.warn("후원 donors — 일일 로그 스냅샷에서 복구", {
              userId,
              donors: normalizeDonorsArray(mergedForResponse.donors).length,
              total: totalCombined(mergedForResponse),
            });
          }
        } catch (err) {
          logger.error("일일 로그 후원 복구 실패", err);
        }
      }
    }

    if (normalizeDonorsArray(mergedForResponse.donors).length > 0) {
      mergedForResponse = syncMemberTotalsFromDonors(mergedForResponse);
      setServerMemoryAppState(userId, mergedForResponse);
    }

    {
      const resetAt = Number(mergedForResponse.settlementResetAt || 0);
      if (resetAt > 0) {
        const before = normalizeDonorsArray(mergedForResponse.donors);
        const after = filterDonorsAfterSettlementReset(before, resetAt);
        if (after.length !== before.length) {
          mergedForResponse = syncMemberTotalsFromDonors({
            ...mergedForResponse,
            donors: after,
          });
          setServerMemoryAppState(userId, mergedForResponse);
        }
      }
    }

    seedAppStateKvCache(userId, mergedForResponse);

    if (isNotModified(mergedForResponse)) {
      return stateNotModifiedResponse(storageHdr);
    }

    logger.debug('Redis 상태 반환', { hasState: !!state, usedMemory: !!getServerMemoryAppState(userId), userId });
    return new Response(JSON.stringify(bodyForPick(mergedForResponse)), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control":
          "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
        [HDR_STATE_STORAGE]: storageHdr,
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
    return stateUnavailableResponse("get_exception");
  }
}
