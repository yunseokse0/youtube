import { describe, expect, it } from "vitest";
import {
  DEFAULT_DONATION_INGEST_MODE,
  donationIngestModeStorageKey,
  parseDonationIngestMode,
} from "@/lib/donation-ingest-mode";

describe("donation-ingest-mode", () => {
  it("defaults to toonation", () => {
    expect(DEFAULT_DONATION_INGEST_MODE).toBe("toonation");
    expect(parseDonationIngestMode(null)).toBe("toonation");
    expect(parseDonationIngestMode("garbage")).toBe("toonation");
  });

  it("parses toona", () => {
    expect(parseDonationIngestMode("toona")).toBe("toona");
  });

  it("scopes storage key by user", () => {
    expect(donationIngestModeStorageKey("alice")).toBe("donationIngestMode:alice");
  });
});
