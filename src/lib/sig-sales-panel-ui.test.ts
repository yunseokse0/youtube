import { describe, expect, it } from "vitest";
import { formatSigSalesWon, sigSalesPanelStatusLabel } from "@/lib/sig-sales-panel-ui";

describe("sig sales panel ui", () => {
  it("formats won with mark", () => {
    expect(formatSigSalesWon(2875000)).toBe("₩ 2,875,000");
  });

  it("maps phase to status", () => {
    expect(sigSalesPanelStatusLabel("IDLE")).toBe("대기 중");
    expect(sigSalesPanelStatusLabel("LANDED")).toBe("진행 중");
    expect(sigSalesPanelStatusLabel("CONFIRMED")).toBe("판매 확정");
  });
});
