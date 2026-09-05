import { ERROR_CODES, makeErrEnvelope, type ErrorEnvelope } from "@domain/types/error-envelope";
import { ok, err, type Result } from "@domain/types/result";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  failureThreshold?: number;
  openWindowMs?: number;
  resetHalfOpenAfterSuccessCount?: number;
  nowProvider?: () => number;
}

export interface CircuitSnapshot {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  openedAt: number | null;
  totalFailures: number;
  totalSuccesses: number;
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private openedAt: number | null = null;
  private totalFailures = 0;
  private totalSuccesses = 0;

  private readonly failureThreshold: number;
  private readonly openWindowMs: number;
  private readonly resetHalfOpenAfterSuccessCount: number;
  private readonly now: () => number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.openWindowMs = opts.openWindowMs ?? 5_000;
    this.resetHalfOpenAfterSuccessCount = opts.resetHalfOpenAfterSuccessCount ?? 1;
    this.now = opts.nowProvider ?? (() => Date.now());
  }

  getState(): CircuitState {
    if (this.state === "OPEN") {
      const elapsed = this.now() - (this.openedAt ?? 0);
      if (elapsed >= this.openWindowMs) {
        this.state = "HALF_OPEN";
        this.consecutiveSuccesses = 0;
      }
    }
    return this.state;
  }

  snapshot(): CircuitSnapshot {
    const _ = this.getState();
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      openedAt: this.openedAt,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    };
  }

  async execute<T>(name: string, fn: () => Promise<T>): Promise<Result<T, ErrorEnvelope>> {
    const state = this.getState();

    if (state === "OPEN") {
      return err(
        makeErrEnvelope(
          ERROR_CODES.DIN_CB_001,
          `[CB:OPEN] ${name}: circuit open after ${this.consecutiveFailures} failures. ${this.openWindowMs - (this.now() - (this.openedAt ?? this.now()))}ms remaining`,
          "policies",
          {
            meta: {
              name,
              state,
              consecutiveFailures: this.consecutiveFailures,
              threshold: this.failureThreshold,
              openedAt: this.openedAt,
              openWindowMs: this.openWindowMs,
            },
          },
        ),
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return ok(result);
    } catch (e) {
      this.onFailure();
      const msg = e instanceof Error ? e.message : String(e);
      return err(
        makeErrEnvelope(ERROR_CODES.DIN_CB_002, `[CB] ${name} failed: ${msg}`, "policies", {
          cause: e,
          meta: {
            name,
            state: this.getState(),
            consecutiveFailures: this.consecutiveFailures,
          },
        }),
      );
    }
  }

  executeSync<T>(name: string, fn: () => T): Result<T, ErrorEnvelope> {
    const state = this.getState();

    if (state === "OPEN") {
      return err(
        makeErrEnvelope(
          ERROR_CODES.DIN_CB_001,
          `[CB:OPEN sync] ${name}: circuit open after ${this.consecutiveFailures} failures`,
          "policies",
          {
            meta: {
              name,
              consecutiveFailures: this.consecutiveFailures,
              threshold: this.failureThreshold,
            },
          },
        ),
      );
    }

    try {
      const result = fn();
      this.onSuccess();
      return ok(result);
    } catch (e) {
      this.onFailure();
      const msg = e instanceof Error ? e.message : String(e);
      return err(
        makeErrEnvelope(ERROR_CODES.DIN_CB_002, `[CB sync] ${name} failed: ${msg}`, "policies", {
          cause: e,
        }),
      );
    }
  }

  forceClose(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.openedAt = null;
  }

  forceOpen(): void {
    this.state = "OPEN";
    this.openedAt = this.now();
  }

  private onSuccess(): void {
    this.totalSuccesses += 1;
    if (this.state === "HALF_OPEN") {
      this.consecutiveSuccesses += 1;
      if (this.consecutiveSuccesses >= this.resetHalfOpenAfterSuccessCount) {
        this.state = "CLOSED";
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        this.openedAt = null;
      }
    } else {
      this.consecutiveFailures = 0;
    }
  }

  private onFailure(): void {
    this.totalFailures += 1;
    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.openedAt = this.now();
      this.consecutiveFailures = this.failureThreshold;
      this.consecutiveSuccesses = 0;
      return;
    }
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = "OPEN";
      this.openedAt = this.now();
    }
  }
}
