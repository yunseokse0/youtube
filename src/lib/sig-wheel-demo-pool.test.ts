import { describe, expect, it } from "vitest";
import type { AppState } from "@/types";
import {
  WHEEL_DEMO_MENU_COUNT,
  WHEEL_DEMO_SIG_POOL,
  WHEEL_DEMO_WIN_COUNT,
  buildWheelDemoOneShotFromWinners,
  isWheelDemoHostAllowed,
  isWheelDemoModeFromSearchParams,
  isWheelDemoSigId,
  mergeWheelDemoSigInventory,
  buildWheelDemoWinnerQueueForAlignment,
  pickWheelDemoWinners,
  sanitizeAppStateWheelDemo,
  stripWheelDemoSigsFromInventory,
} from "./sig-wheel-demo-pool";
import { ONE_SHOT_SIG_ID, canonicalSigIdFromWheelSliceId } from "@/lib/sig-roulette";

describe("sig-wheel-demo-pool", () => {
  it("데모 풀은 20종", () => {
    expect(WHEEL_DEMO_SIG_POOL).toHaveLength(20);
    expect(WHEEL_DEMO_MENU_COUNT).toBe(20);
    expect(WHEEL_DEMO_WIN_COUNT).toBe(5);
    expect(WHEEL_DEMO_SIG_POOL.every((x) => isWheelDemoSigId(x.id))).toBe(true);
  });

  it("pickWheelDemoWinners returns 5 distinct items with one-shot sum", () => {
    const winners = pickWheelDemoWinners(5);
    expect(winners).toHaveLength(5);
    const oneShot = buildWheelDemoOneShotFromWinners(winners);
    expect(oneShot.id).toBe(ONE_SHOT_SIG_ID);
    expect(oneShot.name).toBe("한방 시그");
    expect(oneShot.price).toBeGreaterThan(0);
  });

  it("stripWheelDemoSigsFromInventory removes wheel_demo and preview_", () => {
    const inv = [
      ...WHEEL_DEMO_SIG_POOL.slice(0, 2),
      { id: "preview_9", name: "x", price: 1, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: true },
      { id: "sig_real", name: "실제", price: 1, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: true },
    ];
    const out = stripWheelDemoSigsFromInventory(inv);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe("sig_real");
  });

  it("mergeWheelDemoSigInventory prepends demo when enabled", () => {
    const merged = mergeWheelDemoSigInventory(
      [{ id: "sig_a", name: "A", price: 1, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: false, isActive: true }],
      true
    );
    expect(merged).toHaveLength(21);
    expect(merged[0]!.id).toBe("wheel_demo_01");
    expect(merged.some((x) => x.id === "sig_a")).toBe(true);
  });

  it("wheelDemo=1 is ignored on production-like host", () => {
    const sp = { get: (k: string) => (k === "wheelDemo" ? "1" : null) };
    expect(isWheelDemoModeFromSearchParams(sp, "youtube-5g1a.onrender.com")).toBe(false);
    expect(isWheelDemoModeFromSearchParams(sp, "localhost")).toBe(true);
  });

  it("isWheelDemoHostAllowed for localhost and LAN", () => {
    expect(isWheelDemoHostAllowed("localhost")).toBe(true);
    expect(isWheelDemoHostAllowed("192.168.0.12")).toBe(true);
    expect(isWheelDemoHostAllowed("youtube-5g1a.onrender.com")).toBe(false);
  });

  it("buildWheelDemoWinnerQueueForAlignment duplicate2 repeats first sig", () => {
    const q = buildWheelDemoWinnerQueueForAlignment({ preset: "duplicate2" });
    expect(q).toHaveLength(5);
    expect(canonicalSigIdFromWheelSliceId(q[0]!.id)).toBe(
      canonicalSigIdFromWheelSliceId(q[1]!.id)
    );
    expect(q[2]!.id).not.toBe(q[0]!.id);
  });

  it("sanitizeAppStateWheelDemo strips inventory and roulette picks", () => {
    const state = {
      sigInventory: [...WHEEL_DEMO_SIG_POOL],
      rouletteState: {
        phase: "LANDED",
        isRolling: false,
        result: WHEEL_DEMO_SIG_POOL[0],
        selectedSigs: WHEEL_DEMO_SIG_POOL.slice(0, 2),
        results: WHEEL_DEMO_SIG_POOL,
        spinCount: 2,
        startedAt: 1,
      },
    } as AppState;
    const out = sanitizeAppStateWheelDemo(state);
    expect(out.sigInventory).toHaveLength(0);
    expect(out.rouletteState?.selectedSigs).toHaveLength(0);
    expect(out.rouletteState?.result).toBeNull();
  });
});
