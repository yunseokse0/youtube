"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Howl } from "howler";
import type { SigItem } from "@/types";
import RouletteWheel from "@/components/sig-sales/RouletteWheel";
import ResultOverlay from "@/components/sig-sales/ResultOverlay";
import SigBoardRolling from "@/components/sig-sales/SigBoardRolling";
import { loadStateFromApi, type AppState } from "@/lib/state";
import { getOverlayUserIdFromSearchParams } from "@/lib/overlay-params";
import { resolveSigImageUrl } from "@/lib/constants";
import {
  ONE_SHOT_SIG_ID,
  SOUND_ASSETS_ENABLED,
  SPIN_SOUND_PATHS,
  canonicalSigIdFromWheelSliceId,
} from "@/lib/sig-roulette";
import { useSigSalesState } from "@/hooks/useSigSalesState";
import { useImagePreload } from "@/hooks/useImagePreload";

const POLL_MS = 1000;
const CONFIRMED_VISIBLE_SLOTS = 5;
const MIN_ONE_SHOT_SIGS = 2;
/** OBS 소스 로드 지연 등으로 오버레이가 늦게 붙어도 같은 회차 복원 허용 */
const RECENT_SPIN_WINDOW_MS = 180_000;
const DEMO_POOL = [
  { id: "demo_1", name: "애교", price: 77000, imageUrl: "/images/sigs/애교.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_2", name: "댄스", price: 100000, imageUrl: "/images/sigs/댄스.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_3", name: "식사권", price: 333000, imageUrl: "/images/sigs/식사권.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_4", name: "보이스", price: 50000, imageUrl: "/images/sigs/보이스.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_5", name: "노래", price: 120000, imageUrl: "/images/sigs/노래.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_6", name: "토크", price: 55000, imageUrl: "/images/sigs/토크.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_7", name: "하트", price: 30000, imageUrl: "/images/sigs/하트.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_8", name: "게임", price: 88000, imageUrl: "/images/sigs/게임.png", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_9", name: "보너스", price: 150000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_10", name: "특전", price: 220000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
];
const buildOneShotFromSelected = (selected: SigItem[]) => {
  if (selected.length < MIN_ONE_SHOT_SIGS) return null;
  return {
    id: ONE_SHOT_SIG_ID,
    name: "한방 시그",
    price: selected.reduce((sum, x) => sum + x.price, 0),
  };
};
type WheelPhase = "idle" | "spinning" | "settling" | "result";
const wheelReducer = (state: WheelPhase, action: { type: string }): WheelPhase => {
  switch (action.type) {
    case "START_SPIN":
      return "spinning";
    case "SETTLING":
      return "settling";
    case "LANDED":
      return "result";
    case "RESET":
      return "idle";
    default:
      return state;
  }
};

export default function SigSalesOverlayPage() {
  const sp = useSearchParams();
  const userId = getOverlayUserIdFromSearchParams(sp);
  const memberIdParam = (sp.get("memberId") || sp.get("member") || "").trim();
  const memberFilterId = memberIdParam.length > 0 ? memberIdParam : "";
  const menuCountParam = (() => {
    const raw = sp.get("menuCount") || sp.get("wheelCount") || "";
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(5, Math.min(20, n));
  })();
  const rouletteDemo = sp.get("rouletteDemo") === "1" || sp.get("rouletteDemo") === "true";
  /** 기본: 시그 보드는 회전 완료·결과 패널과 함께만 표시. SPINNING 중에도 보이게 하려면 sigBoardDuringSpin=1 */
  const hideSigBoard =
    sp.get("hideSigBoard") === "1" ||
    String(sp.get("hideSigBoard") || "").toLowerCase() === "true" ||
    sp.get("sigBoard") === "0" ||
    String(sp.get("sigBoard") || "").toLowerCase() === "false";
  const sigBoardDuringSpin =
    sp.get("sigBoardDuringSpin") === "1" ||
    String(sp.get("sigBoardDuringSpin") || "").toLowerCase() === "true";
  const overlayScalePct = (() => {
    const raw = sp.get("scalePct") || sp.get("zoomPct") || "100";
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(50, Math.min(300, n));
  })();
  const wheelScalePct = (() => {
    const raw = sp.get("wheelScalePct") || sp.get("wheelPct") || "85";
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 85;
    return Math.max(55, Math.min(140, n));
  })();
  /** GIF 시그 프레임 유지 시간 배수 (1=원본, 기본 3.5). `sigGifSpeed` 동일 의미 */
  const sigGifDelayMultiplier = (() => {
    const raw = sp.get("sigGifDelay") || sp.get("sigGifSpeed") || "";
    if (!raw.trim()) return 3.5;
    const n = parseFloat(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) return 3.5;
    return Math.max(1, Math.min(10, n));
  })();
  /** 착지 후 이 시간(ms)이 지나야 시그 카드·휠 퇴장 연출 시작. `cardRevealDelayMs` 동의어 */
  const resultRevealDelayMs = useMemo(() => {
    const raw = sp.get("resultRevealDelayMs") || sp.get("cardRevealDelayMs") || "";
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(120_000, n);
  }, [sp]);
  /** 휠 페이드·카드 슬라이드 duration (ms). `wheelFadeMs` 동의어 */
  const revealMotionMs = useMemo(() => {
    const raw = sp.get("revealMotionMs") || sp.get("wheelFadeMs") || "";
    if (!raw.trim()) return 550;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 550;
    return Math.max(200, Math.min(4000, n));
  }, [sp]);
  const revealMotionSec = revealMotionMs / 1000;
  const overlayScale = overlayScalePct / 100;
  const overlayScaleStyle = overlayScale === 1
    ? undefined
    : ({ transform: `scale(${overlayScale})`, transformOrigin: "top center" } as React.CSSProperties);
  const [state, setState] = useState<AppState | null>(null);
  const [pendingLanding, setPendingLanding] = useState<{ selected: SigItem[]; oneShot: { id: string; name: string; price: number } | null; resultId: string | null; persist: boolean } | null>(null);
  const [demoSpin, setDemoSpin] = useState<{ startedAt: number; resultId: string | null } | null>(null);
  const [lastConfirmedText, setLastConfirmedText] = useState("");
  const [lastConfirmedFxKey, setLastConfirmedFxKey] = useState(0);
  const [showResultPanel, setShowResultPanel] = useState(false);
  /** 착지 후 서버가 잠시 SPINNING으로 폴링되어도 결과·회전판 숨김 UX 유지 */
  const [overlayHoldResults, setOverlayHoldResults] = useState(false);
  const [currentSignImageUrl, setCurrentSignImageUrl] = useState("");
  const [wheelPhase, dispatch] = useReducer(wheelReducer, "idle");
  /** 착지 후 정지 연출이 끝나고 resultRevealDelayMs 경과 전까지 false → 시그 카드·휠 퇴장 지연 */
  const [revealGateOpen, setRevealGateOpen] = useState(true);
  const [wheelFadePhase, setWheelFadePhase] = useState<"on" | "fading" | "off">("on");
  const revealTimerRef = useRef<number | null>(null);
  const transitionHandledKeyRef = useRef("");
  const handledSpinKeyRef = useRef("");
  const completedSpinKeyRef = useRef("");
  const phaseRef = useRef<WheelPhase>("idle");
  const demoBootedRef = useRef(false);
  const hasOneShotSoundErrorRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const playFallbackOneShot = useCallback(() => {
    if (typeof window === "undefined") return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new Ctx();
      audioCtxRef.current = ctx;
    }
    if (!ctx) return;
    const tones: Array<[number, number]> = [
      [740, 0.09],
      [990, 0.1],
    ];
    tones.forEach(([freq, sec], idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      g.gain.value = 0.024;
      osc.connect(g);
      g.connect(ctx.destination);
      const at = ctx.currentTime + idx * 0.1;
      osc.start(at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + sec);
      osc.stop(at + sec);
    });
  }, []);
  const [oneShotSound] = useState(() =>
    SOUND_ASSETS_ENABLED
      ? new Howl({
          src: [SPIN_SOUND_PATHS.oneShot],
          preload: true,
          volume: 0.7,
          mute: false,
          onloaderror: () => {
            hasOneShotSoundErrorRef.current = true;
          },
          onplayerror: () => {
            hasOneShotSoundErrorRef.current = true;
          },
        })
      : null
  );
  const { machine, landed, resetToIdle } = useSigSalesState(userId, state);

  const loadRemote = useCallback(async () => {
    if (rouletteDemo) return;
    const remote = await loadStateFromApi(userId);
    if (remote) setState(remote);
  }, [rouletteDemo, userId]);

  useEffect(() => {
    if (rouletteDemo) return;
    void loadRemote();
    const id = window.setInterval(() => void loadRemote(), POLL_MS);
    return () => window.clearInterval(id);
  }, [rouletteDemo, loadRemote]);

  useEffect(() => {
    return () => {
      oneShotSound?.unload();
      try { audioCtxRef.current?.close(); } catch {}
      audioCtxRef.current = null;
    };
  }, [oneShotSound]);

  // 결과 배치는 운영자가 reset 할 때까지 유지한다.

  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || "/images/sigs/stamp.png";
  const menuCount = useMemo(() => {
    if (menuCountParam != null) return menuCountParam;
    const persisted = Number(state?.rouletteState?.menuCount);
    if (Number.isFinite(persisted)) return Math.max(5, Math.min(20, Math.floor(persisted)));
    return 10;
  }, [menuCountParam, state?.rouletteState?.menuCount]);
  const menuFillFromAllActive = useMemo(() => {
    const raw = (sp.get("menuFillFromAllActive") || "").toLowerCase();
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return state?.rouletteState?.menuFillFromAllActive === true;
  }, [sp, state?.rouletteState?.menuFillFromAllActive]);
  const menuFillFromDemo = useMemo(() => {
    const raw = (sp.get("menuFillFromDemo") || "").toLowerCase();
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return state?.rouletteState?.menuFillFromDemo === true;
  }, [sp, state?.rouletteState?.menuFillFromDemo]);
  const activeNormalPool = useMemo(() => {
    if (rouletteDemo) return DEMO_POOL;
    if (!state) return [];
    const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
    return (state.sigInventory || []).filter(
      (x) =>
        x.isActive &&
        x.id !== ONE_SHOT_SIG_ID &&
        !excluded.has(x.id) &&
        (!memberFilterId || (x.memberId || "") === memberFilterId)
    );
  }, [state, rouletteDemo, memberFilterId]);
  const wheelDisplayPool = useMemo(() => {
    // 후보 풀은 최소 menuCount까지 채운다(회전판 칸 수와 무관하게 후보 확보).
    const targetCount = Math.max(CONFIRMED_VISIBLE_SLOTS, menuCount);
    const unique = new Map<string, SigItem>();
    for (const item of activeNormalPool) unique.set(item.id, item);
    if (menuFillFromAllActive && unique.size < targetCount && state) {
      const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
      const broadActivePool = (state.sigInventory || []).filter(
        (x) => x.isActive && x.id !== ONE_SHOT_SIG_ID && !excluded.has(x.id)
      );
      for (const item of broadActivePool) {
        unique.set(item.id, item);
        if (unique.size >= targetCount) break;
      }
    }
    if (menuFillFromDemo && unique.size < targetCount) {
      const fillers = DEMO_POOL;
      for (const item of fillers) {
        unique.set(item.id, item);
        if (unique.size >= targetCount) break;
      }
    }
    return Array.from(unique.values());
  }, [activeNormalPool, menuCount, state, menuFillFromAllActive, menuFillFromDemo]);

  /** 고유 시그가 적어도 menuCount만큼 칸을 순환 채움(각 칸은 고유 slice id) */
  const wheelSlices = useMemo(() => {
    const n = Math.max(1, menuCount);
    const pool =
      wheelDisplayPool.length > 0
        ? wheelDisplayPool
        : rouletteDemo
          ? DEMO_POOL
          : [];
    if (pool.length === 0) return [] as SigItem[];
    const out: SigItem[] = [];
    for (let i = 0; i < n; i++) {
      const canonical = pool[i % pool.length]!;
      out.push({ ...canonical, id: `${canonical.id}__wslot_${i}` });
    }
    return out;
  }, [wheelDisplayPool, menuCount, rouletteDemo]);

  const wheelItemsWithResult = useMemo(() => {
    const base = [...wheelSlices];
    const rid = demoSpin?.resultId || machine.resultId || pendingLanding?.resultId || null;
    if (!rid || base.length === 0) return base;
    const hasWinner = base.some((s) => canonicalSigIdFromWheelSliceId(s.id) === rid);
    if (hasWinner) return base;
    const found =
      activeNormalPool.find((item) => item.id === rid) ||
      (pendingLanding?.selected || []).find((x) => x.id === rid) ||
      (machine.selectedSigs || []).find((x) => x.id === rid) ||
      DEMO_POOL.find((x) => x.id === rid);
    if (!found) return base;
    base[base.length - 1] = { ...found, id: `${found.id}__wslot_${base.length - 1}` };
    return base;
  }, [
    wheelSlices,
    demoSpin?.resultId,
    machine.resultId,
    pendingLanding?.resultId,
    pendingLanding?.selected,
    machine.selectedSigs,
    activeNormalPool,
  ]);

  /** 서버 당첨 id(real) → 휠 세그먼트 id */
  const wheelResultSliceId = useMemo(() => {
    const realId =
      machine.resultId ||
      demoSpin?.resultId ||
      pendingLanding?.resultId ||
      (pendingLanding?.selected?.length ? pendingLanding.selected[pendingLanding.selected.length - 1]?.id : null) ||
      (machine.selectedSigs?.length ? machine.selectedSigs[machine.selectedSigs.length - 1]?.id : null) ||
      null;
    if (!realId || wheelItemsWithResult.length === 0) return null;
    const idx = wheelItemsWithResult.findIndex((s) => canonicalSigIdFromWheelSliceId(s.id) === realId);
    return idx >= 0 ? wheelItemsWithResult[idx]!.id : wheelItemsWithResult[wheelItemsWithResult.length - 1]!.id;
  }, [
    machine.resultId,
    demoSpin?.resultId,
    pendingLanding?.resultId,
    pendingLanding?.selected,
    machine.selectedSigs,
    wheelItemsWithResult,
  ]);
  const displaySelectedSigs = useMemo(() => {
    // 서버 phase가 IDLE인데 이전 회차 selectedSigs만 남은 경우가 있어 표시하지 않음(회전판이 안 돌았는데 숨겨지는 현상 방지)
    if (!rouletteDemo && machine.phase === "IDLE") return [];
    /** 서버가 이미 당첨 시그를 내려준 경우 스핀·착지 연출 중에도 그리드가 비지 않게 함(나중에 한꺼번에만 뜨는 느낌 완화) */
    const hasQueue =
      (pendingLanding?.selected?.length || 0) > 0 || (machine.selectedSigs?.length || 0) > 0;
    const inSpinUx =
      !hasQueue &&
      (Boolean(demoSpin) ||
        (machine.phase === "SPINNING" && !overlayHoldResults) ||
        wheelPhase === "spinning" ||
        wheelPhase === "settling");
    if (inSpinUx) return [];
    if (machine.selectedSigs.length > 0) return machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS);
    if (pendingLanding?.selected?.length) return pendingLanding.selected.slice(0, CONFIRMED_VISIBLE_SLOTS);
    return [];
  }, [machine.selectedSigs, machine.phase, rouletteDemo, pendingLanding, demoSpin, wheelPhase, overlayHoldResults]);
  const displayOneShot = useMemo(() => {
    if (displaySelectedSigs.length < MIN_ONE_SHOT_SIGS) return null;
    return buildOneShotFromSelected(displaySelectedSigs);
  }, [displaySelectedSigs]);
  const completedTargetCount = useMemo(() => {
    if (pendingLanding?.selected?.length) return Math.max(1, Math.min(CONFIRMED_VISIBLE_SLOTS, pendingLanding.selected.length));
    if (machine.selectedSigs?.length) return Math.max(1, Math.min(CONFIRMED_VISIBLE_SLOTS, machine.selectedSigs.length));
    return 1;
  }, [pendingLanding?.selected, machine.selectedSigs]);
  const hideWheelAfterComplete =
    machine.selectedSigs.length >= completedTargetCount &&
    !pendingLanding &&
    !demoSpin &&
    wheelPhase !== "spinning" &&
    wheelPhase !== "settling" &&
    (wheelPhase === "result" || overlayHoldResults || showResultPanel);
  /** 회차별 reveal·페이드 시퀀스 구분(데모에서 sessionId 비어 있어도 충돌 방지) */
  const spinCompletionKey = useMemo(() => {
    const selKey = (machine.selectedSigs || []).map((s) => s.id).join(",");
    return `${machine.sessionId || ""}:${machine.startedAt || 0}:${machine.resultId || ""}:${selKey}`;
  }, [machine.sessionId, machine.startedAt, machine.resultId, machine.selectedSigs]);
  const showWheelVisual = useMemo(
    () => !hideWheelAfterComplete || !revealGateOpen || wheelFadePhase !== "off",
    [hideWheelAfterComplete, revealGateOpen, wheelFadePhase],
  );
  const showSigBoardRollingSection = useMemo(() => {
    if (hideSigBoard || !state || (state.sigInventory || []).length === 0) return false;
    if (sigBoardDuringSpin) return true;
    return Boolean(hideWheelAfterComplete && showResultPanel && revealGateOpen);
  }, [hideSigBoard, state, sigBoardDuringSpin, hideWheelAfterComplete, showResultPanel, revealGateOpen]);
  /**
   * 스핀 중 showResultPanel=false 이어도 당첨 시그가 이미 확정되어 있으면 결과 그리드를 반드시 연다.
   * (그리드 데이터만 채우고 패널을 숨기면「돌다가 비었다가 한꺼번에」가 그대로 발생함)
   */
  const resultOverlayVisible = Boolean(
    revealGateOpen &&
      displaySelectedSigs.length > 0 &&
      (machine.phase === "IDLE"
        ? rouletteDemo
        : (showResultPanel && hideWheelAfterComplete) ||
          machine.phase === "SPINNING" ||
          machine.phase === "LANDED" ||
          machine.phase === "CONFIRM_PENDING" ||
          machine.phase === "CONFIRMED" ||
          wheelPhase === "spinning" ||
          wheelPhase === "settling" ||
          wheelPhase === "result" ||
          Boolean(demoSpin) ||
          Boolean(pendingLanding))
  );
  /** 관리자가 재고에서 완판 처리한 시그 → 방송 결과 카드에도 스탬프 표시 */
  const inventorySoldOutIdSet = useMemo(() => {
    const next = new Set<string>();
    for (const row of state?.sigInventory || []) {
      if (row.soldCount >= row.maxCount) {
        next.add(row.id);
        next.add(canonicalSigIdFromWheelSliceId(row.id));
      }
    }
    return next;
  }, [state?.sigInventory]);
  const oneShotImageUrl = useMemo(() => {
    const oneShotItem = (state?.sigInventory || []).find((item) => item.id === ONE_SHOT_SIG_ID);
    const fromOneShot = (oneShotItem?.imageUrl || "").trim();
    if (fromOneShot) return resolveSigImageUrl(oneShotItem?.name || "한방 시그", fromOneShot);
    const pick = displaySelectedSigs.find((x) => (x.imageUrl || "").trim());
    if (pick) return resolveSigImageUrl(pick.name, pick.imageUrl);
    const poolPick = activeNormalPool.find((x) => (x.imageUrl || "").trim());
    if (poolPick) return resolveSigImageUrl(poolPick.name, poolPick.imageUrl);
    return resolveSigImageUrl("", "");
  }, [state?.sigInventory, displaySelectedSigs, activeNormalPool]);
  const getSignImageUrl = useCallback((id?: string | null) => {
    if (!id) return "";
    const pool = [...(machine.selectedSigs || []), ...(activeNormalPool || []), ...(DEMO_POOL || [])];
    const found = pool.find((item) => item.id === id);
    return resolveSigImageUrl(found?.name || "", found?.imageUrl || "");
  }, [machine.selectedSigs, activeNormalPool]);
  const hasServerSpinToPlay = useMemo(() => {
    return (
      machine.phase === "SPINNING" &&
      machine.isRolling &&
      Boolean(machine.sessionId) &&
      Boolean(pendingLanding?.selected?.length)
    );
  }, [machine.phase, machine.isRolling, machine.sessionId, pendingLanding?.selected?.length]);
  useImagePreload(oneShotImageUrl);
  useImagePreload(currentSignImageUrl);

  useEffect(() => {
    phaseRef.current = wheelPhase;
  }, [wheelPhase]);

  useEffect(() => {
    if (!hideWheelAfterComplete) {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
      setRevealGateOpen(true);
      setWheelFadePhase("on");
      return;
    }
    setRevealGateOpen(false);
    setWheelFadePhase("on");
    const runReveal = () => {
      setRevealGateOpen(true);
      setWheelFadePhase("fading");
    };
    if (resultRevealDelayMs <= 0) {
      runReveal();
    } else {
      revealTimerRef.current = window.setTimeout(() => {
        revealTimerRef.current = null;
        runReveal();
      }, resultRevealDelayMs);
    }
    return () => {
      if (revealTimerRef.current) {
        clearTimeout(revealTimerRef.current);
        revealTimerRef.current = null;
      }
    };
  }, [hideWheelAfterComplete, resultRevealDelayMs]);

  useEffect(() => {
    // 오버레이가 서버 상태만으로도 재생될 수 있도록 대기열을 자동 복원한다.
    if (pendingLanding || demoSpin) return;
    const machineSpinKey = `${machine.startedAt || 0}:${machine.sessionId || ""}:${machine.resultId || ""}`;
    if (machineSpinKey === completedSpinKeyRef.current) return;
    const selectedFromServer = (machine.selectedSigs || []).slice(0, CONFIRMED_VISIBLE_SLOTS);
    if (machine.phase !== "SPINNING" || selectedFromServer.length === 0) return;
    const startedAt = Number(machine.startedAt || 0);
    const recentEnough = startedAt > 0 && Date.now() - startedAt <= RECENT_SPIN_WINDOW_MS;
    if (!machine.isRolling || !recentEnough) return;
    const derivedOneShot = buildOneShotFromSelected(selectedFromServer);
    setPendingLanding({
      selected: selectedFromServer,
      oneShot: derivedOneShot,
      resultId: machine.resultId || selectedFromServer[selectedFromServer.length - 1]?.id || null,
      persist: true,
    });
    const finalRealId =
      machine.resultId || selectedFromServer[selectedFromServer.length - 1]?.id || selectedFromServer[0]?.id || null;
    setDemoSpin({ startedAt: Date.now(), resultId: finalRealId });
  }, [
    machine.phase,
    machine.selectedSigs,
    machine.resultId,
    pendingLanding,
    demoSpin,
    machine.isRolling,
    machine.startedAt,
    machine.sessionId,
  ]);

  useEffect(() => {
    if (rouletteDemo) return;
    // appState 수신 전 기본 IDLE이면 건드리지 않음(HYDRATE SPINNING과 경쟁 방지)
    if (!state) return;
    if (machine.phase !== "IDLE") return;
    dispatch({ type: "RESET" });
    setPendingLanding(null);
    setDemoSpin(null);
    setCurrentSignImageUrl("");
    setOverlayHoldResults(false);
    setRevealGateOpen(true);
    setWheelFadePhase("on");
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    transitionHandledKeyRef.current = "";
    handledSpinKeyRef.current = "";
  }, [machine.phase, state, rouletteDemo]);

  useEffect(() => {
    if (machine.phase !== "SPINNING") return;
    if (!pendingLanding && !demoSpin) return;
    const spinKey = `${machine.startedAt || 0}:${machine.sessionId || ""}:${machine.resultId || ""}`;
    if (spinKey === completedSpinKeyRef.current) return;
    if (!machine.startedAt || handledSpinKeyRef.current === spinKey) return;
    handledSpinKeyRef.current = spinKey;
    dispatch({ type: "RESET" });
    dispatch({ type: "START_SPIN" });
    setOverlayHoldResults(false);
    setShowResultPanel(false);
    setCurrentSignImageUrl("");
    setRevealGateOpen(true);
    setWheelFadePhase("on");
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
    transitionHandledKeyRef.current = "";
  }, [
    machine.phase,
    machine.startedAt,
    machine.sessionId,
    machine.resultId,
    pendingLanding,
    demoSpin,
  ]);

  useEffect(() => {
    if (machine.phase !== "LANDED" && machine.phase !== "CONFIRM_PENDING" && machine.phase !== "CONFIRMED") return;
    if ((machine.selectedSigs || []).length === 0) return;
    setOverlayHoldResults(true);
  }, [machine.phase, machine.selectedSigs]);

  useEffect(() => {
    if (machine.phase === "IDLE") {
      setShowResultPanel(false);
      setOverlayHoldResults(false);
      return;
    }
    if (machine.phase === "SPINNING") {
      // 착지 직후 서버가 잠시 SPINNING으로 오버레이되어도 결과 유지
      if (overlayHoldResults && machine.selectedSigs.length > 0) {
        setShowResultPanel(true);
        return;
      }
      setShowResultPanel(false);
      return;
    }
    if (
      machine.phase !== "LANDED" &&
      machine.phase !== "CONFIRMED" &&
      machine.phase !== "CONFIRM_PENDING"
    ) {
      return;
    }
    if (machine.selectedSigs.length > 0) setShowResultPanel(true);
  }, [machine.phase, machine.selectedSigs, overlayHoldResults]);

  // IDLE 동기화 시에도 방송 화면 결과를 유지한다.
  // 새로운 회차가 시작되면 SPINNING 전환 effect에서 초기화된다.

  useEffect(() => {
    const queue = pendingLanding?.selected || [];
    queue.forEach((item) => {
      const img = new Image();
      img.src = resolveSigImageUrl(item.name, item.imageUrl);
    });
  }, [pendingLanding]);

  useEffect(() => {
    if (!lastConfirmedText) return;
    const id = window.setTimeout(() => setLastConfirmedText(""), 3000);
    return () => window.clearTimeout(id);
  }, [lastConfirmedText]);

  useEffect(() => {
    if (!rouletteDemo) return;
    if (demoBootedRef.current) return;
    if (pendingLanding || demoSpin) return;
    const sourcePool = activeNormalPool.length > 0 ? activeNormalPool : DEMO_POOL;
    const shuffled = [...sourcePool].sort(() => Math.random() - 0.5);
    const selected = shuffled.slice(0, Math.max(1, Math.min(CONFIRMED_VISIBLE_SLOTS, shuffled.length)));
    const resultId = selected[selected.length - 1]?.id || null;
    if (selected.length === 0) return;
    demoBootedRef.current = true;
    setPendingLanding({
      selected,
      oneShot: buildOneShotFromSelected(selected),
      resultId,
      persist: false,
    });
    setShowResultPanel(false);
    setCurrentSignImageUrl("");
    setDemoSpin({ startedAt: Date.now(), resultId });
  }, [rouletteDemo, pendingLanding, demoSpin, activeNormalPool]);

  return (
    <main className="min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[1280px] space-y-4">
        <section
          style={{ ...overlayScaleStyle, backgroundColor: "transparent" }}
          className="relative flex flex-col items-center gap-4 p-0"
        >
          {lastConfirmedText ? (
            <div
              key={`confirmed-fx-${lastConfirmedFxKey}`}
              className="pointer-events-none absolute left-4 top-1/2 z-40 -translate-y-1/2 rounded-2xl border border-fuchsia-300/80 bg-fuchsia-500/25 px-5 py-3 text-3xl font-black text-fuchsia-100 shadow-[0_0_26px_rgba(217,70,239,0.6)] animate-pulse"
            >
              {lastConfirmedText}
            </div>
          ) : null}
          {showWheelVisual ? (
            <motion.div
              key={`wheel-wrap-${spinCompletionKey}`}
              className="flex w-full max-w-[1120px] flex-col items-center"
              initial={false}
              animate={{ opacity: wheelFadePhase === "fading" ? 0 : 1 }}
              transition={{ duration: revealMotionSec, ease: [0.4, 0, 0.2, 1] }}
              onAnimationComplete={() => {
                setWheelFadePhase((p) => (p === "fading" ? "off" : p));
              }}
            >
              <RouletteWheel
                items={wheelItemsWithResult}
                isRolling={wheelPhase === "spinning" || Boolean(demoSpin) || hasServerSpinToPlay}
                resultId={wheelResultSliceId}
                startedAt={demoSpin?.startedAt || machine.startedAt}
                scalePct={wheelScalePct}
                volume={0.7}
                muted={false}
                onTransitionEnd={() => {
                  if (phaseRef.current === "result") return;
                  const transitionKey = `${machine.startedAt}:${wheelResultSliceId || "none"}`;
                  if (transitionHandledKeyRef.current === transitionKey) return;
                  transitionHandledKeyRef.current = transitionKey;
                  dispatch({ type: "SETTLING" });
                  window.setTimeout(() => {
                    dispatch({ type: "LANDED" });
                  }, 280);
                }}
                onLanded={(landedId) => {
                  const selectedQueue = (pendingLanding?.selected || machine.selectedSigs || []).slice(0, CONFIRMED_VISIBLE_SLOTS);
                  if (selectedQueue.length === 0) return;
                  const snapSession = machine.sessionId;
                  const snapStarted = machine.startedAt;
                  const canonicalLand = landedId ? canonicalSigIdFromWheelSliceId(landedId) : null;
                  const expectedReal =
                    pendingLanding?.resultId ||
                    machine.resultId ||
                    selectedQueue[selectedQueue.length - 1]?.id ||
                    null;

                  const oneShot = buildOneShotFromSelected(selectedQueue);
                  const machineSpinKey = `${machine.startedAt || 0}:${machine.sessionId || ""}:${machine.resultId || ""}`;
                  completedSpinKeyRef.current = machineSpinKey;
                  const finalResultId =
                    pendingLanding?.resultId ||
                    machine.resultId ||
                    expectedReal ||
                    canonicalLand ||
                    selectedQueue[selectedQueue.length - 1]?.id ||
                    selectedQueue[0]!.id;
                  landed(selectedQueue, oneShot, finalResultId);
                  if (oneShotSound && !hasOneShotSoundErrorRef.current) {
                    oneShotSound.stop();
                    oneShotSound.play();
                  } else {
                    playFallbackOneShot();
                  }
                  setDemoSpin(null);
                  setPendingLanding(null);
                  setOverlayHoldResults(true);
                  setShowResultPanel(true);
                  setLastConfirmedText(`${selectedQueue.map((s) => s.name).join(", ")} 확정!`);
                  setLastConfirmedFxKey((v) => v + 1);
                  const signUrl = getSignImageUrl(finalResultId);
                  setCurrentSignImageUrl(signUrl || "");
                  if (!rouletteDemo && snapSession) {
                    void (async () => {
                      try {
                        const res = await fetch(`/api/roulette/land?user=${encodeURIComponent(userId)}`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            sessionId: snapSession,
                            startedAt: snapStarted,
                            selectedSigs: selectedQueue,
                            oneShotResult: oneShot,
                          }),
                        });
                        if (res.ok) void loadRemote();
                      } catch {
                        /* 네트워크 실패 시 HYDRATE 완화 로직으로 UX 유지 */
                      }
                    })();
                  }
                }}
              />
            </motion.div>
          ) : null}
          <AnimatePresence mode="wait">
            {resultOverlayVisible ? (
              <motion.div
                key={`result-${spinCompletionKey}`}
                initial={{ opacity: 0, y: 44 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                transition={{ duration: revealMotionSec, ease: [0.22, 1, 0.36, 1] }}
                className={hideWheelAfterComplete ? "relative z-30 w-full max-w-[1120px]" : "w-full max-w-[1120px]"}
              >
                <ResultOverlay
                  visible
                  selectedSigs={displaySelectedSigs}
                  soldOutStampUrl={soldOutStampUrl}
                  soldOverrideSet={inventorySoldOutIdSet}
                  oneShot={displayOneShot ? { name: displayOneShot.name, price: displayOneShot.price } : null}
                  signImageUrl={oneShotImageUrl || currentSignImageUrl}
                  showOneShotReveal={Boolean(displayOneShot && resultOverlayVisible)}
                  className="w-full max-w-[1120px]"
                  gifDelayMultiplier={sigGifDelayMultiplier}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
          {machine.phase === "CONFIRM_PENDING" ? (
            <div className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-black/55">
              <div className="rounded-xl border border-yellow-300/50 bg-neutral-900/90 px-6 py-4 text-center">
                <div className="mx-auto h-7 w-7 animate-spin rounded-full border-2 border-yellow-300 border-t-transparent" />
                <p className="mt-2 text-sm font-semibold text-yellow-100">판매 확정 처리 중...</p>
              </div>
            </div>
          ) : null}
          {machine.phase === "CONFIRMED" ? (
            <div className="mt-4 rounded-xl border border-emerald-300/60 bg-emerald-900/30 p-4 text-center">
              <p className="text-2xl font-black text-emerald-200">판매 확정 완료!</p>
              <p className="mt-1 text-sm text-emerald-100">
                {machine.selectedSigs.map((s) => s.name).join(", ")}
                {machine.oneShot?.name ? ` + ${machine.oneShot.name}` : ""}
              </p>
              <button type="button" onClick={resetToIdle} className="mt-3 rounded bg-emerald-500 px-4 py-1.5 text-sm font-bold text-black">
                새로운 회차 시작
              </button>
            </div>
          ) : null}
        </section>
        {showSigBoardRollingSection && state ? (
          <motion.div
            key={`sigboard-${spinCompletionKey}`}
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: revealMotionSec, ease: [0.22, 1, 0.36, 1] }}
          >
            <SigBoardRolling
              inventory={state.sigInventory || []}
              soldOutStampUrl={soldOutStampUrl}
              className="pb-2"
              gifDelayMultiplier={sigGifDelayMultiplier}
              autoAdvancePages={sigBoardDuringSpin}
            />
          </motion.div>
        ) : null}
      </div>
    </main>
  );
}
