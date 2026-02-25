"use client";
import { useEffect, useState } from "react";

export default function Toast() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const onForbidden = (e: Event) => {
      const ce = e as CustomEvent<{ text: string }>;
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
      const t = setTimeout(() => setMsg(null), 2000);
      return () => clearTimeout(t);
    };
    window.addEventListener("forbidden-alert", onForbidden as EventListener);
    return () => window.removeEventListener("forbidden-alert", onForbidden as EventListener);
  }, []);

  if (!msg) return null;
  return (
    <div className="fixed top-4 right-4 z-50">
      <div className="px-4 py-3 rounded bg-red-600 text-white font-semibold shadow-lg">
        {msg}
      </div>
    </div>
  );
}

