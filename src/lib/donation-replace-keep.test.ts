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

  it("keeps every unseen server donor when the tab removed nothing (removedDonorIds=[])", () => {
    /**
     * 퐁당팝업(마이너스·멤버 재배정) 처럼 후원을 「수정」만 하는 화면의 replace 저장.
     * removedDonorIds=[] 를 보내야 이 탭이 못 받은 신규 후원이 지워지지 않는다.
     */
    const existing = [donor("bank:sms:a"), donor("bank:sms:new1", 5_000), donor("bank:sms:new2", 7_000)];
    const incoming = [donor("bank:sms:a")];
    const out = keepServerDonorsUnseenByReplace(incoming, existing, []);
    expect(out.donors.map((d) => d.id)).toEqual(["bank:sms:a", "bank:sms:new1", "bank:sms:new2"]);
    expect(out.kept.map((d) => d.id)).toEqual(["bank:sms:new1", "bank:sms:new2"]);
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
