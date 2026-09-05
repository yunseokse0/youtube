import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, mapResult, bindResult, unwrapResult, type Result } from "@domain/types/result";
import { makeErrEnvelope, type ErrorEnvelope } from "@domain/types/error-envelope";

describe("Result<T,E> discriminated union", () => {
  it("TR-2.1: tag narrowing으로 err.error.code 접근 가능 + 타입체크 통과", () => {
    const env: ErrorEnvelope = makeErrEnvelope("DIN-TEST-001", "test msg", "domain");
    const r: Result<number, ErrorEnvelope> = err(env);

    expect(r.tag).toBe("err");
    if (r.tag === "err") {
      expect(r.error.code).toBe("DIN-TEST-001");
      expect(r.error.message).toBe("test msg");
      expect(r.error.layer).toBe("domain");
    }

    const r2: Result<number, ErrorEnvelope> = ok(42);
    expect(r2.tag).toBe("ok");
    if (r2.tag === "ok") {
      expect(r2.value).toBe(42);
    }

    expect(isOk(r2)).toBe(true);
    expect(isErr(r)).toBe(true);
  });

  it("mapResult / bindResult / unwrapResult 동작", () => {
    const o = ok<number>(10);
    const doubled = mapResult(o, (v) => v * 2);
    expect(doubled.tag === "ok" && doubled.value).toBe(20);

    const bound = bindResult(o, (v) => ok(String(v)));
    expect(bound.tag === "ok" && bound.value).toBe("10");

    const e: Result<number, ErrorEnvelope> = err(
      makeErrEnvelope("DIN-TEST-002", "boom", "infra"),
    );
    const mappedE = mapResult(e, (v) => v * 2);
    expect(mappedE.tag).toBe("err");

    expect(() => unwrapResult(e)).toThrow(/\[DIN-TEST-002\] boom/);
    expect(unwrapResult(ok(7))).toBe(7);
  });
});
