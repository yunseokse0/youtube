import { describe, expect, it } from "vitest";
import type { Donor } from "@/types";
import { keepServerDonorsUnseenByReplace, sanitizeRemovedDonorIds } from "./donation-replace-keep";

function donor(id: string, amount = 10_000): Donor {
  return { id, name: "준이", amount, at: 1_000, target: "account", memberId: "m1" } as Donor;
}

describe("keepServerDonorsUnseenByReplace", () => {
  it("keeps a server donor the browser tab had not received when it deleted another row", () => {
    const existing = [donor("bank:sms:a"), donor("bank:sms:b"), donor("bank:sms:new", 11_900)];
    const incoming = [donor("bank:sms:a")];
    const out = keepServerDonorsUnseenByReplace(incoming, existing, ["bank:sms:b"]);
    expect(out.donors.map((d) => d.id)).toEqual(["bank:sms:a", "bank:sms:new"]);
    expect(out.kept.map((d) => d.id)).toEqual(["bank:sms:new"]);
  });

  it("still deletes rows the tab explicitly removed", () => {
    const out = keepServerDonorsUnseenByReplace([], [donor("bank:sms:b")], ["bank:sms:b"]);
    expect(out.donors).toEqual([]);
  });

  it("matches push and pull ids of the same hub donation", () => {
    const out = keepServerDonorsUnseenByReplace(
      [donor("bank:din:cmhub1")],
      [donor("bank:sms:cmhub1"), donor("bank:sms:cmhub2")],
      ["bank:din:cmhub2"]
    );
    expect(out.kept).toEqual([]);
  });
});

describe("sanitizeRemovedDonorIds", () => {
  it("is undefined when the client did not send the field (legacy full replace)", () => {
    expect(sanitizeRemovedDonorIds(undefined)).toBeUndefined();
    expect(sanitizeRemovedDonorIds("x")).toBeUndefined();
  });

  it("keeps an empty list so nothing unseen is deleted", () => {
    expect(sanitizeRemovedDonorIds([])).toEqual([]);
    expect(sanitizeRemovedDonorIds([" a ", "", null])).toEqual(["a"]);
  });
});
