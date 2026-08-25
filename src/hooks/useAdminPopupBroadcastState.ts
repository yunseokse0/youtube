"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AppState } from "@/lib/state";
import {
  defaultState,
  loadState,
  loadStateFromApi,
  mergeBroadcastSessionPreservingDonations,
  saveStateAsync,
} from "@/lib/state";
import { notifyBroadcastStateLocalUpdated } from "@/lib/broadcast-state-local-sync";
import {
  readSessionBroadcastState,
  writeSessionBroadcastState,
} from "@/lib/server-authoritative-broadcast-state";
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
        writeSessionBroadcastState(remote, scopedUserId);
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
      const hsOnly = Boolean(opts?.highSocietySettingsOnly || opts?.omitDonationFields);
      /**
       * 영토·HS 저장 전에 팝업 React state(후원 비어 있을 수 있음)로 세션을 덮지 않음.
       * 기존 세션 후원·금액을 유지한 채 HS/영토 필드만 얹어 미리보기 0화 방지.
       */
      const existingSession = readSessionBroadcastState(scopedUserId) ?? loadState(scopedUserId);
      const stamped = {
        ...mergeBroadcastSessionPreservingDonations(existingSession, {
          ...next,
          updatedAt: Date.now(),
        }),
      };
      setState(stamped);
      stateRef.current = stamped;
      if (hsOnly) {
        writeSessionBroadcastState(stamped, scopedUserId);
        notifyBroadcastStateLocalUpdated(scopedUserId, stamped.updatedAt);
      }
      const result = await saveStateAsync(stamped, scopedUserId, opts);
      if (result.ok && hsOnly) {
        void reload();
      }
      return result.ok;
    },
    [scopedUserId, reload]
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
