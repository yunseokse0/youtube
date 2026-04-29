"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, animate, motion, useMotionValue } from "framer-motion";
import type { AnimationPlaybackControls } from "framer-motion";
import { Howl } from "howler";
import type { SigItem } from "@/types";
import { SOUND_ASSETS_ENABLED, SPIN_SOUND_PATHS } from "@/lib/sig-roulette";

type RouletteWheelProps = {
  items: SigItem[];
  isRolling: boolean;
  resultId: string | null;
  startedAt: number;
  volume?: number;
  muted?: boolean;
  onTransitionEnd?: () => void;
  onLanded?: (resultId?: string | null) => void;
};

const COLORS = ["#fb7185", "#f59e0b", "#22d3ee", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#60a5fa"];
const SPIN_DURATION_SCALE = 1.3;

export default function RouletteWheel({ items, isRolling, resultId, startedAt, volume = 0.7, muted = false, onTransitionEnd, onLanded }: RouletteWheelProps) {
  const rotate = useMotionValue(0);
  const [currentAngle, setCurrentAngle] = useState(0);
  const [winnerIndex, setWinnerIndex] = useState(-1);
  const hasLandedRef = useRef(false);
  const animationRef = useRef<AnimationPlaybackControls | null>(null);
  const activeSpinKeyRef = useRef("");
  const itemsRef = useRef<SigItem[]>(items);
  const onLandedRef = useRef<RouletteWheelProps["onLanded"]>(onLanded);
  const onTransitionEndRef = useRef<RouletteWheelProps["onTransitionEnd"]>(onTransitionEnd);
  const [sounds, setSounds] = useState<{ tick: Howl; final: Howl; success: Howl } | null>(null);
  const hasSoundAssetErrorRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playFallbackTone = (freq: number, durationMs: number, gain = 0.03) => {
    if (muted) return;
    if (typeof window === "undefined") return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new Ctx();
      audioCtxRef.current = ctx;
    }
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.value = Math.max(0.001, Math.min(0.08, gain * volume));
    osc.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.stop(now + durationMs / 1000);
  };

  const segmentCount = Math.max(1, items.length);
  const segment = 360 / segmentCount;
  const gradient = useMemo(() => {
    const stops = items.map((_, i) => {
      const from = i * segment;
      const to = (i + 1) * segment;
      return `${COLORS[i % COLORS.length]} ${from}deg ${to}deg`;
    });
    return `conic-gradient(${stops.join(",")})`;
  }, [items, segment]);

  useEffect(() => {
    if (!SOUND_ASSETS_ENABLED) {
      setSounds(null);
      return;
    }
    const tick = new Howl({
      src: [SPIN_SOUND_PATHS.tick],
      loop: true,
      volume,
      preload: true,
      mute: muted,
      onloaderror: () => {
        hasSoundAssetErrorRef.current = true;
      },
      onplayerror: () => {
        hasSoundAssetErrorRef.current = true;
      },
    });
    const final = new Howl({
      src: [SPIN_SOUND_PATHS.final],
      loop: false,
      volume,
      preload: true,
      mute: muted,
      onloaderror: () => {
        hasSoundAssetErrorRef.current = true;
      },
      onplayerror: () => {
        hasSoundAssetErrorRef.current = true;
      },
    });
    const success = new Howl({
      src: [SPIN_SOUND_PATHS.success],
      loop: false,
      volume,
      preload: true,
      mute: muted,
      onloaderror: () => {
        hasSoundAssetErrorRef.current = true;
      },
      onplayerror: () => {
        hasSoundAssetErrorRef.current = true;
      },
    });
    setSounds({ tick, final, success });
    return () => {
      tick.unload();
      final.unload();
      success.unload();
      try { audioCtxRef.current?.close(); } catch {}
      audioCtxRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sounds) return;
    sounds.tick.volume(volume);
    sounds.final.volume(volume);
    sounds.success.volume(volume);
    sounds.tick.mute(muted);
    sounds.final.mute(muted);
    sounds.success.mute(muted);
  }, [sounds, volume, muted]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    onLandedRef.current = onLanded;
  }, [onLanded]);

  useEffect(() => {
    onTransitionEndRef.current = onTransitionEnd;
  }, [onTransitionEnd]);

  useEffect(() => {
    const unsub = rotate.on("change", (v) => {
      const normalized = ((v % 360) + 360) % 360;
      setCurrentAngle(normalized);
    });
    return () => unsub();
  }, [rotate]);

  const calculateFinalAngle = (targetId: string | null, count: number, currentBase: number, minTurns: number) => {
    if (!targetId || !items.length) return currentBase + Math.max(1, minTurns) * 360;
    const idx = Math.max(0, items.findIndex((x) => x.id === targetId));
    const seg = 360 / Math.max(1, count);
    const targetCenter = idx * seg + seg / 2;
    const normalizedTarget = ((360 - targetCenter) % 360 + 360) % 360;
    const currentNorm = ((currentBase % 360) + 360) % 360;
    const deltaToTarget = ((normalizedTarget - currentNorm) % 360 + 360) % 360;
    return currentBase + minTurns * 360 + deltaToTarget;
  };

  const stopAllAnimations = () => {
    animationRef.current?.stop();
    animationRef.current = null;
  };
  const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
  const runTickTrack = async (
    durationMs: number,
    startIntervalMs: number,
    endIntervalMs: number,
    isCancelled: () => boolean,
    tickSound: Howl | null
  ) => {
    if (!tickSound || durationMs <= 0) return;
    const startedAt = Date.now();
    while (!isCancelled()) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= durationMs) break;
      const p = Math.min(1, elapsed / durationMs);
      const currentInterval = Math.max(36, Math.round(startIntervalMs + (endIntervalMs - startIntervalMs) * p));
      if (tickSound && !hasSoundAssetErrorRef.current) {
        tickSound.stop();
        tickSound.play();
      } else {
        playFallbackTone(760, 42, 0.02);
      }
      await sleep(currentInterval);
    }
  };
  const runAnimation = (
    to: number | number[],
    options: { duration: number; ease?: unknown; repeat?: number; repeatType?: "reverse" | "loop" | "mirror" }
  ) =>
    new Promise<void>((resolve) => {
      const controls = animate(rotate, to as never, {
        ...options,
        onComplete: () => resolve(),
      } as never);
      animationRef.current = controls;
    });

  useEffect(() => {
    const spinKey = `${startedAt || 0}:${resultId || "none"}`;

    if (!isRolling || !startedAt) {
      hasLandedRef.current = false;
      activeSpinKeyRef.current = "";
      stopAllAnimations();
      sounds?.tick.stop();
      sounds?.final.stop();
      return;
    }

    const spinItems = itemsRef.current;
    if (!spinItems.length) return;
    if (activeSpinKeyRef.current === spinKey) return;
    activeSpinKeyRef.current = spinKey;

    const idx = Math.max(0, spinItems.findIndex((x) => x.id === resultId));
    setWinnerIndex(idx);
    hasLandedRef.current = false;
    stopAllAnimations();

    console.log("[Wheel] STARTING ANIMATION", { isRolling, startedAt, resultId });

    let cancelled = false;
    sounds?.tick.stop();
    sounds?.final.stop();

    const runSequence = async () => {
      try {
        const currentRotate = rotate.get();
        const accelTarget = currentRotate + 460;
        const cruiseTarget = currentRotate + 1240;

        // 1) 가속: 서서히 속도를 올리는 구간
        await Promise.all([
          runAnimation(accelTarget, { duration: 0.95 * SPIN_DURATION_SCALE, ease: [0.42, 0, 1, 1] }),
          runTickTrack(0.95 * SPIN_DURATION_SCALE * 1000, 125, 62, () => cancelled, sounds?.tick || null),
        ]);
        if (cancelled) return;

        // 2) 고속 유지: 일정한 최고속으로 회전
        await Promise.all([
          runAnimation(cruiseTarget, { duration: 1.15 * SPIN_DURATION_SCALE, ease: "linear" }),
          runTickTrack(1.15 * SPIN_DURATION_SCALE * 1000, 58, 58, () => cancelled, sounds?.tick || null),
        ]);
        if (cancelled) return;

        // 3) 감속 착지: 서서히 감속하며 목표 위치로 자연스럽게 정지
        const target = calculateFinalAngle(resultId, Math.max(1, spinItems.length), cruiseTarget, 1);
        await Promise.all([
          runAnimation(target, {
            duration: 2.9 * SPIN_DURATION_SCALE,
            ease: [0.05, 0.9, 0.18, 1.0],
          }),
          runTickTrack(2.9 * SPIN_DURATION_SCALE * 1000, 72, 190, () => cancelled, sounds?.tick || null),
        ]);
        if (cancelled) return;

        // 4) 착지 후 고정(역동작 없이 바로 정지)
        await runAnimation(target, {
          duration: 0.1 * SPIN_DURATION_SCALE,
          ease: "linear",
        });
        if (cancelled) return;
        onTransitionEndRef.current?.();

        sounds?.tick.stop();
        sounds?.success.stop();
        if (sounds?.success && !hasSoundAssetErrorRef.current) {
          sounds.success.play();
        } else {
          playFallbackTone(880, 120, 0.04);
          window.setTimeout(() => playFallbackTone(1170, 150, 0.04), 110);
        }
        if (!hasLandedRef.current) {
          hasLandedRef.current = true;
          console.log("[Wheel] LANDED CALL", resultId);
          onLandedRef.current?.(resultId);
        }
      } catch {
        // 예외가 나도 다음 회차 시작이 막히지 않도록 사운드만 정리
        sounds?.tick.stop();
        sounds?.final.stop();
      }
    };

    void runSequence();

    return () => {
      cancelled = true;
      stopAllAnimations();
      sounds?.tick.stop();
      sounds?.final.stop();
    };
  }, [isRolling, startedAt, resultId, rotate, sounds]);

  const particles = useMemo(
    () =>
      Array.from({ length: 30 }).map((_, i) => ({
        id: i,
        left: 5 + ((i * 29) % 90),
        delay: (i % 11) * 0.07,
        size: 2 + (i % 4),
      })),
    []
  );

  return (
    <div className="relative mx-auto h-[520px] w-full max-w-[980px] overflow-hidden bg-transparent">
      <AnimatePresence>
        {isRolling ? (
          <motion.div className="pointer-events-none absolute inset-0 z-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {particles.map((p) => (
              <motion.span
                key={p.id}
                className="absolute rounded-full bg-yellow-200"
                style={{ left: `${p.left}%`, bottom: "-10%", width: p.size, height: p.size }}
                animate={{ y: [0, -360], opacity: [0, 1, 0], x: [0, p.id % 2 ? 14 : -14, 0] }}
                transition={{ duration: 1.1 + (p.id % 5) * 0.25, repeat: Infinity, delay: p.delay }}
              />
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 text-5xl text-pink-500 drop-shadow-[0_0_12px_rgba(236,72,153,0.95)]">
        ▼
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <motion.div
          className="relative h-[420px] w-[420px] rounded-full border-8 border-yellow-300 shadow-[0_0_45px_rgba(251,191,36,0.38)]"
          style={{ rotate, background: gradient }}
        >
          {items.map((item, idx) => {
            const angle = idx * segment;
            const isWin = idx === winnerIndex && !isRolling;
            return (
              <div key={`${item.id}-${idx}`} className="absolute left-1/2 top-1/2 h-0 w-0" style={{ transform: `rotate(${angle}deg) translateY(-148px)` }}>
                {isWin ? (
                  <motion.div
                    className="absolute left-1/2 top-1/2 h-14 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-yellow-200/85 bg-pink-500/35"
                    animate={{ opacity: [0.35, 0.95, 0.45], scale: [1, 1.1, 1.03] }}
                    transition={{ duration: 1.1, repeat: Infinity }}
                  />
                ) : null}
                <motion.div
                  className={`relative z-10 w-24 -translate-x-1/2 -translate-y-1/2 text-center text-xs font-black ${isWin ? "text-pink-100" : "text-white"}`}
                  style={{ transform: `rotate(${-angle - currentAngle}deg)` }}
                  animate={isWin ? { scale: [1, 1.14, 1], textShadow: ["0 0 4px #000", "0 0 16px #ec4899", "0 0 4px #000"] } : {}}
                  transition={{ duration: 1.2, repeat: isWin ? Infinity : 0 }}
                >
                  {item.name}
                </motion.div>
              </div>
            );
          })}
          <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-yellow-300 bg-black/60" />
        </motion.div>
      </div>
    </div>
  );
}
