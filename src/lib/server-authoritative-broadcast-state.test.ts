import { describe, expect, it } from "vitest";
import { clampBrowserPersistOptionsForServerAuthority } from "./server-authoritative-broadcast-state";

describe("clampBrowserPersistOptionsForServerAuthority", () => {
  it("strips donorsAuthoritative and forces omitDonationFields for normal saves", () => {
    expect(
      clampBrowserPersistOptionsForServerAuthority({
        donorsAuthoritative: true,
        membersAuthoritative: true,
      })
    ).toEqual({
      membersAuthoritative: true,
      omitDonationFields: true,
      omitHighSocietyFields: true,
    });
  });

  it("allows highSocietySettingsOnly to keep sending territory settings", () => {
    expect(
      clampBrowserPersistOptionsForServerAuthority({
        omitDonationFields: true,
        highSocietySettingsOnly: true,
      })
    ).toEqual({
      omitDonationFields: true,
      highSocietySettingsOnly: true,
    });
  });

  it("allows settlementReset with donorsAuthoritative without touching territory", () => {
    expect(
      clampBrowserPersistOptionsForServerAuthority({
        settlementReset: true,
        omitDonationFields: false,
      })
    ).toEqual({
      settlementReset: true,
      omitDonationFields: false,
      donorsAuthoritative: true,
      omitHighSocietyFields: true,
    });
  });
});
