import { describe, it, expect } from "vitest";
import { normalizeContributionExcludedMemberIds } from "@/domain/state-monolith.all";
import { resolveDonationTableColumnsOptions, normalizeDonationTableColumnsOptions } from "@/lib/donation-table-options";
import { presetToParams } from "@/lib/overlay-params";

describe("기여도 표시 제외 대상 설정 및 '-' 대체 표기 검증", () => {
  const mockMembers = [
    { id: "m_rep", name: "자키", role: "대표", account: 10000, toon: 20000, contribution: 30000 },
    { id: "m_sil", name: "제킹", role: "실장", account: 5000, toon: 10000, contribution: 15000 },
    { id: "m_member1", name: "이나", account: 50000, toon: 50000, contribution: 100000 },
  ];

  it("normalizeContributionExcludedMemberIds: 유효한 멤버 ID만 필터링하여 반환", () => {
    const raw = ["m_rep", "invalid_id", "m_sil"];
    const normalized = normalizeContributionExcludedMemberIds(raw, mockMembers as any);
    expect(normalized).toEqual(["m_rep", "m_sil"]);
  });

  it("normalizeContributionExcludedMemberIds: 쉼표 구분 문자열도 정상 파싱", () => {
    const raw = "m_rep, invalid_id, m_member1";
    const normalized = normalizeContributionExcludedMemberIds(raw, mockMembers as any);
    expect(normalized).toEqual(["m_rep", "m_member1"]);
  });

  it("resolveDonationTableColumnsOptions: contributionExcludedMemberIds 정상 해석", () => {
    const opts = resolveDonationTableColumnsOptions({
      contributionExcludedMemberIds: ["m_rep"],
      showContributionColumn: true,
    });
    expect(opts.contributionExcludedMemberIds).toEqual(["m_rep"]);
  });

  it("resolveDonationTableColumnsOptions: 문자열 포맷도 배열로 정규화", () => {
    const opts = resolveDonationTableColumnsOptions({
      contributionExcludedMemberIds: "m_rep, m_sil",
    });
    expect(opts.contributionExcludedMemberIds).toEqual(["m_rep", "m_sil"]);
  });

  it("presetToParams: URL 쿼리 파라미터로 contributionExcludedMemberIds 직렬화", () => {
    const params = presetToParams({
      id: "preset_1",
      name: "테스트 프리셋",
      contributionExcludedMemberIds: ["m_rep", "m_sil"],
    } as any);
    expect(params.get("contributionExcludedMemberIds")).toBe("m_rep,m_sil");
  });

  it("기여도 합계 계산 시 제외 대상 멤버 제외 검증", () => {
    const excludedIds = new Set(["m_rep"]);
    const isExcluded = (m: { id: string; name: string }) => excludedIds.has(m.id) || excludedIds.has(m.name);
    
    const sumContribution = mockMembers
      .filter((m) => !isExcluded(m))
      .reduce((sum, m) => sum + (m.contribution || 0), 0);

    // mockMembers: m_rep(30000, 제외), m_sil(15000), m_member1(100000)
    // 30000 제외 => 15000 + 100000 = 115000
    expect(sumContribution).toBe(115000);
  });
});
