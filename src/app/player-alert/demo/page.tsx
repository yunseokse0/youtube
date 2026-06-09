"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import PlayerDonationAlertCard, { type PlayerDonationAlertData } from "@/components/donation/PlayerDonationAlertCard";
import { resolveSigOverlayCardImageUrl } from "@/lib/constants";

type WaitingItem = PlayerDonationAlertData & { id: string };

const DEMO_USER_ID = "finalent";

const DEMO_WAITING: WaitingItem[] = [
  {
    id: "demo-1",
    donorName: "달빛후원자",
    playerName: "루나",
    amount: 10000,
    message: "루나님 제트스키 부탁해요!",
    matchedSigName: "제트스키",
    isAutoMatched: true,
  },
  {
    id: "demo-2",
    donorName: "별빛킹",
    playerName: "솔라",
    amount: 15000,
    message: "카운팅스타 가즈아 🔥",
    matchedSigName: "카운팅스타",
    isAutoMatched: true,
  },
  {
    id: "demo-3",
    donorName: "익명의천사",
    playerName: "마티니",
    amount: 12000,
    message: "마티니 시그 하나만요",
    matchedSigName: "마티니",
    isAutoMatched: false,
  },
  {
    id: "demo-4",
    donorName: "치즈냥이",
    playerName: "루니",
    amount: 8000,
    message: "오렌지디스코 추천합니다~",
    matchedSigName: "오렌지디스코",
    isAutoMatched: true,
  },
  {
    id: "demo-5",
    donorName: "방송러버",
    playerName: "제트",
    amount: 20000,
    message: "반야심경 풀버전 기대할게요!",
    matchedSigName: "반야심경",
    isAutoMatched: true,
  },
];

const POPUP_MS = 5000;

export default function PlayerAlertDemoPage() {
  const [queue, setQueue] = useState<WaitingItem[]>(DEMO_WAITING);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [autoPlay, setAutoPlay] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPlayIndexRef = useRef(0);

  const activeAlert = useMemo(
    () => queue.find((item) => item.id === activeId) ?? null,
    [activeId, queue]
  );

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const showPopup = useCallback(
    (item: WaitingItem) => {
      clearTimer();
      setActiveId(item.id);
      timerRef.current = setTimeout(() => {
        setActiveId(null);
        timerRef.current = null;
      }, POPUP_MS);
    },
    [clearTimer]
  );

  const showNextInQueue = useCallback(() => {
    if (queue.length === 0) return;
    showPopup(queue[0]);
  }, [queue, showPopup]);

  useEffect(() => {
    if (!autoPlay || queue.length === 0) return;
    const tick = () => {
      const idx = autoPlayIndexRef.current % queue.length;
      showPopup(queue[idx]!);
      autoPlayIndexRef.current += 1;
    };
    tick();
    const interval = window.setInterval(tick, POPUP_MS + 400);
    return () => window.clearInterval(interval);
  }, [autoPlay, queue, showPopup]);

  useEffect(() => clearTimer, [clearTimer]);

  const dismissPopup = useCallback(() => {
    clearTimer();
    setActiveId(null);
  }, [clearTimer]);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  const resetDemo = useCallback(() => {
    clearTimer();
    setAutoPlay(false);
    setActiveId(null);
    autoPlayIndexRef.current = 0;
    setQueue(DEMO_WAITING);
  }, [clearTimer]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-950 to-black px-4 py-6 text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 lg:flex-row lg:items-start">
        <section className="w-full shrink-0 space-y-4 lg:max-w-md">
          <header>
            <p className="text-xs font-semibold uppercase tracking-wider text-sky-400">테스트</p>
            <h1 className="text-xl font-bold text-slate-100">후원 웹 팝업 · 대기 리스트</h1>
            <p className="mt-1 text-xs text-slate-400">
              대기 {queue.length}건 · 항목 클릭 시 팝업 미리보기 ({POPUP_MS / 1000}초)
            </p>
          </header>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded bg-sky-700 px-3 py-1.5 text-xs font-semibold hover:bg-sky-600"
              onClick={showNextInQueue}
              disabled={queue.length === 0}
            >
              맨 앞 팝업
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1.5 text-xs font-semibold ${autoPlay ? "bg-amber-700 hover:bg-amber-600" : "bg-emerald-700 hover:bg-emerald-600"}`}
              onClick={() => setAutoPlay((v) => !v)}
              disabled={queue.length === 0}
            >
              {autoPlay ? "연속 재생 중지" : "연속 재생"}
            </button>
            <button
              type="button"
              className="rounded bg-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-600"
              onClick={resetDemo}
            >
              초기화
            </button>
            <Link
              href="/player-alert?u=finalent&preview=1"
              className="rounded bg-sky-800 px-3 py-1.5 text-xs font-semibold hover:bg-sky-700"
            >
              실제 팝업 미리보기
            </Link>
          </div>

          <div className="space-y-2 rounded-xl border border-white/10 bg-black/30 p-2">
            <div className="px-1 text-xs font-medium text-neutral-400">대기 리스트 ({queue.length})</div>
            {queue.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-neutral-500">대기 항목이 없습니다.</p>
            ) : (
              queue.map((evt, index) => {
                const thumb =
                  evt.matchedSigName
                    ? resolveSigOverlayCardImageUrl(evt.matchedSigName, evt.matchedSigImageUrl, DEMO_USER_ID)
                    : "";
                const isActive = evt.id === activeId;
                return (
                  <div
                    key={evt.id}
                    className={`w-full rounded-lg border px-2 py-2 text-left text-xs transition ${
                      isActive
                        ? "border-yellow-400/60 bg-yellow-950/30"
                        : "border-white/10 bg-neutral-900/50"
                    }`}
                  >
                    <div className="flex gap-2">
                      {thumb ? (
                        <button
                          type="button"
                          onClick={() => showPopup(evt)}
                          className="h-12 w-12 shrink-0 overflow-hidden rounded border border-amber-500/30 bg-black/40"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumb} alt={evt.matchedSigName || "시그"} className="h-full w-full object-contain" />
                        </button>
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => showPopup(evt)}
                            className="text-[10px] text-neutral-500 hover:text-neutral-300"
                          >
                            #{index + 1} 대기 · 팝업 보기
                          </button>
                          <button
                            type="button"
                            className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-red-900/60 hover:text-red-200"
                            onClick={() => removeFromQueue(evt.id)}
                          >
                            제거
                          </button>
                        </div>
                        <button type="button" onClick={() => showPopup(evt)} className="w-full text-left">
                        {evt.matchedSigName ? (
                          <div className="font-bold text-amber-100">
                            {evt.matchedSigName}
                            {!evt.isAutoMatched ? " (추정)" : ""}
                          </div>
                        ) : null}
                        <div>
                          <span className="font-semibold text-cyan-300">{evt.donorName}</span>
                          <span className="text-neutral-500"> · </span>
                          <span className="tabular-nums text-yellow-200">{evt.amount.toLocaleString("ko-KR")}원</span>
                        </div>
                        {evt.playerName ? (
                          <div className="text-emerald-300/90">플레이어: {evt.playerName}</div>
                        ) : null}
                        {evt.message ? (
                          <div className="line-clamp-2 text-[11px] text-neutral-400">메시지: {evt.message}</div>
                        ) : null}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="flex w-full flex-1 flex-col items-center gap-3">
          <p className="text-xs text-neutral-500">팝업 미리보기 (실제 `/player-alert`와 동일 카드)</p>
          {activeAlert ? (
            <PlayerDonationAlertCard alert={activeAlert} userId={DEMO_USER_ID} onClose={dismissPopup} />
          ) : (
            <div className="flex w-full max-w-md flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/60 px-6 py-20 text-center">
              <p className="text-sm font-medium text-slate-300">후원 알림 대기 중</p>
              <p className="mt-2 text-xs text-slate-500">왼쪽 대기 항목을 클릭하거나 「맨 앞 팝업」을 누르세요.</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
