import { describe, expect, it } from "vitest";
import {
  isOverlayStateViable,
  shouldKeepLastGoodInsteadOf,
} from "@/lib/overlay-last-good";
import { defaultState } from "@/lib/state";
import { STATE_PICK_OBS_TEXT, STATE_PICK_OVERLAY } from "@/lib/state-api-pick";
import { OBS_TEXT_OVERLAY_STATE_KEY, defaultObsTextRegistry } from "@/lib/obs-text-overlay";

describe("overlay-last-good", () => {
  it("obs-text viable when registry has instances", () => {
    const s = defaultState();
    s.overlaySettings = { [OBS_TEXT_OVERLAY_STATE_KEY]: defaultObsTextRegistry() };
    expect(isOverlayStateViable(s, STATE_PICK_OBS_TEXT)).toBe(true);
  });

  it("overlay viable with members", () => {
    const s = defaultState();
    expect(isOverlayStateViable(s, STATE_PICK_OVERLAY)).toBe(true);
  });

  it("keeps last good when incoming is null", () => {
    const last = defaultState();
    expect(shouldKeepLastGoodInsteadOf(null, STATE_PICK_OVERLAY, last)).toBe(true);
  });
});
