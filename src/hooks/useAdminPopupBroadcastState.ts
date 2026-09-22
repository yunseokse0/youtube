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
  const [user, setUser] = useState<{ id: string; name?: string; companyName?: string; unlimited?: boolean; remainingDays?: number } | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const sessionUserId = resolveScopedOverlayUserId(user?.id || "");

  /** ✅ v17.9.4: useAdminPopupBroadcastState 자체 /api/auth/me 인증 로직 내장
   *  이전 BUG: HS 팝업 페이지(/admin/high-society)는 admin 메인 페이지의 auth 로직을 공유하지 않아
   *             로그인 쿠키가 없는 타 PC에서도 URL 파라미터 만으로 finalent 버킷 state 전체 노출 (보안 구멍!)
   *  Fix: /api/auth/me 3회 재시도 → 세션 user.id 없으면 프로덕션은 로그인 페이지로 강제 이동
   */
  useEffect(() => {
    let cancelled = false;
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname.includes("local"));
    const loadAuth = (attempt: number) => {
      fetch("/api/auth/me", { credentials: "include" })
        .then(async (r) => {
          if (!r.ok) throw new Error(`auth_me_${r.status}`);
          return r.json();
        })
        .then((data) => {
          if (cancelled) return;
          const rawUser = data?.user;
          const rawUid = String(rawUser?.id || "").trim();
          if (rawUid) {
            setUser(rawUser);
            setAuthReady(true);
            return;
          }
          /** 세션 로그인 자체가 없음 — 개발모드 URL ?u= 있을 때만 가장 로그인 허용 */
          const resolvedUrlUid = urlUserId ? resolveScopedOverlayUserId(urlUserId) : "";
          if (isLocalhost && resolvedUrlUid) {
            setUser({ id: resolvedUrlUid, companyName: "URL_OVERRIDE_DEV", unlimited: true, remainingDays: 9999 });
            setAuthReady(true);
            return;
          }
          /** 🚨 프로덕션 미로그인 → /login?redirect= 로 강제 이동 */
          setAuthReady(true);
          try {
            const next = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/login?redirect=${next}`;
          } catch (_noop) { /* noop */ }
        })
        .catch(() => {
          if (cancelled) return;
          if (attempt < 3) {
            window.setTimeout(() => loadAuth(attempt + 1), 450 * attempt);
            return;
          }
          const resolvedUrlUid = urlUserId ? resolveScopedOverlayUserId(urlUserId) : "";
          if (isLocalhost && resolvedUrlUid) {
            setUser({ id: resolvedUrlUid, companyName: "URL_OVERRIDE_DEV", unlimited: true, remainingDays: 9999 });
            setAuthReady(true);
            return;
          }
          /** 네트워크 오류 등 auth 실패 — 프로덕션에서는 로그인 페이지로 이동 */
          setAuthReady(true);
          try {
            const next = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/login?redirect=${next}`;
          } catch (_noop) { /* noop */ }
        });
    };
    loadAuth(1);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [state, setState] = useState<AppState | null>(null);
  const stateRef = useRef<AppState | null>(null);
  const reloadBusyRef = useRef(false);

  /** ✅ 2026-09-22 v17.8 Revert: 팝업 창 state ID (finalent 폴백 절대 금지!
   *  1순위: URL ?u= 파라미터 (명시적 전달)
   *  2순위: 자기 로그인user.id (사용자 의도 그대로! 로그인=din 이면 state=din 이 정답!)
   *  3순위: 폴백 없음. finalent 강제 주입 절대 금지 (타계정 state 엉뚱하게 읽는 버그 방지
   */
  const [scopedUserId, setScopedUserId] = useState<string>(() =>
    resolveScopedOverlayUserId(urlUserId || "")
  );
  const [overrideReason, setOverrideReason] = useState<string | null>(null);

  useEffect(() => {
    if (!authReady || !user?.id) return;
    const resolvedUrlUid = urlUserId ? resolveScopedOverlayUserId(urlUserId) : "";
    const resolvedSessionUid = resolveScopedOverlayUserId(user.id);
    const isLocalhost =
      typeof window !== "undefined" &&
      (window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1" ||
        window.location.hostname.includes("local"));

    if (!resolvedUrlUid) {
      setScopedUserId(resolvedSessionUid);
      return;
    }

    if (resolvedUrlUid === resolvedSessionUid) {
      setScopedUserId(resolvedSessionUid);
      setOverrideReason(null);
      return;
    }

    if (isLocalhost) {
      setScopedUserId(resolvedUrlUid);
      setOverrideReason("개발모드 URL override");
      return;
    }

    /** ✅ 프로덕션: URL ?u=finalent 등 세션 계정과 다르면
     *  세션 user.id 로 URL을 강제 교정 → 북마크 등으로 잘못된 URL 접근시 자동 정상화!
     */
    setScopedUserId(resolvedSessionUid);
    setOverrideReason(`URL ${resolvedUrlUid} → ${resolvedSessionUid} 교정`);
    try {
      const current = new URL(window.location.href);
      current.searchParams.set("u", resolvedSessionUid);
      window.history.replaceState(null, "", current.toString());
    } catch (_noop) {
      /* noop */
    }
  }, [authReady, urlUserId, user?.id]);

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
    /** ✅ Fix v17.9.3: scopedUserId 가 아직 세션과 불일치 상태면 reload 스킵 — 교정 완료 후 아래 useEffect에서 자동 reload
     *  이전 버그: authReady 직후 finalent 버킷 state를 먼저 불러와 사용자가 din임에도 finalent HS 설정(OFF)이 표시됨
     */
    if (user?.id) {
      const resolvedSessionUid = resolveScopedOverlayUserId(user.id);
      if (scopedUserId !== resolvedSessionUid) {
        const isLocalhost =
          typeof window !== "undefined" &&
          (window.location.hostname === "localhost" ||
            window.location.hostname === "127.0.0.1" ||
            window.location.hostname.includes("local"));
        const resolvedUrlUid = urlUserId ? resolveScopedOverlayUserId(urlUserId) : "";
        const urlMatchesSession = resolvedUrlUid && resolvedUrlUid === resolvedSessionUid;
        if (!isLocalhost && !urlMatchesSession) return; // 프로덕션에서 교정 대기 중 → reload 스킵
      }
    }
    void reload();
  }, [authReady, reload, scopedUserId, user?.id, urlUserId]);

  useEffect(() => {
    /** ✅ Fix v17.9.3: scopedUserId 가 교정되면(= finalent → din) 자동으로 새 버킷 state reload */
    if (!authReady) return;
    if (!scopedUserId) return;
    if (stateRef.current == null) return; // 첫 init은 위 authReady effect에서 담당
    void reload();
  }, [scopedUserId]);

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
