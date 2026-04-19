"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import { defaultState, loadState, loadStateFromApi, storageKey, type AppState } from "@/lib/state";

type DonorRow = {
  name: string;
  amount: number;
};

function useRemoteState(userId?: string): { state: AppState | null; ready: boolean } {
  const [state, setState] = useState<AppState | null>(null);
  const lastUpdatedRef = useRef(0);
  const syncingRef = useRef(false);

  const readLocalStateIfExists = useCallback((): AppState | null => {
    if (typeof window === "undefined") return null;
    try {
      const key = storageKey(userId);
      const raw = window.localStorage.getItem(key);
      if (!raw) return null;
      return loadState(userId ?? undefined);
    } catch {
      return null;
    }
  }, [userId]);

  useEffect(() => {
    const local = readLocalStateIfExists();
    if (local) {
      setState(local);
      lastUpdatedRef.current = local.updatedAt || 0;
    } else {
      const fallback = defaultState();
      setState(fallback);
      lastUpdatedRef.current = fallback.updatedAt || 0;
    }

    const syncFromApi = async () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      try {
        const remote = await loadStateFromApi(userId);
        if (!remote) return;
        const remoteUpdatedAt = remote.updatedAt || 0;
        if (remoteUpdatedAt >= lastUpdatedRef.current) {
          lastUpdatedRef.current = remoteUpdatedAt;
          setState(remote);
        }
      } finally {
        syncingRef.current = false;
      }
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key !== storageKey(userId ?? undefined)) return;
      const localNow = readLocalStateIfExists();
      if (!localNow) return;
      const localUpdatedAt = localNow.updatedAt || 0;
      if (localUpdatedAt >= lastUpdatedRef.current) {
        lastUpdatedRef.current = localUpdatedAt;
        setState(localNow);
      }
    };

    const timer = window.setInterval(() => {
      void syncFromApi();
    }, 3000);

    window.addEventListener("storage", onStorage);
    void syncFromApi();
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [readLocalStateIfExists, userId]);

  return { state, ready: state !== null };
}

function normalizeTarget(donor: Record<string, unknown>): "account" | "toon" {
  const rawType = String(donor.type || "").trim();
  if (rawType === "계좌") return "account";
  if (rawType === "투네이션") return "toon";

  const rawTarget = String(donor.target || "").trim().toLowerCase();
  if (rawTarget === "toon") return "toon";
  return "account";
}

function aggregateTop5(rows: Array<{ name: string; amount: number }>): DonorRow[] {
  const byName = new Map<string, number>();
  for (const row of rows) {
    const key = row.name.trim() || "무명";
    byName.set(key, (byName.get(key) || 0) + Math.max(0, row.amount || 0));
  }
  return Array.from(byName.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
}

function DonationColumn({
  title,
  titleClass,
  items,
  suffix,
}: {
  title: string;
  titleClass: string;
  items: DonorRow[];
  suffix?: string;
}) {
  return (
    <section className="glass-pastel-card w-full max-w-[520px] overflow-hidden rounded-2xl">
      <div className={`px-4 py-3 text-lg font-bold tracking-wide pastel-text-outline ${titleClass}`}>{title}</div>
      <div className="space-y-2 p-3">
        <AnimatePresence initial={false}>
          {items.map((item, idx) => (
            <motion.div
              key={item.name}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
              className={`grid grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-2 rounded-2xl px-3 py-2.5 text-pastel-ink pastel-text-outline ${
                idx % 2 === 0 ? "bg-pastel-blue/35" : "bg-pastel-yellow/30"
              }`}
            >
              <span className="text-center font-bold text-pastel-ink/80">{idx + 1}</span>
              <span className="truncate font-semibold">{item.name}</span>
              <span className="font-extrabold tabular-nums">
                {item.amount.toLocaleString("ko-KR")}
                {suffix ? ` ${suffix}` : ""}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {items.length === 0 && (
          <div className="rounded-2xl bg-pastel-green/30 px-3 py-6 text-center text-pastel-ink/75 pastel-text-outline">
            데이터 없음
          </div>
        )}
      </div>
    </section>
  );
}

export default function DonationListsOverlayPage() {
  const sp = useSearchParams();
  const userId = sp.get("u") || "finalent";
  const { state, ready } = useRemoteState(userId);

  const { accountTop5, toonTop5 } = useMemo(() => {
    const donors = (state?.donors || []) as Array<Record<string, unknown>>;
    const accountRows: Array<{ name: string; amount: number }> = [];
    const toonRows: Array<{ name: string; amount: number }> = [];

    for (const d of donors) {
      const target = normalizeTarget(d);
      const row = {
        name: String(d.name || "무명"),
        amount: Number(d.amount || 0),
      };
      if (target === "toon") toonRows.push(row);
      else accountRows.push(row);
    }

    return {
      accountTop5: aggregateTop5(accountRows),
      toonTop5: aggregateTop5(toonRows),
    };
  }, [state?.donors]);

  if (!ready) return null;

  return (
    <main className="min-h-screen w-full bg-soft-bg p-6 text-pastel-ink">
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-4 md:grid-cols-2 md:gap-6">
        <DonationColumn
          title="계좌 후원"
          titleClass="bg-pastel-yellow text-pastel-ink"
          items={accountTop5}
        />
        <DonationColumn
          title="투네이션"
          titleClass="bg-pastel-blue text-pastel-ink"
          items={toonTop5}
          suffix="캐시"
        />
      </div>
    </main>
  );
}

