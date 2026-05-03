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
import {
  getOverlayMemberFilterIdFromSearchParams,
  getOverlayUserIdFromSearchParams,
} from "@/lib/overlay-params";
import { resolveSigImageUrl, setSigImagePlaceholderOnlyForOverlay } from "@/lib/constants";
import {
  ONE_SHOT_SIG_ID,
  ROULETTE_WHEEL_SFX_ENABLED,
  SOUND_ASSETS_ENABLED,
  SPIN_SOUND_PATHS,
  canonicalSigIdFromWheelSliceId,
} from "@/lib/sig-roulette";
import { useSigSalesState } from "@/hooks/useSigSalesState";
import { useImagePreload } from "@/hooks/useImagePreload";

/**
 * [계약] 시그 판매 오버레이는 아래를 전제로 구현돼 있어야 한다(“될 수도”가 아님).
 * 1) 스핀 응답(및 이어지는 룰렛 상태)에 `selectedSigs[]`가 한 번에 담기면, 그것이 곧 해당 회차의 전체 당첨
 *    목록·순서다. 서버는 라운드마다 따로 값을 흘려보내는 모델이 아니다.
 * 2) 클라이언트는 위 배열을 받은 뒤, `sequentialRoundIndex` 등으로 휠·결과 카드 연출만 라운드별로 나누어
 *    재생한다. 연출 순서는 서버가 밀어주는 게 아니라 이 페이지의 상태·타이밍이 책임진다.
 * 3) `menuCount`·`minSpinCount`·`minWinsCount` 등 쿼리는 휠 **칸 수(표시)** 조절용이며, 당첨 개수·API `spinCount`와는 무관하다.
 */
const POLL_MS = 1000;
/** cinematic 스핀 최대 당첨 수와 맞춤(API spinCount·풀 한도). 예전 5슬롯 제한은 확대됨 */
const CONFIRMED_VISIBLE_SLOTS = 20;
const MIN_ONE_SHOT_SIGS = 2;
/** OBS 소스 로드 지연 등으로 오버레이가 늦게 붙어도 같은 회차 복원 허용 */
const RECENT_SPIN_WINDOW_MS = 180_000;
/** URL 미지정 시: 착지 직후 카드·게이트가 같은 틱에 열려 렉처럼 보이는 것 완화 */
const DEFAULT_RESULT_REVEAL_DELAY_MS = 480;
/** 순차 라운드: wheelPhase가 result가 된 뒤 카드 한 장을 올리기까지(ms) */
const DEFAULT_SEQUENTIAL_CARD_EMERGE_MS = 200;
/** 순차 라운드: 다음 회전 시작까지(ms). 기본 0 = 착지 직후 바로 다음 회전 */
const DEFAULT_SEQUENTIAL_NEXT_SPIN_MS = 0;
/** 저장소에 한글 파일명 PNG가 없으면 404만 줄줄이 나와 콘솔·미디어가 막히므로 공통 더미 사용 */
const DEMO_POOL = [
  { id: "demo_1", name: "애교", price: 77000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_2", name: "댄스", price: 100000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_3", name: "식사권", price: 333000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_4", name: "보이스", price: 50000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_5", name: "노래", price: 120000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_6", name: "토크", price: 55000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_7", name: "하트", price: 30000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
  { id: "demo_8", name: "게임", price: 88000, imageUrl: "/images/sigs/dummy-sig.svg", maxCount: 1, soldCount: 0, isRolling: true, isActive: true },
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
  const memberFilterId = getOverlayMemberFilterIdFromSearchParams(sp);
  const menuCountParam = (() => {
    const raw =
      sp.get("menuCount") ||
      sp.get("minSpinCount") ||
      sp.get("minWinsCount") ||
      sp.get("minWinCount") ||
      sp.get("wheelCount") ||
      sp.get("itemsCount") ||
      sp.get("winnersCount") ||
      sp.get("M") ||
      "";
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(5, Math.min(20, n));
  })();
  const rouletteDemo = sp.get("rouletteDemo") === "1" || sp.get("rouletteDemo") === "true";
  /**
   * 시그 PNG 없이 결과 UI만 볼 때: 모든 이미지를 더미 SVG로 고정(404·콘솔 스팸 방지).
   * 개발(`npm run dev`)에서는 기본 ON · 배포 빌드에서는 기본 OFF.
   * 강제 ON: `sigPlaceholder=1` · 실제 이미지 경로 사용: `sigPlaceholder=0`
   */
  const sigPlaceholderParam = sp.get("sigPlaceholder");
  const sigPlaceholder =
    sigPlaceholderParam === "1" || sigPlaceholderParam === "true"
      ? true
      : sigPlaceholderParam === "0" || sigPlaceholderParam === "false"
        ? false
        : process.env.NODE_ENV === "development";
  /** 로컬에서 순차 연출이 보이도록 타이밍만 살짝 늘림(?devSequentialTest=1) */
  const devSequentialTest =
    sp.get("devSequentialTest") === "1" ||
    String(sp.get("devSequentialTest") || "").toLowerCase() === "true";
  /** 기본: 시그 보드는 회전 완료·결과 패널과 함께만 표시. SPINNING 중에도 보이게 하려면 sigBoardDuringSpin=1 */
  const hideSigBoard =
    sp.get("hideSigBoard") === "1" ||
    String(sp.get("hideSigBoard") || "").toLowerCase() === "true" ||
    sp.get("sigBoard") === "0" ||
    String(sp.get("sigBoard") || "").toLowerCase() === "false";
  const sigBoardDuringSpin =
    sp.get("sigBoardDuringSpin") === "1" ||
    String(sp.get("sigBoardDuringSpin") || "").toLowerCase() === "true";
  /**
   * 기본: 당첨 결과(위 한 줄)만 쓰고, 아래 `SigBoardRolling`은 끔 → 이중 시그 줄 방지.
   * 인벤 롤링을 당첨과 같이 쓰려면 URL에 sigBoardWithResults=1
   */
  const allowSigBoardWithResults =
    sp.get("sigBoardWithResults") === "1" ||
    String(sp.get("sigBoardWithResults") || "").toLowerCase() === "true";
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
  /** 착지 후 이 시간(ms)이 지나야 시그 카드·휠 퇴장 연출 시작. `cardRevealDelayMs` 동의어. 미지정 시 기본 지연(즉시=0은 URL에 `resultRevealDelayMs=0`) */
  const resultRevealDelayMs = useMemo(() => {
    const raw = sp.get("resultRevealDelayMs") || sp.get("cardRevealDelayMs") || "";
    if (!raw.trim()) return DEFAULT_RESULT_REVEAL_DELAY_MS;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_RESULT_REVEAL_DELAY_MS;
    const base = Math.min(120_000, n);
    return devSequentialTest ? Math.max(base, 550) : base;
  }, [sp, devSequentialTest]);
  /** 휠 페이드·카드 슬라이드 duration (ms). `wheelFadeMs` 동의어 */
  const revealMotionMs = useMemo(() => {
    const raw = sp.get("revealMotionMs") || sp.get("wheelFadeMs") || "";
    if (!raw.trim()) return 550;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 550;
    return Math.max(200, Math.min(4000, n));
  }, [sp]);
  const revealMotionSec = revealMotionMs / 1000;
  /** 한방 시그 표시 후 회전판 페이드 시작까지 추가 대기(ms). `wheelFadeHoldMs` 동의어 */
  const wheelFadeAfterOneShotMs = useMemo(() => {
    const raw = sp.get("wheelFadeAfterOneShotMs") || sp.get("wheelFadeHoldMs") || "";
    if (!raw.trim()) return 650;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) return 650;
    return Math.min(12_000, n);
  }, [sp]);
  /** 당첨 시그 카드를 한 장씩 보이게 하는 간격(ms). `resultStaggerMs` 동의어 */
  const sigResultStaggerMs = useMemo(() => {
    const raw = sp.get("sigResultStaggerMs") || sp.get("resultStaggerMs") || "";
    if (!raw.trim()) return 750;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 750;
    return Math.max(120, Math.min(12000, n));
  }, [sp]);
  /** 순차 라운드당 카드 등장 지연. `sigRoundRevealDelayMs` 동의어 */
  const sequentialCardEmergeMs = useMemo(() => {
    const raw = sp.get("sequentialCardEmergeMs") || sp.get("sigRoundRevealDelayMs") || "";
    if (!raw.trim()) return DEFAULT_SEQUENTIAL_CARD_EMERGE_MS;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_SEQUENTIAL_CARD_EMERGE_MS;
    const base = Math.min(3000, n);
    return devSequentialTest ? Math.max(base, 420) : base;
  }, [sp, devSequentialTest]);
  /** 순차 라운드 사이 다음 스핀까지 대기(ms) */
  const sequentialNextSpinMs = useMemo(() => {
    const raw = sp.get("sequentialNextSpinMs") || "";
    if (!raw.trim()) return DEFAULT_SEQUENTIAL_NEXT_SPIN_MS;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_SEQUENTIAL_NEXT_SPIN_MS;
    const base = Math.max(0, Math.min(6000, n));
    return devSequentialTest ? Math.max(base, 600) : base;
  }, [sp, devSequentialTest]);
  const overlayScale = overlayScalePct / 100;
  const overlayScaleStyle = overlayScale === 1
    ? undefined
    : ({ transform: `scale(${overlayScale})`, transformOrigin: "top center" } as React.CSSProperties);
  const [state, setState] = useState<AppState | null>(null);
  const [pendingLanding, setPendingLanding] = useState<{ selected: SigItem[]; oneShot: { id: string; name: string; price: number } | null; resultId: string | null; persist: boolean } | null>(null);
  const [demoSpin, setDemoSpin] = useState<{ startedAt: number; resultId: string | null } | null>(null);
  const [showResultPanel, setShowResultPanel] = useState(false);
  /** 착지 후 서버가 잠시 SPINNING으로 폴링되어도 결과·회전판 숨김 UX 유지 */
  const [overlayHoldResults, setOverlayHoldResults] = useState(false);
  const [currentSignImageUrl, setCurrentSignImageUrl] = useState("");
  const [wheelPhase, dispatch] = useReducer(wheelReducer, "idle");
  /** 매 렌더 동기 갱신 — useEffect 만 쓰면 라운드2 착지 직전에도 'result'로 남아 onTransitionEnd 가 막힘 */
  const wheelPhaseSyncRef = useRef<WheelPhase>(wheelPhase);
  wheelPhaseSyncRef.current = wheelPhase;
  /** 착지 후 정지 연출이 끝나고 resultRevealDelayMs 경과 전까지 false → 시그 카드·휠 퇴장 지연 */
  const [revealGateOpen, setRevealGateOpen] = useState(true);
  const [wheelFadePhase, setWheelFadePhase] = useState<"on" | "fading" | "off">("on");
  const revealTimerRef = useRef<number | null>(null);
  const staggerTimersRef = useRef<number[]>([]);
  const staggerRanSessionRef = useRef("");
  const [revealedSigCount, setRevealedSigCount] = useState(0);
  const [oneShotRevealUnlocked, setOneShotRevealUnlocked] = useState(false);
  /** 한방 등장 직후 한 템포 쉰 뒤에야 회전판 페이드 시작 */
  const [postOneShotWheelFadeReady, setPostOneShotWheelFadeReady] = useState(true);
  /** [계약] 당첨 목록은 스핀 시점에 이미 확정·여기 인덱스는 서버 동기화용이 아니라 현재 몇 번째 휠 라운드 연출인지만 나타냄(0..n-1) */
  const [sequentialRoundIndex, setSequentialRoundIndex] = useState(0);
  /** 폴링/IDLE 순간에 selectedSigs 가 비어도 방송 화면에 당첨이 남도록 마지막 확정 목록 보존(초기화·신규 세션 때만 제거) */
  const [broadcastStickySigs, setBroadcastStickySigs] = useState<SigItem[] | null>(null);
  /**
   * 폴링으로 sessionId·startedAt 조합이 바뀌면 staggerAnchorKey 가 바뀌어 순차 회전 상태가 통째로 리셋됨(2번째 시그 미표시).
   * 당첨 큐가 처음 잡힐 때의 키를 고정해 같은 회차 동안 유지한다.
   */
  const [staggerSessionPin, setStaggerSessionPin] = useState<string | null>(null);
  const lastPinnedSessionIdRef = useRef<string | null>(null);
  const transitionHandledKeyRef = useRef("");
  /** onTransitionEnd 의 지연 LANDED — 순차 중간 라운드에서 다음 회전이 돌 때까지 반드시 취소해야 2회차 착지 콜백이 막히지 않음 */
  const wheelSettleLandTimerRef = useRef<number | null>(null);
  const handledSpinKeyRef = useRef("");
  const completedSpinKeyRef = useRef("");
  const wheelPhasePrevRef = useRef<WheelPhase>("idle");
  const demoBootedRef = useRef(false);
  /** rouletteDemo 최초 1회만 idle→START_SPIN 보정(라운드 간 타임아웃 스핀과 중복 안 함) */
  const demoWheelPrimedRef = useRef(false);
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
    setSigImagePlaceholderOnlyForOverlay(sigPlaceholder);
    return () => setSigImagePlaceholderOnlyForOverlay(false);
  }, [sigPlaceholder]);

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
    /** 서버 추첨 결과가 로컬 필터(멤버·비활성 등)에서 빠지면 wheelSlices=[] → 애니 미실행 → onLanded 미호출 → phase SPINNING 고착 */
    const serverWinners = [...(machine.selectedSigs || []), ...(pendingLanding?.selected || [])];
    for (const raw of serverWinners) {
      if (!raw?.id) continue;
      const canon = canonicalSigIdFromWheelSliceId(raw.id);
      const fromInv =
        state?.sigInventory?.find((x) => x.id === canon) ||
        state?.sigInventory?.find((x) => x.id === raw.id);
      unique.set(canon, fromInv ? { ...fromInv } : { ...raw, id: canon });
    }
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
  }, [
    activeNormalPool,
    menuCount,
    state,
    menuFillFromAllActive,
    menuFillFromDemo,
    machine.selectedSigs,
    pendingLanding?.selected,
  ]);

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

  const spinQueueSelected = useMemo(
    () =>
      (pendingLanding?.selected?.length ? pendingLanding.selected : machine.selectedSigs || []).slice(
        0,
        CONFIRMED_VISIBLE_SLOTS,
      ),
    [pendingLanding?.selected, machine.selectedSigs],
  );
  const useSequentialWheel = spinQueueSelected.length > 1;
  const sequentialRoundRealId = spinQueueSelected[sequentialRoundIndex]?.id ?? null;

  const wheelItemsWithResult = useMemo(() => {
    const base = [...wheelSlices];
    const rid =
      useSequentialWheel && sequentialRoundRealId
        ? sequentialRoundRealId
        : demoSpin?.resultId || machine.resultId || pendingLanding?.resultId || null;
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
    useSequentialWheel,
    sequentialRoundRealId,
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
      useSequentialWheel && sequentialRoundRealId
        ? sequentialRoundRealId
        : machine.resultId ||
          demoSpin?.resultId ||
          pendingLanding?.resultId ||
          (pendingLanding?.selected?.length ? pendingLanding.selected[pendingLanding.selected.length - 1]?.id : null) ||
          (machine.selectedSigs?.length ? machine.selectedSigs[machine.selectedSigs.length - 1]?.id : null) ||
          null;
    if (!realId || wheelItemsWithResult.length === 0) return null;
    const idx = wheelItemsWithResult.findIndex((s) => canonicalSigIdFromWheelSliceId(s.id) === realId);
    return idx >= 0 ? wheelItemsWithResult[idx]!.id : wheelItemsWithResult[wheelItemsWithResult.length - 1]!.id;
  }, [
    useSequentialWheel,
    sequentialRoundRealId,
    machine.resultId,
    demoSpin?.resultId,
    pendingLanding?.resultId,
    pendingLanding?.selected,
    machine.selectedSigs,
    wheelItemsWithResult,
  ]);
  /** 회전 중·착지 전에는 비우고, 착지 후에는 순차 공개용 전체 목록 */
  const fullSelectedSigs = useMemo(() => {
    const startedAtNum = Number(machine.startedAt || 0);
    /** startedAt 이 0이면「오래된 SPINNING」으로 오인해 당첨 배열을 비우면 안 됨(메타 누락·폴링 지연) */
    const spinningFreshEnough =
      machine.phase !== "SPINNING" ||
      rouletteDemo ||
      startedAtNum <= 0 ||
      Date.now() - startedAtNum <= RECENT_SPIN_WINDOW_MS;
    /** 서버 phase가 예전 회차 SPINNING으로 남아 있으면 OBS만 켠 것처럼 보일 때 카드가 미리 깔리는 현상 방지 */
    if (
      !rouletteDemo &&
      machine.phase === "SPINNING" &&
      !spinningFreshEnough &&
      !pendingLanding &&
      !demoSpin &&
      wheelPhase === "idle"
    ) {
      return [];
    }
    /**
     * 당첨 목록을 비울 때는 **로컬 휠 단계**만 본다. 서버 phase 가 오래 SPINNING 이더라도 휠이 이미 result 면 당첨 데이터를 채운다.
     * (그렇지 않으면 착지 후에도 displaySelectedSigs 가 비어 결과 패널이 영구히 안 뜸)
     * wheelPhase===result 인데도 demoSpin 이 남으면(콜백 순서·조기 return) 당첨 줄이 영구히 비지 않게 함.
     */
    const wheelAnimating = wheelPhase === "spinning" || wheelPhase === "settling";
    /** 순차 2회차 이후에도 demoSpin 이 남아 있으면 목록이 비워져 다음 회전·결과가 망가짐 */
    const demoSpinMasksQueue =
      Boolean(demoSpin) && !(useSequentialWheel && sequentialRoundIndex > 0);
    const inSpinUx =
      wheelPhase === "result"
        ? false
        : demoSpinMasksQueue
          ? true
          : useSequentialWheel
            ? /** 2회차 이상이면 revealedSigCount=0 이어도 1회차 당첨을 유지해야 함 */
              sequentialRoundIndex === 0 &&
              revealedSigCount === 0 &&
              (wheelAnimating || (wheelPhase === "idle" && machine.phase === "SPINNING"))
            : wheelAnimating || (wheelPhase === "idle" && machine.phase === "SPINNING");
    if (inSpinUx) return [];
    if (machine.selectedSigs.length > 0) return machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS);
    if (pendingLanding?.selected?.length) return pendingLanding.selected.slice(0, CONFIRMED_VISIBLE_SLOTS);
    if (broadcastStickySigs?.length) return broadcastStickySigs.slice(0, CONFIRMED_VISIBLE_SLOTS);
    return [];
  }, [
    machine.selectedSigs,
    machine.phase,
    machine.startedAt,
    rouletteDemo,
    pendingLanding,
    demoSpin,
    wheelPhase,
    useSequentialWheel,
    revealedSigCount,
    sequentialRoundIndex,
    broadcastStickySigs,
  ]);
  /**
   * startedAt 가 폴링 중 0→실값으로 바뀌면 키가 바뀌어 순차 상태가 초기화될 수 있음 → staggerSessionPin 으로 완화.
   */
  const staggerKeyLive = useMemo(() => {
    const sid = String(machine.sessionId || "").trim();
    if (sid) return `sid:${sid}`;
    return `at:${Number(machine.startedAt || 0)}`;
  }, [machine.sessionId, machine.startedAt]);
  const staggerAnchorKey = staggerSessionPin ?? staggerKeyLive;

  useEffect(() => {
    const hasWinners =
      (machine.selectedSigs?.length ?? 0) > 0 || Boolean(pendingLanding?.selected?.length);
    if (!hasWinners) return;
    setStaggerSessionPin((prev) => prev ?? staggerKeyLive);
  }, [staggerKeyLive, machine.selectedSigs?.length, pendingLanding?.selected?.length]);

  useEffect(() => {
    const idleClean =
      machine.phase === "IDLE" &&
      (machine.selectedSigs?.length ?? 0) === 0 &&
      !pendingLanding &&
      !demoSpin &&
      !rouletteDemo;
    if (idleClean) setStaggerSessionPin(null);
  }, [machine.phase, machine.selectedSigs?.length, pendingLanding, demoSpin, rouletteDemo]);
  const displaySelectedSigs = useMemo(() => {
    if (fullSelectedSigs.length === 0) return [];
    if (
      (wheelPhase === "spinning" || wheelPhase === "settling") &&
      (!useSequentialWheel || revealedSigCount === 0)
    ) {
      return [];
    }
    if (machine.phase === "CONFIRM_PENDING" || machine.phase === "CONFIRMED") {
      if (machine.phase === "CONFIRMED") return fullSelectedSigs;
      if (
        useSequentialWheel &&
        revealedSigCount > 0 &&
        revealedSigCount < fullSelectedSigs.length
      ) {
        return fullSelectedSigs.slice(0, Math.min(revealedSigCount, fullSelectedSigs.length));
      }
      return fullSelectedSigs;
    }
    if (useSequentialWheel && revealedSigCount > 0) {
      return fullSelectedSigs.slice(0, Math.min(revealedSigCount, fullSelectedSigs.length));
    }
    /** LANDED 만으로 열리면 휠 감속(settling) 중에도 카드가 나올 수 있어 제외 → wheelPhase result 이후만 순차 */
    const progressive =
      wheelPhase === "result" ||
      overlayHoldResults ||
      showResultPanel;
    if (progressive) {
      /** revealedSigCount 가 순차 공개 타이머(sequentialCardEmergeMs 등) 전에 0이면 slice(0,0) 이 되어 당첨 2개·멀티 라운드에서 결과 그리드가 비어 보임 */
      const cap =
        revealedSigCount === 0 && wheelPhase === "result" && fullSelectedSigs.length > 0
          ? 1
          : revealedSigCount;
      return fullSelectedSigs.slice(0, Math.min(cap, fullSelectedSigs.length));
    }
    /** LANDED인데 아직 wheelPhase가 result로 안 넘어온 타이밍은 빈 그리드 */
    if (machine.phase === "LANDED") {
      return [];
    }
    return fullSelectedSigs;
  }, [
    fullSelectedSigs,
    wheelPhase,
    overlayHoldResults,
    showResultPanel,
    revealedSigCount,
    machine.phase,
    useSequentialWheel,
  ]);
  const completedTargetCount = useMemo(() => {
    if (pendingLanding?.selected?.length) return Math.max(1, Math.min(CONFIRMED_VISIBLE_SLOTS, pendingLanding.selected.length));
    if (machine.selectedSigs?.length) return Math.max(1, Math.min(CONFIRMED_VISIBLE_SLOTS, machine.selectedSigs.length));
    return 1;
  }, [pendingLanding?.selected, machine.selectedSigs]);
  const oneShotEligibleAfterReveal = useMemo(
    () => buildOneShotFromSelected(machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS)),
    [machine.selectedSigs],
  );
  const staggerVisualComplete = useMemo(() => {
    if (machine.selectedSigs.length === 0) return true;
    if (revealedSigCount < completedTargetCount) return false;
    if (oneShotEligibleAfterReveal && !oneShotRevealUnlocked) return false;
    return true;
  }, [
    machine.selectedSigs.length,
    revealedSigCount,
    completedTargetCount,
    oneShotEligibleAfterReveal,
    oneShotRevealUnlocked,
  ]);

  const revealQueueKey = useMemo(() => {
    const fromMachine = machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS).map((s) => s.id).join(",");
    if (fromMachine.length > 0) return fromMachine;
    return (pendingLanding?.selected || []).slice(0, CONFIRMED_VISIBLE_SLOTS).map((s) => s.id).join(",");
  }, [machine.selectedSigs, pendingLanding?.selected]);

  useEffect(() => {
    if (wheelSettleLandTimerRef.current != null) {
      window.clearTimeout(wheelSettleLandTimerRef.current);
      wheelSettleLandTimerRef.current = null;
    }
    setRevealedSigCount(0);
    setOneShotRevealUnlocked(false);
    staggerRanSessionRef.current = "";
    setSequentialRoundIndex(0);
  }, [staggerAnchorKey]);

  useEffect(() => {
    if (wheelPhase !== "spinning" && wheelPhase !== "settling") return;
    /**
     * 당첨 2개 이상 순차 연출: 중간 라운드 직후 revealedSigCount 를 올려도,
     * 아직 sequentialRoundIndex===0 인 settling 프레임에서 이 effect 가 전부 0으로 되돌려
     * 결과 패널·2회차 진행이 망가졌음 → 멀티 큐 순차 모드에서는 여기서 초기화하지 않는다(세션 리셋은 staggerAnchorKey effect).
     */
    const queueLen = Math.max(
      pendingLanding?.selected?.length ?? 0,
      machine.selectedSigs?.length ?? 0,
    );
    if (useSequentialWheel && queueLen > 1) return;
    setRevealedSigCount(0);
    setOneShotRevealUnlocked(false);
  }, [
    wheelPhase,
    useSequentialWheel,
    pendingLanding?.selected?.length,
    machine.selectedSigs?.length,
  ]);

  useEffect(() => {
    if (useSequentialWheel) return;
    if (wheelPhase !== "result") return;
    if (staggerRanSessionRef.current === staggerAnchorKey) return;
    if (!revealQueueKey.length) return;
    const items = machine.selectedSigs.length
      ? machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS)
      : (pendingLanding?.selected || []).slice(0, CONFIRMED_VISIBLE_SLOTS);
    const n = items.length;
    if (n === 0) return;
    staggerRanSessionRef.current = staggerAnchorKey;
    const stagger = sigResultStaggerMs;
    for (let i = 1; i <= n; i++) {
      const tid = window.setTimeout(() => setRevealedSigCount(i), stagger * (i - 1));
      staggerTimersRef.current.push(tid);
    }
    if (buildOneShotFromSelected(items)) {
      const tid = window.setTimeout(() => setOneShotRevealUnlocked(true), stagger * n + stagger);
      staggerTimersRef.current.push(tid);
    }
  }, [
    useSequentialWheel,
    wheelPhase,
    staggerAnchorKey,
    sigResultStaggerMs,
    revealQueueKey,
    machine.selectedSigs,
    pendingLanding?.selected,
  ]);

  useEffect(() => {
    return () => {
      staggerTimersRef.current.forEach((x) => window.clearTimeout(x));
      staggerTimersRef.current = [];
    };
  }, []);

  /** 순차 연출: 마지막 시그 카드 공개 후 한방도 확실히 해제(onLanded 타임아웃만 의존하지 않음) */
  useEffect(() => {
    if (!oneShotEligibleAfterReveal) return;
    if (revealedSigCount < completedTargetCount) return;
    if (oneShotRevealUnlocked) return;
    const tid = window.setTimeout(() => setOneShotRevealUnlocked(true), sigResultStaggerMs);
    return () => window.clearTimeout(tid);
  }, [
    oneShotEligibleAfterReveal,
    revealedSigCount,
    completedTargetCount,
    oneShotRevealUnlocked,
    sigResultStaggerMs,
  ]);

  useEffect(() => {
    if (!oneShotEligibleAfterReveal) {
      setPostOneShotWheelFadeReady(true);
      return;
    }
    if (!oneShotRevealUnlocked) {
      setPostOneShotWheelFadeReady(false);
      return;
    }
    const tid = window.setTimeout(() => setPostOneShotWheelFadeReady(true), wheelFadeAfterOneShotMs);
    return () => window.clearTimeout(tid);
  }, [oneShotEligibleAfterReveal, oneShotRevealUnlocked, wheelFadeAfterOneShotMs]);

  const hideWheelAfterComplete =
    machine.selectedSigs.length >= completedTargetCount &&
    !pendingLanding &&
    !demoSpin &&
    wheelPhase !== "spinning" &&
    wheelPhase !== "settling" &&
    (wheelPhase === "result" || overlayHoldResults || showResultPanel) &&
    staggerVisualComplete;
  /** 모든 연출(개별 시그·한방) 완료 후 + 한방 직후 버퍼까지 지나야 회전판 페이드 시작 */
  const wheelFadeScheduled = useMemo(
    () => hideWheelAfterComplete && postOneShotWheelFadeReady,
    [hideWheelAfterComplete, postOneShotWheelFadeReady],
  );
  /**
   * 회차 단위로만 바뀌게 함. selectedSigs/resultId를 넣으면 landed() 직후 키가 바뀌어
   * 결과 패널·휠 래퍼가 통째로 리마운트되며 카드가 한꺼번에 다시 그려지는 현상 발생.
   */
  const spinCompletionKey = useMemo(() => {
    /** demoSpin 시작 시점으로 키가 바뀌면 휠·결과 트리가 리마운트되어 회전 애니가 끊김 → 데모는 고정 키 */
    if (rouletteDemo) return "roulette-demo";
    const sid = String(machine.sessionId || "").trim();
    /** startedAt 폴링 지연으로 키가 바뀌며 순차 회전이 끊기지 않게 sessionId 우선 */
    if (sid) return `spin:${sid}`;
    return `spin:t-${Number(machine.startedAt || 0)}`;
  }, [rouletteDemo, machine.sessionId, machine.startedAt]);
  const showWheelVisual = useMemo(
    () => !wheelFadeScheduled || !revealGateOpen || wheelFadePhase !== "off",
    [wheelFadeScheduled, revealGateOpen, wheelFadePhase],
  );
  /**
   * 스핀 중 showResultPanel=false 이어도 당첨 시그가 이미 확정되어 있으면 결과 그리드를 반드시 연다.
   * (그리드 데이터만 채우고 패널을 숨기면「돌다가 비었다가 한꺼번에」가 그대로 발생함)
   */
  /** 휠용 revealGate 와 별개로 당첨 패널은 스티키·hold 면 항상 표시 가능 */
  const resultsPanelGateOpen =
    revealGateOpen ||
    overlayHoldResults ||
    (broadcastStickySigs?.length ?? 0) > 0 ||
    showResultPanel;
  const resultOverlayVisible = Boolean(
    resultsPanelGateOpen &&
      (displaySelectedSigs.length > 0 || oneShotRevealUnlocked) &&
      (machine.phase === "IDLE"
        ? rouletteDemo || (broadcastStickySigs?.length ?? 0) > 0
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

  const oneShotForResultOverlay = useMemo(() => {
    if (!oneShotRevealUnlocked) return null;
    return (
      machine.oneShot ||
      buildOneShotFromSelected(machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS))
    );
  }, [oneShotRevealUnlocked, machine.oneShot, machine.selectedSigs]);
  const showSigBoardRollingSection = useMemo(() => {
    if (hideSigBoard || !state || (state.sigInventory || []).length === 0) return false;
    if (displaySelectedSigs.length > 0 && resultOverlayVisible && !allowSigBoardWithResults) return false;
    if (sigBoardDuringSpin) return true;
    return Boolean(hideWheelAfterComplete && showResultPanel && resultsPanelGateOpen);
  }, [
    hideSigBoard,
    state,
    displaySelectedSigs.length,
    resultOverlayVisible,
    allowSigBoardWithResults,
    sigBoardDuringSpin,
    hideWheelAfterComplete,
    showResultPanel,
    resultsPanelGateOpen,
  ]);
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
  /** pendingLanding 복원 전·서버 isRolling 불일치 때도 휠 프레임이 돌아가야 함 */
  const hasServerSpinToPlay = useMemo(() => {
    const hasSelection = Boolean(
      pendingLanding?.selected?.length || machine.selectedSigs?.length,
    );
    return (
      machine.phase === "SPINNING" &&
      Boolean(machine.sessionId) &&
      hasSelection
    );
  }, [
    machine.phase,
    machine.sessionId,
    pendingLanding?.selected?.length,
    machine.selectedSigs?.length,
  ]);
  /** RouletteWheel 은 startedAt 이 없으면 스핀 시퀀스 자체를 시작하지 않음 → session_ 타임스탬프로 보강 */
  const wheelAnimationStartedAt = useMemo(() => {
    const t = Number(machine.startedAt || 0);
    if (t > 0) return t;
    const sid = String(machine.sessionId || "");
    const m = /^session_(\d+)$/.exec(sid);
    if (m) return Number(m[1]);
    return demoSpin?.startedAt ?? 0;
  }, [machine.startedAt, machine.sessionId, demoSpin?.startedAt]);
  useImagePreload(oneShotImageUrl);
  useImagePreload(currentSignImageUrl);

  /** 순차 회전: result 전환 직후 한 프레임에 카드가 붙는 느낌 완화 → 짧은 지연 후 +1 */
  useEffect(() => {
    const prev = wheelPhasePrevRef.current;
    let tid: number | undefined;
    if (
      useSequentialWheel &&
      prev === "settling" &&
      wheelPhase === "result"
    ) {
      const cap = Math.min(
        CONFIRMED_VISIBLE_SLOTS,
        Math.max(1, spinQueueSelected.length),
      );
      tid = window.setTimeout(() => {
        setRevealedSigCount((n) => Math.min(n + 1, cap));
      }, sequentialCardEmergeMs);
    }
    wheelPhasePrevRef.current = wheelPhase;
    return () => {
      if (tid !== undefined) window.clearTimeout(tid);
    };
  }, [wheelPhase, useSequentialWheel, spinQueueSelected.length, sequentialCardEmergeMs]);

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
    /** 한방 시그가 방금 열렸으면 잠시 후에 페이드(회전판만 서서히) */
    if (!postOneShotWheelFadeReady) {
      return;
    }
    /** 당첨 카드는 broadcastSticky·hold 동안 휠 페이드와 무관하게 유지 → 깜빡임 방지 */
    const keepResults =
      overlayHoldResults ||
      (broadcastStickySigs?.length ?? 0) > 0 ||
      showResultPanel;
    if (keepResults) {
      setRevealGateOpen(true);
      setWheelFadePhase("fading");
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
  }, [
    hideWheelAfterComplete,
    postOneShotWheelFadeReady,
    resultRevealDelayMs,
    overlayHoldResults,
    broadcastStickySigs,
    showResultPanel,
  ]);

  useEffect(() => {
    // 오버레이가 서버 상태만으로도 재생될 수 있도록 대기열을 자동 복원한다.
    if (pendingLanding || demoSpin) return;
    const machineSpinKey = `${machine.startedAt || 0}:${machine.sessionId || ""}:${machine.resultId || ""}`;
    if (machineSpinKey === completedSpinKeyRef.current) return;
    const selectedFromServer = (machine.selectedSigs || []).slice(0, CONFIRMED_VISIBLE_SLOTS);
    if (selectedFromServer.length === 0) return;
    const startedAt = Number(machine.startedAt || 0);
    const withinWindow = startedAt > 0 && Date.now() - startedAt <= RECENT_SPIN_WINDOW_MS;
    /** startedAt 만 빠졌을 때(session_* 등은 있음) OBS 복원 가능해야 함 */
    const recentEnough = withinWindow || (startedAt <= 0 && Boolean(machine.sessionId));
    if (!recentEnough) return;
    if (machine.phase !== "SPINNING" && machine.phase !== "LANDED") return;
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
    machine.startedAt,
    machine.sessionId,
  ]);

  useEffect(() => {
    if (rouletteDemo) return;
    // appState 수신 전 기본 IDLE이면 건드리지 않음(HYDRATE SPINNING과 경쟁 방지)
    if (!state) return;
    if (machine.phase !== "IDLE") return;
    if (wheelSettleLandTimerRef.current != null) {
      window.clearTimeout(wheelSettleLandTimerRef.current);
      wheelSettleLandTimerRef.current = null;
    }
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
    setSequentialRoundIndex(0);
  }, [machine.phase, state, rouletteDemo]);

  useEffect(() => {
    if (machine.phase !== "SPINNING" && machine.phase !== "LANDED") return;
    if (!pendingLanding && !demoSpin) return;
    const spinKey = `${machine.startedAt || 0}:${machine.sessionId || ""}:${machine.resultId || ""}`;
    if (spinKey === completedSpinKeyRef.current) return;
    if (handledSpinKeyRef.current === spinKey) return;
    /** startedAt 이 저장 상태에서 빠져도 sessionId 가 있으면 스핀 라운드 시작 */
    if (!machine.sessionId && Number(machine.startedAt || 0) <= 0) return;
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
    if (!rouletteDemo || !demoSpin || !pendingLanding?.selected?.length) return;
    if (wheelPhase !== "idle") return;
    if (demoWheelPrimedRef.current) return;
    demoWheelPrimedRef.current = true;
    dispatch({ type: "RESET" });
    dispatch({ type: "START_SPIN" });
  }, [rouletteDemo, demoSpin, pendingLanding?.selected?.length, wheelPhase]);

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

  useEffect(() => {
    if (machine.selectedSigs.length > 0) {
      setBroadcastStickySigs(machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS));
    }
  }, [machine.selectedSigs]);

  useEffect(() => {
    const sid = String(machine.sessionId || "").trim();
    if (machine.phase === "SPINNING" && sid) {
      if (lastPinnedSessionIdRef.current !== null && lastPinnedSessionIdRef.current !== sid) {
        setBroadcastStickySigs(null);
      }
      lastPinnedSessionIdRef.current = sid;
    }
    if (machine.phase === "IDLE" && !sid && machine.selectedSigs.length === 0) {
      lastPinnedSessionIdRef.current = null;
      setBroadcastStickySigs(null);
    }
  }, [machine.phase, machine.sessionId, machine.selectedSigs]);

  return (
    <main className="relative min-h-screen bg-transparent p-4 text-white">
      <div className="mx-auto max-w-[1280px] space-y-4">
        <section className="relative flex w-full flex-col items-center gap-4 bg-transparent p-0">
          <div
            style={
              overlayScaleStyle
                ? { ...overlayScaleStyle, backgroundColor: "transparent" }
                : { backgroundColor: "transparent" }
            }
            className="relative mx-auto flex w-full max-w-[1120px] flex-col items-center gap-0"
          >
          {showWheelVisual ? (
            <motion.div
              key={`wheel-wrap-${spinCompletionKey}`}
              className="flex w-full shrink-0 justify-center"
              initial={false}
              animate={{ opacity: wheelFadePhase === "fading" ? 0 : 1 }}
              transition={{ duration: revealMotionSec, ease: [0.4, 0, 0.2, 1] }}
              onAnimationComplete={() => {
                setWheelFadePhase((p) => (p === "fading" ? "off" : p));
              }}
            >
              <RouletteWheel
                key={`wheel-${sequentialRoundIndex}-${wheelResultSliceId || "none"}`}
                spinReplayNonce={useSequentialWheel ? sequentialRoundIndex : 0}
                items={wheelItemsWithResult}
                /** settling 동안 false면 휠 effect가 조기 종료·정리되어 onTransitionEnd/onLanded 이후에도 상태가 꼬일 수 있음 */
                isRolling={
                  wheelPhase === "spinning" ||
                  wheelPhase === "settling" ||
                  Boolean(demoSpin) ||
                  hasServerSpinToPlay
                }
                resultId={wheelResultSliceId}
                startedAt={demoSpin?.startedAt || wheelAnimationStartedAt}
                scalePct={wheelScalePct}
                volume={0.7}
                muted={false}
                onTransitionEnd={() => {
                  if (wheelPhaseSyncRef.current !== "spinning") return;
                  const transitionKey = `${machine.startedAt}:${wheelResultSliceId || "none"}:${useSequentialWheel ? sequentialRoundIndex : 0}`;
                  if (transitionHandledKeyRef.current === transitionKey) return;
                  transitionHandledKeyRef.current = transitionKey;
                  dispatch({ type: "SETTLING" });
                  if (wheelSettleLandTimerRef.current != null) {
                    window.clearTimeout(wheelSettleLandTimerRef.current);
                    wheelSettleLandTimerRef.current = null;
                  }
                  wheelSettleLandTimerRef.current = window.setTimeout(() => {
                    wheelSettleLandTimerRef.current = null;
                    dispatch({ type: "LANDED" });
                  }, 280);
                }}
                onLanded={(landedId) => {
                  const selectedQueue = (pendingLanding?.selected || machine.selectedSigs || []).slice(0, CONFIRMED_VISIBLE_SLOTS);
                  if (selectedQueue.length === 0) {
                    setDemoSpin(null);
                    setOverlayHoldResults(true);
                    setShowResultPanel(true);
                    if (!rouletteDemo) void loadRemote();
                    return;
                  }

                  const seqMulti = selectedQueue.length > 1;
                  const lastIdx = selectedQueue.length - 1;
                  const isLastRound = sequentialRoundIndex >= lastIdx;

                  if (seqMulti) {
                    if (!isLastRound) {
                      /** 지연 LANDED 가 다음 회전 애니 중에 실행되면 wheelPhase 가 spinning 이 아니게 되어 2회차 onTransitionEnd 가 전부 막힘 */
                      if (wheelSettleLandTimerRef.current != null) {
                        window.clearTimeout(wheelSettleLandTimerRef.current);
                        wheelSettleLandTimerRef.current = null;
                      }
                      /**
                       * 순차 연출: 중간 라운드는 wheel settle→result 타이머를 끊어 revealedSigCount 가 안 오름.
                       * 그러면 displaySelectedSigs 가 (spinning||settling)&&revealedSigCount===0 에 계속 걸려 결과 패널이 비고,
                       * 다음 회전 중에도 「아무 것도 안 나옴」처럼 보임 → 방금 착지한 라운드까지 반영해 공개 개수 올림.
                       */
                      const revealedAfterRound = Math.min(
                        sequentialRoundIndex + 1,
                        selectedQueue.length,
                        CONFIRMED_VISIBLE_SLOTS,
                      );
                      setRevealedSigCount((c) => Math.max(c, revealedAfterRound));
                      /** 중간 회차에서도 당첨 카드·progressive 가 꺼지지 않게 함(2번째 회전 전에 사라짐 방지) */
                      setOverlayHoldResults(true);
                      setShowResultPanel(true);
                      transitionHandledKeyRef.current = "";
                      window.setTimeout(() => {
                        setSequentialRoundIndex((v) => v + 1);
                        dispatch({ type: "RESET" });
                        dispatch({ type: "START_SPIN" });
                      }, sequentialNextSpinMs);
                      return;
                    }
                  }

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
                  if (buildOneShotFromSelected(selectedQueue)) {
                    window.setTimeout(() => setOneShotRevealUnlocked(true), sigResultStaggerMs);
                  }
                  if (ROULETTE_WHEEL_SFX_ENABLED) {
                    if (oneShotSound && !hasOneShotSoundErrorRef.current) {
                      oneShotSound.stop();
                      oneShotSound.play();
                    } else {
                      playFallbackOneShot();
                    }
                  }
                  setDemoSpin(null);
                  setPendingLanding(null);
                  setOverlayHoldResults(true);
                  setShowResultPanel(true);
                  const signUrl = getSignImageUrl(finalResultId);
                  setCurrentSignImageUrl(signUrl || "");
                  if (!rouletteDemo && snapSession) {
                    void (async () => {
                      try {
                        const res = await fetch(`/api/roulette/land?user=${encodeURIComponent(userId)}`, {
                          method: "POST",
                          credentials: "include",
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
          {/* 휠 아래·왼쪽(방송 화면 기준 시그 결과 영역). 회전판 페이드와 무관하게 유지 */}
          <div
            className={`pointer-events-none relative z-[70] w-full max-w-[min(22rem,min(100%,92vw))] shrink-0 self-start overflow-x-hidden overflow-y-auto px-3 pb-2 pt-1 max-h-[min(46vh,520px)] md:max-w-[24rem] md:px-5 md:pb-3 md:pt-2 ${showWheelVisual ? "mt-2 md:mt-3" : "mt-0"}`}
            aria-live="polite"
          >
            <div className="pointer-events-auto">
              <AnimatePresence>
                {resultOverlayVisible ? (
                  <motion.div
                    key={`result-${spinCompletionKey}`}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0.95, y: 8 }}
                    transition={{ duration: Math.min(0.35, revealMotionSec), ease: [0.22, 1, 0.36, 1] }}
                    className="w-full drop-shadow-[0_4px_24px_rgba(0,0,0,0.65)]"
                  >
                    <ResultOverlay
                      visible
                      selectedSigs={displaySelectedSigs}
                      soldOutStampUrl={soldOutStampUrl}
                      soldOverrideSet={inventorySoldOutIdSet}
                      oneShot={oneShotForResultOverlay}
                      signImageUrl={oneShotImageUrl || currentSignImageUrl}
                      showOneShotReveal={Boolean(oneShotForResultOverlay)}
                      className="w-full"
                      gifDelayMultiplier={sigGifDelayMultiplier}
                      entranceOnlyLatest
                    />
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
          </div>
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
