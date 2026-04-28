"use client";

import { useEffect, useRef, useState } from "react";

function useCountUp(value: number, durationMs = 600) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const prevValueRef = useRef<number>(value);

  useEffect(() => {
    const from = prevValueRef.current;
    const to = value;
    prevValueRef.current = to;
    startRef.current = performance.now();
    const loop = (t: number) => {
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round((from + (to - from) * eased) * 10) / 10);
      if (p < 1) rafRef.current = requestAnimationFrame(loop);
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return display;
}

export function GoalBar({
  current,
  goal,
  label,
  width,
  compactLabel = false,
  opacityPercent = 100,
  opacityAffectsText = false,
}: {
  current: number;
  goal: number;
  label: string;
  width: number;
  compactLabel?: boolean;
  opacityPercent?: number;
  opacityAffectsText?: boolean;
}) {
  const pct = goal > 0 ? Math.min(100, (current / goal) * 100) : 0;
  const displayPct = useCountUp(Math.round(pct * 10) / 10, 600);
  const barH = Math.max(26, Math.round(width * 0.055));
  const normalizedLabel = (() => {
    const raw = (label || "").trim();
    if (!raw) return "후원";
    const compact = raw.replace(/\s+/g, "");
    if (compact.includes("목표")) return "후원";
    return raw;
  })();
  const toMan = (n: number) =>
    `${(Math.max(0, n) / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 })}만원`;
  const fillOpacity = Math.max(0, Math.min(100, opacityPercent)) / 100;
  const containerOpacity = opacityAffectsText ? fillOpacity : 1;
  const barFillOpacity = opacityAffectsText ? 1 : fillOpacity;
  const goalTextOutline =
    "-1px -1px 0 rgba(6, 12, 24, 0.95), 1px -1px 0 rgba(6, 12, 24, 0.95), -1px 1px 0 rgba(6, 12, 24, 0.95), 1px 1px 0 rgba(6, 12, 24, 0.95), 0 2px 6px rgba(0,0,0,0.42)";

  return (
    <div style={{ width, padding: "0.12rem", borderRadius: 8, border: "1px solid rgba(255, 215, 232, 0.9)", opacity: containerOpacity }}>
      <div className="relative overflow-hidden" style={{ height: barH, borderRadius: 7, background: "transparent" }}>
        <div
          className="h-full transition-all duration-700 ease-out"
          style={{
            width: `${pct}%`,
            borderRadius: 7,
            opacity: barFillOpacity,
            background: "linear-gradient(90deg, rgba(255, 199, 220, 0.98) 0%, rgba(255, 166, 201, 0.98) 45%, rgba(255, 214, 231, 0.98) 100%)",
            boxShadow: "0 0 8px rgba(255, 182, 213, 0.42), inset 0 1px 0 rgba(255,255,255,0.35)",
          }}
        />
        <div className="absolute inset-0 flex items-center justify-between px-2" style={{ fontSize: Math.max(12, width * 0.028), letterSpacing: "-0.01em" }}>
          <span
            className="inline-flex items-center"
            style={{
              color: "#fff7fb",
              fontWeight: 900,
              textShadow: goalTextOutline,
              lineHeight: 1,
            }}
          >
            {normalizedLabel}
          </span>
          <span style={{ color: "#fff7fb", fontWeight: 700, textShadow: goalTextOutline, lineHeight: 1 }}>
            {compactLabel ? "후원 " : ""}
            {toMan(current)} / {toMan(goal)}{" "}
            <span style={{ color: pct <= 0 ? "#e5e7eb" : "#fff7fb" }}>({displayPct}%)</span>
          </span>
        </div>
      </div>
    </div>
  );
}
