import { describe, expect, it } from "vitest";
import { authCookieSecure } from "./auth";

describe("authCookieSecure", () => {
  it("미설정 시 HTTP 배포 호환으로 false", () => {
    const prev = process.env.AUTH_COOKIE_SECURE;
    const prevNode = process.env.NODE_ENV;
    delete process.env.AUTH_COOKIE_SECURE;
    process.env.NODE_ENV = "production";
    try {
      expect(authCookieSecure()).toBe(false);
    } finally {
      process.env.NODE_ENV = prevNode;
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
