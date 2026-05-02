"use client";
import { useEffect, useRef, useState } from "react";

export default function Toast() {
  const [msg, setMsg] = useState<string | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onForbidden = (e: Event) => {
      const ce = e as CustomEvent<{ text: string; durationMs?: number }>;
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setMsg(ce.detail.text);
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        g.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.7);
        o.stop(ctx.currentTime + 0.7);
      } catch {
        // ignore audio errors
      }
      const ms = Math.min(60000, Math.max(1200, ce.detail.durationMs ?? 2500));
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        setMsg(null);
      }, ms);
    };
    window.addEventListener("forbidden-alert", onForbidden as EventListener);
    return () => {
      window.removeEventListener("forbidden-alert", onForbidden as EventListener);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, []);

  if (!msg) return null;
  return (
    <div className="fixed top-4 right-4 z-50 max-w-[min(92vw,420px)]">
      <div className="rounded bg-red-600 px-4 py-3 text-sm font-semibold leading-snug text-white shadow-lg">{msg}</div>
    </div>
  );
}
