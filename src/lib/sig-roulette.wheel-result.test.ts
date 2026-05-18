import { describe, expect, it } from "vitest";
import type { SigItem } from "@/types";
import {
  buildWheelMenuSlices,
  calculateSpinFinalAngle,
  canonicalSigIdFromWheelSliceId,
  formatWheelSegmentLabel,
  findSliceIndexForResult,
  pickWheelSliceIdForWin,
  resolveWheelSpinTarget,
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

describe("formatWheelSegmentLabel", () => {
  it("칸이 많을수록 짧게 자른다", () => {
    expect(formatWheelSegmentLabel("귀여워서미안해", 20)).toBe("귀여워서…");
    expect(formatWheelSegmentLabel("APT", 8)).toBe("APT");
  });

  it("빈 문자열은 대시", () => {
    expect(formatWheelSegmentLabel("  ", 10)).toBe("—");
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

  it("매칭 실패 시 -1 (잘못된 0번 착지 방지)", () => {
    expect(findSliceIndexForResult(wheel, "unknown")).toBe(-1);
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
    const t1 = resolveWheelSpinTarget(slices, item("a"), 1);
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
