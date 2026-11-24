import { describe, expect, it } from "vitest";
import {
  hasDistinctStrongDonationUids,
  sameDonationEventIdentity,
} from "./donation-event-identity";

describe("donation event identity", () => {
  it("recognizes the same UID across hub source prefixes", () => {
    expect(
      sameDonationEventIdentity(
        { id: "toonation:din:cmumcrom203qg5jncr6t599j6", provider: "toonation", externalId: "ext-a" },
        { id: "bank:sms:cmumcrom203qg5jncr6t599j6", provider: "bank", externalId: "ext-b" }
      )
    ).toBe(true);
  });

  it("does not equate distinct strong UIDs because their external ID matches", () => {
    const first = { id: "bank:sms:uid-first-001", provider: "bank", externalId: "reused-ext" };
    const second = { id: "bank:sms:uid-second-002", provider: "bank", externalId: "reused-ext" };

    expect(hasDistinctStrongDonationUids(first.id, second.id)).toBe(true);
    expect(sameDonationEventIdentity(first, second)).toBe(false);
  });

  it("uses external ID as a fallback when at least one UID is weak or absent", () => {
    expect(
      sameDonationEventIdentity(
        { id: "toonation:fp-old", provider: "toonation", externalId: "reused-ext" },
        { id: "bank:sms:uid-new-001", provider: "toonation", externalId: "reused-ext" }
      )
    ).toBe(true);
  });
});
