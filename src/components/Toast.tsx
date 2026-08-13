"use client";
import { useEffect, useRef, useState } from "react";
import type { AppToastVariant } from "@/lib/app-toast";

type ToastDetail = { text: string; durationMs?: number; variant?: AppToastVariant };

export default function Toast() {
  const [msg, setMsg] = useState<string | null>(null);
  const [variant, setVariant] = useState<AppToastVariant>("error");
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const show = (detail: ToastDetail, fallbackVariant: AppToastVariant) => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      const nextVariant = detail.variant ?? fallbackVariant;
      setVariant(nextVariant);
      setMsg(detail.text);
      if (nextVariant === "error") {
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
      }
      const defaultMs = nextVariant === "error" ? 2500 : 3200;
      const ms = Math.min(60000, Math.max(1200, detail.durationMs ?? defaultMs));
      hideTimerRef.current = setTimeout(() => {
        hideTimerRef.current = null;
        setMsg(null);
      }, ms);
    };

    const onForbidden = (e: Event) => {
      const ce = e as CustomEvent<ToastDetail>;
      show(ce.detail, "error");
    };
    const onAppToast = (e: Event) => {
      const ce = e as CustomEvent<ToastDetail>;
      show(ce.detail, "success");
    };

    window.addEventListener("forbidden-alert", onForbidden as EventListener);
    window.addEventListener("app-toast", onAppToast as EventListener);
    return () => {
      window.removeEventListener("forbidden-alert", onForbidden as EventListener);
      window.removeEventListener("app-toast", onAppToast as EventListener);
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, []);

  if (!msg) return null;

  const tone =
    variant === "error"
      ? "bg-red-600 text-white"
      : variant === "info"
        ? "bg-sky-700 text-white"
        : "bg-emerald-700 text-white";

  return (
    <div className="fixed top-4 right-4 z-50 max-w-[min(92vw,420px)]">
      <div className={`rounded px-4 py-3 text-sm font-semibold leading-snug shadow-lg ${tone}`}>
        {msg}
      </div>
    </div>
  );
}
