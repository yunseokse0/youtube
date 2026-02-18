"use client";
import { useEffect, useState } from "react";
import { ForbidEvent, FORBID_EVENTS_KEY, loadForbidEvents } from "@/lib/state";

export default function AlertsPage() {
  const [events, setEvents] = useState<ForbidEvent[]>([]);

  useEffect(() => {
    setEvents(loadForbidEvents());
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === FORBID_EVENTS_KEY && e.newValue) {
        try {
          const arr = JSON.parse(e.newValue) as ForbidEvent[];
          setEvents(arr);
        } catch {}
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return (
    <main className="min-h-screen p-6">
      <div className="max-w-3xl mx-auto space-y-3">
        <h1 className="text-2xl font-extrabold text-red-400">금지어 알림</h1>
        <div className="space-y-2">
          {events.length === 0 && <div className="text-neutral-400">아직 알림이 없습니다.</div>}
          {events.map((ev, i) => (
            <div key={i} className="p-3 rounded border border-red-500/40 bg-red-950/40">
              <div className="text-xs text-neutral-300">{new Date(ev.at).toLocaleString()}</div>
              <div className="font-semibold text-red-300">금칙어: {ev.word}</div>
              <div className="text-sm"><span className="text-emerald-300">{ev.author}</span>: {ev.message}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
