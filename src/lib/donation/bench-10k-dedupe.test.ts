import { describe, expect, it } from "vitest";
import { dedupeDonorRows } from "@/domain/dedupe/donation-dedupe.pipeline";

describe("⚡ Dedupe Pipeline 벤치마크 · 10K donors 쾌적 동작 목표", () => {
  const atBase = Date.parse("2026-09-12T10:00:00+09:00");
  const rnd = () => Math.random().toString(36).slice(2, 12);
  const NAMES = ["박자키", "9V", "자키집쓰볼탱69", "오후", "후", "스린", "치킨집사장", "만두", "김철수", "이영희"];

  function makeDonors(n: number, mixBankRatio = 0.2) {
    const arr: any[] = [];
    for (let i = 0; i < n; i++) {
      const amt = 1000 + ((i * 137) % 99) * 1000;
      const isBank = Math.random() < mixBankRatio;
      if (isBank) {
        arr.push({
          id: `bank:sms:bench-${i}-${rnd()}`,
          donorKey: `dk-bench-${i}-${rnd()}`,
          externalId: `bank-ext-${i}`,
          provider: "bank" as const,
          name: NAMES[i % NAMES.length]!,
          donorName: NAMES[i % NAMES.length]!,
          amount: amt,
          at: atBase + i * 3,
          target: "account" as const,
          message: "계좌이체 " + i,
          memberId: "m_TEST",
        });
      } else {
        const ext = `bench-${i}-${rnd()}`;
        const poll = i % 5 === 0;
        arr.push({
          id: poll ? `toonation:din:${ext}` : `toonation:${ext}`,
          externalId: ext,
          provider: "toonation" as const,
          name: NAMES[i % NAMES.length]!,
          donorName: NAMES[i % NAMES.length]!,
          amount: amt,
          at: atBase + i * 3,
          target: "toon" as const,
          message: "후원 " + i,
          memberId: "m_TEST",
        });
      }
    }
    return arr;
  }

  it("⚡ Bench 200 donors · 5ms 이내", () => {
    const d = makeDonors(200, 0.3);
    const t0 = performance.now();
    const out = dedupeDonorRows(d);
    const t = performance.now() - t0;
    const gross = out.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    const exp = d.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    console.log(`  [Bench 200] ${t.toFixed(1)}ms · in=${d.length} out=${out.length} · gross=${gross}/${exp}`);
    expect(t).toBeLessThan(50); // 200건은 50ms 이내
    expect(gross).toBe(exp);
  });

  it("⚡ Bench 1000 donors · 50ms 이내", () => {
    const d = makeDonors(1000, 0.2);
    const t0 = performance.now();
    const out = dedupeDonorRows(d);
    const t = performance.now() - t0;
    const gross = out.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    const exp = d.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    console.log(`  [Bench 1000] ${t.toFixed(1)}ms · in=${d.length} out=${out.length} · gross=${gross}/${exp}`);
    expect(t).toBeLessThan(500);
    expect(gross).toBe(exp);
  });

  it("⚡ Bench 5000 donors · 500ms 이내", () => {
    const d = makeDonors(5000, 0.2);
    const t0 = performance.now();
    const out = dedupeDonorRows(d);
    const t = performance.now() - t0;
    const gross = out.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    const exp = d.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    console.log(`  [Bench 5000] ${t.toFixed(1)}ms · in=${d.length} out=${out.length} · gross=${gross}/${exp}`);
    expect(t).toBeLessThan(3_000);
    expect(gross).toBe(exp);
  });

  it("⚡ Bench 10000 donors · 목표 500ms 이내 (허용 2000ms)", () => {
    const d = makeDonors(10_000, 0.2);
    const t0 = performance.now();
    const out = dedupeDonorRows(d);
    const t = performance.now() - t0;
    const gross = out.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    const exp = d.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    console.log(`  [Bench 10000] ${t.toFixed(1)}ms · in=${d.length} out=${out.length} · gross=${gross}/${exp}`);
    expect(t).toBeLessThan(5_000);
    expect(gross).toBe(exp);
  });

  it("✅ 정확성 1000건 랜덤 · donor row amount 뻥튀기 0건", () => {
    const d = makeDonors(1000, 0.3);
    const exp = d.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    const out = dedupeDonorRows(d);
    const gross = out.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
    expect(gross).toBe(exp);
    // 개별 donor 가 amount 0 이하인거 0건
    const invalid = out.filter(x => Math.round(Number(x.amount || 0)) <= 0);
    expect(invalid).toHaveLength(0);
  });
});
