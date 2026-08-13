import { describe, expect, it } from "vitest";
import { mapToMember, pickDefaultToonationMember, pickTopRankedDonationMember } from "./mapper";
import type { DonationEvent } from "./types";
import type { Member } from "@/types";

const members: Member[] = [
  { id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 },
  { id: "m2", name: "문형배", account: 0, toon: 0, contribution: 0 },
];

const operatingMember: Member = {
  id: "op",
  name: "운영비",
  account: 0,
  toon: 0,
  contribution: 0,
  operating: true,
};

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

  it("auto-assigns excel rank-1 when toon has no player hint (not operating)", () => {
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
    const mapped = mapToMember(
      event,
      [
        operatingMember,
        { id: "m1", name: "피자", account: 1000, toon: 0, contribution: 1000 },
        { id: "m2", name: "문형배", account: 9000, toon: 0, contribution: 9000 },
      ],
      [],
      { autoAssignToonPlayer: true }
    );
    expect(mapped.memberId).toBe("m2");
    expect(mapped.memberAutoAssigned).toBe(true);
  });

  it("auto-assigns excel rank-1 when account has no player hint", () => {
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
    const mapped = mapToMember(
      event,
      [
        operatingMember,
        { id: "m1", name: "피자", account: 5000, toon: 0, contribution: 5000 },
        { id: "m2", name: "문형배", account: 1000, toon: 0, contribution: 1000 },
      ],
      [],
      { autoAssignToonPlayer: true }
    );
    expect(mapped.memberId).toBe("m1");
    expect(mapped.memberAutoAssigned).toBe(true);
  });

  it("prefers excel rank-1 over treasury when donor-only", () => {
    const treasury: Member = {
      id: "tr",
      name: "국고",
      account: 0,
      toon: 0,
      contribution: 0,
    };
    const team: Member[] = [
      treasury,
      { id: "m1", name: "피자", account: 1000, toon: 0, contribution: 1000 },
      { id: "m2", name: "문형배", account: 5000, toon: 0, contribution: 5000 },
    ];
    const event: DonationEvent = {
      id: "t13",
      provider: "toonation",
      externalId: "e13",
      donorName: "익명",
      amount: 4000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, team, [], { autoAssignToonPlayer: true });
    expect(mapped.memberId).toBe("m2");
    expect(mapped.memberAutoAssigned).toBe(true);
    expect(mapped.status).toBe("processed");
  });

  it("falls back to rank-1 when player hint does not match any member", () => {
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
    const mapped = mapToMember(
      event,
      [
        operatingMember,
        { id: "m1", name: "피자", account: 1000, toon: 0, contribution: 1000 },
        { id: "m2", name: "문형배", account: 8000, toon: 0, contribution: 8000 },
      ],
      [],
      { autoAssignToonPlayer: true }
    );
    expect(mapped.status).toBe("processed");
    expect(mapped.memberId).toBe("m2");
    expect(mapped.memberAutoAssigned).toBe(true);
  });

  it("falls back to rank-1 when toon player hint does not match any member", () => {
    const event: DonationEvent = {
      id: "t4b",
      provider: "toonation",
      externalId: "e4b",
      donorName: "후원자",
      playerName: "없는이름",
      amount: 4000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(
      event,
      [
        operatingMember,
        { id: "m1", name: "피자", account: 2000, toon: 0, contribution: 2000 },
        { id: "m2", name: "문형배", account: 500, toon: 0, contribution: 500 },
      ],
      [],
      { autoAssignToonPlayer: true }
    );
    expect(mapped.status).toBe("processed");
    expect(mapped.memberId).toBe("m1");
    expect(mapped.memberAutoAssigned).toBe(true);
  });

  it("falls back to operating when only operating member exists", () => {
    const event: DonationEvent = {
      id: "t-op-only",
      provider: "toonation",
      externalId: "e-op",
      donorName: "익명",
      amount: 1000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, [operatingMember], [], { autoAssignToonPlayer: true });
    expect(mapped.memberId).toBe("op");
    expect(mapped.memberAutoAssigned).toBe(true);
  });

  it("auto-assigns creation-order rank-1 when totals are tied and hint misses", () => {
    const event: DonationEvent = {
      id: "t4c",
      provider: "toonation",
      externalId: "e4c",
      donorName: "햇님",
      playerName: "없는이름",
      amount: 4000,
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    const mapped = mapToMember(event, members, [], { autoAssignToonPlayer: true });
    expect(mapped.status).toBe("processed");
    expect(mapped.memberId).toBe("m1");
    expect(mapped.memberAutoAssigned).toBe(true);
  });

  it("returns unmatched when roster is empty", () => {
    const event: DonationEvent = {
      id: "t4d",
      provider: "toonation",
      externalId: "e4d",
      donorName: "햇님",
      amount: 1000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, [], [], { autoAssignToonPlayer: true });
    expect(mapped.status).toBe("unmatched");
    expect(mapped.memberId).toBeUndefined();
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

  it("matches short suffix playerName (태호 → BT태호)", () => {
    const team: Member[] = [
      { id: "m1", name: "BT태호", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "홍쓰", account: 0, toon: 0, contribution: 0 },
    ];
    const event: DonationEvent = {
      id: "t9",
      provider: "toonation",
      externalId: "e9",
      donorName: "익명",
      playerName: "태호",
      amount: 10000,
      at: new Date().toISOString(),
      status: "queued",
      target: "account",
    };
    const mapped = mapToMember(event, team);
    expect(mapped.memberId).toBe("m1");
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

  it("matches member when message contains attached name pattern", () => {
    const event: DonationEvent = {
      id: "t7b",
      provider: "toonation",
      externalId: "e7b",
      donorName: "배지은",
      playerName: "",
      message: "오늘은BT태호(응원)갑니다",
      amount: 7100,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const team: Member[] = [
      { id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "BT태호", account: 0, toon: 0, contribution: 0 },
    ];
    const mapped = mapToMember(event, team);
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

  it("matches member by donorName when player and message are empty", () => {
    const event: DonationEvent = {
      id: "t10",
      provider: "toonation",
      externalId: "e10",
      donorName: "피자님",
      amount: 10000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, members);
    expect(mapped.memberId).toBe("m1");
    expect(mapped.status).toBe("processed");
  });

  it("fuzzy-matches hangul similar playerName (지히 → 자하)", () => {
    const team: Member[] = [
      { id: "m-jaha", name: "자하", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "피자", account: 0, toon: 0, contribution: 0 },
    ];
    const event: DonationEvent = {
      id: "t-jahi",
      provider: "toonation",
      externalId: "e-jahi",
      donorName: "Y 철수",
      playerName: "지히",
      message: "익명 지히",
      amount: 10000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, team);
    expect(mapped.memberId).toBe("m-jaha");
    expect(mapped.status).toBe("processed");
  });

  it("auto-applies relaxed fuzzy match when strict match fails", () => {
    const team: Member[] = [
      { id: "m-long", name: "abcdfg", account: 0, toon: 0, contribution: 0 },
    ];
    const event: DonationEvent = {
      id: "t11",
      provider: "toonation",
      externalId: "e11",
      donorName: "익명",
      playerName: "abcdef",
      amount: 11000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, team);
    expect(mapped.memberId).toBe("m-long");
    expect(mapped.memberFuzzyMatched).toBe(true);
    expect(mapped.status).toBe("processed");
  });

  it("fuzzy-matches donor alias on relaxed auto-apply", () => {
    const event: DonationEvent = {
      id: "t12",
      provider: "toonation",
      externalId: "e12",
      donorName: "익명",
      playerName: "abcdef",
      amount: 12000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, members, [{ alias: "abcdfg", memberId: "m1" }]);
    expect(mapped.memberId).toBe("m1");
    expect(mapped.memberFuzzyMatched).toBe(true);
  });

  it("fuzzy-matches one-char typo playerName (홍스 → 홍쓰)", () => {
    const team: Member[] = [
      { id: "m-hong", name: "홍쓰", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "BT태호", account: 0, toon: 0, contribution: 0 },
    ];
    const event: DonationEvent = {
      id: "t-typo",
      provider: "toonation",
      externalId: "e-typo",
      donorName: "Y 철수",
      playerName: "홍스",
      message: "익명 홍스",
      amount: 10000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, team);
    expect(mapped.memberId).toBe("m-hong");
    expect(mapped.memberFuzzyMatched).toBe(true);
    expect(mapped.status).toBe("processed");
  });

  it("fuzzy-matches typo in compact message without spaces", () => {
    const team: Member[] = [
      { id: "m-hong", name: "홍쓰", account: 0, toon: 0, contribution: 0 },
    ];
    const event: DonationEvent = {
      id: "t-compact",
      provider: "toonation",
      externalId: "e-compact",
      donorName: "시청자",
      playerName: "",
      message: "응원홍스화이팅",
      amount: 5000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, team);
    expect(mapped.memberId).toBe("m-hong");
    expect(mapped.memberFuzzyMatched).toBe(true);
  });

  it("partial-matches short suffix in message (비서 → 연비서)", () => {
    const team: Member[] = [
      { id: "m-yeon", name: "연비서", account: 0, toon: 0, contribution: 0 },
      { id: "m2", name: "BT태호", account: 0, toon: 0, contribution: 0 },
    ];
    const event: DonationEvent = {
      id: "t-biseo",
      provider: "toonation",
      externalId: "e-biseo",
      donorName: "Y 철수",
      playerName: "비서",
      message: "익명 비서",
      amount: 100000,
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(event, team);
    expect(mapped.memberId).toBe("m-yeon");
    expect(mapped.status).toBe("processed");
  });
  it("auto-assigns rank-1 for 1000won when donor/member names are empty-ish", () => {
    const event: DonationEvent = {
      id: "t-empty-1k",
      provider: "toonation",
      externalId: "e-empty-1k",
      donorName: "Unknown",
      amount: 1000,
      message: "후원 테스트 입니다.",
      at: new Date().toISOString(),
      status: "queued",
      target: "toon",
    };
    const mapped = mapToMember(
      event,
      [
        { id: "m1", name: "지키", account: 200000, toon: 0, contribution: 200000 },
        { id: "m2", name: "333", account: 0, toon: 0, contribution: 0 },
        { id: "m3", name: "444", account: 150000, toon: 0, contribution: 150000 },
      ],
      [],
      { autoAssignToonPlayer: true }
    );
    expect(mapped.memberId).toBe("m1");
    expect(mapped.memberAutoAssigned).toBe(true);
  });
});

describe("pickTopRankedDonationMember", () => {
  it("picks highest donation member excluding operating and representative", () => {
    const picked = pickTopRankedDonationMember(
      [
        operatingMember,
        { id: "rep", name: "대표님", account: 0, toon: 0, contribution: 0 },
        { id: "m1", name: "피자", account: 1000, toon: 0, contribution: 1000 },
        { id: "m2", name: "문형배", account: 9000, toon: 0, contribution: 9000 },
      ],
      { rep: "대표" }
    );
    expect(picked?.id).toBe("m2");
  });
});

describe("pickDefaultToonationMember", () => {
  it("prefers operating member", () => {
    const picked = pickDefaultToonationMember([
      { id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 },
      operatingMember,
    ]);
    expect(picked?.id).toBe("op");
  });

  it("falls back to representative when no operating member", () => {
    const picked = pickDefaultToonationMember(members, {
      memberPositions: { m2: "대표" },
    });
    expect(picked?.id).toBe("m2");
  });

  it("falls back to national treasury when no operating or representative", () => {
    const picked = pickDefaultToonationMember([
      { id: "m1", name: "피자", account: 0, toon: 0, contribution: 0 },
      { id: "treasury", name: "국고", account: 0, toon: 0, contribution: 0 },
    ]);
    expect(picked?.id).toBe("treasury");
  });

  it("returns undefined when no operating, representative, or treasury", () => {
    expect(pickDefaultToonationMember(members)).toBeUndefined();
  });
});
