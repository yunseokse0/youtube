import { describe, it, expect } from "vitest";
import type { AppState, Member, Donor, ContributionLog } from "@/types";
import { defaultState } from "@/lib/state";
import {
  collectDay777SigContributionByMember,
  membersWithOverlayDonationAggregate,
} from "@/lib/overlay-donation-aggregate";
import { collectPongdangPopupAutoContributionByMember } from "@/lib/pongdang-popup-contribution";
import { resolvePongdangIncludeZubzub } from "@/lib/overlay-params";
import { buildOverlaySyncSignature } from "@/lib/overlay-sync-signature";

describe("퐁당퐁당 엑셀표 줍줍 적용 여부 (pongdangIncludeZubzub) 옵션 검증", () => {
  const members: Member[] = [
    { id: "m1", name: "서유하", account: 0, toon: 0, contribution: 0 },
    { id: "m2", name: "진아", account: 0, toon: 0, contribution: 0 },
  ];

  const zubzubBonusDonor: Donor = {
    id: "zubzub_bonus_q1",
    zubzubQueueId: "q1",
    memberId: "m1",
    donorName: "대표 시그 줍줍",
    name: "대표 시그 줍줍",
    amount: 130000,
    sigPrice: 130000,
    contributionPoints: 130000,
    target: "account",
    isZubzubBonus: true,
    at: 2000,
  };

  const zubzubBonusLog: ContributionLog = {
    id: "log_zubzub_1",
    zubzubQueueId: "q1",
    memberId: "m1",
    donorName: "대표 시그 줍줍",
    amount: 130000,
    delta: 1,
    at: 2000,
    isZubzubBonus: true,
  };

  it("1. pongdangIncludeZubzub: false (비활성) 시 퐁당퐁당 기여도에 줍줍이 절대 합산되지 않는다 (0점)", () => {
    const base: AppState = {
      ...defaultState(),
      members,
      donors: [zubzubBonusDonor],
      contributionLogs: [zubzubBonusLog],
      pongdangIncludeZubzub: false,
      zubzubSettings: {
        enabled: true,
        minSigPrice: 50000,
        applyContributionToPongdang: false,
      },
    };

    const sigById = collectDay777SigContributionByMember(base, null, {
      pongdangIncludeZubzub: false,
    });
    expect(sigById.get("m1") || 0).toBe(0);

    const popupById = collectPongdangPopupAutoContributionByMember(base, {
      pongdangIncludeZubzub: false,
    });
    expect(popupById.get("m1") || 0).toBe(0);

    const overlayMembers = membersWithOverlayDonationAggregate(base, members, null, {
      day777Calc: true,
      pongdangIncludeZubzub: false,
      isPongdangPopup: true,
    });
    const m1 = overlayMembers.find((m) => m.id === "m1");
    expect(m1?.contribution).toBe(0);
  });

  it("2. pongdangIncludeZubzub: true (활성화) 시 퐁당퐁당 기여도에 줍줍이 정상 합산된다 (130,000점)", () => {
    const base: AppState = {
      ...defaultState(),
      members,
      donors: [zubzubBonusDonor],
      contributionLogs: [zubzubBonusLog],
      pongdangIncludeZubzub: true,
      zubzubSettings: {
        enabled: true,
        minSigPrice: 50000,
        applyContributionToPongdang: true,
      },
    };

    const sigById = collectDay777SigContributionByMember(base, null, {
      pongdangIncludeZubzub: true,
    });
    expect(sigById.get("m1")).toBe(130000);

    const popupById = collectPongdangPopupAutoContributionByMember(base, {
      pongdangIncludeZubzub: true,
    });
    expect(popupById.get("m1")).toBe(130000);

    const overlayMembers = membersWithOverlayDonationAggregate(base, members, null, {
      day777Calc: true,
      pongdangIncludeZubzub: true,
      isPongdangPopup: true,
    });
    const m1 = overlayMembers.find((m) => m.id === "m1");
    expect(m1?.contribution).toBe(130000);
  });

  it("3. resolvePongdangIncludeZubzub 파라미터 및 프리셋 우선순위 정상 해석", () => {
    const opts = { ready: true };

    // 퐁당 테마가 아닐 때는 항상 false
    const nonPdPreset = { theme: "default", day777Calc: false, pongdangIncludeZubzub: true };
    expect(resolvePongdangIncludeZubzub(new URLSearchParams(), nonPdPreset as any, opts)).toBe(false);

    // 퐁당 테마에서 URL 파라미터 우선
    const pdPreset = { theme: "excelPongdang", day777Calc: true, pongdangIncludeZubzub: false };
    const spTrue = new URLSearchParams("theme=excelPongdang&pongdangIncludeZubzub=true");
    expect(resolvePongdangIncludeZubzub(spTrue, pdPreset as any, opts)).toBe(true);

    const spFalse = new URLSearchParams("theme=excelPongdang&pongdangIncludeZubzub=false");
    const pdPresetTrue = { theme: "excelPongdang", day777Calc: true, pongdangIncludeZubzub: true };
    expect(resolvePongdangIncludeZubzub(spFalse, pdPresetTrue as any, opts)).toBe(false);

    // 프리셋 설정 해석
    expect(resolvePongdangIncludeZubzub(new URLSearchParams("theme=excelPongdang"), pdPresetTrue as any, opts)).toBe(true);
    expect(resolvePongdangIncludeZubzub(new URLSearchParams("theme=excelPongdang"), pdPreset as any, opts)).toBe(false);

    // 전역 상태 fallback 해석
    const emptyPreset = { theme: "excelPongdang" };
    expect(
      resolvePongdangIncludeZubzub(new URLSearchParams("theme=excelPongdang"), emptyPreset as any, opts, {
        pongdangIncludeZubzub: true,
      })
    ).toBe(true);
    expect(
      resolvePongdangIncludeZubzub(new URLSearchParams("theme=excelPongdang"), emptyPreset as any, opts, {
        pongdangIncludeZubzub: false,
      })
    ).toBe(false);
  });

  it("4. buildOverlaySyncSignature 에 pongdangIncludeZubzub 이 직렬화되어 토글 시 즉시 서명이 변경된다", () => {
    const stateOff: AppState = {
      ...defaultState(),
      pongdangIncludeZubzub: false,
    };
    const stateOn: AppState = {
      ...defaultState(),
      pongdangIncludeZubzub: true,
    };

    const sigOff = buildOverlaySyncSignature(stateOff);
    const sigOn = buildOverlaySyncSignature(stateOn);
    expect(sigOff).not.toBe(sigOn);
  });
});
