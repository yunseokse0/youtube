import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultState, loadState, saveStateAsync, storageKey } from "@/lib/state";

describe("sigSoldOutStampUrl persistence", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    const ls = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, updatedAt: Date.now() }),
    }));
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", {
      localStorage: ls,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      fetch: fetchMock,
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "CustomEvent",
      class CustomEvent {
        type: string;
        detail: unknown;
        constructor(type: string, init?: { detail?: unknown }) {
          this.type = type;
          this.detail = init?.detail;
        }
      }
    );
  });

  it("does not send empty stamp URL on ordinary save (keeps server custom)", async () => {
    const userId = "stamp-omit-empty";
    const rich = {
      ...defaultState(),
      sigSoldOutStampUrl: "/uploads/sigs/bttaeho/custom_stamp.png",
      members: [{ id: "m1", name: "피자", account: 1000, toon: 0, contribution: 1000 }],
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(rich));

    const emptyStamp = {
      ...rich,
      sigSoldOutStampUrl: "",
      updatedAt: Date.now(),
    };
    await saveStateAsync(emptyStamp, userId, { omitDonationFields: true });

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const body = JSON.parse(String(calls[0][1]?.body || "{}")) as Record<string, unknown>;
    expect(body).not.toHaveProperty("sigSoldOutStampUrl");
  });

  it("sends empty stamp when clearSigSoldOutStamp is set", async () => {
    const userId = "stamp-clear";
    const rich = {
      ...defaultState(),
      sigSoldOutStampUrl: "/uploads/sigs/bttaeho/custom_stamp.png",
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(rich));

    const cleared = { ...rich, sigSoldOutStampUrl: "", updatedAt: Date.now() };
    await saveStateAsync(cleared, userId, {
      omitDonationFields: true,
      clearSigSoldOutStamp: true,
    });

    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse(String(calls[0][1]?.body || "{}")) as Record<string, unknown>;
    expect(body.sigSoldOutStampUrl).toBe("");
    expect(body.clearSigSoldOutStamp).toBe(true);
  });

  it("sends custom stamp URL on upload save", async () => {
    const userId = "stamp-upload";
    const next = {
      ...defaultState(),
      sigSoldOutStampUrl: "/uploads/sigs/bttaeho/1785846410495_f.png",
      updatedAt: Date.now(),
    };
    await saveStateAsync(next, userId, { omitDonationFields: true });
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const body = JSON.parse(String(calls[0][1]?.body || "{}")) as Record<string, unknown>;
    expect(body.sigSoldOutStampUrl).toBe("/uploads/sigs/bttaeho/1785846410495_f.png");
    expect(loadState(userId).sigSoldOutStampUrl).toContain("1785846410495");
  });
});
