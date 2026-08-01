import { describe, expect, it } from "vitest";
import {
  isOverlayStateViable,
  shouldKeepLastGoodInsteadOf,
} from "@/lib/overlay-last-good";
import { defaultState } from "@/lib/state";
import {
  STATE_PICK_OBS_TEXT,
  STATE_PICK_OVERLAY,
  STATE_PICK_SIG_SALES,
} from "@/lib/state-api-pick";
import { OBS_TEXT_OVERLAY_STATE_KEY, defaultObsTextRegistry } from "@/lib/obs-text-overlay";

describe("overlay-last-good", () => {
  it("obs-text viable when registry has instances", () => {
    const s = defaultState();
    s.overlaySettings = { [OBS_TEXT_OVERLAY_STATE_KEY]: defaultObsTextRegistry() };
    expect(isOverlayStateViable(s, STATE_PICK_OBS_TEXT)).toBe(true);
  });

  it("overlay viable with meaningful members only", () => {
    const s = defaultState();
    expect(isOverlayStateViable(s, STATE_PICK_OVERLAY)).toBe(false);
    s.members = [{ id: "real1", name: "실멤버", account: 1000, toon: 0 }];
    expect(isOverlayStateViable(s, STATE_PICK_OVERLAY)).toBe(true);
  });

  it("sig-sales viable when at least two selected sigs", () => {
    const s = defaultState();
    expect(isOverlayStateViable(s, STATE_PICK_SIG_SALES)).toBe(false);
    s.rouletteState = {
      ...s.rouletteState!,
      selectedSigs: [
        { id: "a", name: "A", price: 1, imageUrl: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: true },
        { id: "b", name: "B", price: 2, imageUrl: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: true },
      ],
    };
    expect(isOverlayStateViable(s, STATE_PICK_SIG_SALES)).toBe(true);
  });

  it("keeps last good when incoming is null", () => {
    const last = defaultState();
    last.members = [{ id: "real1", name: "실멤버", account: 1000, toon: 0 }];
    expect(shouldKeepLastGoodInsteadOf(null, STATE_PICK_OVERLAY, last)).toBe(true);
  });

  it("keeps last good when obs-text incoming revision is older", () => {
    const newer = defaultState();
    const regNew = defaultObsTextRegistry();
    regNew.instances[0]!.config = {
      ...regNew.instances[0]!.config,
      revision: 5000,
      blocks: [
        {
          ...regNew.instances[0]!.config.blocks[0]!,
          segments: [{ text: "최신 텍스트", color: "#fff" }],
        },
      ],
    };
    newer.overlaySettings = { [OBS_TEXT_OVERLAY_STATE_KEY]: regNew };
    newer.updatedAt = 5000;

    const older = defaultState();
    const regOld = defaultObsTextRegistry();
    regOld.instances[0]!.config = {
      ...regOld.instances[0]!.config,
      revision: 1000,
      blocks: [
        {
          ...regOld.instances[0]!.config.blocks[0]!,
          segments: [{ text: "구 텍스트", color: "#fff" }],
        },
      ],
    };
    older.overlaySettings = { [OBS_TEXT_OVERLAY_STATE_KEY]: regOld };
    older.updatedAt = 1000;

    expect(shouldKeepLastGoodInsteadOf(older, STATE_PICK_OBS_TEXT, newer)).toBe(true);
  });
});
