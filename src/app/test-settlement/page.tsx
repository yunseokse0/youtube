"use client";

import { computeSettlement } from "@/lib/settlement";
import type { Member } from "@/lib/state";

export default function TestSettlementPage() {
  const members: Member[] = [
    { id: "m1", name: "멤버1", account: 100000, toon: 50000, operating: false },
    { id: "m2", name: "멤버2", account: 80000, toon: 40000, operating: false },
    { id: "m3", name: "멤버3", account: 60000, toon: 30000, operating: false },
    { id: "m4", name: "운영비", account: 20000, toon: 10000, operating: true },
  ];

  const overrides = {
    m1: { accountRatio: 0.7, toonRatio: 0.6 },
    m2: { accountRatio: 0.8, toonRatio: 0.5 },
    m3: { accountRatio: 0.6, toonRatio: 0.7 },
  };

  const result = computeSettlement(members, 0.7, 0.6, 0.033, overrides);

  const sumNet = result.members.reduce((s, m) => s + m.net, 0);
  const sumOk = sumNet === result.totalNet;

  return (
    <main className="min-h-screen p-8 bg-neutral-950 text-neutral-100">
      <h1 className="text-2xl font-bold mb-6">멤버별 정산 비율 테스트</h1>
      <p className="text-neutral-400 mb-6">
        사람마다 정산 비율이 다를 때 정상 작동 여부 확인
      </p>

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-800/80">
              <th className="p-3 text-left">멤버</th>
              <th className="p-3 text-right">계좌</th>
              <th className="p-3 text-right">투네</th>
              <th className="p-3 text-right">계좌비율</th>
              <th className="p-3 text-right">투네비율</th>
              <th className="p-3 text-right">적용계좌</th>
              <th className="p-3 text-right">적용투네</th>
              <th className="p-3 text-right">매출</th>
              <th className="p-3 text-right">세금</th>
              <th className="p-3 text-right">정산</th>
            </tr>
          </thead>
          <tbody>
            {result.members.map((m) => (
              <tr key={m.memberId} className="border-t border-white/5">
                <td className="p-3">{m.name}</td>
                <td className="p-3 text-right">{m.account.toLocaleString()}</td>
                <td className="p-3 text-right">{m.toon.toLocaleString()}</td>
                <td className="p-3 text-right">
                  {(m.accountRatio * 100).toFixed(0)}%
                </td>
                <td className="p-3 text-right">
                  {(m.toonRatio * 100).toFixed(0)}%
                </td>
                <td className="p-3 text-right">
                  {m.accountApplied.toLocaleString()}
                </td>
                <td className="p-3 text-right">
                  {m.toonApplied.toLocaleString()}
                </td>
                <td className="p-3 text-right">{m.gross.toLocaleString()}</td>
                <td className="p-3 text-right">{m.fee.toLocaleString()}</td>
                <td className="p-3 text-right font-semibold">
                  {m.net.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 p-4 rounded-lg bg-neutral-800/50">
        <div className="flex gap-6">
          <span>총 매출: {result.totalGross.toLocaleString()}원</span>
          <span>총 세금: {result.totalFee.toLocaleString()}원</span>
          <span className="font-bold">
            총 정산: {result.totalNet.toLocaleString()}원
          </span>
        </div>
        <div className="mt-2 text-sm">
          합계 검증:{" "}
          <span className={sumOk ? "text-emerald-400" : "text-red-400"}>
            {sumOk ? "✓ OK" : "✗ FAIL"}
          </span>{" "}
          (멤버 net 합계 = {sumNet.toLocaleString()}원)
        </div>
      </div>

      <div className="mt-8 p-4 rounded-lg border border-white/10 text-sm text-neutral-400">
        <h2 className="font-semibold text-neutral-300 mb-2">테스트 데이터</h2>
        <ul className="list-disc list-inside space-y-1">
          <li>멤버1: 계좌 70%, 투네 60% (10만×0.7 + 5만×0.6 = 10만)</li>
          <li>멤버2: 계좌 80%, 투네 50% (8만×0.8 + 4만×0.5 = 8.4만)</li>
          <li>멤버3: 계좌 60%, 투네 70% (6만×0.6 + 3만×0.7 = 5.7만)</li>
          <li>운영비: 100% 적용, 세금 0 (2만+1만 = 3만)</li>
        </ul>
      </div>

      <div className="mt-6">
        <a
          href="/create-accounts"
          className="text-emerald-400 hover:underline"
        >
          → 계정 생성 사이트 테스트
        </a>
      </div>
    </main>
  );
}
