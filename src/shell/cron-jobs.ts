import { ok, err, type Result } from "@domain/types/result";
import { makeErrEnvelope, type ErrorEnvelope } from "@domain/types/error-envelope";
import { ERROR_CODES } from "@domain/types/error-envelope";
import {
  pruneStaleBroadcastDonorsForUser,
} from "@infra/mysql/broadcast-donations-repo";

export const CRON_INTERVAL_BROADCAST_PRUNE_MS = 60 * 60 * 1000;
export const CRON_STALE_BROADCAST_CUTOFF_MS = 60 * 60 * 1000;

export interface CronExecutionContext {
  nowMs?: number;
  dryRun?: boolean;
  userId?: string | null;
  donorIdsKeep?: string[];
}

export interface CronJobResult {
  name: string;
  ok: boolean;
  prunedCount?: number;
  durationMs: number;
  message?: string;
}

async function runBroadcastPrune(
  ctx: CronExecutionContext
): Promise<CronJobResult> {
  const startedAt = Date.now();
  const name = "broadcast-stale-prune";
  try {
    const userId: string = ctx.userId ? String(ctx.userId) : "";
    const keepIds: string[] = Array.isArray(ctx.donorIdsKeep) ? ctx.donorIdsKeep : [];
    if (ctx.dryRun) {
      return {
        name,
        ok: true,
        durationMs: Date.now() - startedAt,
        message: `dry-run userId=${userId || "<all>"} keepIds=${keepIds.length}`,
      };
    }
    if (!userId) {
      return {
        name,
        ok: true,
        prunedCount: 0,
        durationMs: Date.now() - startedAt,
        message: `skip: empty userId`,
      };
    }
    const count = await pruneStaleBroadcastDonorsForUser(userId, keepIds);
    return {
      name,
      ok: true,
      prunedCount: count ?? 0,
      durationMs: Date.now() - startedAt,
    };
  } catch (rawErr) {
    const msg = rawErr instanceof Error ? rawErr.message : String(rawErr);
    return {
      name,
      ok: false,
      durationMs: Date.now() - startedAt,
      message: msg,
    };
  }
}

export type CronJobName = "broadcast-stale-prune";

export async function runCronJob(
  name: CronJobName,
  ctx: CronExecutionContext = {}
): Promise<Result<CronJobResult, ErrorEnvelope>> {
  switch (name) {
    case "broadcast-stale-prune": {
      const result = await runBroadcastPrune(ctx);
      if (!result.ok) {
        return err(
          makeErrEnvelope(
            ERROR_CODES.DIN_STATE_004,
            `[cron:${name}] failed: ${result.message || "unknown"}`,
            "shell",
            {
              meta: {
                name,
                durationMs: result.durationMs,
                error: result.message,
              },
            }
          )
        );
      }
      return ok(result);
    }
    default: {
      return err(
        makeErrEnvelope(
          ERROR_CODES.DIN_STATE_005,
          `[cron] unknown job name: ${String(name)}`,
          "shell",
          { meta: { name } }
        )
      );
    }
  }
}

export function registerIntervalCronJobs(): {
  stop: () => void;
  handles: Map<CronJobName, ReturnType<typeof setInterval>>;
} {
  const handles = new Map<CronJobName, ReturnType<typeof setInterval>>();
  if (typeof setInterval === "undefined") return { stop: () => {}, handles };

  const broadcastPrune = setInterval(() => {
    void runCronJob("broadcast-stale-prune").catch(() => {
      /* swallow at interval level */
    });
  }, CRON_INTERVAL_BROADCAST_PRUNE_MS);
  handles.set("broadcast-stale-prune", broadcastPrune);

  const stop = () => {
    for (const h of handles.values()) clearInterval(h);
    handles.clear();
  };
  return { stop, handles };
}
