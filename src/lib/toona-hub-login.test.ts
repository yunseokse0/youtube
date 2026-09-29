import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  TOONA_HUB_CLIENT_CONNECT_TIMEOUT_MS,
  TOONA_HUB_LOGIN_FETCH_MS,
  TOONA_HUB_PATCH_FETCH_MS,
  TOONA_HUB_POST_LINK_WAIT_MS,
  TOONA_HUB_ROUTE_MAX_DURATION_SEC,
  TOONA_HUB_SESSION_WRITE_MS,
  toonaHubLoginSuccessBody,
} from "@/lib/toona-hub-login";

describe("toona hub login connect budget", () => {
  it("does not wait for post-link sig/formula work before returning", () => {
    expect(TOONA_HUB_POST_LINK_WAIT_MS).toBe(0);
    const body = toonaHubLoginSuccessBody({ email: "sssse@gmail.com" });
    expect(body.ok).toBe(true);
    expect(body.sigImport.error).toBe("deferred");
    expect(body.logs).toEqual([]);
  });

  it("keeps hub login+patch+session write inside the browser timeout", () => {
    const serverBudget =
      TOONA_HUB_LOGIN_FETCH_MS + TOONA_HUB_PATCH_FETCH_MS + TOONA_HUB_SESSION_WRITE_MS;
    expect(serverBudget).toBeLessThan(TOONA_HUB_CLIENT_CONNECT_TIMEOUT_MS);
    expect(serverBudget).toBeLessThan(TOONA_HUB_ROUTE_MAX_DURATION_SEC * 1000);
  });

  it("hub route does not statically import heavy post-link modules", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/api/toona/hub/route.ts"), "utf8");
    expect(src).not.toMatch(/from ["']@\/lib\/toona-hub-client["']/);
    expect(src).not.toMatch(/from ["']@\/lib\/overlay-params["']/);
    expect(src).not.toMatch(/from ["']@\/lib\/app-state-server-load["']/);
    expect(src).toMatch(/from ["']@\/infra\/http\/toona-hub-login-link["']/);
  });
});


describe("toona hub login connect budget", () => {
  it("does not wait for post-link sig/formula work before returning", () => {
    expect(TOONA_HUB_POST_LINK_WAIT_MS).toBe(0);
    const body = toonaHubLoginSuccessBody({ email: "sssse@gmail.com" });
    expect(body.ok).toBe(true);
    expect(body.sigImport.error).toBe("deferred");
    expect(body.logs).toEqual([]);
  });

  it("keeps hub login+patch+session write inside the browser timeout", () => {
    const serverBudget =
      TOONA_HUB_LOGIN_FETCH_MS + TOONA_HUB_PATCH_FETCH_MS + TOONA_HUB_SESSION_WRITE_MS;
    expect(serverBudget).toBeLessThan(TOONA_HUB_CLIENT_CONNECT_TIMEOUT_MS);
    expect(serverBudget).toBeLessThan(TOONA_HUB_ROUTE_MAX_DURATION_SEC * 1000);
  });
});
