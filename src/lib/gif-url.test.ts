import { describe, expect, it } from "vitest";
import { resolveAnimatedSourceForEmbed } from "./gif-url";

describe("resolveAnimatedSourceForEmbed giphy hosts", () => {
  it("resolves media2.giphy.com gif to mp4", () => {
    const out = resolveAnimatedSourceForEmbed(
      "https://media2.giphy.com/media/l0MYC0LajbaPoEADu/giphy.gif"
    );
    expect(out.kind).toBe("video");
    expect(out.src).toBe("https://media.giphy.com/media/l0MYC0LajbaPoEADu/giphy.mp4");
  });

  it("resolves media.giphy.com gif to mp4", () => {
    const out = resolveAnimatedSourceForEmbed(
      "https://media.giphy.com/media/26BRuo6sLetdllPAQ/giphy.gif"
    );
    expect(out.kind).toBe("video");
    expect(out.src).toContain("26BRuo6sLetdllPAQ");
  });
});
