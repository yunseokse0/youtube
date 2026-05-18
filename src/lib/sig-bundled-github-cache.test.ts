import { describe, expect, it } from "vitest";
import {
  readSigGithubTreeCache,
  readSigGithubTreeCacheMs,
  writeSigGithubTreeCache,
} from "@/lib/sig-bundled-github-cache";

describe("sig-bundled-github-cache", () => {
  const ctx = { owner: "o", repo: "r", ref: "main" };

  it("stores and reads paths until TTL", () => {
    const prev = process.env.SIG_BUNDLED_GITHUB_CACHE_MS;
    process.env.SIG_BUNDLED_GITHUB_CACHE_MS = "60000";
    try {
      writeSigGithubTreeCache(ctx, ["/images/sigs/a.gif"]);
      expect(readSigGithubTreeCache(ctx)).toEqual(["/images/sigs/a.gif"]);
      expect(readSigGithubTreeCacheMs()).toBe(60000);
    } finally {
      if (prev === undefined) delete process.env.SIG_BUNDLED_GITHUB_CACHE_MS;
      else process.env.SIG_BUNDLED_GITHUB_CACHE_MS = prev;
    }
  });
});
