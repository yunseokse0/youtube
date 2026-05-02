"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  scalePct?: number;
  volume?: number;
  muted?: boolean;
  onTransitionEnd?: () => void;
  onLanded?: (resultId?: string | null) => void;
};

const COLORS = [
  "#fb7185", "#f59e0b", "#22d3ee", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#60a5fa",
  "#ef4444", "#84cc16", "#06b6d4", "#818cf8", "#e879f9", "#fdba74", "#5eead4", "#fca5a5",
  "#93c5fd", "#f9a8d4", "#bef264", "#fcd34d",
];
const SPIN_DURATION_SCALE = 1.3;

export default function RouletteWheel({
  items,
  isRolling,
  resultId,
  startedAt,
  scalePct = 100,
  volume = 0.7,
  muted = false,
  onTransitionEnd,
  onLanded,
}: RouletteWheelProps) {
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
  const soundsRef = useRef<{ tick: Howl; final: Howl; success: Howl } | null>(null);
  const hasSoundAssetErrorRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  const playFallbackTone = useCallback((freq: number, durationMs: number, gain = 0.03) => {
    if (mutedRef.current) return;
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
    g.gain.value = Math.max(0.001, Math.min(0.08, gain * volumeRef.current));
    osc.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.stop(now + durationMs / 1000);
  }, []);

  const segmentCount = Math.max(1, items.length);
  const segment = 360 / segmentCount;
  const wheelScale = Math.max(55, Math.min(140, Math.floor(Number(scalePct) || 100))) / 100;
  const frameHeightPx = Math.round(360 * wheelScale);
  const frameMaxWidthPx = Math.round(680 * wheelScale);
  const wheelSizePx = Math.round(270 * wheelScale);
  const pointerSizePx = Math.max(28, Math.round(36 * wheelScale));
  const labelRadiusPx = Math.round(96 * wheelScale);
  const labelWidthPx = Math.max(70, Math.round(96 * wheelScale));
  const labelHeightPx = Math.max(34, Math.round(46 * wheelScale));
  const labelFontPx = Math.max(11, Math.round(13 * wheelScale));
  const centerSizePx = Math.max(36, Math.round(48 * wheelScale));
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
      preload: true,
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
      preload: true,
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
      preload: true,
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
    soundsRef.current = sounds;
    sounds.tick.volume(volume);
    sounds.final.volume(volume);
    sounds.success.volume(volume);
    sounds.tick.mute(muted);
    sounds.final.mute(muted);
    sounds.success.mute(muted);
  }, [sounds, volume, muted]);

  useEffect(() => {
    mutedRef.current = muted;
    volumeRef.current = volume;
  }, [muted, volume]);

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

  const calculateFinalAngle = useCallback((targetId: string | null, count: number, currentBase: number, minTurns: number) => {
    const currentItems = itemsRef.current;
    if (!targetId || !currentItems.length) return currentBase + Math.max(1, minTurns) * 360;
    const idx = Math.max(0, currentItems.findIndex((x) => x.id === targetId));
    const seg = 360 / Math.max(1, count);
    const targetCenter = idx * seg + seg / 2;
    const normalizedTarget = ((360 - targetCenter) % 360 + 360) % 360;
    const currentNorm = ((currentBase % 360) + 360) % 360;
    const deltaToTarget = ((normalizedTarget - currentNorm) % 360 + 360) % 360;
    return currentBase + minTurns * 360 + deltaToTarget;
  }, []);

  const stopAllAnimations = useCallback(() => {
    animationRef.current?.stop();
    animationRef.current = null;
  }, []);
  const sleep = useCallback((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)), []);
  const runTickTrack = useCallback(async (
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
      const slow = Math.max(startIntervalMs, endIntervalMs);
      const fast = Math.min(startIntervalMs, endIntervalMs);
      const speedNormRaw = slow === fast ? 1 : (slow - currentInterval) / Math.max(1, slow - fast);
      const speedNorm = Math.max(0, Math.min(1, speedNormRaw));
      const dynamicVolume = Math.max(0.02, Math.min(1, volumeRef.current * (0.35 + 0.65 * speedNorm)));
      const dynamicRate = 0.92 + speedNorm * 0.38;
      if (tickSound && !hasSoundAssetErrorRef.current) {
        tickSound.volume(dynamicVolume);
        tickSound.rate(dynamicRate);
        tickSound.stop();
        tickSound.play();
      } else {
        playFallbackTone(760, 42, 0.02);
      }
      await sleep(currentInterval);
    }
  }, [playFallbackTone, sleep]);
  const runAnimation = useCallback((
    to: number | number[],
    options: { duration: number; ease?: unknown; repeat?: number; repeatType?: "reverse" | "loop" | "mirror" }
  ) =>
    new Promise<void>((resolve) => {
      const controls = animate(rotate, to as never, {
        ...options,
        onComplete: () => resolve(),
      } as never);
      animationRef.current = controls;
    }), [rotate]);

  useEffect(() => {
    const spinKey = `${startedAt || 0}:${resultId || "none"}`;

    if (!isRolling || !startedAt) {
      hasLandedRef.current = false;
      activeSpinKeyRef.current = "";
      stopAllAnimations();
      soundsRef.current?.tick.stop();
      soundsRef.current?.final.stop();
      soundsRef.current?.success.stop();
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

    let cancelled = false;
    soundsRef.current?.tick.stop();
    soundsRef.current?.final.stop();

    const runSequence = async () => {
      try {
        const currentRotate = rotate.get();
        const accelTarget = currentRotate + 460;
        const cruiseTarget = currentRotate + 1240;

        // 1) 가속: 서서히 속도를 올리는 구간
        await Promise.all([
          runAnimation(accelTarget, { duration: 0.95 * SPIN_DURATION_SCALE, ease: [0.42, 0, 1, 1] }),
          runTickTrack(0.95 * SPIN_DURATION_SCALE * 1000, 125, 62, () => cancelled, soundsRef.current?.tick || null),
        ]);
        if (cancelled) return;

        // 2) 고속 유지: 일정한 최고속으로 회전
        await Promise.all([
          runAnimation(cruiseTarget, { duration: 1.15 * SPIN_DURATION_SCALE, ease: "linear" }),
          runTickTrack(1.15 * SPIN_DURATION_SCALE * 1000, 58, 58, () => cancelled, soundsRef.current?.tick || null),
        ]);
        if (cancelled) return;

        // 3) 감속 착지: 서서히 감속하며 목표 위치로 자연스럽게 정지
        const target = calculateFinalAngle(resultId, Math.max(1, spinItems.length), cruiseTarget, 1);
        await Promise.all([
          runAnimation(target, {
            duration: 2.9 * SPIN_DURATION_SCALE,
            ease: [0.05, 0.9, 0.18, 1.0],
          }),
          runTickTrack(2.9 * SPIN_DURATION_SCALE * 1000, 72, 190, () => cancelled, soundsRef.current?.tick || null),
        ]);
        if (cancelled) return;

        // 4) 착지 후 고정(역동작 없이 바로 정지)
        await runAnimation(target, {
          duration: 0.1 * SPIN_DURATION_SCALE,
          ease: "linear",
        });
        if (cancelled) return;
        onTransitionEndRef.current?.();

        soundsRef.current?.tick.stop();
        soundsRef.current?.success.stop();
        if (soundsRef.current?.success && !hasSoundAssetErrorRef.current) {
          soundsRef.current.success.play();
        } else {
          playFallbackTone(880, 120, 0.04);
          window.setTimeout(() => playFallbackTone(1170, 150, 0.04), 110);
        }
        if (!hasLandedRef.current) {
          hasLandedRef.current = true;
          onLandedRef.current?.(resultId);
        }
      } catch {
        // 예외가 나도 다음 회차 시작이 막히지 않도록 사운드만 정리
        soundsRef.current?.tick.stop();
        soundsRef.current?.final.stop();
        soundsRef.current?.success.stop();
      }
    };

    void runSequence();

    return () => {
      cancelled = true;
      stopAllAnimations();
      soundsRef.current?.tick.stop();
      soundsRef.current?.final.stop();
      soundsRef.current?.success.stop();
    };
  }, [isRolling, startedAt, resultId, rotate, stopAllAnimations, runAnimation, runTickTrack, calculateFinalAngle, playFallbackTone]);

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
    <div className="relative mx-auto w-full overflow-hidden bg-transparent" style={{ height: `${frameHeightPx}px`, maxWidth: `${frameMaxWidthPx}px` }}>
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
      <div
        className="pointer-events-none absolute left-1/2 top-1 z-30 -translate-x-1/2 text-pink-500 drop-shadow-[0_0_12px_rgba(236,72,153,0.95)]"
        style={{ fontSize: `${pointerSizePx}px`, lineHeight: 1 }}
      >
        ▼
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <motion.div
          className="relative rounded-full border-8 border-yellow-300 shadow-[0_0_45px_rgba(251,191,36,0.38)]"
          style={{ height: `${wheelSizePx}px`, width: `${wheelSizePx}px`, rotate, background: gradient }}
        >
          {items.map((item, idx) => {
            const angle = idx * segment;
            const isWin = idx === winnerIndex && !isRolling;
            return (
              <div key={`${item.id}-${idx}`} className="absolute left-1/2 top-1/2 h-0 w-0" style={{ transform: `rotate(${angle}deg) translateY(-${labelRadiusPx}px)` }}>
                <motion.div
                  className={`relative z-10 -translate-x-1/2 -translate-y-1/2 rounded-full px-2 py-1 text-center font-black ${
                    isWin
                      ? "border border-yellow-200/80 bg-black/65 text-yellow-100 shadow-[0_0_14px_rgba(250,204,21,0.42)]"
                      : "border border-transparent bg-transparent text-white"
                  }`}
                  style={{
                    width: `${labelWidthPx}px`,
                    minHeight: `${labelHeightPx}px`,
                    fontSize: `${labelFontPx}px`,
                    transform: `rotate(${-angle - currentAngle}deg)`,
                    lineHeight: 1.15,
                    textShadow: "0 0 2px rgba(0,0,0,0.95), 0 1px 1px rgba(0,0,0,0.95), 0 -1px 1px rgba(0,0,0,0.95), 1px 0 1px rgba(0,0,0,0.95), -1px 0 1px rgba(0,0,0,0.95)",
                    WebkitTextStroke: "0.6px rgba(0,0,0,0.92)",
                    paintOrder: "stroke fill",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    whiteSpace: "normal",
                    wordBreak: "keep-all",
                    overflowWrap: "anywhere",
                  }}
                  animate={
                    isWin
                      ? {
                          scale: [1, 1.06, 1],
                          textShadow: ["0 0 4px rgba(0,0,0,0.95)", "0 0 10px rgba(250,204,21,0.65)", "0 0 4px rgba(0,0,0,0.95)"],
                        }
                      : {}
                  }
                  transition={{ duration: 1.4, repeat: isWin ? Infinity : 0 }}
                >
                  {item.name}
                </motion.div>
              </div>
            );
          })}
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-yellow-300 bg-black/60"
            style={{ height: `${centerSizePx}px`, width: `${centerSizePx}px` }}
          />
        </motion.div>
      </div>
    </div>
  );
}
