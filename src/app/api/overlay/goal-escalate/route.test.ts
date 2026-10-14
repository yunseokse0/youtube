import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const staleKv = vi.hoisted(() => ({ state: null as unknown }));
const kvWrites = vi.hoisted(() => [] as unknown[]);

vi.mock("@/app/api/_shared/upstash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/api/_shared/upstash")>();
  return {
    ...actual,
    isPersistentKvConfigured: () => true,
    isMysqlOnlyPersistentKvConfigured: () => true,
    getPersistentKvLastError: async () => null,
  };
});
vi.mock("@/app/api/_shared/upstash-app-state", () => ({
  upstashGetAppStateJson: vi.fn(async () => staleKv.state),
  upstashSetAppStateJson: vi.fn(async (_key: string, value: unknown) => {
    kvWrites.push(value);
    return true;
  }),
}));

import { defaultState, normalizeDonorsArray } from "@/lib/state";
import type { AppState, Donor, Member } from "@/types";
import { getServerMemoryAppState, setServerMemoryAppState } from "@/lib/server-memory-app-state";
import { invalidateAppStateKvCache } from "@/lib/app-state-server-load";
import { POST } from "./route";

function donor(id: string, amount: number): Donor {
  return { id, name: "준이", amount, memberId: "m1", at: Date.now(), target: "account" } as Donor;
}

function state(donors: Donor[]): AppState {
  const total = donors.reduce((s, d) => s + d.amount, 0);
  return {
    ...defaultState(),
    members: [{ id: "m1", name: "소야", account: total, toon: 0, contribution: total } as Member],
    donors,
    overlayPresets: [
      { id: "p1", showGoal: true, goal: "1000000", goalBaseline: "1000000", goalIncreaseStep: "2000000" },
    ] as AppState["overlayPresets"],
    updatedAt: Date.now(),
  };
}

function post(): Promise<Response> {
  return POST(
    new Request("http://localhost/api/overlay/goal-escalate?u=din", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `sb_user=${encodeURIComponent(JSON.stringify({ id: "din" }))}`,
      },
      body: JSON.stringify({ presetId: "p1" }),
    })
  );
}

describe("POST /api/overlay/goal-escalate", () => {
  beforeEach(() => {
    kvWrites.length = 0;
    invalidateAppStateKvCache("din");
  });

  it("keeps a donation that reached memory but not MySQL yet while raising the goal", async () => {
    const landed = [donor("bank:sms:a", 1_000_000), donor("bank:sms:b", 500_000)];
    const fresh = donor("bank:sms:fresh", 11_900);
    staleKv.state = state(landed);
    setServerMemoryAppState("din", state([...landed, fresh]));

    const res = await post();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.goal).toBe(3_000_000);

    const mem = getServerMemoryAppState("din")!;
    expect(normalizeDonorsArray(mem.donors).map((d) => d.id)).toContain("bank:sms:fresh");
    const written = kvWrites.at(-1) as AppState;
    expect(normalizeDonorsArray(written.donors).map((d) => d.id)).toContain("bank:sms:fresh");
  });
});
