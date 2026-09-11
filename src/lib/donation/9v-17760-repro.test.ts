/**
 * 9V 17,760원 뻥튀기 Bug 재현 · Fix 검증 TC
 * 실행: npx vitest run src/lib/donation/9v-17760-repro.test.ts
 */
import { describe, expect, it } from "vitest";
import { dedupeDonorRows } from "@/domain/dedupe/donation-dedupe.pipeline";

describe("9V 17,760원 뻥튀기 Bug 재현 · Fix 검증", () => {
  const MID = "m_1788514906147_ksf2p";
  const MSG = "시그니처 럼블 - 슈숙 소리내면서 해줘";
  const baseAt = Date.parse("2026-09-11T17:34:00+09:00");
  const donors = [
    { id: "toonation:din:1726043646-8880-A", externalId: "1726043646-8880-A", provider: "toonation", name: "9V", donorName: "9V", amount: 8_880, at: baseAt + 6_000, target: "toon", memberId: MID, message: MSG },
    { id: "toonation:din:1726043649-8880-B", externalId: "1726043649-8880-B", provider: "toonation", name: "9V", donorName: "9V", amount: 8_880, at: baseAt + 9_000, target: "toon", memberId: MID, message: MSG },
    { id: "toonation:din:1726043652-8880-C", externalId: "1726043652-8880-C", provider: "toonation", name: "9V", donorName: "9V", amount: 8_880, at: baseAt + 12_000, target: "toon", memberId: MID, message: MSG },
    { id: "toonation:din:1726043655-8880-D", externalId: "1726043655-8880-D", provider: "toonation", name: "9V", donorName: "9V", amount: 8_880, at: baseAt + 15_000, target: "toon", memberId: MID, message: MSG },
  ];

  it("TC1 donors 수 4건 유지 (병합 0건)", () => {
    const out = dedupeDonorRows(donors);
    expect(out).toHaveLength(4);
  });

  it("TC2 개별 donor 금액 전부 8,880원 (17,760 등 뻥튀기 0건)", () => {
    const out = dedupeDonorRows(donors);
    const amounts = out.map(d => Math.round(Number(d.amount || 0)));
    for (const a of amounts) expect(a).toBe(8_880);
  });

  it("TC3 총액 35,520원 (8,880 × 4)", () => {
    const out = dedupeDonorRows(donors);
    const gross = out.reduce((s, d) => s + Math.round(Number(d.amount || 0)), 0);
    expect(gross).toBe(35_520);
  });

  it("TC4 중복 ID 0건 (4개 id 전부 unique)", () => {
    const out = dedupeDonorRows(donors);
    const ids = new Set(out.map(d => String(d.id || "").trim()).filter(Boolean));
    expect(ids.size).toBe(4);
  });
});
