import { describe, expect, it } from "vitest";
import { hydrateManualOverlaySigItem } from "@/lib/manual-sig-broadcast";
import type { SigItem } from "@/types";

describe("hydrateManualOverlaySigItem", () => {
  const inventory: SigItem[] = [
    {
      id: "sig_a",
      name: "독주",
      price: 21000,
      imageUrl: "/uploads/sigs/finalent/1730000000_abc12345.gif",
      memberId: "m1",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    },
  ];

  it("prefers inventory upload path over coerced /images/sigs flat path", () => {
    const item: SigItem = {
      id: "manual_sig_1",
      name: "독주",
      price: 21000,
      imageUrl: "/images/sigs/1730000000_abc12345.gif",
      memberId: "",
      maxCount: 1,
      soldCount: 0,
      isRolling: true,
      isActive: true,
    };
    const out = hydrateManualOverlaySigItem(item, inventory, "finalent", {
      sourceSigId: "sig_a",
      imageUrl: "/images/sigs/1730000000_abc12345.gif",
    });
    expect(out.imageUrl).toBe("/uploads/sigs/finalent/1730000000_abc12345.gif");
    expect(out.memberId).toBe("");
  });
});
