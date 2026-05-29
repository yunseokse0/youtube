import { describe, expect, it } from "vitest";
import type { SigItem } from "@/types";
import { slimSigInventoryForWire } from "./state-wire-slim";

describe("slimSigInventoryForWire", () => {
  it("github-only 모드에서도 /uploads/sigs 경로는 그대로 유지한다", () => {
    const prev = process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
    process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = "true";
    try {
      const row: SigItem = {
        id: "sig_a",
        name: "테스트",
        price: 1000,
        imageUrl: "/uploads/sigs/finalent/1730000000_abcd1234.gif",
        memberId: "",
        maxCount: 1,
        soldCount: 0,
        isRolling: true,
        isActive: true,
      };
      const [out] = slimSigInventoryForWire([row], "finalent");
      expect(out.imageUrl).toBe("/uploads/sigs/finalent/1730000000_abcd1234.gif");
    } finally {
      if (prev === undefined) delete process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY;
      else process.env.NEXT_PUBLIC_SIG_IMAGES_GITHUB_ONLY = prev;
    }
  });

  it("저장 시 /uploads/images/ 경로를 /uploads/sigs/<uid>/ 로 정규화한다", () => {
    const row: SigItem = {
      id: "sig_x",
      name: "테스트",
      price: 1000,
      imageUrl: "/uploads/images/legacy.gif",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    };
    const [out] = slimSigInventoryForWire([row], "finalent");
    expect(out.imageUrl).toBe("/uploads/sigs/finalent/legacy.gif");
  });
});
