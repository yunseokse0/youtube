import { describe, expect, it } from "vitest";
import { buildOverlaySyncSignature } from "@/lib/overlay-sync-signature";
import { defaultState } from "@/lib/state";

describe("buildOverlaySyncSignature", () => {
  it("changes when timer display style changes but members are the same", () => {
    const a = defaultState();
    const b = {
      ...a,
      timerDisplayStyles: {
        general: {
          ...a.timerDisplayStyles.general,
          bgColor: "transparent",
          borderColor: "transparent",
          bgOpacity: 0,
        },
      },
    };
    expect(buildOverlaySyncSignature(a)).not.toBe(buildOverlaySyncSignature(b));
  });
});
