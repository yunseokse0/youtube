import type { ErrorEnvelope } from "./error-envelope";

export type Result<T, E = ErrorEnvelope> =
  | { tag: "ok"; value: T }
  | { tag: "err"; error: E };

export function ok<T, E = ErrorEnvelope>(value: T): Result<T, E> {
  return { tag: "ok", value };
}

export function err<T, E = ErrorEnvelope>(error: E): Result<T, E> {
  return { tag: "err", error };
}

export function mapResult<T, U, E = ErrorEnvelope>(
  r: Result<T, E>,
  f: (v: T) => U,
): Result<U, E> {
  if (r.tag === "ok") return ok(f(r.value));
  return r;
}

export function bindResult<T, U, E = ErrorEnvelope>(
  r: Result<T, E>,
  f: (v: T) => Result<U, E>,
): Result<U, E> {
  if (r.tag === "ok") return f(r.value);
  return r;
}

export function unwrapResult<T, E = ErrorEnvelope>(r: Result<T, E>): T {
  if (r.tag === "ok") return r.value;
  const e = r.error as unknown as ErrorEnvelope;
  throw new Error(`[${e.code}] ${e.message}`);
}

export function isOk<T, E = ErrorEnvelope>(r: Result<T, E>): r is { tag: "ok"; value: T } {
  return r.tag === "ok";
}

export function isErr<T, E = ErrorEnvelope>(r: Result<T, E>): r is { tag: "err"; error: E } {
  return r.tag === "err";
}
