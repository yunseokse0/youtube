import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultState } from "@/lib/state";
import { collectDay777SigContributionByMember } from "@/lib/overlay-donation-aggregate";
import type { DonationEvent } from "./types";

const mocks = vi.hoisted(() => ({
  broadcastPlayerDonationAlert: vi.fn(async () => undefined),
  enrichDonationEventWithSigMatch: vi.fn(),
  loadAppStateForUserId: vi.fn(),
  persistDonationApplyLikeToonation: vi.fn(),
  releaseDonationApplyClaim: vi.fn(async () => undefined),
}));

vi.mock("@/app/api/donations/_shared/alias-store", () => ({
  readDonationAliases: vi.fn(async () => []),
}));

vi.mock("@/app/api/donations/_shared/applied-store", () => ({
  releaseDonationApplyClaim: mocks.releaseDonationApplyClaim,
  tryClaimDonationApply: vi.fn(async () => true),
}));

vi.mock("@/lib/app-state-server-load", () => ({
  loadAppStateForUserId: mocks.loadAppStateForUserId,
}));

vi.mock("@/lib/overlay-params", () => ({
  resolveScopedOverlayUserId: vi.fn(() => "finalent"),
}));

vi.mock("./player-donation-alert", () => ({
  broadcastPlayerDonationAlert: mocks.broadcastPlayerDonationAlert,
  enrichDonationEventWithSigMatch: mocks.enrichDonationEventWithSigMatch,
}));

vi.mock("@/lib/donation-roster-backup-redis", () => ({
  enrichAppStateWithDonationRosterBackupFromKv: vi.fn(async (_uid, state) => ({ state })),
  loadDonationRosterBackupFromKv: vi.fn(async () => null),
}));

vi.mock("@/lib/donation-roster-backup-core", () => ({
  unionAppStateDonorsFromBackupIfRicher: vi.fn((state) => state),
}));

vi.mock("@/lib/din-ingest-batch-fold", () => ({
  shouldDiscardIngestEventForReset: vi.fn(() => false),
}));

vi.mock("@/lib/intentional-donation-clear", () => ({
  shouldSuppressAutoRosterRestore: vi.fn(() => false),
}));

vi.mock("@/lib/donation/persist-donation-like-toon", () => ({
  persistDonationApplyLikeToonation: mocks.persistDonationApplyLikeToonation,
}));

vi.mock("@/lib/toona-hub-client", () => ({
  fetchToonaHubContributionFormula: vi.fn(async () => null),
}));

vi.mock("./toonation/enqueue-donation", () => ({
  enqueueDonationEvent: vi.fn(async () => true),
  purgeDonationQueueForEvent: vi.fn(async () => undefined),
}));

vi.mock("./toonation/listener-config-store", () => ({
  readToonationListenerConfig: vi.fn(async () => null),
}));

vi.mock("./toonation/owner-donation-remap", () => ({
  resolveToonationDonationWithOwnerRemap: vi.fn(async (_uid, event) => event),
}));

import { tryAutoApplyToonationDonationOnServer } from "./server-apply-donation";

describe("tryAutoApplyToonationDonationOnServer signature credit", () => {
  let appState: ReturnType<typeof defaultState>;

  beforeEach(() => {
    vi.clearAllMocks();
    appState = {
      ...defaultState(),
      members: [{ id: "m1", name: "진아", account: 0, toon: 0, contribution: 0 }],
      donors: [],
    };
    mocks.loadAppStateForUserId.mockImplementation(async () => appState);
    mocks.persistDonationApplyLikeToonation.mockImplementation(async (_uid, state) => ({
      ok: true,
      state,
    }));
    mocks.enrichDonationEventWithSigMatch.mockImplementation(async (_uid, event: DonationEvent) => ({
      ...event,
      matchedSigName: event.amount === 92_000 ? "레츠고" : undefined,
      isAutoMatched: event.amount === 92_000,
    }));
  });

  it("matches the sig before saving the donor row and Pongdang contribution", async () => {
    const event: DonationEvent = {
      id: "toonation:jin-a-92000",
      provider: "toonation",
      externalId: "jin-a-92000",
      donorName: "마에스트라",
      playerName: "진아",
      amount: 92_000,
      message: "레츠고신청!",
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };

    const outcome = await tryAutoApplyToonationDonationOnServer("din", event);

    expect(outcome).toBe("applied");
    expect(mocks.enrichDonationEventWithSigMatch).toHaveBeenCalledTimes(1);
    expect(mocks.persistDonationApplyLikeToonation).toHaveBeenCalledTimes(1);
    expect(mocks.enrichDonationEventWithSigMatch.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.persistDonationApplyLikeToonation.mock.invocationCallOrder[0]
    );
    expect(mocks.broadcastPlayerDonationAlert).toHaveBeenCalledWith(
      "finalent",
      expect.objectContaining({ matchedSigName: "레츠고" })
    );
    const persistedState = mocks.persistDonationApplyLikeToonation.mock.calls[0]?.[1];
    expect(persistedState.donors[0]).toMatchObject({
      memberId: "m1",
      amount: 92_000,
      sigPrice: 92_000,
      isSigCredit: true,
    });
    expect(collectDay777SigContributionByMember(persistedState).get("m1")).toBe(92_000);
  });

  it("does not mark an unmatched donation as a sig credit", async () => {
    const event: DonationEvent = {
      id: "toonation:jin-a-ordinary",
      provider: "toonation",
      externalId: "jin-a-ordinary",
      donorName: "마에스트라",
      playerName: "진아",
      amount: 10_000,
      message: "응원해요",
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };

    await tryAutoApplyToonationDonationOnServer("din", event);

    const persistedState = mocks.persistDonationApplyLikeToonation.mock.calls[0]?.[1];
    expect(persistedState.donors[0]?.sigPrice).toBeUndefined();
    expect(persistedState.donors[0]?.isSigCredit).toBeUndefined();
    expect(collectDay777SigContributionByMember(persistedState).get("m1")).toBeUndefined();
  });

  it("releases the apply claim when sig enrichment throws", async () => {
    const event: DonationEvent = {
      id: "toonation:jin-a-enrichment-error",
      provider: "toonation",
      externalId: "jin-a-enrichment-error",
      donorName: "마에스트라",
      playerName: "진아",
      amount: 92_000,
      message: "레츠고신청!",
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    mocks.enrichDonationEventWithSigMatch.mockRejectedValueOnce(new Error("state read failed"));

    await expect(tryAutoApplyToonationDonationOnServer("din", event)).rejects.toThrow(
      "state read failed"
    );

    expect(mocks.releaseDonationApplyClaim).toHaveBeenCalledWith("finalent", event);
    expect(mocks.persistDonationApplyLikeToonation).not.toHaveBeenCalled();
  });
});
