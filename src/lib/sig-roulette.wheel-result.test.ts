import { describe, expect, it } from "vitest";
import type { SigItem } from "@/types";
import {
  calculateSpinFinalAngle,
  canonicalSigIdFromWheelSliceId,
  findSliceIndexForResult,
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

describe("canonicalSigIdFromWheelSliceId", () => {
  it("슬라이스 접미사를 제거해 재고 id와 맞춘다", () => {
    expect(canonicalSigIdFromWheelSliceId("sigA__wslot_3")).toBe("sigA");
    expect(canonicalSigIdFromWheelSliceId("  sigB__wslot_0  ")).toBe("sigB");
  });

  it("접미사가 없으면 그대로 둔다", () => {
    expect(canonicalSigIdFromWheelSliceId("plain")).toBe("plain");
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

  it("매칭 실패 시 0번으로 폴백", () => {
    expect(findSliceIndexForResult(wheel, "unknown")).toBe(0);
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
