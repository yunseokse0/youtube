import { describe, expect, it } from "vitest";
import { collectUsedSigImageKeys, filterBundledPathsNotInUse } from "@/lib/sig-bundled-sync";
import { defaultState } from "@/lib/state";

describe("sig-bundled-sync", () => {
  it("filters paths already in inventory", () => {
    const state = defaultState();
    state.sigInventory = [
      {
        id: "a",
        name: "테스트",
        price: 0,
        imageUrl: "/images/sigs/from-drive/old.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      },
    ];
    const used = collectUsedSigImageKeys(state);
    const out = filterBundledPathsNotInUse(
      ["/images/sigs/from-drive/old.gif", "/images/sigs/from-drive/new.gif", "/images/sigs/stamp.svg"],
      used
    );
    expect(out).toEqual(["/images/sigs/from-drive/new.gif"]);
  });
});
