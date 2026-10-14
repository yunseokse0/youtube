import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultState } from "@/lib/state";
import type { DonationEvent } from "@/lib/donation/types";
import type { AppState, Member } from "@/types";

const loadState = vi.fn<(uid: string) => Promise<AppState | null>>();
const persistApply = vi.fn<
  (uid: string, state: AppState, event: DonationEvent) => Promise<{ ok: true; state: AppState } | { ok: false }>
>();
const enqueueAdmin = vi.fn<(uid: string, event: DonationEvent) => Promise<boolean>>();

vi.mock("@/app/api/donations/_shared/alias-store", () => ({
  readDonationAliases: vi.fn(async () => []),
}));
vi.mock("@/lib/app-state-server-load", () => ({
  loadAppStateForUserId: (uid: string) => loadState(uid),
}));
vi.mock("@/lib/donation/persist-donation-like-toon", () => ({
  persistDonationApplyLikeToonation: (uid: string, state: AppState, event: DonationEvent) =>
    persistApply(uid, state, event),
}));
vi.mock("@/lib/donation/toonation/enqueue-donation", () => ({
  enqueueDonationEvent: (uid: string, event: DonationEvent) => enqueueAdmin(uid, event),
}));
vi.mock("@/lib/overlay-params", () => ({
  resolveScopedOverlayUserId: (uid: string) => uid,
}));

import {
  drainDinIngestQueue,
  offerDinExcelIngest,
  resetDinIngestBatchQueueForTests,
} from "./din-ingest-batch-queue";
import { getDinIngestStore } from "./din-ingest-pending";

function baseState(): AppState {
  return {
    ...defaultState(),
    members: [{ id: "m1", name: "소야", account: 0, toon: 0, contribution: 0, operating: false } as Member],
    donors: [],
  };
}

function hubEvent(cuid: string, extra?: Partial<DonationEvent>): DonationEvent {
  return {
    id: `bank:sms:${cuid}`,
    provider: "bank",
    externalId: cuid,
    donorName: "준이",
    amount: 11_900,
    message: "",
    at: new Date().toISOString(),
    status: "queued",
    target: "account",
    memberId: "m1",
    manualAssignMemberId: "m1",
    ...extra,
  };
}

function queued(): number {
  return (getDinIngestStore().byUser.get("din") || []).length;
}

/** 허브 보조 수집이 같은 후원을 다시 줬을 때 받아들이는지 = ID 기억이 풀렸는지 */
function pullWouldAccept(cuid: string): boolean {
  return !offerDinExcelIngest("din", { ...hubEvent(cuid), id: `bank:din:${cuid}` }).duplicateQueued;
}

describe("drainDinIngestQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetDinIngestBatchQueueForTests();
    loadState.mockReset();
    persistApply.mockReset();
    enqueueAdmin.mockReset();
    enqueueAdmin.mockResolvedValue(true);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("puts the batch back when a flush throws, then lands it on the retry", async () => {
    loadState.mockRejectedValueOnce(new Error("mysql timeout")).mockResolvedValue(baseState());
    persistApply.mockImplementation(async (_uid, state) => ({ ok: true, state }));

    offerDinExcelIngest("din", hubEvent("cmv7xk0aa00cj5j57"));
    await drainDinIngestQueue("din");
    expect(queued()).toBe(1);
    expect(persistApply).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2_000);
    expect(queued()).toBe(0);
    expect(persistApply).toHaveBeenCalledTimes(1);
    expect(persistApply.mock.calls[0]![1].donors?.some((d) => d.id === "bank:sms:cmv7xk0aa00cj5j57")).toBe(true);
  });

  it("after repeated missing persists, hands the donation to the admin queue and frees the id", async () => {
    loadState.mockResolvedValue(baseState());
    persistApply.mockImplementation(async () => ({ ok: true, state: baseState() }));
    const event = hubEvent("cmv7xk0aa00cj5j57");

    offerDinExcelIngest("din", event);
    await drainDinIngestQueue("din");
    for (let i = 0; i < 3; i += 1) await vi.advanceTimersByTimeAsync(2_000);

    expect(queued()).toBe(0);
    expect(persistApply).toHaveBeenCalledTimes(4);
    expect(enqueueAdmin).toHaveBeenCalledWith("din", expect.objectContaining({ id: event.id }));
    expect(pullWouldAccept("cmv7xk0aa00cj5j57")).toBe(true);
  });

  it("keeps retrying a missing donation while the admin queue write fails, never drops it", async () => {
    loadState.mockResolvedValue(baseState());
    persistApply.mockImplementation(async () => ({ ok: true, state: baseState() }));
    enqueueAdmin.mockRejectedValue(new Error("kv down"));

    offerDinExcelIngest("din", hubEvent("cmv7xk0aa00cj5j57"));
    await drainDinIngestQueue("din");
    for (let i = 0; i < 5; i += 1) await vi.advanceTimersByTimeAsync(2_000);

    expect(queued()).toBe(1);
    expect(pullWouldAccept("cmv7xk0aa00cj5j57")).toBe(false);

    enqueueAdmin.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(queued()).toBe(0);
    expect(enqueueAdmin).toHaveBeenLastCalledWith("din", expect.objectContaining({ id: "bank:sms:cmv7xk0aa00cj5j57" }));
  });

  it("keeps an unmatched donation queued while the admin queue write fails", async () => {
    loadState.mockResolvedValue(baseState());
    enqueueAdmin.mockRejectedValueOnce(new Error("kv down")).mockResolvedValue(true);
    const unmatched = hubEvent("cmunmatched01", {
      memberId: undefined,
      manualAssignMemberId: "없는멤버",
    });

    offerDinExcelIngest("din", unmatched);
    await drainDinIngestQueue("din");
    expect(queued()).toBe(1);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(queued()).toBe(0);
    expect(enqueueAdmin).toHaveBeenCalledTimes(2);
    expect(persistApply).not.toHaveBeenCalled();
  });

  it("lands new donations behind a stuck one in the next round", async () => {
    loadState.mockResolvedValue(baseState());
    persistApply.mockImplementation(async (_uid, state) => ({
      ok: true,
      state: { ...state, donors: (state.donors || []).filter((d) => d.id !== "bank:sms:cmstuck000001") },
    }));

    offerDinExcelIngest("din", hubEvent("cmstuck000001"));
    await drainDinIngestQueue("din");
    offerDinExcelIngest("din", hubEvent("cmfresh000001", { amount: 15_100 }));
    await vi.advanceTimersByTimeAsync(2_000);

    const landedFresh = persistApply.mock.calls.some(([, s]) =>
      (s.donors || []).some((d) => d.id === "bank:sms:cmfresh000001")
    );
    expect(landedFresh).toBe(true);
    expect(pullWouldAccept("cmfresh000001")).toBe(true);
  });
});
