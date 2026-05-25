import { describe, expect, it } from "vitest";
import {
  SIG_MATCH_DEMO_SCENARIOS,
  buildSigMatchDemoAppState,
  buildSigMatchDemoSnapshot,
  encodeSigMatchDemoSnapParam,
} from "./sig-match-demo";
import { snapshotToSigMatchState } from "./sig-match-snapshot";

describe("sig-match-snapshot", () => {
  it("round-trips demo snapshot to AppState", () => {
    const raw = buildSigMatchDemoSnapshot("dual-pools", { scoringMode: "amount" });
    const state = snapshotToSigMatchState(raw);
    expect(state).not.toBeNull();
    expect(state!.sigMatchSettings.scoringMode).toBe("amount");
    expect(state!.sigMatchSettings.sigMatchPools.length).toBe(2);
  });

  it("buildSigMatchDemoAppState works for every scenario", () => {
    for (const scenario of SIG_MATCH_DEMO_SCENARIOS) {
      const state = buildSigMatchDemoAppState(scenario);
      expect(state.members.length).toBeGreaterThanOrEqual(3);
      expect(state.sigMatchSettings.isActive).toBe(true);
    }
  });

  it("encodeSigMatchDemoSnapParam produces decodable snap", () => {
    const snap = encodeSigMatchDemoSnapParam(buildSigMatchDemoSnapshot("dual-pools"));
    expect(snap.length).toBeGreaterThan(10);
    const decoded = snapshotToSigMatchState(
      JSON.parse(decodeURIComponent(Buffer.from(snap, "base64").toString("utf8")))
    );
    expect(decoded?.members.length).toBe(4);
  });
});
