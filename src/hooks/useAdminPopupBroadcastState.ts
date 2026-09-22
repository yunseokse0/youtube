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

  /** ✅ 2026-09-22 v17.8 Revert: 팝업 창 state ID (finalent 폴백 절대 금지!
   *  1순위: URL ?u= 파라미터 (명시적 전달)
   *  2순위: 자기 로그인user.id (사용자 의도 그대로! 로그인=din 이면 state=din 이 정답!)
   *  3순위: 폴백 없음. finalent 강제 주입 절대 금지 (타계정 state 엉뚱하게 읽는 버그 방지
   */
  const scopedUserId = resolveScopedOverlayUserId(urlUserId || user?.id);

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
