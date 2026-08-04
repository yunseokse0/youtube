import { describe, expect, it } from "vitest";
import {
  EXAMPLE_TOONATION_LINK_KEY,
  extractToonationLinkKey,
  isExampleToonationLinkKey,
  normalizeToonationAlertboxUrl,
} from "./link-key";

const KEY = "abc123def456ghi789jkl012mno345pq";

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

  it("flags UI example key so it is not synced as real config", () => {
    expect(isExampleToonationLinkKey(EXAMPLE_TOONATION_LINK_KEY)).toBe(true);
    expect(
      isExampleToonationLinkKey(`https://toon.at/widget/alertbox/${EXAMPLE_TOONATION_LINK_KEY}`)
    ).toBe(true);
    expect(isExampleToonationLinkKey(KEY)).toBe(false);
  });
});
