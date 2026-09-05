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

export async function POST(req: Request) {
  let userId: string | null = null;
  try {
    const writeUid = resolveWriteUserId(req);
    if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
    userId = writeUid.userId;
    await ensureMysqlKvBackend();
    const body = (await req.json()) as Partial<AppState> & {
      donorsAuthoritative?: boolean;
      donorsReplace?: boolean;
      settlementReset?: boolean;
      membersAuthoritative?: boolean;
      clearSigInventory?: boolean;
      clearSigSoldOutStamp?: boolean;
      userConfirmed?: boolean;
      confirmPhrase?: string;
    };
    const donorsAuthoritative = body.donorsAuthoritative === true;
    const donorsReplace = body.donorsReplace === true;
    const settlementReset = body.settlementReset === true;
    if (settlementReset && !isSettlementResetExplicitlyConfirmed(body)) {
      logger.warn("settlementReset POST rejected — missing explicit user confirmation", {
        userId,
      });
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
        });
        memNext = memSaved.state;
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
      const saved = await saveAppStateForRoulette(userId, next, {
        donorsMode: authoritativeReplace ? "replace" : "add",
        allowEmptyRosterWipe: settlementReset || donationInitReset,
        bumpRosterVersion: membersAuthoritative || settlementReset,
        bumpDonorListVersion: authoritativeReplace || settlementReset,
      });
      if (!saved.ok) {
        return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      persistedNext = saved.state;
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
    void publishSseEvent(buildStateUpdatedSsePayload(body, persistedNext, finalUpdatedAt, membersAuthoritative)).catch(() => {});
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
    return new Response(JSON.stringify({ ok: false, error: "persist_failed", retry: true }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
}
