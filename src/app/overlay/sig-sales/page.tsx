"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { AnimatePresence, motion, animate, useMotionValue } from "framer-motion";
import { defaultState, loadState, loadStateFromApi, storageKey, type AppState } from "@/lib/state";
import Roulette from "@/components/Roulette";
import { useAudio } from "@/lib/use-audio";
import { resolveSigImageUrl } from "@/lib/constants";

const POLL_MS_SLOW = 1500;
const POLL_MS_ROLLING = 350;
const SPIN_ANIM_MS = 5000;

function useRemoteState(userId?: string): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const syncingRef = useRef(false);
  const rollingRef = useRef(false);
  rollingRef.current = Boolean(state?.rouletteState?.isRolling);

  const readLocal = useCallback((): AppState | null => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem(storageKey(userId));
      if (!raw) return null;
      return loadState(userId ?? undefined);
    } catch {
      return null;
    }
  }, [userId]);

  useEffect(() => {
    const local = readLocal();
    if (local) {
      setState(local);
      lastUpdatedRef.current = local.updatedAt || 0;
    } else {
      const base = defaultState();
      setState(base);
      lastUpdatedRef.current = base.updatedAt || 0;
    }

    const sync = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        const remote = await loadStateFromApi(userId);
        if (remote && (remote.updatedAt || 0) >= lastUpdatedRef.current) {
          lastUpdatedRef.current = remote.updatedAt || Date.now();
          setState(remote);
        }
      } finally {
        syncingRef.current = false;
      }
    };

    const tick = () => void sync();
    const idSlow = window.setInterval(tick, POLL_MS_SLOW);
    const idFast = window.setInterval(() => {
      if (rollingRef.current) tick();
    }, POLL_MS_ROLLING);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      const now = readLocal();
      if (now && (now.updatedAt || 0) >= lastUpdatedRef.current) {
        lastUpdatedRef.current = now.updatedAt || Date.now();
        setState(now);
      }
      void sync();
    };
    const onFocus = () => void sync();
    const onVisible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    void sync();
    return () => {
      window.clearInterval(idSlow);
      window.clearInterval(idFast);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [readLocal, userId]);

  return { state, ready: state !== null };
}

function outlineText(): CSSProperties {
  return {
    color: "#fff",
    textShadow:
      "-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000,0 0 6px rgba(0,0,0,0.85)",
  };
}

export default function SigSalesOverlayPage() {
  const sp = useSearchParams();
  const userId = sp.get("u") || "finalent";
  const reelPreview =
    sp.get("reelPreview") === "true" || sp.get("reelPreview") === "1" || sp.get("previewRoulette") === "true";
  const { state, ready } = useRemoteState(userId);
  const rs = state?.rouletteState;
  const inv = state?.sigInventory || [];
  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || "/images/sigs/stamp.png";
  const activeItems = useMemo(() => inv.filter((x) => x.isActive), [inv]);
  const wheelItems = useMemo(() => (inv.length ? inv : activeItems), [inv, activeItems]);
  const reel = useMemo(() => (inv.length ? [...inv, ...inv, ...inv, ...inv] : []), [inv]);
  const demoX = useMotionValue(0);
  const finishOnceRef = useRef(false);
  const spinAudio = useAudio("/sounds/spin.mp3", { loop: true, volume: 0.55 });
  const winAudio = useAudio("/sounds/win.mp3", { loop: false, volume: 0.95 });

  useEffect(() => {
    finishOnceRef.current = false;
  }, [rs?.startedAt]);

  useEffect(() => {
    spinAudio.unlock();
    winAudio.unlock();
  }, [spinAudio, winAudio]);

  useEffect(() => {
    const isRolling = Boolean(rs?.isRolling);
    if (isRolling) {
      spinAudio.play(true);
    } else {
      spinAudio.stop();
    }
  }, [rs?.isRolling, spinAudio, winAudio]);

  useEffect(() => {
    if (!reelPreview || !reel.length) return;
    if (rs?.isRolling) return;
    const w = typeof window !== "undefined" ? window.innerWidth : 800;
    const amp = Math.min(420, Math.max(160, w * 0.35));
    demoX.set(0);
    const controls = animate(demoX, [-amp, 0], {
      duration: 6,
      ease: "easeInOut",
      repeat: Infinity,
      repeatType: "mirror",
    });
    return () => controls.stop();
  }, [reelPreview, reel.length, rs?.isRolling, demoX]);

  if (!ready || !state) return null;

  const showReel = Boolean(rs?.isRolling && rs?.result && reel.length);
  const showReelDemoStrip = reelPreview && !showReel && reel.length > 0;
  const showRouletteHeader = !showReel;

  return (
    <main className="min-h-screen w-full bg-transparent p-4 text-white">
      <AnimatePresence mode="wait">
        {showReel ? (
          <motion.div
            key="reel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35 }}
            className="relative mx-auto flex h-[min(70vh,640px)] max-w-[1100px] flex-col items-center justify-center overflow-hidden rounded-2xl"
          >
            <div className="mb-3 text-2xl font-black" style={outlineText()}>
              시그 룰렛 · {rs?.spinCount ?? 1}회
            </div>
            <Roulette
              items={wheelItems}
              isRolling={Boolean(rs?.isRolling)}
              resultId={rs?.result?.id}
              spinDurationSec={SPIN_ANIM_MS / 1000}
              startedAt={rs?.startedAt}
              onAnimationComplete={() => {
                if (finishOnceRef.current) return;
                finishOnceRef.current = true;
                spinAudio.stop();
                winAudio.play(true);
                void fetch(`/api/roulette/finish?user=${encodeURIComponent(userId)}`, {
                  method: "POST",
                  credentials: "include",
                }).catch(() => {});
              }}
            />
            <p className="mt-3 text-sm font-semibold" style={outlineText()}>
              포인터(상단 화살표) 위치에서 당첨 시그가 결정됩니다.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="grid"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="mx-auto max-w-[1280px]"
          >
            {showRouletteHeader ? (
              <section className="mb-6">
                <h1 className="mb-2 text-center text-3xl font-black md:text-4xl" style={outlineText()}>
                  시그 룰렛
                </h1>
                {showReelDemoStrip ? (
                  <div className="rounded-2xl border border-fuchsia-400/45 bg-black/45 p-4 shadow-lg backdrop-blur-sm">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-bold text-fuchsia-100">미리보기 · 데모 스크롤 (실제 스핀 시 전체 화면)</span>
                      <span className="text-[10px] text-white/55">방송 URL에는 reelPreview 제거</span>
                    </div>
                    <div className="relative mx-auto h-48 w-full max-w-[900px] overflow-hidden rounded-xl border border-white/25 bg-black/30">
                      <div className="pointer-events-none absolute left-1/2 top-0 z-10 h-full w-1 -translate-x-1/2 bg-amber-300/90 shadow-[0_0_12px_rgba(251,191,36,0.8)]" />
                      <motion.div className="absolute left-0 top-2 flex h-44 gap-2 px-2" style={{ x: demoX }}>
                        {reel.map((item, idx) => (
                          <div
                            key={`demo-strip-${item.id}-${idx}`}
                            className="relative h-40 w-[132px] shrink-0 overflow-hidden rounded-lg border border-white/20 bg-black/40"
                          >
                            <Image
                              src={resolveSigImageUrl(item.name, item.imageUrl)}
                              alt={item.name}
                              fill
                              unoptimized
                              className="object-cover"
                            />
                          </div>
                        ))}
                      </motion.div>
                    </div>
                    <p className="mt-3 text-center text-sm font-semibold text-white/90" style={outlineText()}>
                      가운데 선에 멈추는 슬롯이 실제 룰렛과 동일합니다.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-white/20 bg-black/35 px-4 py-4 text-center backdrop-blur-sm">
                    <p className="text-sm font-semibold text-white/90" style={outlineText()}>
                      관리자에서 <span className="text-amber-200">룰렛 돌리기</span>를 실행하면 이 화면이 잠시 룰렛 전체 화면으로 바뀝니다.
                    </p>
                  </div>
                )}
              </section>
            ) : null}
            <h2 className="mb-3 text-center text-xl font-black text-white/95 md:text-2xl" style={outlineText()}>
              시그 판매
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {activeItems.map((item) => {
                const soldOut = item.soldCount >= item.maxCount;
                const pct = Math.min(100, (item.soldCount / Math.max(1, item.maxCount)) * 100);
                const isSingleSale = item.maxCount <= 1;
                return (
                  <div
                    key={item.id}
                    className="relative overflow-hidden rounded-2xl border border-white/25 bg-black/30 shadow-lg backdrop-blur-sm"
                  >
                    <div className="relative aspect-[4/5] w-full">
                      <Image
                        src={resolveSigImageUrl(item.name, item.imageUrl)}
                        alt={item.name}
                        fill
                        unoptimized
                        className="object-cover"
                      />
                      {soldOut ? <div className="absolute inset-0 bg-neutral-700/70" /> : null}
                      <AnimatePresence>
                        {soldOut ? (
                          <motion.div
                            key={`stamp-${item.id}`}
                            initial={{ scale: 1.4, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="pointer-events-none absolute left-1/2 top-1/2 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
                          >
                            <div className="absolute inset-1 rounded-full bg-rose-300/45 blur-[2px]" aria-hidden />
                            <motion.img
                              src={soldOutStampUrl}
                              alt="참 잘했어요"
                              className="relative z-[1] h-24 w-24 object-contain opacity-90"
                            />
                          </motion.div>
                        ) : null}
                      </AnimatePresence>
                    </div>
                    <div className="p-2">
                      <div className="truncate text-sm font-bold" style={outlineText()}>
                        {item.name}
                      </div>
                      <div className="text-xs" style={outlineText()}>
                        {isSingleSale ? (soldOut ? "완판" : "판매대기") : `${item.soldCount}/${item.maxCount}`} · {item.price.toLocaleString("ko-KR")}원
                      </div>
                      {!isSingleSale ? (
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                          <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300" style={{ width: `${pct}%` }} />
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            {activeItems.length === 0 ? (
              <p className="mt-6 text-center text-sm" style={outlineText()}>
                활성화된 판매 시그가 없습니다. 관리자에서 판매 활성을 켜 주세요.
              </p>
            ) : null}
            {rs?.result ? (
              <div className="mt-6 rounded-2xl border border-amber-300/50 bg-black/35 px-4 py-3 text-center backdrop-blur-sm">
                <div className="text-sm font-bold text-amber-200" style={outlineText()}>
                  최근 당첨
                </div>
                <div className="mt-1 text-xl font-black" style={outlineText()}>
                  {rs.result.name}
                </div>
                {rs.results && rs.results.length > 1 ? (
                  <div className="mt-2 border-t border-white/10 pt-2 text-xs text-white/85" style={outlineText()}>
                    {rs.spinCount}회 결과: {rs.results.map((x) => x.name).join(" → ")}
                  </div>
                ) : null}
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
