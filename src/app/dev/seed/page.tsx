"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  loadSettlementRecords,
  mergeSettlementRecords,
  normalizeSettlementRecords,
  saveSettlementRecords,
} from "@/lib/settlement";
import type { SettlementRecord } from "@/types";

type SeedResult = {
  ok?: boolean;
  error?: string;
  userId?: string;
  donorsCount?: number;
  membersCount?: number;
  totalCombined?: number;
  settlementId?: string | null;
  settlement?: SettlementRecord | null;
  settlementTitle?: string | null;
  totalNet?: number | null;
  settlementSaved?: boolean;
  links?: {
    admin?: string;
    settlements?: string;
    settlementDetail?: string | null;
  };
  hint?: string;
};

function persistSettlementToLocalStorage(userId: string | undefined, settlement: SettlementRecord) {
  const prev = loadSettlementRecords(userId);
  const next = normalizeSettlementRecords(mergeSettlementRecords(prev, [settlement]));
  saveSettlementRecords(next, userId);
}

export default function DevSeedPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<SeedResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const runSeed = useCallback(async (path: string, label: string) => {
    setBusy(label);
    setErr(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as SeedResult & { error?: string };
      if (!res.ok) {
        setErr(data.error || `HTTP ${res.status}`);
        setResult(null);
        return;
      }
      if (data.settlement) {
        persistSettlementToLocalStorage(data.userId, data.settlement);
      }
      setResult(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "요청 실패");
      setResult(null);
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="mx-auto max-w-xl space-y-6">
        <div>
          <h1 className="text-xl font-bold">개발 더미 데이터</h1>
          <p className="mt-2 text-sm text-neutral-400 leading-relaxed">
            localhost 전용입니다. 버튼 한 번으로 후원·멤버 금액과 정산 테스트 레코드를 넣습니다.
          </p>
        </div>

        <div className="space-y-3 rounded-xl border border-white/10 bg-neutral-900/60 p-4">
          <button
            type="button"
            disabled={!!busy}
            className="w-full rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold hover:bg-emerald-500 disabled:opacity-50"
            onClick={() => runSeed("/api/dev/seed-settlement-test", "settlement")}
          >
            {busy === "settlement" ? "넣는 중…" : "정산 테스트용 더미 (후원 + 정산 생성)"}
          </button>
          <button
            type="button"
            disabled={!!busy}
            className="w-full rounded-lg bg-neutral-700 px-4 py-2.5 text-sm hover:bg-neutral-600 disabled:opacity-50"
            onClick={() => runSeed("/api/dev/seed-donations", "donations")}
          >
            {busy === "donations" ? "넣는 중…" : "후원 더미만 (정산 생성 없음)"}
          </button>
          <p className="text-xs text-neutral-500">
            후원 더미: 단체짠더미·소액 후원 등. 정산 테스트: 위 후원 + 「개발 테스트 정산」 레코드까지 생성.
          </p>
        </div>

        {err ? (
          <div className="rounded-lg border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {err}
          </div>
        ) : null}

        {result?.ok ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3 text-sm">
            <div className="font-semibold text-emerald-200">완료</div>
            <ul className="space-y-1 text-neutral-300">
              <li>멤버 {result.membersCount}명 · 후원 {result.donorsCount}건</li>
              <li>합산 금액 {Number(result.totalCombined || 0).toLocaleString()}원</li>
              {result.settlementTitle ? (
                <li>
                  정산 「{result.settlementTitle}」 · totalNet{" "}
                  {Number(result.totalNet || 0).toLocaleString()}원
                </li>
              ) : null}
            </ul>
            {result.hint ? <p className="text-xs text-neutral-400">{result.hint}</p> : null}
            <div className="flex flex-wrap gap-2 pt-1">
              {result.links?.admin ? (
                <Link
                  href={result.links.admin}
                  className="rounded bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700"
                >
                  관리자 (정산 생성)
                </Link>
              ) : null}
              {result.links?.settlementDetail ? (
                <Link
                  href={result.links.settlementDetail}
                  className="rounded bg-indigo-700 px-3 py-1.5 text-xs hover:bg-indigo-600"
                >
                  정산 상세 (비율 테스트)
                </Link>
              ) : null}
              {result.links?.settlements ? (
                <Link
                  href={result.links.settlements}
                  className="rounded border border-white/15 px-3 py-1.5 text-xs hover:border-white/30"
                >
                  정산 목록
                </Link>
              ) : null}
            </div>
          </div>
        ) : null}

        <section className="text-xs text-neutral-500 space-y-2 border-t border-white/10 pt-4">
          <p className="font-semibold text-neutral-400">수동 API</p>
          <code className="block rounded bg-black/50 p-2 break-all">
            POST /api/dev/seed-settlement-test
          </code>
          <code className="block rounded bg-black/50 p-2 break-all">
            POST /api/dev/seed-donations {"{ \"mode\": \"replace\" }"}
          </code>
        </section>
      </div>
    </main>
  );
}
