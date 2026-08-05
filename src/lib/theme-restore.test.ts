import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { defaultState } from "@/lib/state";
import type { AppState } from "@/types";
import {
  applyThemeRestorePatch,
  describeOverlayThemeLabel,
  healDonationFieldsFromLocalSnapshot,
  isThemeRestoreDismissedForCandidate,
  markThemeRestoreDismissed,
  pickBestThemeRestoreCandidate,
  scoreThemeRestoreFields,
  shouldOfferThemeRestore,
  themeRestoreCandidateFingerprint,
  type ThemeRestoreCandidate,
} from "@/lib/theme-restore";

describe("theme-restore", () => {
  const mem = new Map<string, string>();

  beforeEach(() => {
    mem.clear();
    const ls = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, String(v));
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    };
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", { localStorage: ls });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("scores custom overlay presets higher than default", () => {
    const custom = scoreThemeRestoreFields({
      overlayPresets: [{ id: "ov1", name: "방송", theme: "excelLive" } as AppState["overlayPresets"][number]],
    });
    const basic = scoreThemeRestoreFields({
      overlayPresets: [{ id: "ov0", name: "기본", theme: "default" } as AppState["overlayPresets"][number]],
    });
    expect(custom).toBeGreaterThan(basic);
  });

  it("offers restore when current is default and backup is custom", () => {
    const current = defaultState();
    const candidate: ThemeRestoreCandidate = {
      source: "test",
      score: 140,
      updatedAt: 1,
      overlayPresets: [{ id: "ov1", name: "방송", theme: "excelLive" } as AppState["overlayPresets"][number]],
    };
    expect(shouldOfferThemeRestore(current, candidate)).toBe(true);
  });

  it("remembers dismiss so the same candidate is not offered again", () => {
    const candidate: ThemeRestoreCandidate = {
      source: "브라우저 방송 상태",
      score: 140,
      updatedAt: 99,
      overlayPresets: [{ id: "ov1", name: "방송", theme: "excelLive" } as AppState["overlayPresets"][number]],
    };
    expect(isThemeRestoreDismissedForCandidate("finalent", candidate)).toBe(false);
    markThemeRestoreDismissed("finalent", candidate);
    expect(isThemeRestoreDismissedForCandidate("finalent", candidate)).toBe(true);
    expect(
      isThemeRestoreDismissedForCandidate("finalent", {
        ...candidate,
        updatedAt: 100,
        score: 150,
      })
    ).toBe(false);
    expect(themeRestoreCandidateFingerprint(candidate)).toContain("방송");
  });

  it("heals empty live donations from richer local snapshot", () => {
    const live: AppState = {
      ...defaultState(),
      donors: [],
      members: defaultState().members.map((m) => ({ ...m, account: 0, toon: 0 })),
    };
    const local: AppState = {
      ...defaultState(),
      donors: [{ id: "d1", name: "a", amount: 5000, memberId: "m1", at: 1, target: "toon" }],
      members: defaultState().members.map((m, i) =>
        i === 0 ? { ...m, id: "m1", toon: 5000 } : { ...m, account: 0, toon: 0 }
      ),
    };
    const healed = healDonationFieldsFromLocalSnapshot(live, local);
    expect(healed?.donors).toHaveLength(1);
    expect(healed?.donors[0]?.amount).toBe(5000);
  });

  it("does not heal local donations older than live settlement reset", () => {
    const live: AppState = {
      ...defaultState(),
      settlementResetAt: 10_000,
      donors: [],
      members: defaultState().members.map((m) => ({ ...m, account: 0, toon: 0 })),
    };
    const local: AppState = {
      ...defaultState(),
      settlementResetAt: 1_000,
      donors: [{ id: "d1", name: "a", amount: 5000, memberId: "m1", at: 5_000, target: "toon" }],
      members: defaultState().members.map((m, i) =>
        i === 0 ? { ...m, id: "m1", toon: 5000 } : { ...m, account: 0, toon: 0 }
      ),
    };
    expect(healDonationFieldsFromLocalSnapshot(live, local)).toBeNull();
  });

  it("applies theme patch without touching donors", () => {
    const base: AppState = {
      ...defaultState(),
      donors: [{ id: "d1", name: "a", amount: 1000, memberId: "m1", at: 1, target: "toon" }],
    };
    const candidate: ThemeRestoreCandidate = {
      source: "test",
      score: 140,
      updatedAt: 1,
      overlayPresets: [{ id: "ov1", name: "방송", theme: "excelLive" } as AppState["overlayPresets"][number]],
    };
    const next = applyThemeRestorePatch(base, candidate);
    expect(next.overlayPresets?.[0]?.theme).toBe("excelLive");
    expect(next.donors).toHaveLength(1);
  });

  it("picks best candidate by score", () => {
    const best = pickBestThemeRestoreCandidate([
      { source: "a", score: 60, updatedAt: 1, overlayPresets: [{ id: "1", theme: "excel" } as AppState["overlayPresets"][number]] },
      { source: "b", score: 140, updatedAt: 2, overlayPresets: [{ id: "2", theme: "excelLive" } as AppState["overlayPresets"][number]] },
    ]);
    expect(best?.source).toBe("b");
  });

  it("describes overlay theme label", () => {
    expect(
      describeOverlayThemeLabel([{ id: "1", name: "방송 엑셀", theme: "excelLive" }])
    ).toBe("방송 엑셀");
  });
});
