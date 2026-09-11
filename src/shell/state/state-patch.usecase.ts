import type { AppState } from "@/lib/state";
import type { Member } from "@/types";
import {
  applyDonationGoalEscalationToState,
  isDonationInitGoalResetPatch,
} from "@/lib/goal-preset-math";
import {
  defaultState,
  coalesceSettlementResetAt,
  filterDonorsAfterSettlementReset,
  hasExpandedSigInventory,
  mergeDonorsForMultiTabSave,
  isIntentionalDonorListShrink,
  isDonorListMemberReassignment,
  membersDifferByIds,
  normalizeDonorsArray,
  shouldBlockAccidentalEmptyOverwrite,
  totalCombined,
} from "@/lib/state";
import { coalesceIntentionalDonationClearAt } from "@/lib/intentional-donation-clear";
import { sanitizeAppStateWheelDemo } from "@/lib/sig-wheel-demo-pool";
import {
  dedupeDonorRows,
  syncMemberTotalsFromDonors,
  syncAndRepairMemberTotals,
} from "@/lib/donation/apply-donation-state";
import { assembleStateAfterDonationEvent } from "@/shell/state-assembler";
import { isOk } from "@/domain/types/result";
import {
  guardMemberTotalsAgainstAccidentalZeroWipe,
  isHighSocietySettingsOnlyPatch,
  shouldRefuseDonorShrinkOnMemberIdentityPatch,
  shouldRefuseMassEmptyAuthoritativeDonorWipe,
} from "@/lib/donation/zero-wipe-guard";
import { isGroupSplitDonorListMutation } from "@/lib/donation/group-split-donation";
import {
  isMemberRosterIdentityOnlyChange,
  mergeMemberRosterPreservingAmounts,
} from "@/lib/member-roster-merge";
import {
  coalesceAppStateRedisAndMemory,
  invalidateAppStateKvCache,
  seedAppStateKvCache,
} from "@/lib/app-state-server-load";
import { saveAppStateForRoulette } from "@/app/api/roulette/edge-state-store";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import {
  isPersistentKvConfigured,
  ensureMysqlKvBackend,
  getPersistentKvLastError,
  isRedisConfigured,
} from "@/app/api/_shared/upstash";
import {
  upstashGetAppStateJson,
  upstashSetAppStateJson,
} from "@/app/api/_shared/upstash-app-state";
import {
  markSigInventoryBackupCleared,
  saveSigInventoryBackup,
} from "@/lib/sig-inventory-backup";
import {
  clearDonationRosterBackup,
  saveDonationRosterBackup,
} from "@/lib/donation-roster-backup";
import { syncHighSocietyMemberWidthSnapshotInState } from "@/lib/high-society";
import { isSettlementResetExplicitlyConfirmed } from "@/lib/settlement-reset-confirm";
import { publishSseEvent } from "@/lib/sse-clients-hub";
import { computeDonorRankingsUpdatedAt } from "@/lib/donor-rankings-rev";
import { runExclusivePerUser, getMutexQueueDepth, getUserMutexStats, getMutexActiveUserCount } from "@/lib/per-user-mutex";
import {
  donationContentMatchKey,
  donorAtEpochMs,
  normalizeDonorNameKey,
} from "@/domain/dedupe/donation-dedupe.rules";

import {
  stateKey,
  HDR_STATE_STORAGE,
  looksLikeEmptyRosterPersist,
} from "@/shell/state/state-freshness.guard";
import {
  logger,
  mergePartialState,
  buildStateUpdatedSsePayload,
  applyDonationGoalPresetNormalization,
} from "@/shell/state/state-save-shared";

async function upstashGet<T = unknown>(key: string): Promise<T | null> {
  return upstashGetAppStateJson<T>(key);
}

async function upstashSet(key: string, value: unknown) {
  return upstashSetAppStateJson(key, value);
}

type ServerDedupeEntry = { uidKey: string; touchedAt: number };
const SERVER_DEDUP_WINDOW_TTL_MS = 30_000;
const SERVER_DEDUP_MAX_CACHE = 80_000;
const _serverDedupCache = new Map<string, ServerDedupeEntry>();
let _serverDedupPruneTs = 0;

function pruneServerDedupCacheLocked(now: number) {
  if (_serverDedupCache.size <= SERVER_DEDUP_MAX_CACHE && now - _serverDedupPruneTs < 10_000) return;
  _serverDedupPruneTs = now;
  for (const [k, v] of _serverDedupCache) {
    if (now - v.touchedAt > SERVER_DEDUP_WINDOW_TTL_MS) _serverDedupCache.delete(k);
  }
  if (_serverDedupCache.size > SERVER_DEDUP_MAX_CACHE * 1.2) {
    const sorted = Array.from(_serverDedupCache.entries()).sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    const dropN = Math.max(2000, Math.floor(_serverDedupCache.size * 0.3));
    for (let i = 0; i < dropN && i < sorted.length; i++) _serverDedupCache.delete(sorted[i]![0]);
  }
}

function buildServerDedupeSignature(
  userId: string,
  d: {
    id?: string;
    externalId?: string;
    name?: string;
    donorName?: string;
    amount?: number | string;
    target?: string;
    message?: string;
    memberId?: string | number | null;
    at?: string | number;
    donorKey?: string | number;
    primaryKey?: string | number;
  }
): string[] {
  const keys: string[] = [];
  const uid = String(userId || "").trim().toLowerCase();
  const id = String(d.id || "").trim();
  if (id) {
    let base = id;
    base = base.replace(/^(ingest|toona|account|din|hub|poll|push|din_ingest|din_hub):/i, "");
    base = base.replace(/::[a-z]+$/i, "");
    base = base.replace(/^(toonation|bank|other|toon|투네|toona):/i, "");
    base = base.replace(/^(din|hub|self):/i, "");
    if (base) keys.push(`${uid}|id:${base.toLowerCase()}`);
  }
  const ext = String(d.externalId || "").trim().toLowerCase();
  if (ext) keys.push(`${uid}|ext:${ext}`);
  const dk = String(d.donorKey || "").trim().toLowerCase();
  if (dk) keys.push(`${uid}|dk:${dk}`);
  const pk = String(d.primaryKey || "").trim().toLowerCase();
  if (pk) keys.push(`${uid}|pk:${pk}`);
  const name = normalizeDonorNameKey(d.donorName || d.name);
  const amt = Math.max(0, Math.round(Number(d.amount) || 0));
  const msg = String(d.message || "").trim();
  const tgt = String(d.target || "").trim().toLowerCase() === "toon" ? "toon" : "account";
  const mid = String(d.memberId || "").trim().toLowerCase();
  const atMs = donorAtEpochMs({ at: d.at as any });
  /**
   * ✅ 2026-09-11 Hotfix P0 "계좌 다건이체 10건 동시 입금시 9건 누락" Bug 원천 봉쇄:
   *  5번째 exact: content 기반 idempotency signature 는 "4가지 Strong 고유 식별자"가 하나도 없을 때만 발급한다.
   *  - Strong 식별자 (이미 발급된 경우 절대 content fallback 으로 또 잡지 않음: id / externalId / donorKey / primaryKey)
   *  - 이유: 계좌이체 10건 처럼 donor.id / externalId / donorKey 가 전부 고유하게 존재하는데
   *          이름+금액+메시지+1초버킷 이 우연히 같다는 이유만으로 signature 5번이 충돌해서 9건을 완전 소실시키는 false positive 원천 차단.
   *  - 원래 exact: fallback 은 "strong ID 하나도 없는 완전 익명 레거시 후원" (SSE Webhook 경로 이슈 등) 을 위한 마지막 보호막이었음.
   */
  const hasAnyStrongId = Boolean(id) || Boolean(ext) || Boolean(dk) || Boolean(pk);
  if (!hasAnyStrongId && name && amt > 0 && msg.length > 0) {
    const atBucket = Math.max(0, Math.floor((atMs || 0) / 1_000));
    keys.push(
      `${uid}|exact:${name}:${amt}:${tgt}:${mid}:${atBucket}:${msg.toLowerCase()}`
    );
  }
  return keys;
}

function serverDedupCheckAndStamp(
  userId: string,
  donors: Array<{
    id?: string;
    externalId?: string;
    name?: string;
    donorName?: string;
    amount?: number | string;
    target?: string;
    message?: string;
    memberId?: string | number | null;
    at?: string | number;
    donorKey?: string | number;
    primaryKey?: string | number;
  }>
): { kept: number; dropped: number; hitKeys: number } {
  const now = Date.now();
  pruneServerDedupCacheLocked(now);
  let dropped = 0;
  let kept = 0;
  let hitKeys = 0;
  for (const d of donors) {
    const signatures = buildServerDedupeSignature(userId, d);
    let duplicate = false;
    for (const k of signatures) {
      const cached = _serverDedupCache.get(k);
      if (cached && now - cached.touchedAt <= SERVER_DEDUP_WINDOW_TTL_MS) {
        duplicate = true;
        hitKeys += 1;
        break;
      }
    }
    if (duplicate) {
      dropped++;
      continue;
    }
    kept++;
    for (const k of signatures) {
      _serverDedupCache.set(k, { uidKey: k, touchedAt: now });
    }
  }
  return { kept, dropped, hitKeys };
}

export async function POST(req: Request) {
  try {
    const writeUid = resolveWriteUserId(req, { allowAnonymousUrlUser: true });
    if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
    const userId = writeUid.userId;
    const bodyParsed = (await req.json()) as Partial<AppState> & {
      donorsAuthoritative?: boolean;
      donorsReplace?: boolean;
      settlementReset?: boolean;
      membersAuthoritative?: boolean;
      clearSigInventory?: boolean;
      clearSigSoldOutStamp?: boolean;
      userConfirmed?: boolean;
      confirmPhrase?: string;
    };
    const depthBefore = getMutexQueueDepth(userId);
    const mutexEnterTs = Date.now();
    logger.info("Fix⑱ [MUTEX-ENTER-WAIT]", {
      userId,
      depthBefore,
      mutexActiveUserCount: getMutexActiveUserCount(),
      mutexStats: getUserMutexStats(),
    });
    return await runExclusivePerUser(userId, async () => {
      const lockWaitMs = Date.now() - mutexEnterTs;
      const depthAfterLock = getMutexQueueDepth(userId);
      logger.info("Fix⑱ [MUTEX-LOCK-ACQUIRED]", {
        userId,
        lockWaitMs,
        depthAfterLock,
        mutexStats: getUserMutexStats(),
      });
      const procStartTs = Date.now();
      let httpStatus = 500;
      try {
        const result: Response = await (async () => {
          logger.info("FIX18-PANIC0-IIFE-ENTRY", { uid: userId });
      await ensureMysqlKvBackend();
      const body = bodyParsed;
      try {
        const d = (body as any).donors;
        logger.info("FIX18-PANIC1-BODY-DONORS", {
          uid: userId,
          keysLen: Object.keys(body).length,
          donors_type: typeof d,
          donors_isArray: Array.isArray(d),
          donors_len: Array.isArray(d) ? d.length : -1,
          settlementReset: Boolean((body as any).settlementReset),
          first_id: Array.isArray(d) && d.length > 0 ? String(d[0]?.id || 'x').slice(0, 30) : null,
          first_amt: Array.isArray(d) && d.length > 0 ? (d[0]?.amount ?? null) : null,
        });
      } catch (_e) { logger.info("FIX18-PANIC1-ERR", { uid: userId, err: String(_e) }); }
    const donorsAuthoritative = body.donorsAuthoritative === true;
    const donorsReplace = body.donorsReplace === true;
    const settlementReset = body.settlementReset === true;
    if (settlementReset && !isSettlementResetExplicitlyConfirmed(body)) {
      logger.warn("settlementReset POST rejected — missing explicit user confirmation", {
        userId,
      });
      httpStatus = 403;
      return new Response(
        JSON.stringify({ error: "confirm_required", reason: "settlement_reset_confirm" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        }
      );
    }
    const membersAuthoritative = body.membersAuthoritative === true;
    const clearSigInventory = body.clearSigInventory === true;
    logger.info("FIX18-PANIC15-READ", { uid: userId, kv: isPersistentKvConfigured() ? 1 : 0 });
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
    logger.info("FIX18-PANIC2-DIP", {
      uid: userId,
      dip: donorsInPatch ? 1 : 0,
      bd_type: typeof (body as any).donors,
      bd_ctor: ((body as any).donors as any)?.constructor?.name ?? null,
      base_donors: normalizeDonorsArray(baseState.donors).length,
    });
    const donationInitReset = settlementReset || isDonationInitGoalResetPatch(body);
    const resetAt = Number(baseState.settlementResetAt || 0);
    const incomingDonorsRaw = donorsInPatch ? normalizeDonorsArray(body.donors) : [];
    let incomingDonorsFiltered =
      resetAt > 0 && !settlementReset && donorsInPatch
        ? filterDonorsAfterSettlementReset(incomingDonorsRaw, resetAt)
        : incomingDonorsRaw;
    if (kvOk && !existing && !settlementReset && !donationInitReset) {
      const kvErr = await getPersistentKvLastError();
      if (kvErr && looksLikeEmptyRosterPersist(body, donorsInPatch, incomingDonorsFiltered.length)) {
        logger.error("refused empty roster persist while KV unavailable", {
          userId,
          kvErr,
        });
        httpStatus = 503;
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
    const baseDonorsNorm = normalizeDonorsArray(baseState.donors);
    if (userId === "din") {
      console.log(`[FIX18-DBUG-1-READBASE] uid=${userId} base_donors_n=${baseDonorsNorm.length} incoming_raw_n=${incomingDonorsRaw.length} incoming_filt_n=${incomingDonorsFiltered.length} kv=${kvOk ? 1 : 0} mem=${memExisting ? 1 : 0} donorsMode=${donorsReplace ? "replace" : "add"}`);
    }
    logger.info("FIX18-PANIC3-PRETRACE1", {
      uid: userId,
      dip: donorsInPatch ? 1 : 0,
      base: baseDonorsNorm.length,
      raw: incomingDonorsRaw.length,
      filt: incomingDonorsFiltered.length,
    });
    logger.info("Fix⑱ [TRACE donorsInPatch ①initial→preShrink]", {
      userId,
      initialDonorsInPatch: donorsInPatch,
      settlementReset: Boolean(settlementReset),
      resetAt,
      baseDonors: baseDonorsNorm.length,
      incomingRaw: incomingDonorsRaw.length,
      incomingFiltered: incomingDonorsFiltered.length,
      donorsAuthoritative,
      membersAuthoritative,
    });
    if (
      donorsInPatch &&
      !donorsAuthoritative &&
      !settlementReset &&
      !donationInitReset &&
      baseDonorsNorm.length > 0 &&
      incomingDonorsFiltered.length === 0
    ) {
      logger.warn("refused accidental donor wipe — keeping base donors", {
        userId,
        baseCount: baseDonorsNorm.length,
        incomingCount: incomingDonorsFiltered.length,
        reason: "empty incoming donors array",
      });
      donorsInPatch = false;
      logger.info("Fix⑱ [TRACE donorsInPatch ② WIPE 차단 → false]", { userId });
    } else if (
      donorsInPatch &&
      !donorsAuthoritative &&
      !settlementReset &&
      !donationInitReset &&
      baseDonorsNorm.length > 0 &&
      incomingDonorsFiltered.length > 0 &&
      incomingDonorsFiltered.length < baseDonorsNorm.length
    ) {
      const existingDonorIds = new Set(baseDonorsNorm.map((d) => d.id).filter(Boolean));
      const incomingIds = new Set(incomingDonorsFiltered.map((d) => d.id).filter(Boolean));
      let overlapCount = 0;
      incomingIds.forEach((id) => { if (existingDonorIds.has(id)) overlapCount++; });
      const incomingAllNew = overlapCount === 0;
      const keepDonorRatio = incomingIds.size === 0 ? 0 : overlapCount / incomingIds.size;
      if (incomingAllNew) {
        logger.info("donor add-only patch bypassed shrink guard — all NEW ids", {
          userId,
          baseCount: baseDonorsNorm.length,
          incomingCount: incomingDonorsFiltered.length,
          newIdsCount: incomingIds.size,
        });
      } else if (keepDonorRatio >= 0.3 || incomingDonorsFiltered.length <= Math.max(1, Math.floor(baseDonorsNorm.length * 0.5))) {
        logger.warn("refused accidental donor shrink — keeping base donors", {
          userId,
          baseCount: baseDonorsNorm.length,
          incomingCount: incomingDonorsFiltered.length,
          overlapCount,
          keepDonorRatio: Number(keepDonorRatio.toFixed(2)),
        });
        donorsInPatch = false;
        logger.info("Fix⑱ [TRACE donorsInPatch ③ SHRINK 차단 → false]", { userId, keepDonorRatio, overlapCount });
      }
    }
    if (
      shouldRefuseDonorShrinkOnMemberIdentityPatch({
        membersAuthoritative,
        donorsAuthoritative,
        donorsInPatch,
        settlementReset,
        donationInitReset,
        baseMembers: baseState.members,
        patchMembers: patchMembersForRoster ?? undefined,
        baseDonorCount: baseDonorsNorm.length,
        incomingDonorCount: incomingDonorsFiltered.length,
      })
    ) {
      logger.warn("refused donor shrink on member identity-only patch", {
        userId,
        baseCount: baseDonorsNorm.length,
        incomingCount: incomingDonorsFiltered.length,
      });
      donorsInPatch = false;
      logger.info("Fix⑱ [TRACE donorsInPatch ④ MemberIdentity 차단 → false]", { userId });
    }
    const highSocietySettingsInPatch =
      body.highSocietySettings &&
      typeof body.highSocietySettings === "object";
    const territoryLogsInPatch = Array.isArray(body.territoryLogs);
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
      logger.info("Fix⑱ [TRACE donorsInPatch ⑤ MassEmptyAuth 차단 → false]", { userId });
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
          Number(baseState.updatedAt || 0),
          body.donorListVersion,
          baseState.donorListVersion
        ));
    /**
     * Fix ⑱-FINAL Stale Incoming Bump:
     * Mutex Queue 대기 지연으로 클라이언트 body.updatedAt (발송시간) 이
     * 이미 baseState.updatedAt (최근 저장 시간) 보다 과거가 되면,
     * mergeDonorsForMultiTabSave 내 incomingStale=true 판정으로 인해
     * union이 스킵되고 existing donors가 그대로 반환되어 incoming NEW donor
     * 가 Lost Update 되는 Bug 방지.
     * Mutex 내 직렬화 된 요청은 논리적으로 항상 최신이므로, incomingUpdatedAt
     * 을 Math.max(사용자지정, 서버 현재시각, base existingAt + 1) 로 강제 bump
     * 하여 절대로 stale 판정이 나오지 않게 보장.
     */
    const __serverNowTs = Date.now();
    const __baseAt = Number(baseState.updatedAt || 0);
    const __clientIncomingAt = Number(body.updatedAt || 0);
    const __forcedIncomingAt = Math.max(
      __clientIncomingAt,
      __serverNowTs,
      __baseAt > 0 ? __baseAt + 1 : 0
    );
    const mergedDonors = donorsInPatch
      ? donationInitReset
        ? []
        : authoritativeReplace
          ? incomingDonorsFiltered
          : mergeDonorsForMultiTabSave(incomingDonorsFiltered, baseState.donors, {
              incomingUpdatedAt: __forcedIncomingAt,
              existingUpdatedAt: __baseAt,
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
          incomingUpdatedAt: __forcedIncomingAt,
          existingUpdatedAt: __baseAt,
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
    let bodyForMerge: Partial<AppState> & {
      donorsAuthoritative?: boolean;
      donorsReplace?: boolean;
      settlementReset?: boolean;
      membersAuthoritative?: boolean;
      clearSigInventory?: boolean;
      clearSigSoldOutStamp?: boolean;
    } =
      !donorsInPatch && Array.isArray(body.donors)
        ? (() => {
            const { donors: _drop, ...rest } = body;
            return rest;
          })()
        : body;
    const highSocietySettingsOnlyPatch = isHighSocietySettingsOnlyPatch({
      highSocietySettingsInPatch: Boolean(highSocietySettingsInPatch),
      territoryLogsInPatch,
      donorsInPatch,
      membersAuthoritative,
      settlementReset,
      donationInitReset,
    });
    if (highSocietySettingsOnlyPatch && "members" in bodyForMerge && !membersAuthoritative) {
      const {
        members: _m,
        memberPositions: _mp,
        memberPositionMode: _mpm,
        rankPositionLabels: _rpl,
        ...hsOnlyRest
      } = bodyForMerge;
      bodyForMerge = hsOnlyRest;
    }
    const merged = mergePartialState(
      baseState,
      {
        ...bodyForMerge,
        ...(membersAuthoritative ? { membersAuthoritative: true as const } : {}),
        ...(settlementReset ? { settlementReset: true as const } : {}),
        ...(clearSigInventory ? { clearSigInventory: true as const } : {}),
      },
      userId
    );
    const dedupedDonors = donorsInPatch ? dedupeDonorRows(safeMergedDonors) : normalizeDonorsArray(baseState.donors);
    if (userId === "din") {
      const mergedN = Array.isArray(mergedDonors) ? mergedDonors.length : -1;
      const safeN = Array.isArray(safeMergedDonors) ? safeMergedDonors.length : -1;
      const dedupN = Array.isArray(dedupedDonors) ? dedupedDonors.length : -1;
      console.log(`[FIX18-DBUG-1.5-MERGE] uid=${userId} donorsInPatch=${donorsInPatch ? 1 : 0} authRep=${authoritativeReplace ? 1 : 0} mergedN=${mergedN} safeN=${safeN} dedupN=${dedupN} baseN=${baseDonorsNorm.length} incN=${incomingDonorsFiltered.length}`);
    }
    const memberIdentityOnlyPatch =
      membersAuthoritative &&
      !donorsInPatch &&
      patchMembersForRoster != null &&
      isMemberRosterIdentityOnlyChange(baseState.members, patchMembersForRoster);
    const shouldSyncMembersFromDonors =
      !highSocietySettingsOnlyPatch &&
      !memberIdentityOnlyPatch &&
      (donorsInPatch ||
        ("members" in bodyForMerge && normalizeDonorsArray(dedupedDonors).length > 0));
    let draft: AppState = shouldSyncMembersFromDonors
      ? settlementReset || donationInitReset
        ? syncMemberTotalsFromDonors({ ...merged, donors: dedupedDonors })
        : guardMemberTotalsAgainstAccidentalZeroWipe(
            syncMemberTotalsFromDonors({ ...merged, donors: dedupedDonors }),
            baseState
          )
      : { ...merged, donors: dedupedDonors };
    if (highSocietySettingsOnlyPatch) {
      if (Array.isArray(merged.members)) {
        draft = {
          ...draft,
          members: mergeMemberRosterPreservingAmounts(baseState.members || [], merged.members),
        };
      }
    }
    if (donorsInPatch && normalizeDonorsArray(dedupedDonors).length > 0) {
      const bodyMembers = Array.isArray(body.members) ? ({ members: body.members } as AppState) : null;
      const rosterReplaced =
        membersAuthoritative ||
        (Array.isArray(merged.members) &&
          Array.isArray(baseState.members) &&
          membersDifferByIds(merged.members, baseState.members) &&
          Number(merged.updatedAt || 0) >= Number(baseState.updatedAt || 0));
      /** TR-7.1: 4단계 pipeline 경유 재링크 (실패시 fallback으로 legacy guard+sync 호출 → 회귀0 방지) */
      const baseForAdmin = syncMemberTotalsFromDonors({ ...merged, donors: dedupedDonors });
      const assembleRes = await assembleStateAfterDonationEvent(baseState, "admin-patch", {
        kind: "admin-patch",
        baseState,
        draft,
        bodyMembers,
        rosterReplaced,
        settlementReset: settlementReset || undefined,
        donationInitReset: donationInitReset || undefined,
        membersAuthoritative,
        highSocietySettingsOnlyPatch: highSocietySettingsOnlyPatch || undefined,
      });
      if (isOk(assembleRes)) {
        draft = assembleRes.value;
      } else {
        draft = rosterReplaced
          ? guardMemberTotalsAgainstAccidentalZeroWipe(baseForAdmin, baseState)
          : guardMemberTotalsAgainstAccidentalZeroWipe(
              syncAndRepairMemberTotals(draft, baseState, bodyMembers),
              baseState
            );
      }
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
            intentionalDonationClearAt: coalesceIntentionalDonationClearAt({
              settlementReset: true,
              resetStamp,
              hasDonations: false,
            }),
          }
        : {}),
    });
    const effectiveResetAt = coalesceSettlementResetAt({
      baseResetAt: Number(baseState.settlementResetAt || 0),
      patchResetAt: Number(next.settlementResetAt || 0),
      settlementReset,
      resetStamp,
    });
    if (effectiveResetAt > 0 && Number(next.settlementResetAt || 0) !== effectiveResetAt) {
      next = { ...next, settlementResetAt: effectiveResetAt };
    }
    const effectiveClearAt = coalesceIntentionalDonationClearAt({
      baseClearAt: Number(baseState.intentionalDonationClearAt || 0),
      patchClearAt: Number(next.intentionalDonationClearAt || 0),
      settlementReset,
      resetStamp,
      hasDonations:
        normalizeDonorsArray(next.donors).length > 0 || totalCombined(next) > 0,
    });
    if (effectiveClearAt) {
      next = { ...next, intentionalDonationClearAt: effectiveClearAt };
    } else if (next.intentionalDonationClearAt) {
      const cleared = { ...next };
      delete cleared.intentionalDonationClearAt;
      next = cleared;
    }
    const forceSyncMembersNow = settlementReset || donationInitReset;
    if (forceSyncMembersNow || (!settlementReset && effectiveResetAt > 0)) {
      const before = normalizeDonorsArray(next.donors);
      let donorsToUse = before;
      let stripped = false;
      if (!settlementReset && effectiveResetAt > 0) {
        donorsToUse = filterDonorsAfterSettlementReset(before, effectiveResetAt);
        stripped = donorsToUse.length !== before.length;
      } else {
        donorsToUse = before;
      }
      next = syncMemberTotalsFromDonors({ ...next, donors: donorsToUse });
      if (stripped) {
        logger.warn("pre-reset donors stripped before persist", {
          userId,
          dropped: before.length - donorsToUse.length,
        });
      }
    }

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

    if (!settlementReset && !donationInitReset) {
      next = syncHighSocietyMemberWidthSnapshotInState(next);
    }

    if (membersAuthoritative) {
      const rosterAt = Math.max(Number(next.membersRosterUpdatedAt || 0), Number(next.updatedAt || 0));
      if (rosterAt > 0) {
        next = { ...next, membersRosterUpdatedAt: rosterAt };
      }
    }

    if (clearSigInventory) {
      await markSigInventoryBackupCleared(userId);
    } else if (hasExpandedSigInventory(next.sigInventory)) {
      void saveSigInventoryBackup(userId, next.sigInventory);
    }

    if (settlementReset || donationInitReset) {
      await clearDonationRosterBackup(userId, next.settlementResetAt);
    } else if (
      donorsInPatch &&
      (normalizeDonorsArray(next.donors).length > 0 || totalCombined(next) > 0)
    ) {
      void saveDonationRosterBackup(userId, next);
    }

    if (!isPersistentKvConfigured()) {
      let memNext = next;
      if (donorsInPatch) {
        const memSaved = await saveAppStateForRoulette(userId, next, {
          donorsMode: authoritativeReplace ? "replace" : "add",
          allowEmptyRosterWipe: settlementReset || donationInitReset,
          bumpRosterVersion: membersAuthoritative || settlementReset,
          bumpDonorListVersion: authoritativeReplace || settlementReset,
          skipOuterRead: true,
        });
        memNext = memSaved.state;
        if (userId === "din") {
          const mn = normalizeDonorsArray(memNext.donors);
          console.log(`[FIX18-DBUG-2-AFTERSAVE-MEM] uid=${userId} next_donors_n=${normalizeDonorsArray(next.donors).length} persisted_donors_n=${mn.length} ok=${memSaved.ok ? 1 : 0}`);
        }
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
      const memUpdatedAt = Number(memNext.updatedAt || 0) || Date.now();
      invalidateAppStateKvCache(userId);
      seedAppStateKvCache(userId, memNext);
      void publishSseEvent(buildStateUpdatedSsePayload(body, memNext, memUpdatedAt, membersAuthoritative)).catch(() => {});
      logger.info('메모리 상태 업데이트', { updatedAt: memNext.updatedAt });
      httpStatus = 200;
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
      const beforeFinalDedup = normalizeDonorsArray(next.donors);
      const finalDeduped = dedupeDonorRows(beforeFinalDedup);
      if (finalDeduped.length !== beforeFinalDedup.length) {
        logger.warn("FINAL PERSIST-LEVEL DEDUPE HIT (in-patch)", {
          userId,
          before: beforeFinalDedup.length,
          after: finalDeduped.length,
          dropped: beforeFinalDedup.length - finalDeduped.length,
        });
        next = syncMemberTotalsFromDonors({ ...next, donors: finalDeduped });
      }
      const beforeWindow = normalizeDonorsArray(next.donors);
      const windowDedupResult = serverDedupCheckAndStamp(userId, beforeWindow);
      if (windowDedupResult.dropped > 0) {
        const keptDonors: any[] = [];
        const signaturesByRow = beforeWindow.map((d: any) => buildServerDedupeSignature(userId, d));
        const now = Date.now();
        let idx = 0;
        for (const d of beforeWindow) {
          const sigs = signaturesByRow[idx++] || [];
          let dup = false;
          for (const k of sigs) {
            const c = _serverDedupCache.get(k);
            if (c && c.uidKey === k && now - c.touchedAt <= SERVER_DEDUP_WINDOW_TTL_MS && Math.abs(now - c.touchedAt) > 0) {
              dup = true;
              break;
            }
          }
          if (!dup) {
            keptDonors.push(d);
            for (const k of sigs) _serverDedupCache.set(k, { uidKey: k, touchedAt: now });
          }
        }
        logger.warn("SERVER 30s WINDOW DEDUPE HIT (in-patch)", {
          userId,
          before: beforeWindow.length,
          after: keptDonors.length,
          dropped: windowDedupResult.dropped,
          hitKeys: windowDedupResult.hitKeys,
        });
        next = syncMemberTotalsFromDonors({ ...next, donors: keptDonors });
      }
      const nextDonors = normalizeDonorsArray(next.donors);
      const incomingIds = normalizeDonorsArray(body.donors).map(d => d.id).filter(Boolean);
      logger.info("Fix⑱ [DEBUG PRE-SAVE]", {
        userId,
        baseDonors: baseDonorsNorm.length,
        incomingDonorsRaw: incomingDonorsFiltered.length,
        incomingIdsSample: incomingIds.slice(0, 3),
        mergedDonors: safeMergedDonors.length,
        dedupedDonors: (donorsInPatch ? dedupeDonorRows(safeMergedDonors) : normalizeDonorsArray(baseState.donors)).length,
        nextDonors: nextDonors.length,
        nextIdsSample: nextDonors.map(d => d.id).filter(Boolean).slice(0, 5),
        nextResetAt: next.settlementResetAt || 0,
        donorsMode: authoritativeReplace ? "replace" : "add",
        settlementReset: Boolean(settlementReset),
      });
      const saved = await saveAppStateForRoulette(userId, next, {
        donorsMode: authoritativeReplace ? "replace" : "add",
        allowEmptyRosterWipe: settlementReset || donationInitReset,
        bumpRosterVersion: membersAuthoritative || settlementReset,
        bumpDonorListVersion: authoritativeReplace || settlementReset,
        skipOuterRead: true,
      });
      if (!saved.ok) {
        httpStatus = 503;
        return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      persistedNext = saved.state;
      const persistedDonors = normalizeDonorsArray(persistedNext.donors);
      if (userId === "din") {
        console.log(`[FIX18-DBUG-2-AFTERSAVE] uid=${userId} next_donors_n=${nextDonors.length} persisted_donors_n=${persistedDonors.length} ok=${saved.ok ? 1 : 0}`);
      }
      logger.info("Fix⑱ [DEBUG POST-SAVE]", {
        userId,
        nextDonors: nextDonors.length,
        persistedDonors: persistedDonors.length,
        donorDelta: persistedDonors.length - nextDonors.length,
        persistedIdsSample: persistedDonors.map(d => d.id).filter(Boolean).slice(0, 8),
        persistedResetAt: persistedNext.settlementResetAt || 0,
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
        if (!isRedisConfigured()) {
          httpStatus = 503;
          return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
            status: 503,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
          });
        }
        setServerMemoryAppState(userId, toPersist);
        redisFallback = "memory";
        logger.warn('Redis 업데이트 실패로 메모리에 기록', { updatedAt: toPersist.updatedAt, userId });
      } else {
        setServerMemoryAppState(userId, toPersist);
      }
      persistedNext = toPersist;
    }
    const finalUpdatedAt = Number(persistedNext.updatedAt || 0) || Date.now();
    invalidateAppStateKvCache(userId);
    seedAppStateKvCache(userId, persistedNext);
    setServerMemoryAppState(userId, persistedNext);
    void publishSseEvent(buildStateUpdatedSsePayload(body, persistedNext, finalUpdatedAt, membersAuthoritative)).catch(() => {});
    httpStatus = 200;
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
        })();
        httpStatus = result.status || httpStatus;
        return result;
      } finally {
        const procMs = Date.now() - procStartTs;
        logger.info("Fix⑱ [MUTEX-RELEASE]", {
          userId,
          httpStatus,
          procMs,
          lockWaitMs,
          depthBeforeRelease: getMutexQueueDepth(userId),
          mutexStats: getUserMutexStats(),
        });
      }
    });
  } catch (error) {
    try { logger.error("FIX18-PANIC4-CATCH", {
      err: String((error as any)?.message || error),
      stack: (String((error as any)?.stack || '')).slice(0, 400),
    }); } catch (_) {}
    logger.error('상태 업데이트 실패', error);
    return new Response(JSON.stringify({ ok: false, error: "persist_failed", retry: true }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
}
