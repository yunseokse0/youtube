"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AppState } from "@/lib/state";
import { defaultState, loadState, loadStateFromApi, saveState, saveStateAsync } from "@/lib/state";
import { notifyBroadcastStateLocalUpdated } from "@/lib/broadcast-state-local-sync";
import { useSSEConnection } from "@/lib/sse-client";
import { resolveScopedOverlayUserId } from "@/lib/overlay-params";

export function useAdminPopupBroadcastState() {
  const router = useRouter();
  const sp = useSearchParams();
  const urlUserId = (sp.get("u") || sp.get("user") || "").trim();
  const [user, setUser] = useState<{ id: string } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null);
  const reloadBusyRef = useRef(false);

  const scopedUserId = resolveScopedOverlayUserId(user?.id || urlUserId || "finalent");

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user?: { id?: string } } | null) => {
        const id = data?.user?.id;
        if (typeof id === "string" && id.trim()) setUser({ id: id.trim() });
        else router.replace("/login");
      })
      .catch(() => router.replace("/login"))
      .finally(() => setAuthReady(true));
  }, [router]);

  const reload = useCallback(async () => {
    if (reloadBusyRef.current) return;
    reloadBusyRef.current = true;
    try {
      const remote = await loadStateFromApi(scopedUserId, { forceFull: true });
      if (remote) {
        setState(remote);
        return;
      }
      const local = loadState(scopedUserId);
      setState(local ?? defaultState());
    } finally {
      reloadBusyRef.current = false;
    }
  }, [scopedUserId]);

  useEffect(() => {
    if (!authReady) return;
    void reload();
  }, [authReady, reload]);

  useSSEConnection((d: unknown) => {
    const o = d as { type?: string };
    if (o?.type === "state_updated") void reload();
  });

  const persistAppState = useCallback(
    async (
      next: AppState,
      opts?: Parameters<typeof saveStateAsync>[2]
    ): Promise<boolean> => {
      const stamped = { ...next, updatedAt: Date.now() };
      setState(stamped);
      stateRef.current = stamped;
      saveState(stamped, scopedUserId);
      notifyBroadcastStateLocalUpdated(scopedUserId, stamped.updatedAt);
      const result = await saveStateAsync(stamped, scopedUserId, opts);
      return result.ok;
    },
    [scopedUserId]
  );

  const accountMismatch =
    user?.id != null && urlUserId.length > 0 && user.id !== urlUserId;

  return {
    user,
    scopedUserId,
    urlUserId,
    authReady,
    state,
    setState,
    stateRef,
    reload,
    persistAppState,
    accountMismatch,
  };
}
