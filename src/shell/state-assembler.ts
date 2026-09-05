import type { AppState, Donor, Member, ContributionFormula } from "@/types";
import { makeErrEnvelope, type ErrorEnvelope } from "@domain/types/error-envelope";
import { ok, err, type Result } from "@domain/types/result";
import { ERROR_CODES } from "@domain/types/error-envelope";
import { InvariantContract, type InvariantCheckOptions } from "@/policies/invariant-contract.policy";
import {
  dedupeDonorRows,
  syncAndRepairMemberTotals,
  syncMemberTotalsFromDonors,
} from "@/domain/apply-donation-state.all";
import { guardMemberTotalsAgainstAccidentalZeroWipe } from "@/domain/guards/zero-wipe-guard";
import { normalizeDonorsArray } from "@/lib/state";

export type AssemblerEventKind =
  | "apply"
  | "persist"
  | "ingest-toona"
  | "ingest-din"
  | "admin-patch"
  | "restore-backup"
  | "reload-kv"
  | "cron-prune";

export interface AssemblerApplyPayload {
  kind: "apply";
  previousState: AppState;
}

export interface AssemblerPersistPayload {
  kind: "persist";
  previousState: AppState;
  mode?: "replace" | "add";
}

export interface AssemblerAdminPatchPayload {
  kind: "admin-patch";
  baseState: AppState;
  draft: AppState;
  bodyMembers?: { members: Member[] } | null;
  rosterReplaced?: boolean;
  settlementReset?: boolean;
  donationInitReset?: boolean;
  membersAuthoritative?: boolean;
  highSocietySettingsOnlyPatch?: boolean;
}

export interface AssemblerReloadKvPayload {
  kind: "reload-kv";
  synced: AppState;
  lastGood: AppState | null;
  merged: AppState;
}

export interface AssemblerIngestPayload {
  kind: "ingest-toona" | "ingest-din";
  previousState: AppState;
  donorBaseline?: AppState;
}

export interface AssemblerRestoreBackupPayload {
  kind: "restore-backup";
  previousState: AppState;
  backupState: AppState;
}

export interface AssemblerCronPrunePayload {
  kind: "cron-prune";
  previousState: AppState;
  prunedDonors?: Donor[];
}

export type AssemblerPayload =
  | AssemblerApplyPayload
  | AssemblerPersistPayload
  | AssemblerAdminPatchPayload
  | AssemblerReloadKvPayload
  | AssemblerIngestPayload
  | AssemblerRestoreBackupPayload
  | AssemblerCronPrunePayload;

export interface AssemblerOpts {
  skipZeroWipeGuard?: boolean;
  skipInvariantExit?: boolean;
  invariantPath?: string;
  writeCommitAt?: number;
  overrideDedupedDonors?: Donor[];
}

const INVARIANT_DUMP_THRESHOLD = 16;

function buildInvariantOpts(
  opts: AssemblerOpts | undefined,
  step: "entry" | "exit",
  prevState?: unknown
): InvariantCheckOptions {
  return {
    path: opts?.invariantPath
      ? `${opts.invariantPath}:${step}`
      : `shell/assembler:${step}`,
    throwOnViolation: false,
    logOnViolation: true,
    prevState,
    dumpThreshold: INVARIANT_DUMP_THRESHOLD,
  };
}

function assertEntryShape(
  state: AppState,
  eventKind: AssemblerEventKind,
  opts: AssemblerOpts | undefined
) {
  const checkOpts = buildInvariantOpts(opts, "entry", undefined);
  const hasDonors = Array.isArray(state.donors);
  const hasMembers = Array.isArray(state.members);
  const hasUpdatedAt = typeof (state as Record<string, unknown>).updatedAt !== "undefined";
  const staticResult = InvariantContract.checkAll(state, checkOpts);
  if (staticResult.passed && hasDonors && hasMembers && hasUpdatedAt) {
    return staticResult;
  }
  const violations = [...staticResult.violations];
  if (!hasDonors) {
    violations.push({
      code: ERROR_CODES.DIN_STATE_001,
      rule: "entry.state.donors.array",
      message: `[${eventKind}] entry state.donors must be array`,
      detail: { eventKind, type: typeof state.donors },
    });
  }
  if (!hasMembers) {
    violations.push({
      code: ERROR_CODES.DIN_STATE_002,
      rule: "entry.state.members.array",
      message: `[${eventKind}] entry state.members must be array`,
      detail: { eventKind, type: typeof state.members },
    });
  }
  if (!hasUpdatedAt) {
    violations.push({
      code: ERROR_CODES.DIN_STATE_003,
      rule: "entry.state.updatedAt",
      message: `[${eventKind}] entry state.updatedAt missing`,
      detail: { eventKind },
    });
  }
  const passed = violations.length === 0;
  if (!passed && checkOpts.logOnViolation !== false) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.warn(`[assembler:invariant:entry] violations=${violations.length} kind=${eventKind}`);
    }
  }
  return { ...staticResult, passed, violations };
}

function assertExitShape(
  prevState: AppState,
  nextState: AppState,
  eventKind: AssemblerEventKind,
  opts: AssemblerOpts | undefined
) {
  if (opts?.skipInvariantExit) {
    return { passed: true as const, violations: [], durationMs: 0 };
  }
  const checkOpts = buildInvariantOpts(opts, "exit", prevState);
  const staticResult = InvariantContract.checkAll(nextState, checkOpts);
  const violations = [...staticResult.violations];
  const prevUpdated = Number(prevState.updatedAt || 0);
  const nextUpdated = Number(nextState.updatedAt || 0);
  const mono = nextUpdated >= prevUpdated;
  const hasDonorsArr = Array.isArray(nextState.donors);
  if (!hasDonorsArr) {
    violations.push({
      code: ERROR_CODES.DIN_STATE_004,
      rule: "exit.state.donors.array",
      message: `[${eventKind}] exit state.donors must be array`,
      detail: { eventKind },
    });
  }
  if (!mono) {
    violations.push({
      code: ERROR_CODES.DIN_STATE_005,
      rule: "exit.updatedAt.monotonic",
      message: `[${eventKind}] exit updatedAt regression ${nextUpdated} < ${prevUpdated}`,
      detail: { eventKind, prevUpdated, nextUpdated },
    });
  }
  const passed = violations.length === 0;
  if (!passed && checkOpts.logOnViolation !== false) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
      // eslint-disable-next-line no-console
      console.warn(`[assembler:invariant:exit] violations=${violations.length} kind=${eventKind}`);
    }
  }
  return { ...staticResult, passed, violations };
}

function applyRepairPipeline(
  eventKind: AssemblerEventKind,
  base: AppState,
  fresh: AppState,
  hint: { members: Member[] } | AppState | null | undefined,
  opts: AssemblerOpts | undefined
): AppState {
  void eventKind;
  const afterSync = syncAndRepairMemberTotals(base, fresh, hint as AppState | undefined);
  const donorSource = opts?.overrideDedupedDonors || afterSync.donors;
  const deduped = dedupeDonorRows(normalizeDonorsArray(donorSource));
  const afterDedup: AppState =
    deduped.length === normalizeDonorsArray(afterSync.donors).length
      ? afterSync
      : { ...afterSync, donors: deduped as Donor[] };
  const rosterDerived = deduped.length > 0 && !opts?.skipZeroWipeGuard;
  if (!rosterDerived) return afterDedup;
  const memberSourced = syncMemberTotalsFromDonors({
    ...afterDedup,
    donors: deduped as Donor[],
  });
  return guardMemberTotalsAgainstAccidentalZeroWipe(memberSourced, fresh);
}

function setBumpTs(state: AppState, writeAt: number | undefined): AppState {
  const now = writeAt ?? Date.now();
  if (Number(state.updatedAt || 0) >= now) return state;
  return {
    ...state,
    updatedAt: now,
    donorRankingsUpdatedAt: state.donorRankingsUpdatedAt || now,
  };
}

export async function assembleStateAfterDonationEvent(
  state: AppState,
  eventKind: AssemblerEventKind,
  payload: AssemblerPayload,
  opts?: AssemblerOpts
): Promise<Result<AppState, ErrorEnvelope>> {
  try {
    if (!state || typeof state !== "object") {
      return err(
        makeErrEnvelope(
          ERROR_CODES.DIN_STATE_001,
          `[assembler] invalid state input for kind=${eventKind}`,
          "shell",
          { meta: { eventKind, stateType: typeof state } }
        )
      );
    }

    assertEntryShape(state, eventKind, opts);

    let next: AppState;

    switch (payload.kind) {
      case "apply": {
        next = applyRepairPipeline(
          eventKind,
          state,
          payload.previousState,
          undefined,
          opts
        );
        break;
      }
      case "persist": {
        next = applyRepairPipeline(
          eventKind,
          state,
          payload.previousState,
          undefined,
          opts
        );
        break;
      }
      case "admin-patch": {
        const { baseState, draft, bodyMembers, rosterReplaced, settlementReset, donationInitReset } = payload;
        if (settlementReset || donationInitReset) {
          next = applyRepairPipeline(
            eventKind,
            syncMemberTotalsFromDonors(draft),
            baseState,
            undefined,
            opts
          );
        } else if (rosterReplaced) {
          next = applyRepairPipeline(
            eventKind,
            syncMemberTotalsFromDonors(draft),
            baseState,
            undefined,
            opts
          );
        } else {
          next = applyRepairPipeline(
            eventKind,
            draft,
            baseState,
            bodyMembers,
            opts
          );
        }
        break;
      }
      case "reload-kv": {
        const { lastGood, merged } = payload;
        next = applyRepairPipeline(
          eventKind,
          state,
          lastGood || merged,
          merged,
          opts
        );
        break;
      }
      case "ingest-toona":
      case "ingest-din": {
        const baseline = payload.donorBaseline || payload.previousState;
        next = applyRepairPipeline(
          eventKind,
          state,
          baseline,
          undefined,
          opts
        );
        break;
      }
      case "restore-backup": {
        next = applyRepairPipeline(
          eventKind,
          state,
          payload.backupState,
          payload.previousState,
          opts
        );
        break;
      }
      case "cron-prune": {
        const pruned =
          payload.prunedDonors && payload.prunedDonors.length > 0
            ? { ...state, donors: payload.prunedDonors }
            : state;
        next = applyRepairPipeline(
          eventKind,
          pruned,
          payload.previousState,
          undefined,
          { ...opts, skipZeroWipeGuard: true }
        );
        break;
      }
      default: {
        return err(
          makeErrEnvelope(
            ERROR_CODES.DIN_STATE_002,
            `[assembler] unknown eventKind`,
            "shell",
            { meta: { eventKind: String((payload as AssemblerPayload)?.kind || eventKind) } }
          )
        );
      }
    }

    const bumped = setBumpTs(next, opts?.writeCommitAt);
    assertExitShape(state, bumped, eventKind, opts);
    return ok(bumped);
  } catch (rawErr) {
    const msg = rawErr instanceof Error ? rawErr.message : String(rawErr);
    return err(
      makeErrEnvelope(
        ERROR_CODES.DIN_STATE_003,
        `[assembler] uncaught pipeline error: ${msg}`,
        "shell",
        {
          meta: {
            eventKind,
            errorMessage: msg,
            errorStack: rawErr instanceof Error ? rawErr.stack : undefined,
          },
        }
      )
    );
  }
}

export type { AssemblerEventKind as AssemblerEvent };
