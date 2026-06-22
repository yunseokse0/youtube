import { describe, expect, it } from "vitest";
import {
  clampManualSigPickCount,
  emptyManualDrafts,
  manualSigDraftsReady,
  MAX_MANUAL_SIG_PICK_COUNT,
  MIN_MANUAL_SIG_PICK_COUNT,
  resizeManualDrafts,
} from "@/lib/manual-sig-workbench";

describe("manual sig pick count", () => {
  it("clamps to 2~20", () => {
    expect(clampManualSigPickCount(1)).toBe(MIN_MANUAL_SIG_PICK_COUNT);
    expect(clampManualSigPickCount(99)).toBe(MAX_MANUAL_SIG_PICK_COUNT);
    expect(clampManualSigPickCount(8)).toBe(8);
  });

  it("resizes drafts and validates N filled rows", () => {
    const eight = emptyManualDrafts(8).map((row, idx) => ({
      ...row,
      name: `시그${idx + 1}`,
      priceInput: String((idx + 1) * 1000),
      sourceSigId: `sig-${idx + 1}`,
    }));
    expect(eight).toHaveLength(8);
    expect(manualSigDraftsReady(eight, 8)).toBe(true);
    const shrunk = resizeManualDrafts(eight, 5);
    expect(shrunk).toHaveLength(5);
    expect(manualSigDraftsReady(shrunk, 5)).toBe(true);
    expect(manualSigDraftsReady(shrunk, 8)).toBe(false);
  });
});
