import { describe, expect, it } from "vitest";
import {
  normalizeManualBuyerMemberIds,
  normalizeManualSaleModes,
  normalizeManualSigDraftPersist,
  resizeManualBuyerMemberIds,
  resizeManualSaleModes,
} from "@/lib/manual-sig-workbench";

describe("manual sig sale mode / buyer normalize", () => {
  it("defaults sale modes to single and pads length", () => {
    expect(normalizeManualSaleModes(undefined, 3)).toEqual(["single", "single", "single"]);
    expect(normalizeManualSaleModes(["multi", "nope"], 3)).toEqual(["multi", "single", "single"]);
  });

  it("clears buyer when slot is not sold", () => {
    const flags = [true, false, true];
    expect(normalizeManualBuyerMemberIds(["a", "b", "c"], flags, 3)).toEqual(["a", null, "c"]);
    expect(normalizeManualBuyerMemberIds(["", null, "x"], flags, 3)).toEqual([null, null, "x"]);
  });

  it("resize helpers keep modes and buyers aligned to pick count", () => {
    expect(resizeManualSaleModes(["multi"], 3)).toEqual(["multi", "single", "single"]);
    expect(resizeManualBuyerMemberIds(["m1", "m2"], [true, false, true], 3)).toEqual([
      "m1",
      null,
      null,
    ]);
  });

  it("normalizeManualSigDraftPersist includes modes and buyers", () => {
    const persist = normalizeManualSigDraftPersist(
      {
        drafts: [
          { name: "A", priceInput: "1000", imageUrl: "" },
          { name: "B", priceInput: "2000", imageUrl: "" },
        ],
        oneShotName: "한방",
        oneShotPriceInput: "",
        oneShotImageUrl: "",
        sigSoldFlags: [true, false],
        oneShotMarkSold: false,
        sigSaleModes: ["multi"],
        sigBuyerMemberIds: ["mem1", "mem2"],
      },
      2
    );
    expect(persist?.sigSaleModes).toEqual(["multi", "single"]);
    expect(persist?.sigBuyerMemberIds).toEqual(["mem1", null]);
  });
});
