import { describe, expect, it } from "vitest";
import { defaultState } from "@/lib/state";
import { getServerMemoryAppState, setServerMemoryAppState } from "./server-memory-app-state";

describe("server-memory-app-state", () => {
  it("stores state per userId", () => {
    const a = { ...defaultState(), updatedAt: 1 };
    const b = { ...defaultState(), updatedAt: 2 };
    setServerMemoryAppState("user_a", a);
    setServerMemoryAppState("user_b", b);
    expect(getServerMemoryAppState("user_a")?.updatedAt).toBe(1);
    expect(getServerMemoryAppState("user_b")?.updatedAt).toBe(2);
    expect(getServerMemoryAppState("user_c")).toBeNull();
  });

  it("clears entry when next is null", () => {
    setServerMemoryAppState("tmp", defaultState());
    setServerMemoryAppState("tmp", null);
    expect(getServerMemoryAppState("tmp")).toBeNull();
  });
});
