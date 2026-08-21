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
    });
  });

  it("allows settlementReset with donorsAuthoritative", () => {
    expect(
      clampBrowserPersistOptionsForServerAuthority({
        settlementReset: true,
        omitDonationFields: false,
      })
    ).toEqual({
      settlementReset: true,
      omitDonationFields: false,
      donorsAuthoritative: true,
    });
  });
});
