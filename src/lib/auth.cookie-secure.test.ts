import { describe, expect, it, vi } from "vitest";
import { authCookieSecure } from "./auth";

describe("authCookieSecure", () => {
  it("미설정 시 HTTP 배포 호환으로 false", () => {
    const prev = process.env.AUTH_COOKIE_SECURE;
    delete process.env.AUTH_COOKIE_SECURE;
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(authCookieSecure()).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      if (prev === undefined) delete process.env.AUTH_COOKIE_SECURE;
      else process.env.AUTH_COOKIE_SECURE = prev;
    }
  });

  it("AUTH_COOKIE_SECURE=true 이면 true", () => {
    const prev = process.env.AUTH_COOKIE_SECURE;
    process.env.AUTH_COOKIE_SECURE = "true";
    try {
      expect(authCookieSecure()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.AUTH_COOKIE_SECURE;
      else process.env.AUTH_COOKIE_SECURE = prev;
    }
  });
});
