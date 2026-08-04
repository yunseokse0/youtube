import { describe, expect, it } from "vitest";
import { matchSigInventoryItemByFileName, planSigBulkReupload } from "./sig-image-bulk";
import type { SigItem } from "@/types";

const item = (p: Partial<SigItem>): SigItem => ({
  id: p.id || "sig_1",
  name: p.name || "버터플라이",
  price: p.price ?? 0,
  imageUrl: p.imageUrl || "",
  memberId: p.memberId || "",
  maxCount: p.maxCount ?? 1,
  soldCount: p.soldCount ?? 0,
  isRolling: p.isRolling ?? true,
  isActive: p.isActive ?? true,
});

describe("matchSigInventoryItemByFileName", () => {
  it("matches amount_name filenames to inventory name", () => {
    const inv = [item({ id: "a", name: "버터플라이", price: 50000 })];
    expect(matchSigInventoryItemByFileName(inv, "1,000,000_버터플라이.gif")?.id).toBe("a");
    expect(matchSigInventoryItemByFileName(inv, "1000000_버터플라이.png")?.id).toBe("a");
  });

  it("still matches plain name filenames", () => {
    const inv = [item({ id: "b", name: "04클럽춤" })];
    expect(matchSigInventoryItemByFileName(inv, "04클럽춤.gif")?.id).toBe("b");
  });
});

describe("planSigBulkReupload", () => {
  it("plans reupload for priced filename matches", () => {
    const inv = [item({ id: "a", name: "버터플라이" })];
    const file = { name: "1,000,000_버터플라이.gif" } as File;
    const plans = planSigBulkReupload([file], inv);
    expect(plans).toHaveLength(1);
    expect(plans[0]?.item.id).toBe("a");
  });
});
