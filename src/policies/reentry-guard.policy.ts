import { ERROR_CODES, makeErrEnvelope, type ErrorEnvelope } from "@domain/types/error-envelope";
import { ok, err, type Result } from "@domain/types/result";

export interface ReentryGuardEntry {
  lastRunAt: number;
  lastResult?: unknown;
}

export interface ReentryGuardOptions {
  nowProvider?: () => number;
}

export const STANDARD_COOLDOWNS: Record<string, number> = {
  "fetchToonaDonationsSinceLink": 60_000,
  "bmodeRefreshRoster": 180_000,
  "bmodeRefreshDonors": 180_000,
  "bmodeRefreshBroadcast": 180_000,
  "pruneStaleBroadcastDonors": 60 * 60_000,
};

export class ReentryGuard {
  private readonly entries = new Map<string, ReentryGuardEntry>();
  private readonly now: () => number;

  constructor(opts: ReentryGuardOptions = {}) {
    this.now = opts.nowProvider ?? (() => Date.now());
  }

  getLastRunAt(name: string): number | null {
    return this.entries.get(name)?.lastRunAt ?? null;
  }

  isCoolingDown(name: string, cooldownMs?: number): { cooling: boolean; remainingMs: number } {
    const effectiveCooldown =
      cooldownMs ?? STANDARD_COOLDOWNS[name] ?? 0;
    if (effectiveCooldown <= 0) {
      return { cooling: false, remainingMs: 0 };
    }
    const entry = this.entries.get(name);
    if (!entry) {
      return { cooling: false, remainingMs: 0 };
    }
    const elapsed = this.now() - entry.lastRunAt;
    if (elapsed < effectiveCooldown) {
      return { cooling: true, remainingMs: effectiveCooldown - elapsed };
    }
    return { cooling: false, remainingMs: 0 };
  }

  async guard<T>(
    name: string,
    cooldownMs: number | undefined,
    fn: () => Promise<T>,
  ): Promise<Result<T, ErrorEnvelope>> {
    const effectiveCooldown =
      cooldownMs ?? STANDARD_COOLDOWNS[name] ?? 0;

    const { cooling, remainingMs } = this.isCoolingDown(name, effectiveCooldown);

    if (cooling) {
      return err(
        makeErrEnvelope(
          ERROR_CODES.DIN_REENTRY_001,
          `[ReentryGuard] ${name} skipped: cooldown remaining ${remainingMs}ms / ${effectiveCooldown}ms`,
          "policies",
          { meta: { name, cooldownMs: effectiveCooldown, remainingMs } },
        ),
      );
    }

    const result = await fn();
    this.entries.set(name, {
      lastRunAt: this.now(),
      lastResult: result,
    });
    return ok(result);
  }

  guardSync<T>(
    name: string,
    cooldownMs: number | undefined,
    fn: () => T,
  ): Result<T, ErrorEnvelope> {
    const effectiveCooldown =
      cooldownMs ?? STANDARD_COOLDOWNS[name] ?? 0;

    const { cooling, remainingMs } = this.isCoolingDown(name, effectiveCooldown);

    if (cooling) {
      return err(
        makeErrEnvelope(
          ERROR_CODES.DIN_REENTRY_002,
          `[ReentryGuard] ${name} sync skipped: cooldown remaining ${remainingMs}ms`,
          "policies",
          { meta: { name, cooldownMs: effectiveCooldown, remainingMs } },
        ),
      );
    }

    const result = fn();
    this.entries.set(name, {
      lastRunAt: this.now(),
      lastResult: result,
    });
    return ok(result);
  }

  forceReset(name?: string): void {
    if (name === undefined) {
      this.entries.clear();
      return;
    }
    this.entries.delete(name);
  }
}

export const defaultReentryGuard = new ReentryGuard();
