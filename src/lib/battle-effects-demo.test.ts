import { describe, expect, it, vi } from "vitest";
import {
  BATTLE_EFFECTS_DEMO_SCENARIOS,
  getBattleEffectsDemoHubPath,
  getBattleEffectsScenarioPath,
} from "./battle-effects-demo";
import { BATTLE_EFFECTS_VERIFY_CASES } from "./battle-effects-verify";
import { OVERLAY_UI_REVISION } from "./overlay-ui-revision";
import { shouldSuppressOverlaySseConnection } from "./overlay-params";

describe("battle-effects-demo", () => {
  it("hub path is stable", () => {
    expect(getBattleEffectsDemoHubPath()).toBe("/overlay/battle-effects-demo");
  });

  it("every scenario yields overlay path with demo or snap", () => {
    for (const s of BATTLE_EFFECTS_DEMO_SCENARIOS) {
      const path = getBattleEffectsScenarioPath(s);
      expect(path).toMatch(/^\/overlay\//);
      expect(path.includes("demo=true") || path.includes("snap=")).toBe(true);
    }
  });

  it("verify cases cover meal and sig with current rev", () => {
    const battles = BATTLE_EFFECTS_VERIFY_CASES.map((c) => c.battle);
    expect(battles).toContain("meal");
    expect(battles).toContain("sig");
    const sigCase = BATTLE_EFFECTS_VERIFY_CASES.find((c) => c.battle === "sig")!;
    expect(sigCase.checks.some((c) => c.label.includes(OVERLAY_UI_REVISION.sig))).toBe(true);
  });

  it("demo hub paths suppress SSE", () => {
    const w = {
      location: { pathname: getBattleEffectsDemoHubPath(), search: "" },
      parent: null as unknown as Window,
    };
    w.parent = w as unknown as Window;
    vi.stubGlobal("window", w);
    expect(shouldSuppressOverlaySseConnection()).toBe(true);
    vi.unstubAllGlobals();
  });
});
