import { describe, it, expect } from "vitest";
import type { AppState, Member } from "@/types";
import { defaultState } from "@/lib/state";
import {
  resolvePongdangShowContributionExcluded,
  presetToParams,
  type OverlayPresetLike,
} from "@/lib/overlay-params";
import { buildOverlaySyncSignature } from "@/lib/overlay-sync-signature";
import { pickOverlayState } from "@/lib/state-api-pick";

describe("기여도 제외 멤버 퐁당퐁당 전용 표시 검증", () => {
  const mockMembers: Member[] = [
    { id: "m_rep", name: "자키", role: "대표", account: 100000, toon: 50000, contribution: 200000 },
    { id: "m_jina", name: "진아", role: "멤버", account: 80000, toon: 40000, contribution: 150000 },
    { id: "m_surin", name: "수린", role: "멤버", account: 60000, toon: 30000, contribution: 100000 },
  ];

  it("1. 일반 엑셀표(비-퐁당퐁당)에서는 resolvePongdangShowContributionExcluded 가 항상 false", () => {
    const rawSp = new URLSearchParams("theme=excelGold");
    const preset: OverlayPresetLike = { theme: "excelGold", membersTheme: "excelGold" };
    const res = resolvePongdangShowContributionExcluded(rawSp, preset, { ready: true });
    expect(res).toBe(false);
  });

  it("2. 퐁당퐁당 엑셀표(excelPongdang/day777)에서는 기본적으로 true (기여도 표시)", () => {
    const rawSp = new URLSearchParams("theme=excelPongdang");
    const preset: OverlayPresetLike = { theme: "excelPongdang", membersTheme: "excelPongdang" };
    const res = resolvePongdangShowContributionExcluded(rawSp, preset, { ready: true });
    expect(res).toBe(true);
  });

  it("3. 퐁당퐁당 엑셀표라도 URL 또는 프리셋에서 명시적으로 false 설정 시 false", () => {
    // URL 에서 false 지정
    const rawSpFalse = new URLSearchParams("theme=excelPongdang&pongdangShowContributionExcluded=false");
    const presetPd: OverlayPresetLike = { theme: "excelPongdang" };
    expect(resolvePongdangShowContributionExcluded(rawSpFalse, presetPd, { ready: true })).toBe(false);

    // 프리셋에서 false 지정
    const rawSpEmpty = new URLSearchParams("theme=excelPongdang");
    const presetFalse: OverlayPresetLike = { theme: "excelPongdang", pongdangShowContributionExcluded: false };
    expect(resolvePongdangShowContributionExcluded(rawSpEmpty, presetFalse, { ready: true })).toBe(false);

    // 전역 상태에서 false 지정
    const stateFalse = { pongdangShowContributionExcluded: false };
    expect(resolvePongdangShowContributionExcluded(rawSpEmpty, presetPd, { ready: true }, stateFalse)).toBe(false);
  });

  it("4. 퐁당퐁당 vs 일반 엑셀표 기여도 제외 멤버 표출 분기 검증", () => {
    const excludedSet = new Set(["m_rep"]);
    const checkExcluded = (
      m: Member,
      isPongdang: boolean,
      showInPongdang: boolean
    ) => {
      if (!m) return false;
      if (isPongdang && showInPongdang) return false;
      return excludedSet.has(m.id) || excludedSet.has(m.name);
    };

    // 일반 엑셀표: 대표(m_rep)는 기여도 제외 대상이므로 checkExcluded === true ('-' 표기 대상)
    expect(checkExcluded(mockMembers[0], false, false)).toBe(true);
    // 일반 엑셀표: 일반 멤버는 제외되지 않음
    expect(checkExcluded(mockMembers[1], false, false)).toBe(false);

    // 퐁당퐁당 엑셀표: 대표(m_rep)라도 퐁당퐁당에서는 정상 표시 (checkExcluded === false)
    expect(checkExcluded(mockMembers[0], true, true)).toBe(false);
    expect(checkExcluded(mockMembers[1], true, true)).toBe(false);

    // 퐁당퐁당 엑셀표에서 옵션을 끈 경우: 다시 제외됨
    expect(checkExcluded(mockMembers[0], true, false)).toBe(true);
  });

  it("5. 기여도 합계(sumContribution) 계산 시 일반표는 대표 제외, 퐁당퐁당은 대표 포함 검증", () => {
    const excludedSet = new Set(["m_rep"]);
    const isExcluded = (m: Member, isPongdang: boolean, showInPongdang: boolean) => {
      if (isPongdang && showInPongdang) return false;
      return excludedSet.has(m.id);
    };

    // 일반 엑셀표 sumContribution: m_rep(200000 제외) => 150000 + 100000 = 250000
    const sumNormal = mockMembers
      .filter((m) => !isExcluded(m, false, false))
      .reduce((sum, m) => sum + (m.contribution || 0), 0);
    expect(sumNormal).toBe(250000);

    // 퐁당퐁당 엑셀표 sumContribution: m_rep(200000 포함) => 200000 + 150000 + 100000 = 450000
    const sumPongdang = mockMembers
      .filter((m) => !isExcluded(m, true, true))
      .reduce((sum, m) => sum + (m.contribution || 0), 0);
    expect(sumPongdang).toBe(450000);
  });

  it("6. presetToParams 직렬화 검증", () => {
    const presetTrue: OverlayPresetLike = {
      id: "p1",
      name: "퐁당 프리셋",
      theme: "excelPongdang",
      pongdangShowContributionExcluded: true,
    };
    const paramsTrue = presetToParams(presetTrue);
    expect(paramsTrue.get("pongdangShowContributionExcluded")).toBe("true");

    const presetFalse: OverlayPresetLike = {
      id: "p2",
      name: "퐁당 프리셋 2",
      theme: "excelPongdang",
      pongdangShowContributionExcluded: false,
    };
    const paramsFalse = presetToParams(presetFalse);
    expect(paramsFalse.get("pongdangShowContributionExcluded")).toBe("false");
  });

  it("7. pickOverlayState 및 buildOverlaySyncSignature 연동 검증", () => {
    const base: AppState = {
      ...defaultState(),
      members: mockMembers,
      contributionExcludedMemberIds: ["m_rep"],
      pongdangShowContributionExcluded: true,
    };

    const picked = pickOverlayState(base);
    expect((picked as any).pongdangShowContributionExcluded).toBe(true);

    const sigTrue = buildOverlaySyncSignature(base);
    const sigFalse = buildOverlaySyncSignature({
      ...base,
      pongdangShowContributionExcluded: false,
    });
    expect(sigTrue).not.toEqual(sigFalse);
  });
});
