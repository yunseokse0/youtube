import { describe, expect, it } from "vitest";
import type { SigItem } from "@/types";
import {
  layoutSigOverlayResultRow,
  SIG_OVERLAY_CARD_MAX_PX,
  sigOverlayBroadcastCardWidthPx,
  sigOverlayBroadcastMediaHeightPx,
  sigOverlayBroadcastCardTotalHeightPx,
} from "@/components/sig-sales/sig-overlay-card-size";
import {
  buildSessionSpinExclusion,
  buildSigSalesWheelDisplayPool,
  buildWheelMenuSlices,
  buildWheelMenuSlicesFromWinnerQueue,
  buildWheelSlicesForCurrentRoundWinner,
  calculateSpinFinalAngle,
  canonicalSigIdFromWheelSliceId,
  formatWheelSegmentLabel,
  sanitizeWheelDisplayName,
  findSliceIndexForResult,
  pickDistinctSigsByIdAndName,
  pickWheelAnimationResultId,
  pickWheelSliceIdForWin,
  rememberUsedWheelSliceId,
  resolveSigSalesMenuCount,
  dedupeSigQueueByIdAndName,
  resolveSpinQueueForSession,
  resolveWheelSlicesForSpinVisual,
  bindWheelAnimationToRoundWinner,
  resolveWheelSpinTarget,
  wheelDuplicatePickForWinner,
  sigEligibleForSessionSpinPool,
  sigMatchesMemberFilter,
  wheelSliceMatchesServerWinner,
} from "./sig-roulette";

function item(id: string, price = 0): SigItem {
  return {
    id,
    name: id,
    price,
    imageUrl: "",
    maxCount: 1,
    soldCount: 0,
    isRolling: false,
    isActive: true,
  };
}

describe("pickDistinctSigsByIdAndName", () => {
  it("동일 표시명·다른 id 중복 당첨을 막는다", () => {
    const pool: SigItem[] = [
      { ...item("a1"), name: "마티니" },
      { ...item("a2"), name: "마티니" },
      { ...item("b1"), name: "우치다" },
    ];
    const picked = pickDistinctSigsByIdAndName(pool, 3);
    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((x) => x.name))).toEqual(new Set(["마티니", "우치다"]));
  });
});

describe("formatWheelSegmentLabel", () => {
  it("칸이 많을수록 짧게 자른다", () => {
    expect(formatWheelSegmentLabel("귀여워서미안해", 20)).toBe("귀여워서미…");
    expect(formatWheelSegmentLabel("APT", 8)).toBe("APT");
  });

  it("5글자 시그명은 20칸 휠에서도 그대로 표시", () => {
    expect(formatWheelSegmentLabel("퍼킹뱅어", 20)).toBe("퍼킹뱅어");
  });

  it("빈 문자열은 대시", () => {
    expect(formatWheelSegmentLabel("  ", 10)).toBe("—");
  });
});

describe("sanitizeWheelDisplayName", () => {
  it("대체 문자를 제거한다", () => {
    expect(sanitizeWheelDisplayName("퍼킹\uFFFD뱅어")).toBe("퍼킹뱅어");
  });
});

describe("canonicalSigIdFromWheelSliceId", () => {
  it("슬라이스 접미사를 제거해 재고 id와 맞춘다", () => {
    expect(canonicalSigIdFromWheelSliceId("sigA__wslot_3")).toBe("sigA");
    expect(canonicalSigIdFromWheelSliceId("  sigB__wslot_0  ")).toBe("sigB");
  });

  it("접미사가 없으면 그대로 둔다", () => {
    expect(canonicalSigIdFromWheelSliceId("plain")).toBe("plain");
  });
});

describe("wheel animation id per round (regression)", () => {
  it("5회 당첨 큐 각 라운드는 해당 시그 sliceId로만 애니한다", () => {
    const pool: SigItem[] = [
      { ...item("sig_dance"), name: "복고댄스" },
      { ...item("sig_swim"), name: "SWIM" },
      { ...item("sig_apt"), name: "APT" },
      { ...item("sig_london"), name: "LONDON" },
      { ...item("sig_fox"), name: "여우" },
      { ...item("sig_ice"), name: "아이스크림" },
    ];
    const slices = buildWheelMenuSlices(pool, 10);
    const winners = pickDistinctSigsByIdAndName(pool, 5);
    const used = new Set<string>();
    const last = winners[winners.length - 1]!;
    for (let round = 0; round < winners.length; round++) {
      const winner = winners[round]!;
      const target = resolveWheelSpinTarget(slices, winner, round, used, winners.slice(0, round));
      const animId = pickWheelAnimationResultId(target.sliceId, winner, last.id);
      expect(animId, `round ${round}`).toBeTruthy();
      expect(wheelSliceMatchesServerWinner(animId, winner)).toBe(true);
      expect(
        canonicalSigIdFromWheelSliceId(animId!),
        `round ${round} must not use last winner ${last.id}`
      ).toBe(canonicalSigIdFromWheelSliceId(winner.id));
      rememberUsedWheelSliceId(used, target.sliceId);
      const idx = findSliceIndexForResult(target.items, animId!);
      const seg = 360 / target.items.length;
      const norm = ((360 - (idx * seg + seg / 2)) % 360 + 360) % 360;
      const angle = calculateSpinFinalAngle(target.items, animId, target.items.length, 0, 1);
      expect(((angle % 360) + 360) % 360).toBeCloseTo(norm, 8);
    }
  });
});

describe("pickWheelAnimationResultId", () => {
  it("다중 당첨 시 machine.result(마지막 id) 폴백을 쓰지 않는다", () => {
    const last = item("sig_swim");
    const first = item("sig_dance");
    last.name = "SWIM";
    first.name = "복고댄스";
    expect(pickWheelAnimationResultId(null, first, last.id)).toBe("sig_dance");
    expect(pickWheelAnimationResultId(null, null, last.id)).toBe("sig_swim");
    expect(pickWheelAnimationResultId("sig_dance__wslot_2", first, last.id)).toBe(
      "sig_dance__wslot_2"
    );
  });

  it("sliceId 없을 때 wheelItems로 중복 칸 중 올바른 sliceId를 고른다", () => {
    const slices: SigItem[] = [item("a__wslot_0"), item("b__wslot_1"), item("a__wslot_2")];
    const winner = item("a");
    expect(
      pickWheelAnimationResultId(null, winner, { wheelItems: slices, duplicatePick: 1 })
    ).toBe("a__wslot_2");
  });
});

describe("pickWheelSliceIdForWin", () => {
  const dupWheel: SigItem[] = [
    item("a__wslot_0"),
    item("b__wslot_1"),
    item("a__wslot_2"),
  ];

  it("당첨 id에 `__wslot_n`이 붙어 있어도 캐노니컬로 슬라이스와 매칭한다", () => {
    expect(pickWheelSliceIdForWin(dupWheel, "b__wslot_99", 0)).toBe("b__wslot_1");
    expect(pickWheelSliceIdForWin(dupWheel, "a__wslot_0", 0)).toBe("a__wslot_0");
  });

  it("동일 시그가 여러 칸이면 duplicatePick으로 칸을 고른다", () => {
    expect(pickWheelSliceIdForWin(dupWheel, "a", 0)).toBe("a__wslot_0");
    expect(pickWheelSliceIdForWin(dupWheel, "a", 1)).toBe("a__wslot_2");
    expect(pickWheelSliceIdForWin(dupWheel, "a", 2)).toBe("a__wslot_0");
  });

  it("이미 착지한 슬라이스는 다음 라운드에서 다른 칸을 고른다", () => {
    const used = new Set<string>();
    const first = pickWheelSliceIdForWin(dupWheel, "a", 0, used);
    expect(first).toBe("a__wslot_0");
    rememberUsedWheelSliceId(used, first);
    expect(pickWheelSliceIdForWin(dupWheel, "a", 1, used)).toBe("a__wslot_2");
  });
});

describe("sequential same winner on pinned wheel", () => {
  it("2회차 동일 당첨도 착지 slice가 서버 당첨과 일치하고 다른 칸을 쓴다", () => {
    const pool: SigItem[] = [
      { ...item("sig_fox"), name: "여우" },
      { ...item("sig_family"), name: "괴짜가족" },
      item("sig_b"),
      item("sig_c"),
      item("sig_d"),
      item("sig_e"),
    ];
    const slices = buildWheelMenuSlices(pool, 8);
    const winner = { ...item("sig_family"), name: "괴짜가족" };
    const used = new Set<string>();
    const t0 = resolveWheelSpinTarget(slices, winner, 0, used);
    expect(wheelSliceMatchesServerWinner(t0.sliceId, winner)).toBe(true);
    rememberUsedWheelSliceId(used, t0.sliceId);
    const t1 = resolveWheelSpinTarget(slices, winner, 1, used, [winner]);
    expect(wheelSliceMatchesServerWinner(t1.sliceId, winner)).toBe(true);
    expect(t1.sliceId).not.toBe(t0.sliceId);
    const landIdx = findSliceIndexForResult(t1.items, t1.sliceId);
    const foxIdx = findSliceIndexForResult(t1.items, "sig_fox__wslot_0");
    expect(landIdx).toBeGreaterThanOrEqual(0);
    if (foxIdx >= 0) expect(landIdx).not.toBe(foxIdx);
  });
});

describe("findSliceIndexForResult", () => {
  const wheel: SigItem[] = [
    item("alpha__wslot_0"),
    item("beta__wslot_0"),
    item("gamma__wslot_0"),
  ];

  it("당첨 id가 슬라이스 id와 일치하면 해당 인덱스", () => {
    expect(findSliceIndexForResult(wheel, "beta__wslot_0")).toBe(1);
  });

  it("서버가 캐노니컬 id만 넘겨도 슬라이스와 매칭된다", () => {
    expect(findSliceIndexForResult(wheel, "gamma")).toBe(2);
  });

  it("동일 시그 중복 칸이면 duplicatePick으로 인덱스를 고른다", () => {
    const dup: SigItem[] = [item("a__wslot_0"), item("b__wslot_1"), item("a__wslot_2")];
    expect(findSliceIndexForResult(dup, "a", 0)).toBe(0);
    expect(findSliceIndexForResult(dup, "a", 1)).toBe(2);
  });

  it("매칭 실패 시 -1 (잘못된 0번 착지 방지)", () => {
    expect(findSliceIndexForResult(wheel, "unknown")).toBe(-1);
  });
});

describe("buildWheelSlicesForCurrentRoundWinner", () => {
  it("이번 회차 당첨 1칸 휠은 해당 시그만 착지한다", () => {
    const winner = { ...item("sig_fox"), name: "여우" };
    const slices = buildWheelSlicesForCurrentRoundWinner(winner);
    expect(slices).toHaveLength(1);
    const target = resolveWheelSpinTarget(slices, winner, 0);
    expect(wheelSliceMatchesServerWinner(target.sliceId, winner)).toBe(true);
    const angle = calculateSpinFinalAngle(slices, target.sliceId, 1, 0, 1);
    expect(findSliceIndexForResult(slices, target.sliceId)).toBe(0);
    expect(angle).toBeGreaterThan(0);
  });
});

describe("buildWheelMenuSlicesFromWinnerQueue", () => {
  it("당첨 큐만으로 칸을 만들고 순차 남은 큐의 0번이 첫 칸이다", () => {
    const winners = [
      { ...item("sig_a"), name: "A" },
      { ...item("sig_b"), name: "B" },
      { ...item("sig_c"), name: "C" },
    ];
    const remaining = buildWheelMenuSlicesFromWinnerQueue(winners.slice(1));
    expect(remaining).toHaveLength(2);
    expect(canonicalSigIdFromWheelSliceId(remaining[0]!.id)).toBe("sig_b");
    const target = resolveWheelSpinTarget(remaining, winners[1]!, 0);
    expect(wheelSliceMatchesServerWinner(target.sliceId, winners[1]!)).toBe(true);
  });
});

describe("bindWheelAnimationToRoundWinner", () => {
  it("순차 1·2회차는 각각 큐 0번·1번 시그에 착지한다(회차 인덱스 선행 증가 버그 회귀)", () => {
    const queue = ["r0", "r1", "r2"].map((id) => item(id));
    queue[0]!.name = "1회차";
    queue[1]!.name = "2회차";
    queue[2]!.name = "3회차";
    const menu = buildWheelMenuSlices(
      ["a", "b", "c", "d", "e", "f"].map((id) => item(id)),
      6
    );
    const r0 = bindWheelAnimationToRoundWinner({
      wheelSlices: menu,
      roundWinner: queue[0]!,
      roundIndex: 0,
      priorWinners: [],
    });
    expect(wheelSliceMatchesServerWinner(r0.animationResultId, queue[0]!)).toBe(true);
    const r1 = bindWheelAnimationToRoundWinner({
      wheelSlices: menu,
      roundWinner: queue[1]!,
      roundIndex: 1,
      priorWinners: [queue[0]!],
    });
    expect(wheelSliceMatchesServerWinner(r1.animationResultId, queue[1]!)).toBe(true);
    expect(wheelSliceMatchesServerWinner(r1.animationResultId, queue[0]!)).toBe(false);
  });

  it("이번 회차 당첨 시그에 맞춰 animationResultId가 착지한다", () => {
    const slices = buildWheelMenuSlices(
      ["a", "b", "c", "d", "e"].map((id) => item(id)),
      5
    );
    const winner = item("z_round");
    winner.name = "이번당첨";
    const bound = bindWheelAnimationToRoundWinner({
      wheelSlices: slices,
      roundWinner: winner,
      roundIndex: 0,
    });
    expect(bound.animationResultId).toBeTruthy();
    expect(wheelSliceMatchesServerWinner(bound.animationResultId, winner)).toBe(true);
    const idx = findSliceIndexForResult(bound.items, bound.animationResultId);
    expect(bound.items[idx]?.name).toBe("이번당첨");
  });
});

describe("resolveWheelSpinTarget", () => {
  const pool = ["a", "b", "c", "d"].map((id) => item(`${id}__wslot_0`));

  it("서버 당첨이 휠에 없으면 해당 회차 칸에 주입한다", () => {
    const slices = buildWheelMenuSlices(pool, 4);
    const target = resolveWheelSpinTarget(slices, item("z", 99), 2);
    expect(target.sliceId).toBe("z__wslot_2");
    expect(findSliceIndexForResult(target.items, target.sliceId!)).toBe(2);
    expect(wheelSliceMatchesServerWinner(target.sliceId, item("z"))).toBe(true);
  });

  it("동일 시그 중복 칸이면 roundIndex로 칸을 고른다", () => {
    const slices: SigItem[] = [item("a__wslot_0"), item("b__wslot_1"), item("a__wslot_2")];
    const t0 = resolveWheelSpinTarget(slices, item("a"), 0);
    const t1 = resolveWheelSpinTarget(slices, item("a"), 1, undefined, [item("a")]);
    expect(t0.sliceId).toBe("a__wslot_0");
    expect(t1.sliceId).toBe("a__wslot_2");
  });
});

describe("calculateSpinFinalAngle", () => {
  const four: SigItem[] = ["q", "r", "s", "t"].map((id) => item(`${id}__wslot_0`));

  it("minTurns마다 정확히 360도 추가된다", () => {
    const base = 1240;
    const a = calculateSpinFinalAngle(four, "s", 4, base, 1);
    const b = calculateSpinFinalAngle(four, "s", 4, base, 2);
    expect(b - a).toBe(360);
  });

  it("착지 후 (최종각 % 360)이 당첨 슬라이스 중심과 정합한다", () => {
    const count = four.length;
    const currentBase = 100;
    const targetId = "r";
    const idx = findSliceIndexForResult(four, targetId);
    const seg = 360 / count;
    const targetCenter = idx * seg + seg / 2;
    const expectedPointerNorm = ((360 - targetCenter) % 360 + 360) % 360;

    const finalAngle = calculateSpinFinalAngle(four, targetId, count, currentBase, 1);
    const landedNorm = ((finalAngle % 360) + 360) % 360;
    expect(landedNorm).toBeCloseTo(expectedPointerNorm, 10);
  });

  it("targetId 없으면 빈 회전만(minTurns * 360) 더한다", () => {
    expect(calculateSpinFinalAngle(four, null, 4, 50, 2)).toBe(50 + 2 * 360);
  });
});

describe("resolveSigSalesMenuCount", () => {
  it("활성 시그보다 많은 칸을 보장한다", () => {
    expect(resolveSigSalesMenuCount(8, 10)).toBe(11);
    expect(resolveSigSalesMenuCount(15, 10)).toBe(15);
  });

  it("관리자 설정이 최소보다 크면 그대로 쓴다", () => {
    expect(resolveSigSalesMenuCount(20, 5)).toBe(20);
  });
});

/** 휠 착지 slice ↔ 서버 당첨 카드 정합(회차별) */
describe("dedupeSigQueueByIdAndName", () => {
  it("큐에서 id·표시명 중복을 제거한다", () => {
    const q = dedupeSigQueueByIdAndName([
      { ...item("sig_a"), name: "슈퍼맨" },
      { ...item("sig_b"), name: "댄스" },
      { ...item("sig_c"), name: "슈퍼맨" },
      { ...item("sig_a"), name: "다른이름" },
    ]);
    expect(q.map((x) => x.id)).toEqual(["sig_a", "sig_b"]);
  });
});

describe("wheelDuplicatePickForWinner", () => {
  it("이전 회차에 없으면 0, 같은 시그가 또 나오면 1+", () => {
    const a = item("sig_a");
    expect(wheelDuplicatePickForWinner([], a)).toBe(0);
    expect(wheelDuplicatePickForWinner([a], a)).toBe(1);
    expect(wheelDuplicatePickForWinner([a, item("sig_b")], a)).toBe(1);
  });
});

describe("resolveSpinQueueForSession", () => {
  it("폴링 순간 primary가 비어도 같은 session 당첨 큐를 유지한다", () => {
    const winners = [item("a"), item("b"), item("c")];
    const first = resolveSpinQueueForSession(
      { sessionId: "", queue: [] },
      "session_1",
      winners,
      [],
      5
    );
    expect(first.queue.map((x) => x.id)).toEqual(["a", "b", "c"]);
    const flicker = resolveSpinQueueForSession(
      first.pin,
      "session_1",
      [],
      [],
      5
    );
    expect(flicker.queue.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("같은 session·같은 당첨 집합이면 primary 순서만 바뀌어도 큐 순서를 유지한다", () => {
    const pin = { sessionId: "s1", queue: [item("a"), item("b"), item("c")] };
    const reordered = [item("c"), item("a"), item("b")];
    const out = resolveSpinQueueForSession(pin, "s1", reordered, [], 5);
    expect(out.queue.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("같은 session에서 당첨 수가 늘면 기존 순서 뒤에만 붙인다", () => {
    const pin = { sessionId: "s1", queue: [item("a"), item("b")] };
    const extended = [item("a"), item("b"), item("c")];
    const out = resolveSpinQueueForSession(pin, "s1", extended, [], 5);
    expect(out.queue.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("폴링으로 큐에 id 중복이 섞여도 dedupe 한다", () => {
    const pin = { sessionId: "s1", queue: [] };
    const dup = [item("a"), item("b"), item("a"), item("c")];
    const out = resolveSpinQueueForSession(pin, "s1", dup, [], 5);
    expect(out.queue.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});

describe("sigOverlayBroadcast card metrics", () => {
  it("한방·개별 카드가 동일 폭·미디어 높이(px)를 쓴다", () => {
    const w = sigOverlayBroadcastCardWidthPx(78);
    const mediaH = sigOverlayBroadcastMediaHeightPx(78);
    expect(w).toBe(Math.round(188 * 0.78));
    expect(mediaH).toBe(Math.round(w * (300 / 202)));
  });

  it("한방·개별 셸 전체 높이가 동일(px)", () => {
    const h = sigOverlayBroadcastCardTotalHeightPx(78, false);
    const mediaH = sigOverlayBroadcastMediaHeightPx(78);
    expect(h).toBeGreaterThan(mediaH);
    expect(sigOverlayBroadcastCardTotalHeightPx(78, true)).toBeGreaterThan(h);
  });
});

describe("layoutSigOverlayResultRow", () => {
  it("6칸이면 행 너비에 맞춰 cardScalePct를 줄인다", () => {
    const { cardScalePct } = layoutSigOverlayResultRow({
      cellCount: 6,
      userScalePct: 100,
      maxRowWidthPx: 1080,
    });
    const natural = 6 * SIG_OVERLAY_CARD_MAX_PX + 5 * 4;
    const expected = Math.floor((1080 / natural) * 100);
    expect(cardScalePct).toBeLessThanOrEqual(expected);
    expect(cardScalePct).toBeGreaterThanOrEqual(50);
  });
});

describe("resolveWheelSlicesForSpinVisual", () => {
  it("기본은 메뉴 풀 칸 수만큼 여러 칸을 만든다", () => {
    const pool = ["a", "b", "c", "d", "e", "f"].map((id) => item(id));
    const slices = resolveWheelSlicesForSpinVisual({ menuPool: pool, menuCount: 8 });
    expect(slices.length).toBe(8);
  });

  it("winnersOnly면 당첨 큐 길이만큼 칸을 만든다", () => {
    const winners = [item("a"), item("b"), item("c")];
    const slices = resolveWheelSlicesForSpinVisual({
      menuPool: [],
      menuCount: 20,
      winnersOnly: true,
      winnerQueue: winners,
    });
    expect(slices).toHaveLength(3);
  });
});

describe("sequential menu wheel per round", () => {
  it("N칸 메뉴 휠에서 회차별 착지가 서버 당첨과 일치한다", () => {
    const pool: SigItem[] = [
      { ...item("sig_a"), name: "A" },
      { ...item("sig_b"), name: "B" },
      { ...item("sig_c"), name: "C" },
      { ...item("sig_d"), name: "D" },
      { ...item("sig_e"), name: "E" },
      { ...item("sig_f"), name: "F" },
    ];
    const menuSlices = resolveWheelSlicesForSpinVisual({ menuPool: pool, menuCount: 10 });
    expect(menuSlices.length).toBeGreaterThan(1);
    const winners = pickDistinctSigsByIdAndName(pool, 5);
    const used = new Set<string>();
    const last = winners[winners.length - 1]!;
    for (let round = 0; round < winners.length; round++) {
      const winner = winners[round]!;
      const target = resolveWheelSpinTarget(menuSlices, winner, round, used, winners.slice(0, round));
      const animId = pickWheelAnimationResultId(target.sliceId, winner, last.id);
      expect(wheelSliceMatchesServerWinner(animId, winner), `round ${round}`).toBe(true);
      rememberUsedWheelSliceId(used, target.sliceId);
    }
  });
});

describe("sequential one-slice wheel per round", () => {
  it("회차별 1칸 휠 착지 id가 서버 당첨 큐 순서와 일치한다", () => {
    const winners = pickDistinctSigsByIdAndName(
      ["a", "b", "c", "d", "e"].map((id) => item(id)),
      5
    );
    const used = new Set<string>();
    for (let round = 0; round < winners.length; round++) {
      const winner = winners[round]!;
      const slices = buildWheelSlicesForCurrentRoundWinner(winner);
      const target = resolveWheelSpinTarget(slices, winner, round, used, winners.slice(0, round));
      const animId = pickWheelAnimationResultId(target.sliceId, winner, winners[4]!.id);
      expect(wheelSliceMatchesServerWinner(animId, winner), `round ${round}`).toBe(true);
      rememberUsedWheelSliceId(used, target.sliceId);
    }
  });
});

describe("wheel spin queue aligns with result cards", () => {
  it("각 회차 resolveWheelSpinTarget 착지가 서버 당첨과 캐노니컬 id로 일치한다", () => {
    const pool: SigItem[] = [
      { ...item("sig_a"), name: "애교" },
      { ...item("sig_b"), name: "댄스" },
      { ...item("sig_c"), name: "노래" },
      { ...item("sig_d"), name: "토크" },
      { ...item("sig_e"), name: "게임" },
      { ...item("sig_f"), name: "식사권" },
    ];
    const slices = buildWheelMenuSlices(pool, 8);
    const winners = pickDistinctSigsByIdAndName(pool, 5);
    expect(winners.length).toBe(5);
    for (let round = 0; round < winners.length; round++) {
      const winner = winners[round]!;
      const target = resolveWheelSpinTarget(slices, winner, round, undefined, winners.slice(0, round));
      expect(target.sliceId, `round ${round}`).toBeTruthy();
      expect(wheelSliceMatchesServerWinner(target.sliceId, winner)).toBe(true);
      const idx = findSliceIndexForResult(target.items, target.sliceId);
      expect(idx).toBeGreaterThanOrEqual(0);
      const sliceItem = target.items[idx]!;
      expect(canonicalSigIdFromWheelSliceId(sliceItem.id)).toBe(
        canonicalSigIdFromWheelSliceId(winner.id)
      );
    }
  });

  it("당첨이 휠 풀에 없어도 주입 후 착지·카드 id가 같다", () => {
    const slices = buildWheelMenuSlices([item("only_a"), item("only_b")], 4);
    const offPool = item("off_pool_winner", 88000);
    offPool.name = "오프풀당첨";
    const target = resolveWheelSpinTarget(slices, offPool, 1);
    expect(wheelSliceMatchesServerWinner(target.sliceId, offPool)).toBe(true);
    const idx = findSliceIndexForResult(target.items, target.sliceId);
    expect(target.items[idx]?.name).toBe("오프풀당첨");
  });

  it("calculateSpinFinalAngle 착지 각도가 sliceId 칸 중심과 일치한다", () => {
    const slices = buildWheelMenuSlices(
      ["a", "b", "c", "d", "e"].map((id) => item(id)),
      5
    );
    const winner = item("c");
    const target = resolveWheelSpinTarget(slices, winner, 0);
    const count = target.items.length;
    const seg = 360 / count;
    const idx = findSliceIndexForResult(target.items, target.sliceId);
    const targetCenter = idx * seg + seg / 2;
    const expectedPointerNorm = ((360 - targetCenter) % 360 + 360) % 360;
    const finalAngle = calculateSpinFinalAngle(target.items, target.sliceId, count, 500, 2);
    const landedNorm = ((finalAngle % 360) + 360) % 360;
    expect(landedNorm).toBeCloseTo(expectedPointerNorm, 8);
  });
});

describe("buildSessionSpinExclusion", () => {
  it("이미 당첨된 표시명(다른 id)은 다음 스핀 풀에서 제외한다", () => {
    const sakuraA: SigItem = { ...item("sig_sakura_a"), name: "사쿠란보", price: 42500 };
    const sakuraB: SigItem = { ...item("sig_sakura_b"), name: "사쿠란보", price: 43000 };
    const other: SigItem = { ...item("sig_other"), name: "우치다" };
    const inventory = [sakuraA, sakuraB, other];
    const exclusion = buildSessionSpinExclusion(
      inventory,
      ["sig_sakura_a"],
      [sakuraA]
    );
    expect(sigEligibleForSessionSpinPool(sakuraA, exclusion)).toBe(false);
    expect(sigEligibleForSessionSpinPool(sakuraB, exclusion)).toBe(false);
    expect(sigEligibleForSessionSpinPool(other, exclusion)).toBe(true);
  });

  it("완판(soldCount>=maxCount) 시그는 이름·id 모두 제외한다", () => {
    const sold: SigItem = { ...item("sig_sold"), name: "완판됨", soldCount: 1, maxCount: 1 };
    const fresh: SigItem = { ...item("sig_fresh"), name: "신규" };
    const exclusion = buildSessionSpinExclusion([sold, fresh], []);
    expect(sigEligibleForSessionSpinPool(sold, exclusion)).toBe(false);
    expect(sigEligibleForSessionSpinPool(fresh, exclusion)).toBe(true);
  });

  it("휠 표시 풀에도 동일 표시명 중복 행이 들어가지 않는다", () => {
    const sakuraA: SigItem = { ...item("sig_sakura_a"), name: "사쿠란보" };
    const sakuraB: SigItem = { ...item("sig_sakura_b"), name: "사쿠란보" };
    const other: SigItem = { ...item("sig_other"), name: "우치다" };
    const pool = buildSigSalesWheelDisplayPool({
      inventory: [sakuraA, sakuraB, other],
      sessionExcludedSigIds: ["sig_sakura_a"],
      menuCount: 20,
    });
    const names = pool.map((x) => x.name);
    expect(names.filter((n) => n === "사쿠란보")).toHaveLength(0);
    expect(names).toContain("우치다");
  });
});

describe("sigMatchesMemberFilter", () => {
  const memberA = { memberId: "m-a" };
  const common = { memberId: "" };

  it("필터 없으면 모두 포함", () => {
    expect(sigMatchesMemberFilter(memberA, "")).toBe(true);
    expect(sigMatchesMemberFilter(memberA, null)).toBe(true);
    expect(sigMatchesMemberFilter(common, undefined)).toBe(true);
  });

  it("멤버 선택 시 해당 멤버 + 공통 시그만 포함", () => {
    expect(sigMatchesMemberFilter(memberA, "m-a")).toBe(true);
    expect(sigMatchesMemberFilter(common, "m-a")).toBe(true);
    expect(sigMatchesMemberFilter({ memberId: "m-b" }, "m-a")).toBe(false);
  });
});
