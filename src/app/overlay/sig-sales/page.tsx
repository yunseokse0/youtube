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
const ONE_SHOT_SIG_ID = "sig_one_shot";
const ROULETTE_DEMO_ITEMS = [
  { id: "demo_1", name: "애교", price: 77000, imageUrl: "/images/sigs/애교.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_2", name: "댄스", price: 100000, imageUrl: "/images/sigs/댄스.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_3", name: "식사권", price: 333000, imageUrl: "/images/sigs/식사권.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_4", name: "보이스", price: 50000, imageUrl: "/images/sigs/보이스.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_5", name: "노래", price: 120000, imageUrl: "/images/sigs/노래.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_6", name: "토크", price: 55000, imageUrl: "/images/sigs/토크.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_7", name: "하트", price: 30000, imageUrl: "/images/sigs/하트.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_8", name: "게임", price: 88000, imageUrl: "/images/sigs/게임.png", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_9", name: "보너스", price: 150000, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_10", name: "한방 시그", price: 0, imageUrl: "", memberId: "", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
] as const;

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
  const rouletteDemo =
    sp.get("rouletteDemo") === "true" || sp.get("rouletteDemo") === "1" || sp.get("wheelDemo") === "true";
  const { state, ready } = useRemoteState(userId);
  const rs = state?.rouletteState;
  const inv = state?.sigInventory || [];
  const excludedSet = useMemo(
    () => new Set((state?.sigSalesExcludedIds || []).map((x) => String(x))),
    [state?.sigSalesExcludedIds]
  );
  const invForSales = useMemo(() => inv.filter((x) => !excludedSet.has(x.id)), [inv, excludedSet]);
  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || "/images/sigs/stamp.png";
  const activeItems = useMemo(
    () =>
      (rouletteDemo ? [...ROULETTE_DEMO_ITEMS] : invForSales.filter((x) => x.isActive)).filter(
        (x) => x.id !== ONE_SHOT_SIG_ID && x.name !== "한방 시그"
      ),
    [invForSales, rouletteDemo]
  );
  const wheelItems = useMemo(() => {
    if (rouletteDemo) return [...ROULETTE_DEMO_ITEMS];
    const rolling = invForSales.filter((x) => x.isRolling);
    if (rolling.length > 0) return rolling;
    if (activeItems.length > 0) return activeItems;
    return invForSales;
  }, [invForSales, activeItems, rouletteDemo]);
  const reel = useMemo(() => (wheelItems.length ? [...wheelItems, ...wheelItems, ...wheelItems, ...wheelItems] : []), [wheelItems]);
  const demoX = useMotionValue(0);
  const finishOnceRef = useRef(false);
  const [demoStartedAt, setDemoStartedAt] = useState<number>(() => Date.now());
  const [demoResultId, setDemoResultId] = useState<string | undefined>(undefined);
  const [demoResults, setDemoResults] = useState<typeof wheelItems>([]);
  const [highlightedSigId, setHighlightedSigId] = useState<string | null>(null);
  const prevResolvedResultIdRef = useRef<string | null>(null);
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

  // 데모 모드에서도 "회전 시작 → 당첨" 사운드를 주기적으로 재생
  useEffect(() => {
    if (!rouletteDemo || !wheelItems.length) return;
    spinAudio.stop();
    spinAudio.play(true);
    const t = window.setTimeout(() => {
      spinAudio.stop();
      winAudio.play(true);
    }, Math.max(1200, SPIN_ANIM_MS - 280));
    return () => {
      window.clearTimeout(t);
    };
  }, [rouletteDemo, demoStartedAt, wheelItems.length, spinAudio, winAudio]);

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

  useEffect(() => {
    if (!rouletteDemo || !wheelItems.length) return;
    const pick = () => {
      const oneShot = wheelItems.find((x) => x.name === "한방 시그");
      const basePool = wheelItems.filter((x) => x.name !== "한방 시그");
      const randoms = Array.from({ length: 4 }).map(() => {
        const idx = Math.floor(Math.random() * Math.max(1, basePool.length));
        return (basePool[idx] || wheelItems[0])!;
      });
      const results = oneShot ? [...randoms, oneShot] : [...randoms, randoms[randoms.length - 1]!];
      setDemoResults(results);
      setDemoResultId(results[results.length - 1]?.id);
      setDemoStartedAt(Date.now());
    };
    pick();
    const id = window.setInterval(pick, SPIN_ANIM_MS + 800);
    return () => window.clearInterval(id);
  }, [rouletteDemo, wheelItems]);

  const demoRolling = rouletteDemo && wheelItems.length > 0;
  const showReel = Boolean((rs?.isRolling && rs?.result && reel.length) || demoRolling);
  const showReelDemoStrip = reelPreview && !showReel && reel.length > 0;
  const showRouletteHeader = !showReel;
  const isRollingDisplay = demoRolling || Boolean(rs?.isRolling);
  const resolvedResultId = demoRolling ? (demoResultId || null) : (rs?.result?.id || null);

  useEffect(() => {
    if (!resolvedResultId) return;
    if (prevResolvedResultIdRef.current === resolvedResultId) return;
    prevResolvedResultIdRef.current = resolvedResultId;
    setHighlightedSigId(resolvedResultId);
    const t = window.setTimeout(() => setHighlightedSigId(null), 1600);
    return () => window.clearTimeout(t);
  }, [resolvedResultId]);

  if (!ready || !state) return null;

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
              {demoRolling ? "시그 판매 추첨 · 데모 5회" : `시그 판매 추첨 · ${rs?.spinCount ?? 1}회`}
            </div>
            <Roulette
              items={wheelItems}
              isRolling={isRollingDisplay}
              resultId={demoRolling ? demoResultId : rs?.result?.id}
              spinDurationSec={SPIN_ANIM_MS / 1000}
              startedAt={demoRolling ? demoStartedAt : rs?.startedAt}
              onAnimationComplete={() => {
                if (demoRolling) return;
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
                  시그 판매
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
                            {String(item.imageUrl || "").trim() ? (
                              <Image
                                src={resolveSigImageUrl(item.name, item.imageUrl)}
                                alt={item.name}
                                fill
                                unoptimized
                                className="object-cover"
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-fuchsia-700/40 to-rose-700/40 px-2 text-center text-lg font-black text-white">
                                {item.name}
                              </div>
                            )}
                          </div>
                        ))}
                      </motion.div>
                    </div>
                    <p className="mt-3 text-center text-sm font-semibold text-white/90" style={outlineText()}>
                      가운데 선에 멈추는 슬롯이 실제 룰렛과 동일합니다.
                    </p>
                  </div>
                ) : (
                  <></>
                )}
              </section>
            ) : null}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {activeItems.map((item) => {
                const soldOut = item.soldCount >= item.maxCount;
                const pct = Math.min(100, (item.soldCount / Math.max(1, item.maxCount)) * 100);
                const isSingleSale = item.maxCount <= 1;
                const isHighlighted = item.id === highlightedSigId;
                return (
                  <div
                    key={item.id}
                    className={`relative overflow-hidden rounded-2xl border bg-black/30 shadow-lg backdrop-blur-sm transition-all duration-300 ${isHighlighted ? "border-amber-300/95 animate-pulse shadow-[0_0_24px_rgba(251,191,36,0.65)] scale-[1.02]" : "border-white/25"}`}
                  >
                    {isHighlighted ? (
                      <div className="pointer-events-none absolute inset-0 z-10 bg-gradient-to-br from-amber-300/20 via-yellow-200/10 to-transparent" />
                    ) : null}
                    <div className="relative aspect-[4/5] w-full">
                      {String(item.imageUrl || "").trim() ? (
                        <Image
                          src={resolveSigImageUrl(item.name, item.imageUrl)}
                          alt={item.name}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-fuchsia-700/40 to-rose-700/40 px-2 text-center text-2xl font-black text-white">
                          {item.name}
                        </div>
                      )}
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
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
