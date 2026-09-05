import { ERROR_CODES, makeErrEnvelope, type ErrorEnvelope } from "@domain/types/error-envelope";
import { ok, err, type Result } from "@domain/types/result";

export interface InvariantCheckOptions {
  path?: string;
  throwOnViolation?: boolean;
  logOnViolation?: boolean;
  prevState?: unknown;
  dumpThreshold?: number;
}

export interface InvariantViolation {
  code: string;
  rule: string;
  message: string;
  detail: Record<string, unknown>;
}

export interface InvariantCheckResult {
  passed: boolean;
  violations: InvariantViolation[];
  durationMs: number;
}

type AnyState = Record<string, unknown>;

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : -Infinity;
  }
  return -Infinity;
}

function stateHasField(s: unknown, field: string): boolean {
  return typeof s === "object" && s !== null && field in (s as AnyState);
}

function getStateField(s: unknown, field: string): unknown {
  if (typeof s !== "object" || s === null) return undefined;
  return (s as AnyState)[field];
}

export class InvariantContractError extends Error {
  readonly envelope: ErrorEnvelope;
  readonly violations: InvariantViolation[];
  readonly stateSnapshot: unknown;

  constructor(
    message: string,
    violations: InvariantViolation[],
    stateSnapshot: unknown,
    envelope?: ErrorEnvelope,
  ) {
    super(message);
    this.name = "InvariantContractError";
    this.violations = violations;
    this.stateSnapshot = stateSnapshot;
    this.envelope =
      envelope ??
      makeErrEnvelope(
        ERROR_CODES.DIN_INVAR_001,
        message,
        "policies",
        {
          meta: {
            violationCount: violations.length,
            violations: violations.slice(0, 8),
            stateKeys:
              typeof stateSnapshot === "object" && stateSnapshot !== null
                ? Object.keys(stateSnapshot as AnyState).slice(0, 20)
                : [],
          },
        },
      );
  }
}

export class InvariantContract {
  static checkAll(
    state: unknown,
    opts: InvariantCheckOptions = {},
  ): InvariantCheckResult {
    const start = Date.now();
    const violations: InvariantViolation[] = [];

    const r1 = InvariantContract.checkRosterVersionMonotonic(state, opts);
    if (r1) violations.push(r1);

    const r2 = InvariantContract.checkDonorListVersionMonotonic(state, opts);
    if (r2) violations.push(r2);

    const r3 = InvariantContract.checkContributionFormula(state, opts);
    if (r3) violations.push(r3);

    const durationMs = Date.now() - start;
    const passed = violations.length === 0;

    if (!passed && opts.logOnViolation !== false) {
      const prefix = opts.path ? `[${opts.path}] ` : "";
      console.warn(
        `${prefix}[InvariantContract] ${violations.length} violation(s): ${violations.map((v) => `${v.code}/${v.rule}`).join(", ")}`,
      );
    }

    if (!passed && opts.throwOnViolation === true) {
      throw new InvariantContractError(
        `${violations.length} invariant violation(s) at ${opts.path ?? "unknown"}`,
        violations,
        state,
      );
    }

    return { passed, violations, durationMs };
  }

  static assert(state: unknown, opts: InvariantCheckOptions = {}): Result<true, ErrorEnvelope> {
    const result = InvariantContract.checkAll(state, {
      ...opts,
      throwOnViolation: false,
    });
    if (result.passed) return ok(true as const);
    const first = result.violations[0];
    return err(
      makeErrEnvelope(
        first.code,
        first.message,
        "policies",
        {
          meta: {
            path: opts.path,
            allViolations: result.violations,
            durationMs: result.durationMs,
          },
        },
      ),
    );
  }

  static checkRosterVersionMonotonic(
    state: unknown,
    opts: InvariantCheckOptions = {},
  ): InvariantViolation | null {
    const prev = opts.prevState;
    const prevV = toNum(getStateField(prev ?? state, "prevRosterVersion"));
    const curV = toNum(getStateField(state, "rosterVersion"));

    if (prevV === -Infinity || curV === -Infinity) return null;
    if (curV >= prevV) return null;

    return {
      code: ERROR_CODES.DIN_INVAR_001,
      rule: "rosterVersion.monotonic",
      message: `rosterVersion regressed: ${curV} < prev ${prevV}`,
      detail: { path: opts.path ?? "unknown", prevRosterVersion: prevV, rosterVersion: curV },
    };
  }

  static checkDonorListVersionMonotonic(
    state: unknown,
    opts: InvariantCheckOptions = {},
  ): InvariantViolation | null {
    const prev = opts.prevState;
    const prevV = toNum(getStateField(prev ?? state, "prevDonorListVersion"));
    const curV = toNum(getStateField(state, "donorListVersion"));

    if (prevV === -Infinity || curV === -Infinity) return null;
    if (curV >= prevV) return null;

    return {
      code: ERROR_CODES.DIN_INVAR_002,
      rule: "donorListVersion.monotonic",
      message: `donorListVersion regressed: ${curV} < prev ${prevV}`,
      detail: { path: opts.path ?? "unknown", prevDonorListVersion: prevV, donorListVersion: curV },
    };
  }

  static checkContributionFormula(
    state: unknown,
    _opts: InvariantCheckOptions = {},
  ): InvariantViolation | null {
    if (typeof state !== "object" || state === null) return null;

    const hasSources =
      stateHasField(state, "donationLinks") || stateHasField(state, "sources");
    const hasContribution = stateHasField(state, "members") || stateHasField(state, "contributionLogs");

    if (!hasSources || !hasContribution) return null;

    const members = getStateField(state, "members");
    if (!Array.isArray(members)) return null;

    const memberContribSum = members.reduce<number>((acc, m) => {
      const c = toNum(getStateField(m, "contribution"));
      return acc + (c === -Infinity ? 0 : c);
    }, 0);

    const logs = getStateField(state, "contributionLogs");
    const logSum =
      Array.isArray(logs)
        ? logs.reduce<number>((acc, l) => {
            const delta = toNum(getStateField(l, "delta"));
            return acc + (delta === -Infinity ? 0 : delta);
          }, 0)
        : 0;

    if (logSum === 0) return null;
    if (Math.abs(memberContribSum - logSum) < 0.5) return null;

    return {
      code: ERROR_CODES.DIN_INVAR_003,
      rule: "contribution.sumMatchesLogs",
      message: `Member contrib total ${memberContribSum} != contributionLogs delta sum ${logSum}`,
      detail: {
        memberContribSum,
        logSum,
        diff: Math.abs(memberContribSum - logSum),
        path: _opts.path ?? "unknown",
      },
    };
  }
}

export function assertInvariants(
  state: unknown,
  path?: string,
  throwOnFail = false,
): InvariantCheckResult {
  return InvariantContract.checkAll(state, { path, throwOnViolation: throwOnFail });
}
