import { describe, expect, it } from "vitest";
import { toonaHubDonationToEvent } from "@/lib/toona-hub-donation-map";
import { isDuplicateDonationEvent } from "@/lib/donation/apply-donation-state";
import { defaultState } from "@/lib/state";

describe("toonaHubDonationToEvent (scenario B 1:1)", () => {
  const linkedAt = Date.parse("2026-09-03T00:00:00.000Z");

  it("maps account channel to bank:din:{id}", () => {
    const event = toonaHubDonationToEvent(
      {
        id: "don-abc",
        nickname: "홍 길동",
        amount: 50000,
        channel: "account",
        source: "sms",
        playerName: "자키",
        createdAt: "2026-09-03T01:00:00.000Z",
        message: "계좌 후원",
      },
      linkedAt
    );
    expect(event).toMatchObject({
      id: "bank:din:don-abc",
      provider: "bank",
      externalId: "don-abc",
      donorName: "홍길동",
      amount: 50000,
      target: "account",
      playerName: "자키",
    });
  });

  it("maps toon channel to toonation:din:{id}", () => {
    const event = toonaHubDonationToEvent(
      {
        id: "toon-1",
        displayNickname: "박자기",
        amount: 10000,
        channel: "toon",
        createdAt: "2026-09-03T01:00:00.000Z",
      },
      linkedAt
    );
    expect(event).toMatchObject({
      id: "toonation:din:toon-1",
      provider: "toonation",
      externalId: "toon-1",
      target: "toon",
      donorName: "박자기",
    });
  });

  it("skips donations before hub link", () => {
    expect(
      toonaHubDonationToEvent(
        {
          id: "old",
          nickname: "a",
          amount: 1000,
          createdAt: "2026-09-02T00:00:00.000Z",
        },
        linkedAt
      )
    ).toBeNull();
  });
});

describe("scenario B pull vs ingest dedupe", () => {
  it("treats bank:din:{id} as duplicate of existing donor with same external id suffix", () => {
    const state = {
      ...defaultState(),
      donors: [
        {
          id: "bank:sms:don-abc",
          name: "홍길동",
          amount: 50000,
          memberId: "m1",
          at: Date.parse("2026-09-03T01:00:00.000Z"),
          target: "account" as const,
        },
      ],
    };
    const pullEvent = toonaHubDonationToEvent(
      {
        id: "don-abc",
        nickname: "홍길동",
        amount: 50000,
        channel: "account",
        createdAt: "2026-09-03T01:00:00.000Z",
      },
      Date.parse("2026-09-03T00:00:00.000Z")
    );
    expect(pullEvent).not.toBeNull();
    expect(isDuplicateDonationEvent(state, pullEvent!)).toBe(true);
  });
});
