"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import type { AppState, RouletteState, SigItem } from "@/types";
import { clampOverlayOpacity } from "@/lib/sig-roulette";

type SalesPhase = NonNullable<RouletteState["phase"]>;

type SigSalesMachine = {
  phase: SalesPhase;
  isRolling: boolean;
  isFinishLoading: boolean;
  errorMessage: string | null;
  selectedSigs: SigItem[];
  oneShot: { id: string; name: string; price: number } | null;
  resultId: string | null;
  startedAt: number;
  sessionId: string;
  overlayOpacity: number;
  lastFinishedAt: number;
};

type Action =
  | { type: "HYDRATE"; payload: Partial<SigSalesMachine> }
  | { type: "SET_OPACITY"; payload: number }
  | { type: "SPINNING"; payload: Pick<SigSalesMachine, "startedAt" | "sessionId" | "resultId"> }
  | { type: "LANDED"; payload: Pick<SigSalesMachine, "selectedSigs" | "oneShot" | "resultId"> }
  | { type: "CONFIRM_PENDING" }
  | { type: "CANCEL_CONFIRM" }
  | { type: "RESET_IDLE" }
  | { type: "SET_ERROR"; payload: string | null }
  | { type: "SPIN_FAILED"; payload?: string }
  | { type: "SET_FINISH_LOADING"; payload: boolean }
  | { type: "CONFIRMED"; payload: number };

const initialMachine: SigSalesMachine = {
  phase: "IDLE",
  isRolling: false,
  isFinishLoading: false,
  errorMessage: null,
  selectedSigs: [],
  oneShot: null,
  resultId: null,
  startedAt: 0,
  sessionId: "",
  overlayOpacity: 0.85,
  lastFinishedAt: 0,
};

function reducer(state: SigSalesMachine, action: Action): SigSalesMachine {
  switch (action.type) {
    case "HYDRATE":
      return {
        ...state,
        ...action.payload,
        isFinishLoading: false,
        overlayOpacity: clampOverlayOpacity(action.payload.overlayOpacity ?? state.overlayOpacity),
      };
    case "SET_OPACITY":
      return { ...state, overlayOpacity: clampOverlayOpacity(action.payload) };
    case "SPINNING":
      return {
        ...state,
        phase: "SPINNING",
        isRolling: true,
        errorMessage: null,
        startedAt: action.payload.startedAt,
        sessionId: action.payload.sessionId,
        resultId: action.payload.resultId,
      };
    case "LANDED":
      return {
        ...state,
        phase: "LANDED",
        isRolling: false,
        isFinishLoading: false,
        selectedSigs: action.payload.selectedSigs,
        oneShot: action.payload.oneShot,
        resultId: action.payload.resultId,
      };
    case "CONFIRM_PENDING":
      return { ...state, phase: "CONFIRM_PENDING", isFinishLoading: false };
    case "CANCEL_CONFIRM":
      return { ...state, phase: "LANDED", isFinishLoading: false };
    case "RESET_IDLE":
      return { ...initialMachine, overlayOpacity: state.overlayOpacity };
    case "SET_ERROR":
      return { ...state, errorMessage: action.payload };
    case "SPIN_FAILED":
      return {
        ...state,
        phase: "IDLE",
        isRolling: false,
        errorMessage: action.payload || "회전판 시작 실패",
      };
    case "SET_FINISH_LOADING":
      return { ...state, isFinishLoading: action.payload };
    case "CONFIRMED":
      return { ...state, phase: "CONFIRMED", isFinishLoading: false, lastFinishedAt: action.payload };
    default:
      return state;
  }
}

function toMachine(rs: RouletteState | undefined): Partial<SigSalesMachine> {
  return {
    phase: rs?.phase ?? "IDLE",
    isRolling: Boolean(rs?.isRolling),
    selectedSigs: rs?.selectedSigs || rs?.results || [],
    oneShot: rs?.oneShotResult || null,
    resultId: rs?.result?.id || null,
    startedAt: rs?.startedAt || 0,
    sessionId: rs?.sessionId || "",
    overlayOpacity: clampOverlayOpacity(rs?.overlayOpacity ?? 0.85),
    lastFinishedAt: rs?.lastFinishedAt || 0,
  };
}

export function useSigSalesState(userId: string, appState: AppState | null) {
  const [machine, dispatch] = useReducer(reducer, initialMachine);
  const prevUpdatedAtRef = useRef(0);
  const machineRef = useRef(machine);
  machineRef.current = machine;

  useEffect(() => {
    if (!appState) return;
    const incomingTs = appState.updatedAt || 0;
    if (incomingTs < prevUpdatedAtRef.current) return;

    const incoming = toMachine(appState.rouletteState);
    const cur = machineRef.current;
    // 서버가 아직 SPINNING인데 로컬은 착지(LANDED)·확정대기(CONFIRM_PENDING)면 폴링이 단계를 되돌리지 않음
    if (
      incoming.phase === "SPINNING" &&
      (cur.phase === "LANDED" || cur.phase === "CONFIRM_PENDING") &&
      cur.sessionId &&
      cur.sessionId === incoming.sessionId &&
      Number(incoming.startedAt || 0) === Number(cur.startedAt || 0)
    ) {
      prevUpdatedAtRef.current = incomingTs;
      return;
    }

    prevUpdatedAtRef.current = incomingTs;
    dispatch({ type: "HYDRATE", payload: incoming });
  }, [appState]);

  const spin = useCallback(async (options?: { memberId?: string | null; force?: boolean; spinCount?: number }) => {
    if (!options?.force && machine.isFinishLoading) {
      throw new Error("spin_blocked");
    }
    if (!options?.force && (machine.phase === "SPINNING" || machine.phase === "CONFIRM_PENDING")) {
      throw new Error("spin_blocked");
    }
    dispatch({ type: "SPINNING", payload: { startedAt: Date.now(), sessionId: "", resultId: null } });
    try {
      const res = await fetch(`/api/roulette/spin?user=${encodeURIComponent(userId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "cinematic5",
          memberId: options?.memberId || null,
          ...(typeof options?.spinCount === "number" && Number.isFinite(options.spinCount)
            ? { spinCount: Math.max(1, Math.min(999, Math.floor(options.spinCount))) }
            : {}),
        }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        const code = payload?.error || "spin_failed";
        throw new Error(code);
      }
      const data = (await res.json()) as {
        startedAt: number;
        sessionId: string;
        result: SigItem;
        selectedSigs: SigItem[];
        oneShot: { id: string; name: string; price: number } | null;
      };
      dispatch({
        type: "SPINNING",
        payload: {
          startedAt: data.startedAt || Date.now(),
          sessionId: data.sessionId || "",
          resultId: data.result?.id || null,
        },
      });
      return data;
    } catch (e) {
      const code = e instanceof Error && e.message ? e.message : "spin_failed";
      if (code === "spin_blocked") {
        throw e;
      }
      const message =
        code === "not_enough_active_sigs"
          ? "활성 시그가 5개 미만입니다."
          : code === "empty_inventory"
            ? "시그 목록이 비어 있습니다."
            : "회전판 시작 실패";
      dispatch({ type: "SPIN_FAILED", payload: message });
      throw new Error(code);
    }
  }, [userId, machine.phase, machine.isFinishLoading]);

  const landed = useCallback((selectedSigs: SigItem[], oneShot: { id: string; name: string; price: number } | null, resultId: string | null) => {
    dispatch({ type: "LANDED", payload: { selectedSigs, oneShot, resultId } });
  }, []);

  const markConfirmPending = useCallback(() => {
    dispatch({ type: "CONFIRM_PENDING" });
  }, []);

  const cancelConfirm = useCallback(() => {
    dispatch({ type: "CANCEL_CONFIRM" });
  }, []);

  const resetToIdle = useCallback(() => {
    dispatch({ type: "RESET_IDLE" });
  }, []);

  const setError = useCallback((msg: string | null) => {
    dispatch({ type: "SET_ERROR", payload: msg });
  }, []);

  const finish = useCallback(async (payload?: {
    sessionId?: string;
    selectedSigs?: SigItem[];
    oneShotResult?: { id: string; name: string; price: number } | null;
    finalPhase?: "CONFIRMED" | "CANCELLED";
  }) => {
    dispatch({ type: "SET_FINISH_LOADING", payload: true });
    dispatch({ type: "SET_ERROR", payload: null });
    try {
      const res = await fetch(`/api/roulette/finish?user=${encodeURIComponent(userId)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "cinematic5",
          sessionId: payload?.sessionId || machine.sessionId,
          selectedSigs: payload?.selectedSigs || machine.selectedSigs,
          oneShotResult: payload?.oneShotResult || machine.oneShot,
          finalPhase: payload?.finalPhase || "CONFIRMED",
        }),
      });
      if (!res.ok) {
        dispatch({ type: "SET_FINISH_LOADING", payload: false });
        dispatch({ type: "SET_ERROR", payload: "판매 확정 처리에 실패했습니다." });
        throw new Error("finish_failed");
      }
      dispatch({ type: "CONFIRMED", payload: Date.now() });
      return (await res.json()) as { ok: boolean; logId?: string; duplicate?: boolean };
    } catch {
      dispatch({ type: "SET_FINISH_LOADING", payload: false });
      dispatch({ type: "SET_ERROR", payload: "판매 확정 처리에 실패했습니다." });
      throw new Error("finish_failed");
    }
  }, [userId, machine.sessionId, machine.selectedSigs, machine.oneShot]);

  const setOpacity = useCallback((value: number) => dispatch({ type: "SET_OPACITY", payload: value }), []);

  return useMemo(
    () => ({
      machine,
      spin,
      landed,
      markConfirmPending,
      cancelConfirm,
      resetToIdle,
      finish,
      setOpacity,
      setError,
    }),
    [machine, spin, landed, markConfirmPending, cancelConfirm, resetToIdle, finish, setOpacity, setError]
  );
}
