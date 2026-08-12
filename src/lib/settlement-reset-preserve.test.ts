import { describe, expect, it } from "vitest";
import { pickSettingsPreservedAcrossSettlementReset } from "./settlement-reset-preserve";
import type { AppState } from "@/types";

describe("pickSettingsPreservedAcrossSettlementReset", () => {
  it("keeps donor rankings title and drops donation fields from the pick", () => {
    const state = {
      donors: [{ id: "d1", name: "A", amount: 1000, memberId: "m1", at: 1 }],
      donorRankingsTheme: {
        top: 20,
        titleText: "커스텀 순위 제목",
        titleSize: 40,
        rowSize: 28,
        rankSize: 30,
        overlayOpacity: 88,
        bg: "transparent",
        panelBg: "rgba(0,0,0,0.5)",
        borderColor: "transparent",
        headerAccountBg: "#111",
        headerToonBg: "#111",
        rowEvenBg: "transparent",
        rowOddBg: "transparent",
        rankColor: "#fff",
        nameColor: "#ff0",
        amountColor: "#ff0",
        titleColor: "#fff",
        outlineColor: "#000",
        outlineWidth: 1,
        zoomPct: 100,
      },
      highSocietySettings: {
        enabled: true,
        seatMemberIds: ["a", "b"],
        defaultMiddlePush: "left",
        fieldCm: 1600,
      },
      missions: [{ id: "1", title: "m", price: "0" }],
    } as unknown as AppState;

    const preserved = pickSettingsPreservedAcrossSettlementReset(state);
    expect(preserved.donorRankingsTheme?.titleText).toBe("커스텀 순위 제목");
    expect(preserved.highSocietySettings?.fieldCm).toBe(1600);
    expect(preserved.missions).toHaveLength(1);
    expect("donors" in preserved).toBe(false);
    expect("members" in preserved).toBe(false);
  });
});
