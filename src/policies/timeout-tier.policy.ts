import { ERROR_CODES, makeErrEnvelope, type ErrorEnvelope } from "@domain/types/error-envelope";

export const TimeoutTier = {
  L4_MYSQL: 10_000,
  L3_DOMAIN: 14_000,
  L2_SHELL: 16_000,
  L1_API: 25_000,
} as const;

export type TimeoutTierValue = (typeof TimeoutTier)[keyof typeof TimeoutTier];

export type TimeoutTierName = keyof typeof TimeoutTier;

export function resolveTimeoutMs(
  tierOrMs: TimeoutTierValue | number,
): { ms: number; name: string } {
  for (const [name, ms] of Object.entries(TimeoutTier)) {
    if (tierOrMs === ms) {
      return { ms, name };
    }
  }
  return { ms: tierOrMs as number, name: "custom" };
}

export class TimeoutError extends Error {
  readonly envelope: ErrorEnvelope;
  constructor(ms: number, name: string) {
    super(`Timeout after ${ms}ms (tier: ${name})`);
    this.name = "TimeoutError";
    this.envelope = makeErrEnvelope(
      ERROR_CODES.DIN_TIME_001,
      `Operation exceeded ${ms}ms timeout (tier ${name})`,
      "policies",
      { meta: { timeoutMs: ms, timeoutTier: name } },
    );
  }
}

export function applyTimeout<T>(
  promise: Promise<T>,
  tierOrMs: TimeoutTierValue | number,
  abortSignal?: AbortSignal,
): Promise<T> {
  const { ms, name } = resolveTimeoutMs(tierOrMs);

  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new TimeoutError(ms, name));
    }, ms);
  });

  const cleanup = () => {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  if (abortSignal) {
    abortSignal.addEventListener("abort", cleanup, { once: true });
  }

  return Promise.race([promise, timeoutPromise]).finally(cleanup);
}
