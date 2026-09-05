import {
  applyTimeout,
  resolveTimeoutMs,
  type TimeoutTierValue,
  TimeoutError,
} from "@policies/timeout-tier.policy";
import { MemoryMeter, type MeterCounterName } from "@infra/metrics/memory-meter";
import { ERROR_CODES, makeErrEnvelope, type ErrorEnvelope } from "@domain/types/error-envelope";
import { ok, err, type Result } from "@domain/types/result";

let perfNow: () => number;
try {
  const { performance } = require("perf_hooks") as typeof import("perf_hooks");
  perfNow = () => performance.now();
} catch {
  perfNow = () => Date.now();
}

export interface InstrumentedCallOpts {
  abortSignal?: AbortSignal;
  poolLeakDetector?: () => boolean;
  meta?: Record<string, unknown>;
}

export interface InstrumentedCallResult<T> {
  value: T;
  latencyMs: number;
}

const COUNTER_SUCCESS: MeterCounterName = "io_success";
const COUNTER_FAILURE: MeterCounterName = "io_failure";
const COUNTER_TIMEOUT: MeterCounterName = "io_timeout";
const COUNTER_POOL_LEAK: MeterCounterName = "pool_leak";

export class InstrumentedIO {
  private readonly meter: MemoryMeter;

  constructor(meter?: MemoryMeter) {
    this.meter = meter ?? MemoryMeter.shared;
  }

  async callRaw<T>(
    opName: string,
    tierOrMs: TimeoutTierValue | number,
    fn: () => Promise<T>,
    opts: InstrumentedCallOpts = {},
  ): Promise<T> {
    const startedAt = perfNow();
    const { name: tierName } = resolveTimeoutMs(tierOrMs);

    try {
      const result = await applyTimeout(fn(), tierOrMs, opts.abortSignal);

      const latency = perfNow() - startedAt;
      this.meter.incrementCounter(COUNTER_SUCCESS, 1);
      this.meter.recordLatency(`${opName}:${tierName}`, latency);

      if (opts.poolLeakDetector?.()) {
        this.meter.incrementCounter(COUNTER_POOL_LEAK, 1);
      }

      return result;
    } catch (e) {
      const latency = perfNow() - startedAt;

      if (e instanceof TimeoutError) {
        this.meter.incrementCounter(COUNTER_TIMEOUT, 1);
      } else {
        this.meter.incrementCounter(COUNTER_FAILURE, 1);
      }
      this.meter.recordLatency(`${opName}:${tierName}:err`, latency);

      if (opts.poolLeakDetector?.()) {
        this.meter.incrementCounter(COUNTER_POOL_LEAK, 1);
      }

      throw e;
    }
  }

  async callResult<T>(
    opName: string,
    tierOrMs: TimeoutTierValue | number,
    fn: () => Promise<T>,
    opts: InstrumentedCallOpts = {},
  ): Promise<Result<T, ErrorEnvelope>> {
    try {
      const v = await this.callRaw(opName, tierOrMs, fn, opts);
      return ok(v);
    } catch (e) {
      if (e instanceof TimeoutError) {
        return err(e.envelope);
      }
      const msg = e instanceof Error ? e.message : String(e);
      return err(
        makeErrEnvelope(ERROR_CODES.DIN_STATE_001, `[${opName}] ${msg}`, "infra", {
          cause: e,
          meta: opts.meta,
        }),
      );
    }
  }

  wrap<TArgs extends unknown[], TResult>(
    opName: string,
    tierOrMs: TimeoutTierValue | number,
    fn: (...args: TArgs) => Promise<TResult>,
    optsFactory?: (args: TArgs) => InstrumentedCallOpts,
  ): (...args: TArgs) => Promise<TResult> {
    return async (...args: TArgs) => {
      const opts = optsFactory ? optsFactory(args) : {};
      return this.callRaw(opName, tierOrMs, () => fn(...args), opts);
    };
  }

  wrapResult<TArgs extends unknown[], TResult>(
    opName: string,
    tierOrMs: TimeoutTierValue | number,
    fn: (...args: TArgs) => Promise<TResult>,
    optsFactory?: (args: TArgs) => InstrumentedCallOpts,
  ): (...args: TArgs) => Promise<Result<TResult, ErrorEnvelope>> {
    return async (...args: TArgs) => {
      const opts = optsFactory ? optsFactory(args) : {};
      return this.callResult(opName, tierOrMs, () => fn(...args), opts);
    };
  }
}

export const defaultInstrumentedIO = new InstrumentedIO();
