"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  HIGH_SOCIETY_BAR_STYLES,
  type HighSocietyBarStyle,
} from "@/lib/high-society";

/**
 * 상류사회 세로(9:16) 오버레이 데모 — 로그인 없이 test 데이터로 확인
 */
export default function HighSocietyDemoPage() {
  const [hostObs, setHostObs] = useState(false);
  const [barStyle, setBarStyle] = useState<HighSocietyBarStyle>("flat");
  const [bLeft, setBLeft] = useState(50);
  const [cLeft, setCLeft] = useState(50);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const iframeSrc = useMemo(() => {
    const q = new URLSearchParams({
      test: "true",
      bar: barStyle,
      bLeft: String(bLeft),
      cLeft: String(cLeft),
    });
    if (hostObs) q.set("host", "obs");
    return `/overlay/high-society?${q.toString()}`;
  }, [hostObs, barStyle, bLeft, cLeft]);

  const obsPath = `/overlay/high-society?u=din&host=obs&bar=${barStyle}`;
  const obsUrl = origin ? `${origin}${obsPath}` : obsPath;

  return (
    <main className="min-h-[100dvh] bg-neutral-950 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-4 md:p-8 lg:flex-row lg:items-start">
        <section className="w-full max-w-md space-y-4 lg:sticky lg:top-6">
          <div>
            <p className="text-xs uppercase tracking-[0.14em] text-amber-400/80">High Society</p>
            <h1 className="mt-1 text-2xl font-bold text-amber-50">상류사회 · 세로 오버레이 데모</h1>
            <p className="mt-2 text-sm leading-relaxed text-neutral-400">
              게이지 형태 2종(평평 / 화살표). 룰: 1만원=5cm · 천원 버림(2만6천→10cm) · A→D 영토.
            </p>
          </div>

          <div>
            <p className="mb-2 text-[11px] font-semibold text-amber-200/90">영토 게이지 형태</p>
            <div className="grid grid-cols-2 gap-2">
              {HIGH_SOCIETY_BAR_STYLES.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    barStyle === opt.id
                      ? "border-amber-400 bg-amber-600/90 text-white"
                      : "border-white/10 bg-neutral-900 text-neutral-300 hover:border-white/25"
                  }`}
                  onClick={() => setBarStyle(opt.id)}
                >
                  <div className="text-sm font-bold">{opt.label}</div>
                  <div className="mt-0.5 text-[10px] opacity-80 leading-snug">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-white/10 bg-neutral-900/80 p-3">
            <p className="text-[11px] font-semibold text-amber-200/90">B·C 확장 방향 분배</p>
            <label className="block text-[11px] text-neutral-400">
              B 왼쪽 {bLeft}% / 오른쪽 {100 - bLeft}%
              <input
                type="range"
                min={0}
                max={100}
                value={bLeft}
                onChange={(e) => setBLeft(Number(e.target.value))}
                className="mt-1 w-full accent-amber-500"
              />
            </label>
            <label className="block text-[11px] text-neutral-400">
              C 왼쪽 {cLeft}% / 오른쪽 {100 - cLeft}%
              <input
                type="range"
                min={0}
                max={100}
                value={cLeft}
                onChange={(e) => setCLeft(Number(e.target.value))}
                className="mt-1 w-full accent-amber-500"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                hostObs ? "bg-emerald-700 text-white" : "bg-neutral-800 text-neutral-300"
              }`}
              onClick={() => setHostObs((v) => !v)}
            >
              host=obs {hostObs ? "ON" : "OFF"}
            </button>
          </div>

          <div className="rounded-xl border border-amber-500/25 bg-amber-950/30 p-3 text-xs text-neutral-300 space-y-2">
            <p className="font-semibold text-amber-100">OBS URL</p>
            <code className="block break-all text-amber-200/90">{obsUrl}</code>
            <p className="text-[10px] text-neutral-500">
              화살표: <code className="text-neutral-400">&amp;bar=arrow</code> · 평평:{" "}
              <code className="text-neutral-400">&amp;bar=flat</code> (기본)
            </p>
            <button
              type="button"
              className="rounded bg-neutral-800 px-2 py-1 text-[11px] hover:bg-neutral-700"
              onClick={() => void navigator.clipboard.writeText(obsUrl)}
            >
              OBS URL 복사
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <Link href="/overlay/dev" className="text-sky-400 underline">
              오버레이 허브
            </Link>
            <Link href="/admin" className="text-sky-400 underline">
              관리자
            </Link>
            <a href={iframeSrc} target="_blank" rel="noreferrer" className="text-sky-400 underline">
              전체 화면으로 열기
            </a>
          </div>
        </section>

        <section className="flex flex-1 flex-col items-center gap-3">
          <p className="text-[11px] text-neutral-500">세로 폰 미리보기 (9:16)</p>
          <div
            className="relative w-full max-w-[360px] overflow-hidden rounded-[28px] border border-white/15 bg-[radial-gradient(ellipse_at_center,_#2a2218_0%,_#0a0a0a_70%)] shadow-2xl"
            style={{ aspectRatio: "9 / 16" }}
          >
            <iframe
              key={iframeSrc}
              src={iframeSrc}
              title="상류사회 오버레이 데모"
              className="absolute inset-0 h-full w-full border-0"
              style={{ background: "transparent" }}
            />
          </div>
          <code className="max-w-full break-all text-[10px] text-neutral-500">{iframeSrc}</code>
        </section>
      </div>
    </main>
  );
}
