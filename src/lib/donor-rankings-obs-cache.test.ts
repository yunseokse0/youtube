import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { defaultState } from "@/lib/state";
import {
  clearDonorRankingsObsCache,
  donorRankingsObsCacheHasRankings,
  readDonorRankingsObsCache,
  writeDonorRankingsObsCache,
} from "@/lib/donor-rankings-obs-cache";

function installSessionStorageMock(): void {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
    },
  });
}

describe("donor-rankings-obs-cache", () => {
  beforeEach(() => {
    installSessionStorageMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("detects meaningful rankings from wire or donors", () => {
    expect(donorRankingsObsCacheHasRankings(null)).toBe(false);
    expect(donorRankingsObsCacheHasRankings(defaultState())).toBe(false);
    expect(
      donorRankingsObsCacheHasRankings({
        donorRankingsWire: {
          unifiedTop: [{ name: "A", amount: 1000 }],
          accountTop: [],
          toonTop: [],
        },
      })
    ).toBe(true);
  });

  it("round-trips cache for OBS bootstrap", () => {
    const state = {
      ...defaultState(),
      updatedAt: 9000,
      donorRankingsUpdatedAt: 9100,
      settlementResetAt: 100,
      donors: [{ id: "d1", name: "DonorA", amount: 5000, memberId: "m1", at: 1, target: "account" as const }],
      donorRankingsWire: {
        unifiedTop: [{ name: "DonorA", amount: 5000 }],
        accountTop: [{ name: "DonorA", amount: 5000 }],
        toonTop: [],
      },
    };
    writeDonorRankingsObsCache("din", state);
    const cached = readDonorRankingsObsCache("din");
    expect(cached?.donorRankingsWire?.unifiedTop).toEqual([{ name: "DonorA", amount: 5000 }]);
    expect(cached?.donors).toHaveLength(1);
    clearDonorRankingsObsCache("din");
    expect(readDonorRankingsObsCache("din")).toBeNull();
  });
});
