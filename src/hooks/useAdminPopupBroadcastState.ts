"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { AppState } from "@/lib/state";
import {
  cacheBroadcastStateSnapshot,
  defaultState,
  loadState,
  loadStateFromApi,
  saveStateAsync,
} from "@/lib/state";
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
      /**
       * 세션 캐시만 갱신 — saveState() 는 옵션 없이 전체 POST 하여
       * 팝업의 불완전 donors/0원 members 로 엑셀·후원순위를 지우는 회귀가 있음.
       * 서버 반영은 반드시 saveStateAsync(+ highSocietySettingsOnly 등)만.
       */
      cacheBroadcastStateSnapshot(stamped, scopedUserId);
      const result = await saveStateAsync(stamped, scopedUserId, opts);
      /** HS/영토 저장 후 서버 정본(후원·금액)으로 다시 맞춤 — 로컬 0원 스냅샷 잔류 방지 */
      if (result.ok && (opts?.highSocietySettingsOnly || opts?.omitDonationFields)) {
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
