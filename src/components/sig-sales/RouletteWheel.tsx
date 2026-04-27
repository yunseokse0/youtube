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
  onLanded?: (resultId?: string | null) => void;
};

const COLORS = ["#fb7185", "#f59e0b", "#22d3ee", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#60a5fa"];

export default function RouletteWheel({ items, isRolling, resultId, startedAt, volume = 0.7, muted = false, onLanded }: RouletteWheelProps) {
  const rotate = useMotionValue(0);
  const [currentAngle, setCurrentAngle] = useState(0);
  const [winnerIndex, setWinnerIndex] = useState(-1);
  const hasLandedRef = useRef(false);
  const animationRef = useRef<AnimationPlaybackControls | null>(null);
  const activeSpinKeyRef = useRef("");
  const itemsRef = useRef<SigItem[]>(items);
  const onLandedRef = useRef<RouletteWheelProps["onLanded"]>(onLanded);
  const [sounds, setSounds] = useState<{ tick: Howl; final: Howl; success: Howl } | null>(null);

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
    const tick = new Howl({ src: [SPIN_SOUND_PATHS.tick], loop: true, volume, preload: true, mute: muted });
    const final = new Howl({ src: [SPIN_SOUND_PATHS.final], loop: false, volume, preload: true, mute: muted });
    const success = new Howl({ src: [SPIN_SOUND_PATHS.success], loop: false, volume, preload: true, mute: muted });
    setSounds({ tick, final, success });
    return () => {
      tick.unload();
      final.unload();
      success.unload();
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
    const unsub = rotate.on("change", (v) => {
      const normalized = ((v % 360) + 360) % 360;
      setCurrentAngle(normalized);
    });
    return () => unsub();
  }, [rotate]);

  const calculateFinalAngle = (targetId: string | null, count: number) => {
    if (!targetId || !items.length) return rotate.get() + 360;
    const idx = Math.max(0, items.findIndex((x) => x.id === targetId));
    const targetCenter = idx * (360 / Math.max(1, count)) + 360 / Math.max(1, count) / 2;
    const normalizedTarget = ((360 - targetCenter) % 360 + 360) % 360;
    const current = rotate.get();
    const currentNorm = ((current % 360) + 360) % 360;
    const deltaToTarget = ((normalizedTarget - currentNorm) % 360 + 360) % 360;
    // Always include extra turns so every spin is visibly long.
    return current + 4 * 360 + deltaToTarget;
  };

  const stopAllAnimations = () => {
    animationRef.current?.stop();
    animationRef.current = null;
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
    sounds?.tick.play();

    const runSequence = async () => {
      try {
        const currentRotate = rotate.get();
        const burstTarget = currentRotate + 720;
        const phase1Target = currentRotate + 2040;

        // 1-1) 짧은 급가속: 첫 구간이 가장 빠르게 체감되지만 튀지 않게 완화
        await runAnimation(burstTarget, { duration: 0.52, ease: [0.16, 0.95, 0.3, 1] });
        if (cancelled) return;

        // 1-2) 안정 고속 구간: 일정 속도로 회전하여 체감 안정화
        await runAnimation(phase1Target, { duration: 2.25, ease: "linear" });
        if (cancelled) return;

        // 2) 감속 착지 (2.05s): 급브레이크 느낌을 줄이고 자연스럽게 감속
        const target = calculateFinalAngle(resultId, Math.max(1, spinItems.length));
        sounds?.final.stop();
        sounds?.final.play();
        await runAnimation(target, {
          duration: 2.05,
          ease: [0.2, 0.9, 0.28, 1.0],
        });
        if (cancelled) return;

        // 3) 착지 직전 미세 wobble
        await runAnimation(target + 8, {
          duration: 0.2,
          repeat: 1,
          repeatType: "reverse",
          ease: "easeInOut",
        });
        if (cancelled) return;

        sounds?.tick.stop();
        sounds?.success.stop();
        sounds?.success.play();
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
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.16),transparent_58%)]" />
            <div className="absolute inset-y-0 left-1/2 w-28 -translate-x-1/2 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.25),transparent)] blur-xl" />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2 text-5xl text-amber-300 drop-shadow-[0_0_10px_rgba(251,191,36,0.9)]">
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
                <motion.div
                  className={`w-24 -translate-x-1/2 -translate-y-1/2 text-center text-xs font-black ${isWin ? "text-yellow-200" : "text-white"}`}
                  style={{ transform: `rotate(${-angle - currentAngle}deg)` }}
                  animate={isWin ? { scale: [1, 1.08, 1], textShadow: ["0 0 4px #000", "0 0 14px #facc15", "0 0 4px #000"] } : {}}
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
