"use client";

import { useState } from "react";
import SigSoldStampOverlay from "@/components/sig-sales/SigSoldStampOverlay";
import { DEFAULT_SIG_SOLD_STAMP_URL } from "@/lib/constants";

const DEMO_SIG_SRC = "/images/sigs/from-drive/마티니.gif";
const DEMO_SIG_FALLBACK = "/images/sigs/dummy-sig.svg";

export default function SigStampDemoPage() {
  const [sold, setSold] = useState(true);
  const [sigSrc, setSigSrc] = useState(DEMO_SIG_SRC);
  const stampUrl = DEFAULT_SIG_SOLD_STAMP_URL;

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold">시그 판매 완료 이미지 데모</h1>
          <p className="text-sm text-neutral-400">
            방송 OBS·관리자 화면과 동일한 <code className="text-emerald-300">SigSoldStampOverlay</code> 컴포넌트입니다.
            레이어: 시그 GIF → 회색 딤(48%) → 흰 배경 30%(GIF 전체) → 도장 PNG.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setSold((v) => !v)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${
              sold ? "bg-rose-700 text-white" : "bg-emerald-700 text-white"
            }`}
          >
            {sold ? "판매 완료 해제" : "판매 완료 적용"}
          </button>
          <span className="text-sm text-neutral-400">
            상태: <strong className="text-white">{sold ? "판매 완료 (도장 ON)" : "판매 전"}</strong>
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <DemoCard title="① 판매 전" sold={false} sigSrc={sigSrc} stampUrl={stampUrl} onSigError={() => setSigSrc(DEMO_SIG_FALLBACK)} />
          <DemoCard title="② 판매 완료" sold={sold} sigSrc={sigSrc} stampUrl={stampUrl} onSigError={() => setSigSrc(DEMO_SIG_FALLBACK)} />
        </div>

        <section className="rounded-xl border border-white/10 bg-neutral-900/80 p-4 text-sm text-neutral-300">
          <h2 className="mb-2 font-semibold text-white">도장 이미지 경로</h2>
          <ul className="list-inside list-disc space-y-1">
            <li>
              기본: <code>{DEFAULT_SIG_SOLD_STAMP_URL}</code> (없으면 <code>/images/sigs/stamp.png</code> 폴백)
            </li>
            <li>관리자·OBS 공통 설정: 저장소 <code>sigSoldOutStampUrl</code></li>
          </ul>
        </section>

        <section className="flex flex-wrap items-start gap-6">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">도장 원본만</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/sigs/stamp.png" alt="판매 완료 도장" className="h-32 w-32 object-contain bg-white/10 p-2 rounded-lg" />
          </div>
          <p className="max-w-md text-sm text-neutral-400">
            실제 방송에서는{" "}
            <a href="/overlay/sig-sales?wheelDemo=1" className="text-sky-400 underline">
              /overlay/sig-sales
            </a>
            과{" "}
            <a href="/admin/sig-sales-manual" className="text-sky-400 underline">
              /admin/sig-sales
            </a>
            에서 재고 <code>soldCount</code> 또는 수동 체크 시 같은 연출이 붙습니다.
          </p>
        </section>
      </div>
    </main>
  );
}

function DemoCard({
  title,
  sold,
  sigSrc,
  stampUrl,
  onSigError,
}: {
  title: string;
  sold: boolean;
  sigSrc: string;
  stampUrl: string;
  onSigError: () => void;
}) {
  return (
    <article className="space-y-2">
      <h2 className="text-sm font-semibold text-neutral-300">{title}</h2>
      <div className="mx-auto w-full max-w-[240px] rounded-xl border border-white/20 bg-black/50 p-2 shadow-lg">
        <div className="relative aspect-[4/5] overflow-hidden rounded-lg border border-white/20 bg-black/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={sigSrc}
            alt="시그 미리보기"
            className="relative z-[2] h-full w-full object-contain object-center"
            onError={onSigError}
          />
          {sold ? <SigSoldStampOverlay soldOutStampUrl={stampUrl} /> : null}
        </div>
        <p className="mt-2 truncate text-center text-sm font-bold text-white">마티니</p>
        <p className="text-center text-xs tabular-nums text-neutral-50">₩100,000</p>
      </div>
    </article>
  );
}
