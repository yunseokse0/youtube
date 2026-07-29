import { describe, expect, it } from "vitest";
import {
  migrateLegacyLocalStorageKey,
  overlayPresetsStorageKey,
  settlementOptionsStorageKey,
} from "./state";

describe("account-scoped local storage keys", () => {
  it("scopes overlay presets by userId", () => {
    expect(overlayPresetsStorageKey("demo1")).toBe("excel-broadcast-overlay-presets:demo1");
    expect(settlementOptionsStorageKey("demo1")).toBe("excel-broadcast-settlement-options-v1:demo1");
  });

  it("migrateLegacyLocalStorageKey copies legacy to scoped key", () => {
    const legacy = "excel-broadcast-overlay-presets";
    const scoped = overlayPresetsStorageKey("acct_a");
    const store: Record<string, string> = { [legacy]: '["p1"]' };
    const ls = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    // @ts-expect-error test stub
    global.window = { localStorage: ls };
    const migrated = migrateLegacyLocalStorageKey(legacy, scoped);
    expect(migrated).toBe('["p1"]');
    expect(store[scoped]).toBe('["p1"]');
  });
});
