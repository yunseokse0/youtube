"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppState, STORAGE_KEY, defaultState, loadState, totalAccount, Member, roundToThousand } from "@/lib/state";

function useStorageState(): AppState {
  const [s, setS] = useState<AppState>(defaultState());
  useEffect(() => setS(loadState()), []);
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try { setS(JSON.parse(e.newValue)); } catch {}
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);
  return s;
}

function useCountUp(value: number, durationMs = 600) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);
  const fromRef = useRef<number>(value);

  useEffect(() => {
    const from = display;
    const to = value;
    fromRef.current = from;
    startRef.current = performance.now();
    const loop = (t: number) => {
      const elapsed = t - startRef.current;
      const p = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(from + (to - from) * eased));
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

function OverlayInner() {
  const s = useStorageState();
  const sum = useMemo(() => totalAccount(s), [s]);
  const rounded = useMemo(() => roundToThousand(sum), [sum]);
  const displaySum = useCountUp(rounded, 800);
  const sp = useSearchParams();
  const scale = Math.max(0.3, Math.min(3, parseFloat(sp.get("scale") || "1")));
  const memberSize = Math.max(10, Math.min(80, parseInt(sp.get("memberSize") || "24", 10)));
  const totalSize = Math.max(14, Math.min(160, parseInt(sp.get("totalSize") || "64", 10)));
  const dense = (sp.get("dense") || "false").toLowerCase() === "true";
  const anchor = (sp.get("anchor") || "tl").toLowerCase();
  const sumAnchor = (sp.get("sumAnchor") || "bc").toLowerCase();

  useEffect(() => {
    const prev = document.body.style.background;
    const prevHtml = document.documentElement.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => { document.body.style.background = prev; };
  }, []);

  const listPosClass =
    anchor === "tr" ? "top-4 right-4 items-end text-right" :
    anchor === "bl" ? "bottom-4 left-4" :
    anchor === "br" ? "bottom-4 right-4 items-end text-right" :
    "top-4 left-4";
  const sumPosClass =
    sumAnchor === "tc" ? "top-4 left-1/2 -translate-x-1/2" :
    sumAnchor === "bl" ? "bottom-4 left-4 translate-x-0" :
    sumAnchor === "br" ? "bottom-4 right-4 translate-x-0" :
    sumAnchor === "tr" ? "top-4 right-4 translate-x-0" :
    "bottom-4 left-1/2 -translate-x-1/2";

  return (
    <main className="transparent-bg min-h-screen text-outline-strong no-select" style={{ zoom: scale }}>
      <div className={`fixed ${listPosClass} space-y-2`}>
        {s.members.map((m: Member) => (
          <div key={m.id} className="font-bold tracking-tight" style={{ fontSize: memberSize, lineHeight: dense ? 1 : 1.15 }}>
            <span className="text-white">{m.name}</span>
            <span className="ml-2 text-emerald-300">{m.account}</span>
            <span className="ml-1 text-neutral-200">({m.toon})</span>
          </div>
        ))}
      </div>
      <div className={`fixed ${sumPosClass}`}>
        <div
          className="font-extrabold text-amber-200 drop-shadow-[0_0_6px_rgba(0,0,0,1)]"
          style={{ fontSize: totalSize, lineHeight: 1.05 }}
        >
          계좌 총합 {displaySum.toLocaleString()}
        </div>
      </div>
    </main>
  );
}

export default function OverlayPage() {
  return (
    <Suspense>
      <OverlayInner />
    </Suspense>
  );
}
