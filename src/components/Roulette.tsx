"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion, useMotionValue } from "framer-motion";
import type { SigItem } from "@/types";
import { resolveSigImageUrl } from "@/lib/constants";

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
    <div className="relative h-[420px] w-full max-w-[900px] overflow-hidden rounded-2xl border border-pink-200 bg-white/40 backdrop-blur-md">
      <div className="pointer-events-none absolute left-1/2 top-2 z-20 -translate-x-1/2 text-4xl leading-none text-rose-400 drop-shadow-[0_0_10px_rgba(251,113,133,0.95)] animate-pulse">
        ▼
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
                  <div className="relative h-12 w-12 overflow-hidden rounded-full border border-white/80 bg-white/70 shadow">
                    <Image
                      src={resolveSigImageUrl(item.name, item.imageUrl)}
                      alt={item.name}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  </div>
                  <div
                    className="max-w-[92px] truncate text-center text-[11px] font-black text-rose-700"
                    style={{
                      textShadow:
                        "-1px -1px 0 rgba(255,255,255,0.95),1px -1px 0 rgba(255,255,255,0.95),-1px 1px 0 rgba(255,255,255,0.95),1px 1px 0 rgba(255,255,255,0.95)",
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

