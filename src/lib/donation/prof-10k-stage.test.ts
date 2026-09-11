import { describe, expect, it } from "vitest";
import { dedupeDonorRows } from "@/domain/dedupe/donation-dedupe.pipeline";

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
        provider: "bank",
        name: NAMES[i % NAMES.length]!,
        donorName: NAMES[i % NAMES.length]!,
        amount: amt,
        at: atBase + i * 3,
        target: "account",
        message: "계좌이체 " + i,
        memberId: "m_TEST",
      });
    } else {
      const ext = `bench-${i}-${rnd()}`;
      const poll = i % 5 === 0;
      arr.push({
        id: poll ? `toonation:din:${ext}` : `toonation:${ext}`,
        externalId: ext,
        provider: "toonation",
        name: NAMES[i % NAMES.length]!,
        donorName: NAMES[i % NAMES.length]!,
        amount: amt,
        at: atBase + i * 3,
        target: "toon",
        message: "후원 " + i,
        memberId: "m_TEST",
      });
    }
  }
  return arr;
}

describe("⚙️ 구간별 프로파일링 10K donors", () => {
  it("manual profiler", () => {
    const d = makeDonors(10_000, 0.2);
    // 구간별 복제 & 시간측정 위해 기존 dedupeDonorRows 함수의 세부 로직을 수동으로 풀어서 측정은 너무 길어짐
    // → 간단히 100건 / 1000건 / 5000건 / 10000건 간의 누적 시간 증가율로 어느 구간이 O(n²) 인지 판단
    const sz = [100, 500, 1000, 2000, 5000, 10000];
    console.log("\n  📊 Size vs Time table:");
    const results: number[] = [];
    for (const n of sz) {
      const dn = makeDonors(n, 0.2);
      const t0 = performance.now();
      const out = dedupeDonorRows(dn);
      const t = performance.now() - t0;
      results.push(t);
      console.log(`    N=${n.toString().padStart(6, " ")} → ${t.toFixed(0).toString().padStart(6, " ")}ms (기대선형~${(results[0]! * n / sz[0]!).toFixed(0)}ms · ratio²/N=${(t/(n*n/1e6)).toFixed(2)})`);
      const gross = out.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
      const exp = dn.reduce((s, x) => s + Math.round(Number(x.amount || 0)), 0);
      expect(gross).toBe(exp);
    }
    console.log("\n  👉 만약 ratio²/N 이 일정하면 O(n²), ratio 선형 증가하면 O(n log n), 일정하면 O(n)");
    expect(true).toBe(true);
  }, 180_000);
});
