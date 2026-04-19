"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { AnimatePresence, motion, animate, useMotionValue } from "framer-motion";
import { defaultState, loadState, loadStateFromApi, storageKey, type AppState } from "@/lib/state";
import { resolveSigImageUrl } from "@/lib/constants";

const POLL_MS = 1500;
const SPIN_ANIM_MS = 2800;

function useRemoteState(userId?: string): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const syncingRef = useRef(false);

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

    const id = window.setInterval(() => {
      void sync();
    }, POLL_MS);
    window.addEventListener("storage", (e) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      const now = readLocal();
      if (now && (now.updatedAt || 0) >= lastUpdatedRef.current) {
        lastUpdatedRef.current = now.updatedAt || Date.now();
        setState(now);
      }
    });
    void sync();
    return () => window.clearInterval(id);
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
  const { state, ready } = useRemoteState(userId);
  const rs = state?.rouletteState;
  const inv = state?.sigInventory || [];
  const activeItems = useMemo(() => inv.filter((x) => x.isActive), [inv]);
  const reel = useMemo(() => (inv.length ? [...inv, ...inv, ...inv, ...inv] : []), [inv]);
  const xMv = useMotionValue(0);
  const finishOnceRef = useRef(false);

  useEffect(() => {
    finishOnceRef.current = false;
  }, [rs?.startedAt]);

  useEffect(() => {
    if (!rs?.isRolling || !rs.result || !reel.length) return;
    const slot = 140;
    const mid = Math.floor(reel.length / 2);
    let hit = reel.findIndex((it, i) => i >= mid - 4 && i <= mid + 8 && it.id === rs.result?.id);
    if (hit < 0) hit = reel.findIndex((it) => it.id === rs.result?.id);
    if (hit < 0) hit = mid;
    const centerX = typeof window !== "undefined" ? window.innerWidth / 2 : 400;
    const start = 0;
    const end = -(hit * slot) + centerX - slot / 2;
    xMv.set(start);
    const controls = animate(xMv, end, { duration: SPIN_ANIM_MS / 1000, ease: [0.12, 0.85, 0.15, 1] });
    const t = window.setTimeout(() => {
      if (finishOnceRef.current) return;
      finishOnceRef.current = true;
      void fetch(`/api/roulette/finish?user=${encodeURIComponent(userId)}`, {
        method: "POST",
        credentials: "include",
      }).catch(() => {});
    }, SPIN_ANIM_MS + 120);
    return () => {
      window.clearTimeout(t);
      controls.stop();
    };
  }, [rs?.isRolling, rs?.result?.id, rs?.startedAt, reel, userId, xMv]);

  if (!ready || !state) return null;

  const showReel = Boolean(rs?.isRolling && rs?.result && reel.length);

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
            <div className="relative h-48 w-full max-w-[900px] overflow-hidden rounded-xl border border-white/25 bg-black/20">
              <div className="pointer-events-none absolute left-1/2 top-0 z-10 h-full w-1 -translate-x-1/2 bg-amber-300/90 shadow-[0_0_12px_rgba(251,191,36,0.8)]" />
              <motion.div className="absolute left-0 top-2 flex h-44 gap-2 px-2" style={{ x: xMv }}>
                {reel.map((item, idx) => (
                  <div
                    key={`${item.id}-${idx}`}
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
            <p className="mt-3 text-sm font-semibold" style={outlineText()}>
              당첨 시그가 가운데에 멈춥니다…
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
            {rs?.result ? (
              <div className="mb-4 rounded-2xl border border-amber-300/50 bg-black/35 px-4 py-3 text-center backdrop-blur-sm">
                <div className="text-sm font-bold text-amber-200" style={outlineText()}>
                  최근 당첨
                </div>
                <div className="mt-1 text-xl font-black" style={outlineText()}>
                  {rs.result.name}
                </div>
              </div>
            ) : null}
            <h1 className="mb-3 text-center text-2xl font-black md:text-3xl" style={outlineText()}>
              시그 판매
            </h1>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {activeItems.map((item) => {
                const soldOut = item.soldCount >= item.maxCount;
                const pct = Math.min(100, (item.soldCount / Math.max(1, item.maxCount)) * 100);
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
                              src="/images/sigs/stamp.png"
                              alt="참 잘했어요"
                              className="relative z-[1] h-24 w-24 object-contain opacity-90 mix-blend-multiply"
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
                        {item.soldCount}/{item.maxCount} · {item.price.toLocaleString("ko-KR")}원
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                        <div className="h-full rounded-full bg-gradient-to-r from-emerald-300 to-cyan-300" style={{ width: `${pct}%` }} />
                      </div>
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
