"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, useMotionValue } from "framer-motion";
import type { SigItem } from "@/types";

type RouletteProps = {
  items: SigItem[];
  isRolling: boolean;
  resultId?: string;
  spinDurationSec?: number;
  startedAt?: number;
  onAnimationComplete?: () => void;
};

const SEGMENT_COLORS = [
  "#fde68a",
  "#fbcfe8",
  "#bfdbfe",
  "#bbf7d0",
  "#fecaca",
  "#ddd6fe",
];

export default function Roulette({
  items,
  isRolling,
  resultId,
  spinDurationSec = 5,
  startedAt,
  onAnimationComplete,
}: RouletteProps) {
  const wheelRotate = useMotionValue(0);
  const [targetAngle, setTargetAngle] = useState(0);
  const [currentAngle, setCurrentAngle] = useState(0);
  const particles = useMemo(
    () =>
      Array.from({ length: 26 }).map((_, i) => {
        const seed = i + 1;
        return {
          id: `pt-${i}`,
          left: 8 + ((seed * 37) % 84),
          size: 3 + (seed % 5),
          delay: (seed % 9) * 0.08,
          duration: 0.7 + (seed % 5) * 0.22,
          hue: 36 + (seed % 4) * 16,
        };
      }),
    []
  );

  const segment = 360 / Math.max(1, items.length);
  const gradient = useMemo(() => {
    if (!items.length) return "conic-gradient(#ffffff 0deg, #f9a8d4 360deg)";
    const steps: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const from = i * segment;
      const to = (i + 1) * segment;
      const color = SEGMENT_COLORS[i % SEGMENT_COLORS.length]!;
      steps.push(`${color} ${from}deg ${to}deg`);
    }
    return `conic-gradient(${steps.join(", ")})`;
  }, [items, segment]);

  useEffect(() => {
    const unsub = wheelRotate.on("change", (v) => {
      const normalized = ((v % 360) + 360) % 360;
      setCurrentAngle(normalized);
    });
    return () => unsub();
  }, [wheelRotate]);

  useEffect(() => {
    if (!isRolling || !items.length || !resultId) return;
    const winnerIndex = Math.max(0, items.findIndex((x) => x.id === resultId));
    const spins = 7;
    // Align winner to the segment center at the top pointer.
    const end = spins * 360 - (winnerIndex * segment + segment / 2);
    setTargetAngle(end);
  }, [isRolling, items, resultId, segment, startedAt]);

  return (
    <div className="relative h-[420px] w-full max-w-[900px] overflow-hidden rounded-2xl bg-transparent">
      {isRolling ? (
        <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
          {particles.map((p) => (
            <motion.span
              key={p.id}
              className="absolute rounded-full"
              style={{
                left: `${p.left}%`,
                bottom: "-8%",
                width: p.size,
                height: p.size,
                background: `hsla(${p.hue}, 95%, 72%, 0.95)`,
                boxShadow: `0 0 ${p.size * 2}px hsla(${p.hue}, 95%, 70%, 0.85)`,
              }}
              initial={{ opacity: 0, y: 0, x: 0, scale: 0.7 }}
              animate={{
                opacity: [0, 0.95, 0],
                y: [-2, -250],
                x: [0, (p.left % 2 === 0 ? 16 : -16), 0],
                scale: [0.7, 1.15, 0.6],
              }}
              transition={{
                duration: p.duration,
                delay: p.delay,
                repeat: Infinity,
                ease: "easeOut",
              }}
            />
          ))}
        </div>
      ) : null}
      <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2">
        <div className="text-4xl leading-none text-rose-400 drop-shadow-[0_0_10px_rgba(251,113,133,0.95)] animate-pulse">
          ▼
        </div>
      </div>
      <div className="absolute inset-0 grid place-items-center">
        <motion.div
          className="relative h-[360px] w-[360px] rounded-full border-8 border-[#D4AF37] shadow-[0_0_24px_rgba(212,175,55,0.45)]"
          style={{ rotate: wheelRotate, background: gradient }}
          animate={{ rotate: isRolling ? targetAngle : wheelRotate.get() }}
          transition={{ duration: spinDurationSec, type: "spring", damping: 15 }}
          onAnimationComplete={() => {
            if (isRolling) onAnimationComplete?.();
          }}
        >
          {items.map((item, idx) => {
            const angle = idx * segment;
            return (
              <div
                key={`r-item-${item.id}-${idx}`}
                className="absolute left-1/2 top-1/2 h-0 w-0"
                style={{ transform: `rotate(${angle}deg) translateY(-122px)` }}
              >
                <div
                  className="relative flex w-24 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1"
                  style={{ transform: `rotate(${-angle - currentAngle}deg)` }}
                >
                  <div
                    className="max-w-[96px] px-1 text-center text-[11px] font-black text-rose-700"
                    style={{
                      textShadow:
                        "-1px -1px 0 rgba(255,255,255,0.92),1px -1px 0 rgba(255,255,255,0.92),-1px 1px 0 rgba(255,255,255,0.92),1px 1px 0 rgba(255,255,255,0.92)",
                    }}
                  >
                    {item.name}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-[#D4AF37] bg-white/75 shadow-[0_0_14px_rgba(212,175,55,0.4)]" />
        </motion.div>
      </div>
    </div>
  );
}

