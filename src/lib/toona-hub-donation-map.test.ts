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

  it("keeps a donation inside the saved floor even when the hub was relinked later", () => {
    const relinkedAt = Date.parse("2026-10-07T13:30:00.000Z");
    const floor = Date.parse("2026-10-07T09:00:00.000Z");
    const event = toonaHubDonationToEvent(
      {
        id: "missed-1",
        nickname: "춘삼",
        amount: 17000,
        channel: "toon",
        createdAt: "2026-10-07T09:26:59.000Z",
      },
      relinkedAt,
      { importFromMs: floor }
    );
    expect(event).toMatchObject({ id: "toonation:din:missed-1", amount: 17000, donorName: "춘삼" });
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

describe("빠진 네 건은 이웃 후원과 다른 줄이다", () => {
  const linkedAt = Date.parse("2026-10-07T00:00:00.000Z");
  const row = (
    id: string,
    nickname: string,
    amount: number,
    message: string,
    createdAt: string,
    channel: "toon" | "account"
  ) =>
    toonaHubDonationToEvent(
      { id, nickname, amount, message, createdAt, channel },
      linkedAt,
      { importFromMs: linkedAt }
    );

  it("같은 고유 ID만 중복이고, 금액·메시지가 다른 이웃은 남긴다", () => {
    const chunsam = row("gap-chun", "춘삼", 17000, "자키", "2026-10-07T09:26:59.000Z", "toon");
    const chunsamLater = row("sms-chun-16", "춘삼", 16000, "자키", "2026-10-07T09:35:59.000Z", "toon");
    const hwal1 = row("gap-hwal", "자키집쓰볼탱69", 18000, "얼음인가ㅜ열음임가 컴", "2026-10-07T10:50:37.000Z", "toon");
    const hwal2 = row("sms-hwal", "자키집쓰볼탱69", 18000, "청담에서 오신 고급지신분 컴", "2026-10-07T10:50:26.000Z", "toon");
    const rimo = row("gap-rimo", "리모", 70500, "고은아 모닝빵에 밀웜 고수 좀 넣어줄래?", "2026-10-07T11:26:34.000Z", "toon");
    const rimoLater = row("sms-rimo", "리모", 70500, "고은아 잠시 행복했지?", "2026-10-07T13:20:30.000Z", "toon");
    const bank = row("gap-bank", "03승연곤쥬", 600000, "", "2026-10-07T12:00:55.000Z", "account");
    const bankOther = row("sms-bank", "짐승준열음땅줘", 600000, "", "2026-10-07T11:24:48.000Z", "account");
    expect(chunsam && hwal1 && rimo && bank).toBeTruthy();

    const state = {
      ...defaultState(),
      donors: [chunsamLater, hwal2, rimoLater, bankOther, chunsam].filter(Boolean).map((event) => ({
        id: event!.id,
        name: event!.donorName,
        amount: event!.amount,
        memberId: "m1",
        at: Date.parse(event!.at),
        target: event!.target,
        message: event!.message,
        externalId: event!.externalId,
      })),
    };

    expect(isDuplicateDonationEvent(state, chunsam!)).toBe(true);
    expect(isDuplicateDonationEvent(state, { ...chunsam!, id: "toonation:din:gap-chun" })).toBe(true);
    expect(isDuplicateDonationEvent(state, chunsamLater!)).toBe(true);
    expect(isDuplicateDonationEvent(state, hwal1!)).toBe(false);
    expect(isDuplicateDonationEvent(state, rimo!)).toBe(false);
    expect(isDuplicateDonationEvent(state, bank!)).toBe(false);
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
