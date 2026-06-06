import { describe, expect, it } from "vitest";
import { extractToonationLinkKey, normalizeToonationAlertboxUrl } from "./link-key";

const KEY = "f28dc2204fbaf86fd9df74c12f435c73";

describe("normalizeToonationAlertboxUrl", () => {
  it("accepts bare integration key", () => {
    expect(normalizeToonationAlertboxUrl(KEY)).toBe(`https://toon.at/widget/alertbox/${KEY}`);
  });

  it("accepts full alertbox url", () => {
    expect(normalizeToonationAlertboxUrl(`https://toon.at/widget/alertbox/${KEY}`)).toBe(
      `https://toon.at/widget/alertbox/${KEY}`
    );
  });

  it("accepts path fragment", () => {
    expect(normalizeToonationAlertboxUrl(`/widget/alertbox/${KEY}`)).toBe(
      `https://toon.at/widget/alertbox/${KEY}`
    );
  });

  it("rejects empty and invalid", () => {
    expect(normalizeToonationAlertboxUrl("")).toBeNull();
    expect(normalizeToonationAlertboxUrl("ab")).toBeNull();
    expect(normalizeToonationAlertboxUrl("https://example.com/x")).toBeNull();
  });

  it("extracts key", () => {
    expect(extractToonationLinkKey(KEY)).toBe(KEY);
  });
});
