import { describe, expect, it } from "vitest";
import { mapToMember, pickDefaultToonationMember } from "./mapper";
import type { DonationEvent } from "./types";
import type { Member } from "@/types";

const members: Member[] = [
  { id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 },
  { id: "m2", name: "문형배", account: 0, toon: 0, contribution: 0 },
];

describe("mapToMember", () => {
  it("matches member by playerName from message", () => {
    const event: DonationEvent = {
      id: "t1",
      provider: "toonation",
      externalId: "e1",
      donorName: "배지은",
      playerName: "피자",
      amount: 1000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, members);
    expect(mapped.memberId).toBe("m1");
    expect(mapped.donorName).toBe("배지은");
  });

  it("auto-assigns first member when toon has no player", () => {
    const event: DonationEvent = {
      id: "t2",
      provider: "toonation",
      externalId: "e2",
      donorName: "배지은",
      amount: 2000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, members, [], { autoAssignToonPlayer: true });
    expect(mapped.memberId).toBe("m1");
    expect(mapped.memberAutoAssigned).toBe(true);
  });

  it("auto-assigns first member when account has no player", () => {
    const event: DonationEvent = {
      id: "t3",
      provider: "toonation",
      externalId: "e3",
      donorName: "햇님",
      amount: 3000,
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    const mapped = mapToMember(event, members, [], { autoAssignToonPlayer: true });
    expect(mapped.memberId).toBe("m1");
    expect(mapped.memberAutoAssigned).toBe(true);
  });

  it("auto-assigns first member when account player is unknown", () => {
    const event: DonationEvent = {
      id: "t4",
      provider: "toonation",
      externalId: "e4",
      donorName: "햇님",
      playerName: "없는이름",
      amount: 4000,
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    const mapped = mapToMember(event, members, [], { autoAssignToonPlayer: true });
    expect(mapped.memberId).toBe("m1");
    expect(mapped.memberAutoAssigned).toBe(true);
  });

  it("fuzzy-matches honorific playerName (피자님 → 피자)", () => {
    const event: DonationEvent = {
      id: "t5",
      provider: "toonation",
      externalId: "e5",
      donorName: "배지은",
      playerName: "피자님",
      amount: 5000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, members);
    expect(mapped.memberId).toBe("m1");
    expect(mapped.memberAutoAssigned).toBeUndefined();
  });

  it("fuzzy-matches near playerName", () => {
    const team: Member[] = [
      { id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "문형배배", account: 0, toon: 0, contribution: 0 },
    ];
    const event: DonationEvent = {
      id: "t6",
      provider: "toonation",
      externalId: "e6",
      donorName: "후원자",
      playerName: "문형배현",
      amount: 6000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, team);
    expect(mapped.memberId).toBe("m2");
  });

  it("matches member name from later message token", () => {
    const event: DonationEvent = {
      id: "t7",
      provider: "toonation",
      externalId: "e7",
      donorName: "배지은",
      playerName: "",
      message: "시그 문형배",
      amount: 7000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, members);
    expect(mapped.memberId).toBe("m2");
  });

  it("matches realName when display name differs", () => {
    const withReal: Member[] = [
      ...members,
      { id: "m3", name: "별명", realName: "홍길동", account: 0, toon: 0, contribution: 0 },
    ];
    const event: DonationEvent = {
      id: "t8",
      provider: "toonation",
      externalId: "e8",
      donorName: "후원",
      playerName: "홍길동",
      amount: 8000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, withReal);
    expect(mapped.memberId).toBe("m3");
  });
});

describe("pickDefaultToonationMember", () => {
  it("returns first member", () => {
    expect(pickDefaultToonationMember(members)?.id).toBe("m1");
  });
});
