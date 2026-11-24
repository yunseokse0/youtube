import { describe, it, expect } from "vitest";
import {
  buildMemberRankSnapshot,
  buildRankChangeSessionSnapshot,
  detectRankImprovementForFx,
} from "@/lib/excel-member-rank-change";
import type { OverlayRankRow } from "@/lib/excel-member-rank-change";
import type { Member } from "@/types";
import { appendExcelMemberRankChangeStyleParams } from "@/lib/excel-member-rank-change-style";

describe("Multi-preset rank change and identical theme application", () => {
  it("allows identical theme styles to be shared across multiple presets", () => {
    const sharedTheme = {
      memberRankChangeFx: "on",
      memberRankChangeNameSize: "32",
      memberRankChangeRankSize: "88",
      memberRankChangeIconSize: "34",
      memberRankChangeNameColor: "#ffffff",
      memberRankChangeRankColor: "#ffd700",
      memberRankChangeAccentColor: "#ffd700",
      memberRankChangeCardBg: "rgba(20, 32, 44, 0.95)",
      memberRankChangeCardBorder: "rgba(77, 166, 255, 0.3)",
      memberRankChangeConfettiColors: "#ffd700,#ffffff,#4da6ff,#00e676",
    };

    const presetMain = { id: "p_main", name: "자키엑셀표", ...sharedTheme };
    const presetPongdang = { id: "p_pongdang", name: "퐁당퐁당 엑셀 식사", ...sharedTheme };

    // Both presets serialize identical URL query parameters
    const qMain = new URLSearchParams();
    appendExcelMemberRankChangeStyleParams(qMain, presetMain);

    const qPongdang = new URLSearchParams();
    appendExcelMemberRankChangeStyleParams(qPongdang, presetPongdang);

    expect(qMain.toString()).toBe(qPongdang.toString());
    expect(qMain.get("memberRankChangeCardBg")).toBe("rgba(20, 32, 44, 0.95)");
    expect(qPongdang.get("memberRankChangeCardBg")).toBe("rgba(20, 32, 44, 0.95)");
  });

  it("detects rank changes across multiple presets independently", () => {
    const m1: Member = { id: "m1", name: "서유하", account: 0, toon: 0, contribution: 10000 };
    const m2: Member = { id: "m2", name: "진아", account: 0, toon: 0, contribution: 20000 };

    // Target 1: Main Excel Table
    const targetMainPrevRanked: OverlayRankRow[] = [
      { rank: 1, m: m2, rankDisplay: "1위", displayAmount: 20000 },
      { rank: 2, m: m1, rankDisplay: "2위", displayAmount: 10000 },
    ];
    const targetMainPrevSnap = buildMemberRankSnapshot(targetMainPrevRanked);
    const targetMainPrevSession = buildRankChangeSessionSnapshot([m1, m2], [], "contribution");

    // Target 2: Pongdang Excel Table
    const targetPongPrevRanked: OverlayRankRow[] = [
      { rank: 1, m: m1, rankDisplay: "1위", displayAmount: 50000 },
      { rank: 2, m: m2, rankDisplay: "2위", displayAmount: 30000 },
    ];
    const targetPongPrevSnap = buildMemberRankSnapshot(targetPongPrevRanked);
    const targetPongPrevSession = buildRankChangeSessionSnapshot([m1, m2], [], "contribution");

    // Scenario A: m1 rises to rank 1 in Target 1 (Main Excel)
    const m1MainUpdated: Member = { id: "m1", name: "서유하", account: 0, toon: 0, contribution: 30000 };
    const targetMainNextRanked: OverlayRankRow[] = [
      { rank: 1, m: m1MainUpdated, rankDisplay: "1위", displayAmount: 30000 },
      { rank: 2, m: m2, rankDisplay: "2위", displayAmount: 20000 },
    ];
    const targetMainNextSnap = buildMemberRankSnapshot(targetMainNextRanked);
    const targetMainNextSession = buildRankChangeSessionSnapshot([m1MainUpdated, m2], [], "contribution");

    const membersMainMap = new Map([
      ["m1", m1MainUpdated],
      ["m2", m2],
    ]);

    const hitMain = detectRankImprovementForFx(
      targetMainPrevSnap,
      targetMainNextSnap,
      membersMainMap,
      targetMainPrevSession,
      targetMainNextSession
    );

    expect(hitMain).not.toBeNull();
    expect(hitMain?.memberId).toBe("m1");
    expect(hitMain?.oldRank).toBe(2);
    expect(hitMain?.newRank).toBe(1);

    // Scenario B: In Target 2 (Pongdang), m2 receives a donation and overtakes m1
    const m2PongUpdated: Member = { id: "m2", name: "진아", account: 0, toon: 0, contribution: 70000 };
    const targetPongNextRanked: OverlayRankRow[] = [
      { rank: 1, m: m2PongUpdated, rankDisplay: "1위", displayAmount: 70000 },
      { rank: 2, m: m1, rankDisplay: "2위", displayAmount: 50000 },
    ];
    const targetPongNextSnap = buildMemberRankSnapshot(targetPongNextRanked);
    const targetPongNextSession = buildRankChangeSessionSnapshot([m1, m2PongUpdated], [], "contribution");

    const membersPongMap = new Map([
      ["m1", m1],
      ["m2", m2PongUpdated],
    ]);

    const hitPongdang = detectRankImprovementForFx(
      targetPongPrevSnap,
      targetPongNextSnap,
      membersPongMap,
      targetPongPrevSession,
      targetPongNextSession
    );

    expect(hitPongdang).not.toBeNull();
    expect(hitPongdang?.memberId).toBe("m2");
    expect(hitPongdang?.oldRank).toBe(2);
    expect(hitPongdang?.newRank).toBe(1);
  });
});
