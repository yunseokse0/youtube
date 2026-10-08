import { describe, expect, it } from "vitest";
import {
  DEFAULT_DONATION_INGEST_MODE,
  donationIngestModeStorageKey,
  parseDonationIngestMode,
} from "@/lib/donation-ingest-mode";

describe("donation-ingest-mode", () => {
  it("defaults to DIN hub and ignores the retired direct mode", () => {
    expect(DEFAULT_DONATION_INGEST_MODE).toBe("toona");
    expect(parseDonationIngestMode(null)).toBe("toona");
    expect(parseDonationIngestMode("toonation")).toBe("toona");
    expect(parseDonationIngestMode("garbage")).toBe("toona");
  });

  it("parses toona", () => {
    expect(parseDonationIngestMode("toona")).toBe("toona");
  });

  it("scopes storage key by user", () => {
    expect(donationIngestModeStorageKey("alice")).toBe("donationIngestMode:alice");
  });
});
