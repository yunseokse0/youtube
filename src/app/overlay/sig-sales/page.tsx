"use client";

import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { Howl } from "howler";
import type { SigItem } from "@/types";

const RouletteWheel = dynamic(() => import("@/components/sig-sales/RouletteWheel"), {
  ssr: false,
});
import { layoutSigOverlayResultRow } from "@/components/sig-sales/sig-overlay-card-size";

const ResultOverlay = dynamic(() => import("@/components/sig-sales/ResultOverlay"), {
  ssr: false,
});
const SigBoardRolling = dynamic(() => import("@/components/sig-sales/SigBoardRolling"), {
  ssr: false,
});
import { loadStateFromApi, loadState, storageKey, type AppState } from "@/lib/state";
import {
  getOverlayMemberFilterIdFromSearchParams,
  getOverlayUserIdFromSearchParams,
  inferSigUploadUserIdFromInventory,
  shouldSuppressOverlaySseConnection,
} from "@/lib/overlay-params";
import { DEFAULT_SIG_SOLD_STAMP_URL, resolveSigImageUrl, setSigImagePlaceholderOnlyForOverlay } from "@/lib/constants";
import {
  ONE_SHOT_SIG_ID,
  ROULETTE_WHEEL_SFX_ENABLED,
  SOUND_ASSETS_ENABLED,
  SPIN_SOUND_PATHS,
  buildSessionSpinExclusion,
  buildSigSalesWheelDisplayPool,
  resolveWheelSlicesForSpinVisual,
  sigEligibleForSessionSpinPool,
  clampSigSalesMenuCount,
  resolveSigSalesMenuCount,
  canonicalSigIdFromWheelSliceId,
  hydrateSigItemFromInventory,
  sigMatchesMemberFilter,
  rememberUsedWheelSliceId,
  resolveSpinQueueForSession,
  bindWheelAnimationToRoundWinner,
  findSliceIndexForResult,
  type SpinQueueSessionPin,
  sanitizeWheelDisplayName,
  wheelSliceMatchesServerWinner,
} from "@/lib/sig-roulette";
import { useSigSalesState } from "@/hooks/useSigSalesState";
import { useImagePreload } from "@/hooks/useImagePreload";
import { useSSEConnection } from "@/lib/sse-client";
import {
  createStateUpdatedScheduler,
  readOverlayPollIntervalMs,
  readOverlaySseFallbackPollMs,
  readSigSalesOverlayPollMs,
  shouldSyncOverlayFromStateUpdatedEvent,
  shouldSyncSigSalesFromRouletteSseHint,
  sigSalesPhaseRank,
  sigSalesRouletteSyncCursorFromState,
  type SigSalesRouletteSyncCursor,
} from "@/lib/overlay-pull-policy";
import {
  WHEEL_DEMO_MENU_COUNT,
  WHEEL_DEMO_WIN_COUNT,
  getWheelDemoMenuCountFromSearchParams,
  getWheelDemoWinCountFromSearchParams,
  isWheelDemoAutoSpinFromSearchParams,
  isWheelDemoModeFromSearchParams,
  mergeWheelDemoSigInventory,
  pickWheelDemoWinners,
} from "@/lib/sig-wheel-demo-pool";

/**
 * [계약] 시그 판매 오버레이는 아래를 전제로 구현돼 있어야 한다(“될 수도”가 아님).
 * 1) 스핀 응답(및 이어지는 룰렛 상태)에 `selectedSigs[]`가 한 번에 담기면, 그것이 곧 해당 회차의 전체 당첨
 *    목록·순서다. 서버는 라운드마다 따로 값을 흘려보내는 모델이 아니다.
 * 2) 클라이언트는 위 배열을 받은 뒤, `sequentialRoundIndex` 등으로 휠·결과 카드 연출만 라운드별로 나누어
 *    재생한다. 연출 순서는 서버가 밀어주는 게 아니라 이 페이지의 상태·타이밍이 책임진다.
 * 3) `menuCount` 쿼리만 휠 **칸 수(표시)** 를 덮어씀(미지정 시 서버 저장값). `minSpinCount` 등은 당첨 회차와 혼동되므로 칸 수에 쓰지 않음.
 * 4) `winnersOnly=1`·`onlyWinners=1`: 확정 당첨 시그만 회전판에 올리고(미당첨 메뉴 숨김), 시그 보드 롤링은 끈다. 당첨 전(IDLE)에는 기존처럼 전체 풀.
 * 5) 서버가 `selectedSigs[]`를 한 번에 주더라도 프론트는 항상 한 장씩 순차 회전·공개한다(멀티 당첨 연출 고정).
 *    CONFIRM_PENDING 에도 `revealedSigCount` 로 같은 속도를 유지한다(관리자 확정 클릭 직후 한꺼번에 깔리지 않게).
 * 6) `sigResultScalePct` / `resultScalePct`: 확정 카드 줄만 추가 축소(zoom%, 기본 78). URL이 없으면 관리자에 저장된 `rouletteState.sigResultScalePct` 사용.
 */
/** 기본은 폴링 없음(SSE·변동 시 GET). `overlayPollMs` URL은 로드 시 제거됨. */
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
const MANUAL_SIG_DRAFT_STATE_KEY = "sigSalesManualDraftV1";
const MANUAL_SIG_DRAFT_STORAGE_PREFIX = "admin-sig-sales-manual-draft-v1";
const DEMO_SIG_PRESET_IDS = new Set([
  "sig_aegyo",
  "sig_dance",
  "sig_meal",
  "sig_voice",
  "sig_song",
  "sig_talk",
  "sig_heart",
  "sig_game",
]);

function isDemoPlaceholderSig(item: SigItem): boolean {
  const id = String(item?.id || "").trim();
  const imageUrl = String(item?.imageUrl || "").toLowerCase();
  return DEMO_SIG_PRESET_IDS.has(id) || imageUrl.includes("dummy-sig.svg");
}

const buildOneShotFromSelected = (selected: SigItem[]) => {
  if (selected.length < MIN_ONE_SHOT_SIGS) return null;
  return {
    id: ONE_SHOT_SIG_ID,
    name: "한방 시그",
    price: selected.reduce((sum, x) => sum + x.price, 0),
  };
};

function resolveOverlayWheelStartedAt(startedAt: number, sessionId: string): number {
  const t = Number(startedAt || 0);
  if (t > 0) return t;
  const m = /^session_(\d+)$/.exec(String(sessionId || "").trim());
  if (m) return Number(m[1]);
  return Date.now();
}

/** 순차 연출 중 `machine.result`(마지막 당첨 id)가 바뀌어도 스핀 재시작 키가 흔들리지 않게 함 */
function overlaySpinSessionKey(startedAt: number, sessionId: string): string {
  return `${Number(startedAt) || 0}:${String(sessionId || "").trim()}`;
}

/** OBS: 서버 SPINNING 수신 시 휠·당첨 큐를 한 번에 맞춤(슬라이스 id·startedAt 정합) */
function bootstrapOverlaySpinPlayback(
  selected: SigItem[],
  spinVisualSlices: SigItem[],
  startedAt: number,
  sessionId: string,
  usedSliceIds?: ReadonlySet<string>
): {
  pendingLanding: {
    selected: SigItem[];
    oneShot: { id: string; name: string; price: number } | null;
    resultId: string | null;
    persist: boolean;
  };
  demoSpin: { startedAt: number; resultId: string | null };
} {
  const firstBound = bindWheelAnimationToRoundWinner({
    wheelSlices: spinVisualSlices,
    roundWinner: selected[0] ?? null,
    roundIndex: 0,
    usedSliceIds,
  });
  const spinStartedAt = resolveOverlayWheelStartedAt(startedAt, sessionId);
  const rid = firstBound.animationResultId || firstBound.sliceId || selected[0]?.id || null;
  return {
    pendingLanding: {
      selected,
      oneShot: buildOneShotFromSelected(selected),
      resultId: rid,
      persist: true,
    },
    /** resultId 는 휠 `wheelAnimationResultId` 전용 — demo 에 넣으면 2회차에 1회차 착지 id 로 다시 돎 */
    demoSpin: {
      startedAt: spinStartedAt,
      resultId: null,
    },
  };
}
type WheelPhase = "idle" | "spinning" | "settling" | "result";
const wheelReducer = (state: WheelPhase, action: { type: string }): WheelPhase => {
  switch (action.type) {
    case "START_SPIN":
      return "spinning";
    case "SETTLING":
      return state === "spinning" ? "settling" : state;
    case "LANDED":
      return "result";
    case "RESET":
      return "idle";
    default:
      return state;
  }
};

/** SSR·Suspense fallback·클라이언트 첫 페인트가 동일한 `<main>` — 하이드레이션 불일치 방지 */
function OverlayHydrationShell({
  message = "오버레이 불러오는 중…",
}: {
  message?: string;
}) {
  return (
    <main className="relative min-h-[100dvh] max-h-[100dvh] overflow-hidden bg-neutral-950 px-3 py-3 text-white sm:px-5 sm:py-4">
      <p className="flex min-h-[50dvh] items-center justify-center text-sm text-neutral-300">{message}</p>
    </main>
  );
}

export default function SigSalesOverlayPage() {
  return (
    <Suspense fallback={<OverlayHydrationShell />}>
      <SigSalesOverlayPageInner />
    </Suspense>
  );
}

function SigSalesOverlayPageInner() {
  const sp = useSearchParams();
  const manualModeParam =
    String(sp.get("mode") || "").toLowerCase() === "manual" ||
    String(sp.get("overlayMode") || "").toLowerCase() === "manual";
  const userId = getOverlayUserIdFromSearchParams(sp);
  const [clientBoot, setClientBoot] = useState<{ ready: boolean; host: string | null }>({
    ready: false,
    host: null,
  });
  useEffect(() => {
    setClientBoot({ ready: true, host: window.location.hostname });
  }, []);
  const clientHost = clientBoot.host;
  const wheelDemoActive = useMemo(
    () => (manualModeParam ? false : clientHost != null ? isWheelDemoModeFromSearchParams(sp, clientHost) : false),
    [sp, clientHost, manualModeParam]
  );
  const wheelDemoAutoSpin = useMemo(
    () => isWheelDemoAutoSpinFromSearchParams(sp, wheelDemoActive),
    [sp, wheelDemoActive]
  );
  const memberFilterId = getOverlayMemberFilterIdFromSearchParams(sp);
  const menuCountParam = (() => {
    const demoMenu = getWheelDemoMenuCountFromSearchParams(sp, wheelDemoActive);
    if (demoMenu != null) return demoMenu;
    const raw = sp.get("menuCount") || "";
    if (!raw.trim()) return null;
    return clampSigSalesMenuCount(raw);
  })();
  /**
   * 시그 PNG 없이 결과 UI만 볼 때: 모든 이미지를 더미 SVG로 고정(404·콘솔 스팸 방지).
   * 기본 OFF. 강제 ON: `sigPlaceholder=1` · 명시 OFF: `sigPlaceholder=0`
   */
  const sigPlaceholderParam = sp.get("sigPlaceholder");
  /** 기본 OFF — 실제 시그 이미지 사용. 더미만: `?sigPlaceholder=1` */
  const sigPlaceholder =
    sigPlaceholderParam === "1" || sigPlaceholderParam === "true"
      ? true
      : sigPlaceholderParam === "0" || sigPlaceholderParam === "false"
        ? false
        : false;
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
  /**
   * 개별 당첨 미니 카드 숨기고 한방 시그만(하단 고정). 방송 합산 강조용.
   * `hanbangOnly=1` · `oneShotOnly=1` (동의어)
   */
  const hanbangOnlyResultLayout =
    sp.get("hanbangOnly") === "1" ||
    String(sp.get("hanbangOnly") || "").toLowerCase() === "true" ||
    sp.get("oneShotOnly") === "1" ||
    String(sp.get("oneShotOnly") || "").toLowerCase() === "true";
  /** 회전판·연출에서 미당첨 시그 숨김. 동의어: onlyWinners */
  const winnersOnlyOverlay =
    sp.get("winnersOnly") === "1" ||
    String(sp.get("winnersOnly") || "").toLowerCase() === "true" ||
    sp.get("onlyWinners") === "1" ||
    String(sp.get("onlyWinners") || "").toLowerCase() === "true";
  /** mode=manual 이면 회전판 대신 결과 패널 중심으로 표시 */
  const manualOverlayMode = manualModeParam;
  const overlayScalePct = (() => {
    const raw = sp.get("scalePct") || sp.get("zoomPct") || "100";
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(50, Math.min(300, n));
  })();
  const wheelScalePct = (() => {
    const raw = sp.get("wheelScalePct") || sp.get("wheelPct") || "100";
    const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return 100;
    return Math.max(55, Math.min(140, n));
  })();
  /** GIF 프레임 배수(1=원본·부드러움, 1 초과=느리게). `sigGifSpeed` 동의어. 느린 캔버스 연출은 1보다 큰 값 */
  const sigGifDelayMultiplier = (() => {
    const raw = sp.get("sigGifDelay") || sp.get("sigGifSpeed") || "";
    if (!raw.trim()) return 1;
    const n = parseFloat(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(10, n));
  })();
  /** 착지 후 이 시간(ms)이 지나야 시그 카드·휠 퇴장 연출 시작. `cardRevealDelayMs` 동의어. 미지정 시 기본 지연(즉시=0은 URL에 `resultRevealDelayMs=0`) */
  const resultRevealDelayMs = useMemo(() => {
    const raw = sp.get("resultRevealDelayMs") || sp.get("cardRevealDelayMs") || "";
    if (!raw.trim()) return DEFAULT_RESULT_REVEAL_DELAY_MS;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_RESULT_REVEAL_DELAY_MS;
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
    return Math.min(3000, n);
  }, [sp]);
  /** 순차 라운드 사이 다음 스핀까지 대기(ms) */
  const sequentialNextSpinMs = useMemo(() => {
    const raw = sp.get("sequentialNextSpinMs") || "";
    if (!raw.trim()) return DEFAULT_SEQUENTIAL_NEXT_SPIN_MS;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n) || n < 0) return DEFAULT_SEQUENTIAL_NEXT_SPIN_MS;
    return Math.max(0, Math.min(6000, n));
  }, [sp]);
  const overlayScale = overlayScalePct / 100;
  /**
   * 휠만 작게 두면(`wheelScalePct` 낮음) 휠 열만 보정(scale). 확정 카드까지 같이 키우면 한 화면에 안 들어가므로
   * 부스트는 휠·플레이스홀더 래퍼에만 적용한다. 끄려면 `wheelBoost=0`
   */
  const wheelColumnBoost =
    sp.get("wheelBoost") === "0" || String(sp.get("noWheelBoost") || "").toLowerCase() === "true"
      ? 1
      : wheelScalePct < 85
        ? Math.min(1.38, 85 / Math.max(55, wheelScalePct))
        : 1;
  const overlayUserScaleStyle =
    Math.abs(overlayScale - 1) < 0.001
      ? undefined
      : ({
          transform: `scale(${overlayScale})`,
          transformOrigin: "top center",
        } as React.CSSProperties);
  const wheelColumnBoostScaleStyle =
    Math.abs(wheelColumnBoost - 1) < 0.001
      ? undefined
      : ({
          transform: `scale(${wheelColumnBoost})`,
          transformOrigin: "top center",
        } as React.CSSProperties);
  const [state, setState] = useState<AppState | null>(null);
  const [manualDraftFromLocal, setManualDraftFromLocal] = useState<{
    drafts?: Array<{ name?: string; priceInput?: string; imageUrl?: string }>;
    oneShotName?: string;
    oneShotPriceInput?: string;
    oneShotImageUrl?: string;
  } | null>(null);
  const wheelInventory = useMemo(() => {
    const merged = mergeWheelDemoSigInventory(state?.sigInventory, wheelDemoActive);
    if (wheelDemoActive) return merged;
    // 실방송/OBS에서는 기본 데모 시그(더미 이미지 포함)를 회전판/보드 후보에서 제외한다.
    return merged.filter((item) => !isDemoPlaceholderSig(item));
  }, [state?.sigInventory, wheelDemoActive]);
  /** OBS URL `u=` 가 틀려도 인벤 업로드 경로에서 이미지 계정을 맞춤(관리자 미리보기와 동일) */
  const sigImageUserId = useMemo(
    () => inferSigUploadUserIdFromInventory(state?.sigInventory, userId),
    [state?.sigInventory, userId]
  );
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
  /** [계약] 당첨 목록은 스핀 시점에 이미 확정·여기 인덱스는 서버 동기화용이 아니라 현재 몇 번째 휠 라운드 연출인지만 나타냄(0..n-1) */
  const [sequentialRoundIndex, setSequentialRoundIndex] = useState(0);
  const sequentialRoundIndexRef = useRef(0);
  sequentialRoundIndexRef.current = sequentialRoundIndex;
  /** 한 sessionId 동안 휠 칸 배치 고정 — 중간 폴링으로 `__wslot_n`↔시그 매핑이 바뀌면 2회차 착지가 엇갈림 */
  const [pinnedWheelLayout, setPinnedWheelLayout] = useState<{
    sessionId: string;
    queueSig: string;
    slices: SigItem[];
  } | null>(null);
  const usedWheelSliceIdsRef = useRef<Set<string>>(new Set());
  const spinQueuePinRef = useRef<SpinQueueSessionPin>({ sessionId: "", queue: [] });
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
  const wheelDemoAutoRanRef = useRef(false);
  const wheelPhasePrevRef = useRef<WheelPhase>("idle");
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
  const overlayReloadSeenRef = useRef<number | null>(null);

  const lastSyncedUpdatedAtRef = useRef(0);
  const lastRouletteSyncRef = useRef<SigSalesRouletteSyncCursor>({ sessionId: "", phase: "" });
  const loadRemote = useCallback(async (opts?: { forceFull?: boolean }) => {
    const remote = await loadStateFromApi(userId, {
      ifUpdatedSince: opts?.forceFull ? 0 : lastSyncedUpdatedAtRef.current,
      forceFull: opts?.forceFull,
      pick: manualOverlayMode ? undefined : "sig-sales",
    });
    if (!remote) return;
    const ts = remote.updatedAt || 0;
    if (ts > 0) lastSyncedUpdatedAtRef.current = Math.max(lastSyncedUpdatedAtRef.current, ts);
    lastRouletteSyncRef.current = sigSalesRouletteSyncCursorFromState(remote.rouletteState);
    setState(remote);
  }, [userId, manualOverlayMode]);

  const loadRemoteRef = useRef(loadRemote);
  loadRemoteRef.current = loadRemote;
  const scheduleSseLoadRef = useRef<(() => void) | null>(null);
  const { connected: sseConnected } = useSSEConnection((d: unknown) => {
    const o = d as {
      type?: string;
      updatedAt?: number;
      roulettePhase?: string;
      rouletteSessionId?: string;
    };
    if (o?.type !== "state_updated") return;
    const rouletteHint = shouldSyncSigSalesFromRouletteSseHint(o, lastRouletteSyncRef.current);
    if (
      !rouletteHint &&
      !shouldSyncOverlayFromStateUpdatedEvent(o.updatedAt, lastSyncedUpdatedAtRef.current)
    ) {
      return;
    }
    if (rouletteHint) {
      const sid = String(o.rouletteSessionId || lastRouletteSyncRef.current.sessionId || "").trim();
      const phase = String(o.roulettePhase || lastRouletteSyncRef.current.phase || "").trim();
      if (sid) lastRouletteSyncRef.current = { sessionId: sid, phase };
    }
    scheduleSseLoadRef.current?.();
  });

  useEffect(() => {
    setSigImagePlaceholderOnlyForOverlay(sigPlaceholder);
    return () => setSigImagePlaceholderOnlyForOverlay(false);
  }, [sigPlaceholder]);

  useEffect(() => {
    if (!manualOverlayMode) return;
    if (typeof window === "undefined") return;
    const key = `${MANUAL_SIG_DRAFT_STORAGE_PREFIX}:${userId || "default"}`;
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        setManualDraftFromLocal(null);
        return;
      }
      const parsed = JSON.parse(raw) as {
        drafts?: Array<{ name?: string; priceInput?: string; imageUrl?: string }>;
        oneShotName?: string;
        oneShotPriceInput?: string;
        oneShotImageUrl?: string;
      };
      setManualDraftFromLocal(parsed && typeof parsed === "object" ? parsed : null);
    } catch {
      setManualDraftFromLocal(null);
    }
  }, [manualOverlayMode, userId, state?.updatedAt]);

  useEffect(() => {
    const { schedule, cancel } = createStateUpdatedScheduler(() => {
      /** SSE는 updatedAt만 전달 → 304·since 경합 시 SPINNING을 놓치지 않도록 전체 본문 수신 */
      void loadRemoteRef.current({ forceFull: true });
    });
    scheduleSseLoadRef.current = schedule;
    if (shouldSuppressOverlaySseConnection()) {
      try {
        const local = loadState(userId ?? undefined);
        if (local) setState(local);
        else void loadRemote();
      } catch {
        void loadRemote();
      }
    } else {
      void loadRemote({ forceFull: true });
    }
    const pollMs = readOverlayPollIntervalMs();
    const sigSalesPollMs = pollMs > 0 ? 0 : readSigSalesOverlayPollMs();
    let pollId: number | undefined;
    if (pollMs > 0) pollId = window.setInterval(() => void loadRemote(), pollMs);
    let sigSalesPollId: number | undefined;
    if (sigSalesPollMs > 0) {
      sigSalesPollId = window.setInterval(() => {
        void loadRemoteRef.current();
      }, sigSalesPollMs);
    }
    const sseFallbackMs = pollMs > 0 || sigSalesPollMs > 0 ? 0 : readOverlaySseFallbackPollMs();
    let sseFallbackId: number | undefined;
    if (sseFallbackMs > 0 && !sseConnected) {
      sseFallbackId = window.setInterval(() => void loadRemote(), sseFallbackMs);
    }
    const key = storageKey(userId ?? undefined);
    let storageDebounce: ReturnType<typeof setTimeout> | null = null;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return;
      /** 관리자 iframe: 부모가 이미 localStorage에 최신을 썼으므로 GET 생략 */
      if (shouldSuppressOverlaySseConnection()) {
        try {
          const local = loadState(userId ?? undefined);
          if (local) setState(local);
        } catch {
          /* noop */
        }
        return;
      }
      if (storageDebounce) clearTimeout(storageDebounce);
      storageDebounce = setTimeout(() => {
        storageDebounce = null;
        void loadRemote();
      }, 400);
    };
    window.addEventListener("storage", onStorage);
    const onPageShow = (ev: PageTransitionEvent) => {
      if (ev.persisted) lastSyncedUpdatedAtRef.current = 0;
      void loadRemoteRef.current({ forceFull: true });
    };
    window.addEventListener("pageshow", onPageShow);
    return () => {
      cancel();
      scheduleSseLoadRef.current = null;
      if (pollId) window.clearInterval(pollId);
      if (sigSalesPollId) window.clearInterval(sigSalesPollId);
      if (sseFallbackId) window.clearInterval(sseFallbackId);
      if (storageDebounce) clearTimeout(storageDebounce);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [loadRemote, userId, sseConnected]);
  useEffect(() => {
    const nonce = Number(state?.rouletteState?.overlayReloadNonce || 0);
    if (!Number.isFinite(nonce)) return;
    if (overlayReloadSeenRef.current == null) {
      overlayReloadSeenRef.current = nonce;
      return;
    }
    if (nonce !== overlayReloadSeenRef.current) {
      overlayReloadSeenRef.current = nonce;
      window.location.reload();
    }
  }, [state?.rouletteState?.overlayReloadNonce]);

  useEffect(() => {
    return () => {
      oneShotSound?.unload();
      try { audioCtxRef.current?.close(); } catch {}
      audioCtxRef.current = null;
    };
  }, [oneShotSound]);

  // 결과 배치는 운영자가 reset 할 때까지 유지한다.

  const soldOutStampUrl = (state?.sigSoldOutStampUrl || "").trim() || DEFAULT_SIG_SOLD_STAMP_URL;
  const menuCountSetting = useMemo(() => {
    if (menuCountParam != null) return menuCountParam;
    return clampSigSalesMenuCount(state?.rouletteState?.menuCount);
  }, [menuCountParam, state?.rouletteState?.menuCount]);
  const menuFillFromAllActive = useMemo(() => {
    const raw = (sp.get("menuFillFromAllActive") || "").toLowerCase();
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return state?.rouletteState?.menuFillFromAllActive === true;
  }, [sp, state?.rouletteState?.menuFillFromAllActive]);
  /** URL 우선. 미지정 시 서버 저장 `rouletteState.sigResultScalePct`(기본 78). 동의어: `resultScalePct` */
  const sigResultScalePctUrlOverride = useMemo(() => {
    const raw = sp.get("sigResultScalePct") || sp.get("resultScalePct") || "";
    if (!raw.trim()) return null;
    const n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(n)) return null;
    return Math.max(50, Math.min(100, n));
  }, [sp]);
  const sigResultScalePct = useMemo(() => {
    if (sigResultScalePctUrlOverride != null) return sigResultScalePctUrlOverride;
    const persisted = Number(state?.rouletteState?.sigResultScalePct);
    if (Number.isFinite(persisted)) return Math.max(50, Math.min(100, Math.floor(persisted)));
    return 78;
  }, [sigResultScalePctUrlOverride, state?.rouletteState?.sigResultScalePct]);
  const activeNormalPool = useMemo(() => {
    if (!state) return [];
    const excluded = new Set((state.sigSalesExcludedIds || []).map((x) => String(x)));
    const sessionExclusion = buildSessionSpinExclusion(
      wheelInventory,
      state.rouletteState?.sessionExcludedSigIds
    );
    return wheelInventory.filter(
      (x) =>
        x.isActive &&
        x.id !== ONE_SHOT_SIG_ID &&
        !excluded.has(x.id) &&
        sigEligibleForSessionSpinPool(x, sessionExclusion) &&
        x.soldCount < x.maxCount &&
        sigMatchesMemberFilter(x, memberFilterId)
    );
  }, [state, wheelInventory, memberFilterId]);
  const effectiveMenuCount = useMemo(
    () => resolveSigSalesMenuCount(menuCountSetting, activeNormalPool.length),
    [menuCountSetting, activeNormalPool.length]
  );
  /**
   * 당첨 큐 단일 소스(휠·결과 카드·순차 인덱스). 서버 `selectedSigs` 우선.
   */
  const spinQueueSelected = useMemo(() => {
    const resolved = resolveSpinQueueForSession(
      spinQueuePinRef.current,
      machine.sessionId || "",
      machine.selectedSigs || [],
      pendingLanding?.selected?.length
        ? pendingLanding.selected
        : broadcastStickySigs || [],
      CONFIRMED_VISIBLE_SLOTS
    );
    spinQueuePinRef.current = resolved.pin;
    if (resolved.queue.length > 0) return resolved.queue;
    return (broadcastStickySigs || []).slice(0, CONFIRMED_VISIBLE_SLOTS);
  }, [
    machine.selectedSigs,
    machine.sessionId,
    pendingLanding?.selected,
    broadcastStickySigs,
  ]);
  const useSequentialWheel = spinQueueSelected.length > 1;
  const rouletteHasWinnerQueue =
    machine.phase === "SPINNING" ||
    machine.phase === "LANDED" ||
    machine.phase === "CONFIRM_PENDING" ||
    machine.phase === "CONFIRMED";
  const wheelDisplayPool = useMemo(() => {
    if (!state) return [];
    return buildSigSalesWheelDisplayPool({
      inventory: wheelInventory,
      sigSalesExcludedIds: state.sigSalesExcludedIds,
      sessionExcludedSigIds: state.rouletteState?.sessionExcludedSigIds,
      memberFilterId,
      menuCount: effectiveMenuCount,
      menuFillFromAllActive,
      ensureItems: [...(machine.selectedSigs || []), ...(pendingLanding?.selected || [])],
    });
  }, [
    state,
    wheelInventory,
    memberFilterId,
    effectiveMenuCount,
    menuFillFromAllActive,
    machine.selectedSigs,
    pendingLanding?.selected,
  ]);

  /** 회전 연출·OBS 휠 표시 칸(기본: 메뉴 풀 N칸). `winnersOnly` URL만 당첨 큐 칸 */
  const wheelVisualSlices = useMemo(
    () =>
      resolveWheelSlicesForSpinVisual({
        menuPool: wheelDisplayPool,
        menuCount: effectiveMenuCount,
        winnersOnly: winnersOnlyOverlay,
        winnerQueue: spinQueueSelected,
        pinnedSlices: null,
      }),
    [wheelDisplayPool, effectiveMenuCount, winnersOnlyOverlay, spinQueueSelected]
  );

  useEffect(() => {
    const sid = String(machine.sessionId || "").trim();
    if (!sid || machine.phase === "IDLE") {
      setPinnedWheelLayout(null);
      usedWheelSliceIdsRef.current = new Set();
      return;
    }
    if (wheelVisualSlices.length === 0) return;
    if (
      machine.phase !== "SPINNING" &&
      machine.phase !== "LANDED" &&
      machine.phase !== "CONFIRM_PENDING" &&
      machine.phase !== "CONFIRMED"
    ) {
      return;
    }
    const queueSig = (machine.selectedSigs || pendingLanding?.selected || [])
      .slice(0, CONFIRMED_VISIBLE_SLOTS)
      .map((s) => canonicalSigIdFromWheelSliceId(s.id))
      .join(",");
    setPinnedWheelLayout((prev) => {
      if (prev?.sessionId === sid && prev.slices.length > 0) return prev;
      usedWheelSliceIdsRef.current = new Set();
      return { sessionId: sid, queueSig, slices: wheelVisualSlices };
    });
  }, [machine.phase, machine.sessionId, wheelVisualSlices, machine.selectedSigs, pendingLanding?.selected]);

  const currentRoundWinner = useMemo(
    () =>
      spinQueueSelected.length > 0
        ? spinQueueSelected[Math.min(sequentialRoundIndex, spinQueueSelected.length - 1)] ?? null
        : null,
    [spinQueueSelected, sequentialRoundIndex]
  );
  const priorRoundWinners = useMemo(
    () => spinQueueSelected.slice(0, Math.max(0, sequentialRoundIndex)),
    [spinQueueSelected, sequentialRoundIndex]
  );
  const wheelSpinning =
    wheelPhase === "spinning" ||
    wheelPhase === "settling" ||
    Boolean(demoSpin) ||
    machine.phase === "SPINNING";
  /** 착지 직후 `result` 에서도 resultId 유지 — effect 조기 cleanup 으로 각도·스냅이 끊기는 것 방지 */
  const wheelKeepsSpinBinding =
    wheelSpinning || wheelPhase === "result";

  const wheelSlicesForSpin = useMemo(
    () =>
      resolveWheelSlicesForSpinVisual({
        menuPool: wheelDisplayPool,
        menuCount: effectiveMenuCount,
        winnersOnly: winnersOnlyOverlay,
        winnerQueue: spinQueueSelected,
        pinnedSlices:
          pinnedWheelLayout?.sessionId === machine.sessionId
            ? pinnedWheelLayout.slices
            : null,
      }),
    [
      wheelDisplayPool,
      effectiveMenuCount,
      winnersOnlyOverlay,
      spinQueueSelected,
      pinnedWheelLayout,
      machine.sessionId,
    ]
  );

  const wheelRoundBinding = useMemo(
    () =>
      bindWheelAnimationToRoundWinner({
        wheelSlices: wheelSlicesForSpin,
        roundWinner: currentRoundWinner,
        roundIndex: useSequentialWheel ? sequentialRoundIndex : 0,
        usedSliceIds: useSequentialWheel ? usedWheelSliceIdsRef.current : undefined,
        priorWinners: useSequentialWheel ? priorRoundWinners : undefined,
      }),
    [
      wheelSlicesForSpin,
      currentRoundWinner,
      useSequentialWheel,
      sequentialRoundIndex,
      priorRoundWinners,
    ]
  );

  const wheelItemsWithResult = wheelRoundBinding.items;

  /** 당첨 카드(`hydrateSigItemFromInventory`)와 동일한 재고 이름 — 롤링 메타 짧은 라벨만 쓰면 휠·카드 문구가 달라 보임 */
  const getWheelLabel = useCallback(
    (item: SigItem) => {
      const canon = canonicalSigIdFromWheelSliceId(item.id);
      const fromInv =
        wheelInventory.find((x) => x.id === canon) ||
        wheelInventory.find((x) => x.id === item.id) ||
        state?.sigInventory?.find((x) => x.id === canon) ||
        state?.sigInventory?.find((x) => x.id === item.id);
      const raw = String(fromInv?.name || item.name || "").trim() || canon;
      return sanitizeWheelDisplayName(raw) || raw;
    },
    [wheelInventory, state?.sigInventory]
  );

  const wheelResultSliceId = wheelRoundBinding.sliceId;
  const wheelAnimationResultId = wheelRoundBinding.animationResultId;
  const wheelTargetSliceIndex = wheelRoundBinding.targetSliceIndex;

  useEffect(() => {
    if (!currentRoundWinner || !wheelResultSliceId) return;
    if (!wheelSliceMatchesServerWinner(wheelResultSliceId, currentRoundWinner)) {
      console.warn("[sig-sales overlay] wheel target slice ≠ current round winner", {
        round: sequentialRoundIndex,
        sliceId: wheelResultSliceId,
        winnerId: currentRoundWinner.id,
        winnerName: currentRoundWinner.name,
      });
    }
  }, [
    wheelResultSliceId,
    currentRoundWinner,
    sequentialRoundIndex,
  ]);
  /** 회전 중·착지 전에는 비우고, 착지 후에는 순차 공개용 전체 목록 */
  const fullSelectedSigs = useMemo(() => {
    const startedAtNum = Number(machine.startedAt || 0);
    /** startedAt 이 0이면「오래된 SPINNING」으로 오인해 당첨 배열을 비우면 안 됨(메타 누락·폴링 지연) */
    const spinningFreshEnough =
      machine.phase !== "SPINNING" ||
      startedAtNum <= 0 ||
      Date.now() - startedAtNum <= RECENT_SPIN_WINDOW_MS;
    /** 서버 phase가 예전 회차 SPINNING으로 남아 있으면 OBS만 켠 것처럼 보일 때 카드가 미리 깔리는 현상 방지 */
    if (
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
    const queue = spinQueueSelected;
    if (queue.length > 0) return queue;
    if (
      broadcastStickySigs?.length &&
      (overlayHoldResults ||
        machine.phase === "LANDED" ||
        machine.phase === "CONFIRM_PENDING" ||
        machine.phase === "CONFIRMED")
    ) {
      return broadcastStickySigs.slice(0, CONFIRMED_VISIBLE_SLOTS);
    }
    return [];
  }, [
    spinQueueSelected,
    machine.phase,
    machine.startedAt,
    pendingLanding,
    demoSpin,
    wheelPhase,
    useSequentialWheel,
    revealedSigCount,
    sequentialRoundIndex,
    broadcastStickySigs,
    overlayHoldResults,
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
      !demoSpin;
    if (idleClean) {
      setStaggerSessionPin(null);
      spinQueuePinRef.current = { sessionId: "", queue: [] };
    }
  }, [machine.phase, machine.selectedSigs?.length, pendingLanding, demoSpin]);
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
      /** 확정 처리 중(CONFIRM_PENDING)도 LANDED·progressive와 같은 cap으로 유지한다. */
      const cap =
        revealedSigCount === 0 && fullSelectedSigs.length > 0 ? 1 : revealedSigCount;
      return fullSelectedSigs.slice(0, Math.min(cap, fullSelectedSigs.length));
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
      /** OBS 새로고침·서버 LANDED 복원: hold 중인데 휠 연출이 idle이면 당첨 전부 표시(관리자와 동기) */
      const serverCatchUp =
        (overlayHoldResults || showResultPanel) &&
        machine.phase === "LANDED" &&
        wheelPhase !== "spinning" &&
        wheelPhase !== "settling";
      /** revealedSigCount 가 순차 공개 타이머(sequentialCardEmergeMs 등) 전에 0이면 slice(0,0) 이 되어 당첨 2개·멀티 라운드에서 결과 그리드가 비어 보임 */
      const cap = serverCatchUp
        ? fullSelectedSigs.length
        : revealedSigCount === 0 && wheelPhase === "result" && fullSelectedSigs.length > 0
          ? 1
          : revealedSigCount;
      return fullSelectedSigs.slice(0, Math.min(cap, fullSelectedSigs.length));
    }
    /** LANDED인데 아직 wheelPhase가 result로 안 넘어온 타이밍은 빈 그리드 */
    if (machine.phase === "LANDED") {
      if (overlayHoldResults || showResultPanel) {
        return fullSelectedSigs.slice(0, fullSelectedSigs.length);
      }
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
  /** 당첨 배열을 재고와 맞춰 휠 라벨·이미지와 동일 시그로 표시 */
  const displaySelectedSigsForUi = useMemo(() => {
    const hydrated = displaySelectedSigs.map((s) => hydrateSigItemFromInventory(s, wheelInventory, sigImageUserId));
    if (!manualOverlayMode) return hydrated;
    return hydrated.filter((item) => !isDemoPlaceholderSig(item));
  }, [displaySelectedSigs, wheelInventory, sigImageUserId, manualOverlayMode]);
  const manualDraftFromState = useMemo(() => {
    if (!manualOverlayMode) return null;
    const os = state?.overlaySettings;
    if (!os || typeof os !== "object") return null;
    const raw = (os as Record<string, unknown>)[MANUAL_SIG_DRAFT_STATE_KEY];
    if (!raw || typeof raw !== "object") return null;
    return raw as {
      drafts?: Array<{ name?: string; priceInput?: string; imageUrl?: string }>;
      oneShotName?: string;
      oneShotPriceInput?: string;
      oneShotImageUrl?: string;
    };
  }, [manualOverlayMode, state?.overlaySettings]);
  const manualDraftFromUrl = useMemo(() => {
    if (!manualOverlayMode) return null;
    const drafts = Array.from({ length: 5 }, (_, idx) => {
      const n = idx + 1;
      const name = String(sp.get(`m${n}n`) || "").trim();
      const priceInput = String(sp.get(`m${n}p`) || "").trim();
      const imageUrl = String(sp.get(`m${n}i`) || "").trim();
      return { name, priceInput, imageUrl };
    });
    const hasAnyDraft = drafts.some((x) => x.name || x.priceInput || x.imageUrl);
    const oneShotName = String(sp.get("osn") || "").trim();
    const oneShotPriceInput = String(sp.get("osp") || "").trim();
    const oneShotImageUrl = String(sp.get("osi") || "").trim();
    if (!hasAnyDraft && !oneShotName && !oneShotPriceInput && !oneShotImageUrl) return null;
    return {
      drafts,
      oneShotName,
      oneShotPriceInput,
      oneShotImageUrl,
    };
  }, [manualOverlayMode, sp]);
  /** 서버 저장 초안 우선 — OBS URL을 매번 바꿀 필요 없음(URL 초안은 레거시·오프라인 폴백) */
  const manualDraftEffective = manualDraftFromState || manualDraftFromUrl || manualDraftFromLocal;
  const manualDraftSelectedForUi = useMemo(() => {
    const rows = Array.isArray(manualDraftEffective?.drafts) ? manualDraftEffective!.drafts : [];
    return rows
      .map((row, idx) => {
        const name = String(row?.name || "").trim();
        const digits = String(row?.priceInput || "").replace(/[^\d]/g, "");
        const price = digits ? Math.max(0, Math.floor(Number.parseInt(digits, 10) || 0)) : 0;
        if (!name || price <= 0) return null;
        return {
          id: `manual_draft_${idx + 1}`,
          name,
          price,
          imageUrl: String(row?.imageUrl || "").trim(),
          memberId: "",
          maxCount: 1,
          soldCount: 0,
          isRolling: true,
          isActive: true,
        } as SigItem;
      })
      .filter((x): x is SigItem => Boolean(x));
  }, [manualDraftEffective]);
  const effectiveSelectedSigsForUi = useMemo(() => {
    if (!manualOverlayMode) return displaySelectedSigsForUi;
    return displaySelectedSigsForUi.length > 0 ? displaySelectedSigsForUi : manualDraftSelectedForUi;
  }, [manualOverlayMode, displaySelectedSigsForUi, manualDraftSelectedForUi]);
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
  /** 개별 당첨 시그만 모두 공개됐는지(한방 카드는 제외) — 회전판은 여기까지만 기다렸다가 페이드 */
  const individualSigsRevealDone = useMemo(() => {
    if (machine.selectedSigs.length === 0) return true;
    return revealedSigCount >= completedTargetCount;
  }, [machine.selectedSigs.length, revealedSigCount, completedTargetCount]);

  const revealQueueKey = useMemo(() => {
    const fromMachine = machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS).map((s) => s.id).join(",");
    if (fromMachine.length > 0) return fromMachine;
    return (pendingLanding?.selected || []).slice(0, CONFIRMED_VISIBLE_SLOTS).map((s) => s.id).join(",");
  }, [machine.selectedSigs, pendingLanding?.selected]);

  const prevStaggerAnchorKeyRef = useRef(staggerAnchorKey);
  useEffect(() => {
    if (wheelSettleLandTimerRef.current != null) {
      window.clearTimeout(wheelSettleLandTimerRef.current);
      wheelSettleLandTimerRef.current = null;
    }
    if (prevStaggerAnchorKeyRef.current !== staggerAnchorKey) {
      prevStaggerAnchorKeyRef.current = staggerAnchorKey;
      setRevealedSigCount(0);
      setSequentialRoundIndex(0);
      sequentialRoundIndexRef.current = 0;
      usedWheelSliceIdsRef.current = new Set();
      spinQueuePinRef.current = { sessionId: "", queue: [] };
      setOneShotRevealUnlocked(false);
      staggerRanSessionRef.current = "";
    }
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

  /** 개별 당첨 카드가 전부 공개되면 회전판 제거(한방 로딩·페이드와 무관) */
  const hideWheelAfterComplete = useMemo(() => {
    if (pendingLanding || demoSpin) return false;
    if (wheelPhase === "spinning" || wheelPhase === "settling") return false;
    if (completedTargetCount < 1) return false;
    return (
      revealedSigCount >= completedTargetCount &&
      displaySelectedSigs.length >= completedTargetCount &&
      individualSigsRevealDone
    );
  }, [
    pendingLanding,
    demoSpin,
    wheelPhase,
    completedTargetCount,
    revealedSigCount,
    displaySelectedSigs.length,
    individualSigsRevealDone,
  ]);
  /**
   * 회차 단위로만 바뀌게 함. selectedSigs/resultId를 넣으면 landed() 직후 키가 바뀌어
   * 결과 패널·휠 래퍼가 통째로 리마운트되며 카드가 한꺼번에 다시 그려지는 현상 발생.
   */
  const spinCompletionKey = useMemo(() => {
    const sid = String(machine.sessionId || "").trim();
    /** startedAt 폴링 지연으로 키가 바뀌며 순차 회전이 끊기지 않게 sessionId 우선 */
    if (sid) return `spin:${sid}`;
    return `spin:t-${Number(machine.startedAt || 0)}`;
  }, [machine.sessionId, machine.startedAt]);
  const showWheelVisual = !hideWheelAfterComplete && !manualOverlayMode;
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
  const manualModeHasResults =
    manualOverlayMode &&
    (effectiveSelectedSigsForUi.length > 0 ||
      Boolean(machine.oneShot) ||
      Boolean(String(manualDraftEffective?.oneShotPriceInput || "").replace(/[^\d]/g, "")) ||
      Boolean(buildOneShotFromSelected(machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS))));
  const resultOverlayVisible = Boolean(
    (manualModeHasResults || resultsPanelGateOpen) &&
      (manualOverlayMode
        ? effectiveSelectedSigsForUi.length > 0 ||
          Boolean(machine.oneShot) ||
          Boolean(String(manualDraftEffective?.oneShotPriceInput || "").replace(/[^\d]/g, ""))
        : displaySelectedSigs.length > 0 || oneShotRevealUnlocked) &&
      (machine.phase === "IDLE"
        ? manualModeHasResults || (broadcastStickySigs?.length ?? 0) > 0
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
    if (!manualOverlayMode && !oneShotRevealUnlocked) return null;
    if (!manualOverlayMode && effectiveSelectedSigsForUi.length < MIN_ONE_SHOT_SIGS) return null;
    const draftOneShot = manualOverlayMode
      ? (() => {
          const digits = String(manualDraftEffective?.oneShotPriceInput || "").replace(/[^\d]/g, "");
          const price = digits ? Math.max(0, Math.floor(Number.parseInt(digits, 10) || 0)) : 0;
          const autoPrice = effectiveSelectedSigsForUi.reduce((sum, x) => sum + Math.max(0, Math.floor(Number(x.price || 0))), 0);
          const finalPrice = price > 0 ? price : autoPrice;
          if (finalPrice <= 0) return null;
          return {
            id: ONE_SHOT_SIG_ID,
            name: String(manualDraftEffective?.oneShotName || "한방 시그").trim() || "한방 시그",
            price: finalPrice,
          };
        })()
      : null;
    return (
      draftOneShot ||
      machine.oneShot ||
      buildOneShotFromSelected(effectiveSelectedSigsForUi.slice(0, CONFIRMED_VISIBLE_SLOTS))
    );
  }, [oneShotRevealUnlocked, machine.oneShot, effectiveSelectedSigsForUi, manualOverlayMode, manualDraftEffective]);
  const resultCardCount = useMemo(() => {
    let n = effectiveSelectedSigsForUi.length;
    if (oneShotForResultOverlay) n += 1;
    return Math.max(1, n);
  }, [effectiveSelectedSigsForUi.length, oneShotForResultOverlay]);
  const resultRowLayout = useMemo(
    () => layoutSigOverlayResultRow({ cellCount: resultCardCount, userScalePct: sigResultScalePct }),
    [resultCardCount, sigResultScalePct]
  );
  const showSigBoardRollingSection = useMemo(() => {
    if (manualOverlayMode) return false;
    if (wheelDemoActive) return false;
    if (winnersOnlyOverlay) return false;
    if (hideSigBoard || !state || (state.sigInventory || []).length === 0) return false;
    if (displaySelectedSigs.length > 0 && resultOverlayVisible && !allowSigBoardWithResults) return false;
    if (sigBoardDuringSpin) {
      // 회전 중에만 보드를 노출하고, IDLE(회전 전)에서는 임시 카드 노출을 막는다.
      return (
        machine.phase === "SPINNING" ||
        machine.phase === "LANDED" ||
        machine.phase === "CONFIRM_PENDING" ||
        wheelPhase === "spinning" ||
        wheelPhase === "settling" ||
        Boolean(demoSpin) ||
        Boolean(pendingLanding)
      );
    }
    return Boolean(hideWheelAfterComplete && showResultPanel && resultsPanelGateOpen);
  }, [
    manualOverlayMode,
    winnersOnlyOverlay,
    hideSigBoard,
    state,
    displaySelectedSigs.length,
    resultOverlayVisible,
    allowSigBoardWithResults,
    sigBoardDuringSpin,
    hideWheelAfterComplete,
    showResultPanel,
    resultsPanelGateOpen,
    wheelDemoActive,
    machine.phase,
    wheelPhase,
    demoSpin,
    pendingLanding,
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
  /**
   * "판매 처리(확정)" 직후에는 재고 완판이 아니어도 결과 카드에 판매 상태(흰 배경/스탬프)를 보여야 한다.
   * 기존은 `soldCount >= maxCount`만 반영되어, 확정 직후에는 판매 카드가 일반 상태처럼 보일 수 있었다.
   */
  const confirmedRoundSoldIdSet = useMemo(() => {
    const next = new Set<string>();
    if (
      machine.phase !== "CONFIRMED" &&
      machine.phase !== "CONFIRM_PENDING" &&
      machine.phase !== "LANDED"
    ) {
      return next;
    }
    const normalizeNameKey = (raw: string) =>
      String(raw || "").trim().toLowerCase().replace(/\s+/g, "");
    const selectedNamePriceSet = new Set(
      (machine.selectedSigs || []).map(
        (x) => `${normalizeNameKey(x.name)}::${Math.floor(Number(x.price || 0))}`
      )
    );
    const selectedIdSet = new Set<string>();
    for (const s of machine.selectedSigs || []) {
      selectedIdSet.add(s.id);
      selectedIdSet.add(canonicalSigIdFromWheelSliceId(s.id));
    }
    /** 확정 처리 중: 당첨 카드 전체에 스탬프 미리보기 */
    if (machine.phase === "CONFIRM_PENDING") {
      for (const id of selectedIdSet) next.add(id);
      if ((machine.selectedSigs?.length ?? 0) >= MIN_ONE_SHOT_SIGS) {
        next.add(ONE_SHOT_SIG_ID);
        next.add(canonicalSigIdFromWheelSliceId(ONE_SHOT_SIG_ID));
      }
      return next;
    }
    /** LANDED·CONFIRMED: 재고 soldCount가 올라간 당첨 시그만 스탬프(체크 즉시 반영) */
    for (const row of state?.sigInventory || []) {
      const canon = canonicalSigIdFromWheelSliceId(row.id);
      const inRound =
        selectedIdSet.has(row.id) ||
        selectedIdSet.has(canon) ||
        selectedNamePriceSet.has(
          `${normalizeNameKey(row.name)}::${Math.floor(Number(row.price || 0))}`
        );
      if (!inRound || row.soldCount <= 0) continue;
      next.add(row.id);
      next.add(canon);
    }
    return next;
  }, [machine.phase, machine.selectedSigs, state?.sigInventory]);
  const resultSoldOverrideSet = useMemo(() => {
    const next = new Set<string>(inventorySoldOutIdSet);
    for (const id of confirmedRoundSoldIdSet) next.add(id);
    return next;
  }, [inventorySoldOutIdSet, confirmedRoundSoldIdSet]);
  const oneShotImageUrl = useMemo(() => {
    const oneShotItem = (state?.sigInventory || []).find((item) => item.id === ONE_SHOT_SIG_ID);
    const fromOneShot = (oneShotItem?.imageUrl || "").trim();
    if (fromOneShot) return resolveSigImageUrl(oneShotItem?.name || "한방 시그", fromOneShot, sigImageUserId);
    const draftOneShotImage = String(manualDraftEffective?.oneShotImageUrl || "").trim();
    if (manualOverlayMode && draftOneShotImage) return resolveSigImageUrl("한방 시그", draftOneShotImage, sigImageUserId);
    const pick = effectiveSelectedSigsForUi.find((x) => (x.imageUrl || "").trim());
    if (pick) return resolveSigImageUrl(pick.name, pick.imageUrl, sigImageUserId);
    const poolPick = activeNormalPool.find((x) => (x.imageUrl || "").trim());
    if (poolPick) return resolveSigImageUrl(poolPick.name, poolPick.imageUrl, sigImageUserId);
    return resolveSigImageUrl("", "", sigImageUserId);
  }, [state?.sigInventory, effectiveSelectedSigsForUi, activeNormalPool, sigImageUserId, manualDraftEffective, manualOverlayMode]);
  const getSignImageUrl = useCallback((id?: string | null) => {
    if (!id) return "";
    const canon = canonicalSigIdFromWheelSliceId(String(id));
    const inv = state?.sigInventory;
    const fromInv = inv?.find((x) => x.id === canon) || inv?.find((x) => x.id === id);
    if (fromInv) return resolveSigImageUrl(fromInv.name, fromInv.imageUrl || "", sigImageUserId);
    const pool = [...(machine.selectedSigs || []), ...(activeNormalPool || [])];
    const found = pool.find(
      (item) => item.id === id || canonicalSigIdFromWheelSliceId(item.id) === canon,
    );
    return resolveSigImageUrl(found?.name || "", found?.imageUrl || "", sigImageUserId);
  }, [machine.selectedSigs, activeNormalPool, state?.sigInventory, sigImageUserId]);
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
    resultRevealDelayMs,
    overlayHoldResults,
    broadcastStickySigs,
    showResultPanel,
  ]);

  const serverCatchUpKeyRef = useRef("");
  useEffect(() => {
    const rs = state?.rouletteState;
    const serverPhase = String(rs?.phase || "").trim();
    const selectedFromServer = (rs?.selectedSigs || rs?.results || machine.selectedSigs || []).slice(
      0,
      CONFIRMED_VISIBLE_SLOTS
    );
    if (selectedFromServer.length === 0) return;
    const machineSpinKey = overlaySpinSessionKey(machine.startedAt, machine.sessionId || "");
    const catchUpKey = `${serverPhase}:${machine.phase}:${machineSpinKey}:${selectedFromServer.length}:${revealedSigCount}`;
    const queueLen = selectedFromServer.length;
    const serverShowcase =
      serverPhase === "LANDED" ||
      serverPhase === "CONFIRM_PENDING" ||
      serverPhase === "CONFIRMED";
    const serverAheadOfReveal = selectedFromServer.length > revealedSigCount;
    const serverFinishedSpin = serverShowcase && !rs?.isRolling;
    const startedAt = Number(machine.startedAt || rs?.startedAt || 0);
    const withinWindow = startedAt > 0 && Date.now() - startedAt <= RECENT_SPIN_WINDOW_MS;
    const recentEnough = withinWindow || (startedAt <= 0 && Boolean(machine.sessionId || rs?.sessionId));

    if (serverShowcase && (serverAheadOfReveal || serverFinishedSpin)) {
      if (!recentEnough) return;
      if (serverCatchUpKeyRef.current === catchUpKey) return;
      serverCatchUpKeyRef.current = catchUpKey;
      completedSpinKeyRef.current = machineSpinKey;
      const sequentialStillPlaying =
        selectedFromServer.length > 1 &&
        (Boolean(demoSpin) ||
          wheelPhase === "spinning" ||
          wheelPhase === "settling" ||
          machine.phase === "SPINNING");
      setDemoSpin(null);
      setPendingLanding(null);
      setOverlayHoldResults(true);
      setShowResultPanel(true);
      setRevealedSigCount((c) => Math.max(c, selectedFromServer.length));
      /** 순차 연출 중 LANDED 폴링이 오면 roundIndex 를 끝으로 점프 → 1회차에 마지막 당첨 시그가 휠에 착지함 */
      if (!sequentialStillPlaying) {
        setSequentialRoundIndex(Math.max(0, selectedFromServer.length - 1));
      }
      const oneShot = rs?.oneShotResult || buildOneShotFromSelected(selectedFromServer);
      const resultId =
        rs?.result?.id || selectedFromServer[selectedFromServer.length - 1]?.id || machine.resultId;
      if (sigSalesPhaseRank(serverPhase) > sigSalesPhaseRank(machine.phase)) {
        landed(selectedFromServer, oneShot, resultId || null);
      }
      if (wheelPhase !== "spinning" && wheelPhase !== "settling") {
        dispatch({ type: "LANDED" });
      }
      if (oneShot) setOneShotRevealUnlocked(true);
      return;
    }

    if (pendingLanding || demoSpin) return;
    if (machine.phase !== "SPINNING") return;
    if (!recentEnough) return;
    if (machineSpinKey === completedSpinKeyRef.current) return;
    serverCatchUpKeyRef.current = catchUpKey;
    const boot = bootstrapOverlaySpinPlayback(
      selectedFromServer,
      wheelSlicesForSpin,
      machine.startedAt,
      machine.sessionId,
      usedWheelSliceIdsRef.current
    );
    setPendingLanding(boot.pendingLanding);
    setDemoSpin(boot.demoSpin);
  }, [
    state?.rouletteState,
    state?.updatedAt,
    machine.phase,
    machine.selectedSigs,
    machine.startedAt,
    machine.sessionId,
    machine.resultId,
    pendingLanding,
    demoSpin,
    wheelPhase,
    revealedSigCount,
    wheelSlicesForSpin,
    landed,
  ]);

  useEffect(() => {
    // appState 수신 전 기본 IDLE이면 건드리지 않음(HYDRATE SPINNING과 경쟁 방지)
    if (!state) return;
    if (machine.phase !== "IDLE") return;
    /** 로컬 휠 데모 자동 스핀 중에는 폴링마다 demoSpin 이 지워지지 않게 함 */
    if (wheelDemoAutoSpin && (demoSpin || pendingLanding)) return;
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
    serverCatchUpKeyRef.current = "";
    setSequentialRoundIndex(0);
  }, [machine.phase, state, wheelDemoAutoSpin, demoSpin, pendingLanding]);

  /** 로컬 wheelDemo: 서버 스핀 없이 20칸 휠 + 당첨 5개 + 한방 시그 연출 1회 자동 재생 */
  useEffect(() => {
    if (!wheelDemoAutoSpin || !state) return;
    if (wheelDemoAutoRanRef.current) return;
    if (machine.phase !== "IDLE") return;
    if (demoSpin || pendingLanding) return;
    const demoMenuN = getWheelDemoMenuCountFromSearchParams(sp, wheelDemoActive) ?? WHEEL_DEMO_MENU_COUNT;
    if (wheelSlicesForSpin.length < demoMenuN) return;

    wheelDemoAutoRanRef.current = true;
    const winN = getWheelDemoWinCountFromSearchParams(sp, wheelDemoActive);
    const selected = pickWheelDemoWinners(winN);
    const sessionId = `wheel_demo_local_${Date.now()}`;
    const startedAt = Date.now();
    const boot = bootstrapOverlaySpinPlayback(
      selected,
      wheelSlicesForSpin,
      startedAt,
      sessionId,
      usedWheelSliceIdsRef.current
    );
    setPendingLanding({ ...boot.pendingLanding, persist: false });
    setDemoSpin(boot.demoSpin);
    setBroadcastStickySigs(selected);
    setShowResultPanel(true);
    setOverlayHoldResults(false);
    dispatch({ type: "START_SPIN" });
  }, [
    wheelDemoAutoSpin,
    wheelDemoActive,
    sp,
    state,
    machine.phase,
    demoSpin,
    pendingLanding,
    wheelSlicesForSpin,
  ]);

  useEffect(() => {
    if (machine.phase !== "SPINNING") return;
    const selectedFromServer = (machine.selectedSigs || []).slice(0, CONFIRMED_VISIBLE_SLOTS);
    if (selectedFromServer.length > 0 && !pendingLanding && !demoSpin) {
      const boot = bootstrapOverlaySpinPlayback(
        selectedFromServer,
        wheelSlicesForSpin,
        machine.startedAt,
        machine.sessionId,
        usedWheelSliceIdsRef.current
      );
      setPendingLanding(boot.pendingLanding);
      setDemoSpin(boot.demoSpin);
    }
  }, [
    machine.phase,
    machine.selectedSigs,
    machine.startedAt,
    machine.sessionId,
    pendingLanding,
    demoSpin,
    wheelSlicesForSpin,
  ]);

  useEffect(() => {
    if (machine.phase !== "SPINNING" && machine.phase !== "LANDED") return;
    if (!pendingLanding && !demoSpin) return;
    const spinKey = overlaySpinSessionKey(machine.startedAt, machine.sessionId || "");
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
      img.src = resolveSigImageUrl(item.name, item.imageUrl, sigImageUserId);
    });
  }, [pendingLanding, sigImageUserId]);

  useEffect(() => {
    if (machine.selectedSigs.length > 0) {
      setBroadcastStickySigs(machine.selectedSigs.slice(0, CONFIRMED_VISIBLE_SLOTS));
    }
  }, [machine.selectedSigs]);

  useEffect(() => {
    const sid = String(machine.sessionId || "").trim();
    if (sid && lastPinnedSessionIdRef.current !== null && lastPinnedSessionIdRef.current !== sid) {
      setBroadcastStickySigs(null);
      serverCatchUpKeyRef.current = "";
    }
    if (machine.phase === "SPINNING" && sid) {
      lastPinnedSessionIdRef.current = sid;
    }
    if (machine.phase === "IDLE" && !sid && machine.selectedSigs.length === 0) {
      lastPinnedSessionIdRef.current = null;
      setBroadcastStickySigs(null);
      serverCatchUpKeyRef.current = "";
    }
  }, [machine.phase, machine.sessionId, machine.selectedSigs]);

  const mainClassName = wheelDemoActive
    ? "relative min-h-[100dvh] max-h-[100dvh] overflow-hidden bg-neutral-950 px-3 py-3 text-white sm:px-5 sm:py-4"
    : "relative max-h-[100dvh] min-h-0 overflow-hidden bg-transparent px-3 py-3 text-white sm:px-5 sm:py-4";

  if (!clientBoot.ready) {
    return <OverlayHydrationShell />;
  }

  return (
    <main className={mainClassName} suppressHydrationWarning>
      {wheelDemoActive && !state ? (
        <p className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center text-sm text-neutral-300">
          휠 데모 불러오는 중…
        </p>
      ) : null}
      <div className="mx-auto max-w-[1280px] space-y-4">
        <section className="relative flex w-full flex-col items-center gap-4 bg-transparent p-0">
          <div
            style={
              overlayUserScaleStyle
                ? { ...overlayUserScaleStyle, backgroundColor: "transparent" }
                : { backgroundColor: "transparent" }
            }
            className="relative mx-auto flex w-full max-w-[min(1400px,98vw)] flex-col items-center gap-0"
          >
          <div
            style={
              wheelColumnBoostScaleStyle
                ? { ...wheelColumnBoostScaleStyle, backgroundColor: "transparent" }
                : { backgroundColor: "transparent" }
            }
            className="flex w-full shrink-0 flex-col items-center"
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
                getLabel={getWheelLabel}
                /** settling 동안 false면 휠 effect가 조기 종료·정리되어 onTransitionEnd/onLanded 이후에도 상태가 꼬일 수 있음 */
                isRolling={
                  wheelPhase === "spinning" ||
                  wheelPhase === "settling" ||
                  Boolean(demoSpin) ||
                  hasServerSpinToPlay
                }
                resultId={wheelKeepsSpinBinding ? wheelAnimationResultId : null}
                targetSliceIndex={wheelKeepsSpinBinding ? wheelTargetSliceIndex : null}
                startedAt={demoSpin?.startedAt || wheelAnimationStartedAt || 0}
                scalePct={wheelScalePct}
                volume={0.7}
                muted={false}
                onTransitionEnd={() => {
                  if (wheelPhaseSyncRef.current !== "spinning") return;
                  const transitionKey = `${demoSpin?.startedAt || machine.startedAt}:${wheelResultSliceId || "none"}:${useSequentialWheel ? sequentialRoundIndex : 0}`;
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
                  const selectedQueue = spinQueueSelected;
                  const roundNow = sequentialRoundIndexRef.current;
                  if (selectedQueue.length === 0) {
                    setDemoSpin(null);
                    setOverlayHoldResults(true);
                    setShowResultPanel(true);
                    void loadRemote();
                    return;
                  }

                  const seqMulti = selectedQueue.length > 1;
                  const lastIdx = selectedQueue.length - 1;
                  const isLastRound = roundNow >= lastIdx;

                  /** 멀티 당첨은 항상 라운드별 순차 회전으로 처리한다. */
                  if (seqMulti && useSequentialWheel) {
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
                        roundNow + 1,
                        selectedQueue.length,
                        CONFIRMED_VISIBLE_SLOTS,
                      );
                      setRevealedSigCount((c) => Math.max(c, revealedAfterRound));
                      setDemoSpin(null);
                      /** 중간 회차에서도 당첨 카드·progressive 가 꺼지지 않게 함(2번째 회전 전에 사라짐 방지) */
                      setOverlayHoldResults(true);
                      setShowResultPanel(true);
                      const partialQueue = selectedQueue.slice(0, revealedAfterRound);
                      const snapSessionMid = machine.sessionId;
                      if (snapSessionMid && partialQueue.length > 0) {
                        void fetch(`/api/roulette/land?user=${encodeURIComponent(userId)}`, {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            sessionId: snapSessionMid,
                            startedAt: machine.startedAt,
                            selectedSigs: partialQueue,
                            oneShotResult: buildOneShotFromSelected(partialQueue),
                          }),
                        })
                          .catch(() => {});
                      }
                      rememberUsedWheelSliceId(
                        usedWheelSliceIdsRef.current,
                        landedId || wheelResultSliceId
                      );
                      transitionHandledKeyRef.current = "";
                      const nextRound = roundNow + 1;
                      /** 착지 직후 index+1 하면 휠·카드가 다음 회차 시그로 바뀜(1회차에 2회차 당첨 노출) → 다음 스핀 직전에만 올림 */
                      window.setTimeout(() => {
                      sequentialRoundIndexRef.current = nextRound;
                      setSequentialRoundIndex(nextRound);
                      setDemoSpin({
                        startedAt: Date.now(),
                        resultId: null,
                      });
                        dispatch({ type: "RESET" });
                        dispatch({ type: "START_SPIN" });
                      }, sequentialNextSpinMs);
                      return;
                    }
                  }

                  const snapSession = machine.sessionId;
                  const snapStarted = machine.startedAt;
                  const roundIdx = seqMulti ? Math.min(roundNow, lastIdx) : lastIdx;
                  const serverWinner = selectedQueue[roundIdx] ?? selectedQueue[lastIdx] ?? null;
                  const trustedLandId =
                    serverWinner &&
                    landedId &&
                    wheelSliceMatchesServerWinner(landedId, serverWinner)
                      ? landedId
                      : wheelResultSliceId || wheelAnimationResultId || serverWinner?.id || landedId;
                  if (
                    serverWinner &&
                    landedId &&
                    !wheelSliceMatchesServerWinner(landedId, serverWinner)
                  ) {
                    console.warn("[sig-sales overlay] wheel/card mismatch — using server queue", {
                      landedId,
                      trustedLandId,
                      serverId: serverWinner.id,
                      roundIdx,
                    });
                  }
                  rememberUsedWheelSliceId(usedWheelSliceIdsRef.current, trustedLandId);
                  const finalQueue = selectedQueue;
                  setRevealedSigCount((c) =>
                    Math.max(c, Math.min(finalQueue.length, roundIdx + 1, CONFIRMED_VISIBLE_SLOTS))
                  );
                  const oneShot = buildOneShotFromSelected(finalQueue);
                  const machineSpinKey = overlaySpinSessionKey(
                    machine.startedAt,
                    machine.sessionId || ""
                  );
                  completedSpinKeyRef.current = machineSpinKey;
                  const finalResultId =
                    serverWinner?.id ||
                    wheelAnimationResultId ||
                    pendingLanding?.resultId ||
                    finalQueue[Math.min(roundNow, lastIdx)]?.id ||
                    finalQueue[finalQueue.length - 1]?.id ||
                    null;
                  landed(finalQueue, oneShot, finalResultId);
                  if (buildOneShotFromSelected(finalQueue)) {
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
                  if (snapSession) {
                    void (async () => {
                      try {
                        const res = await fetch(`/api/roulette/land?user=${encodeURIComponent(userId)}`, {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            sessionId: snapSession,
                            startedAt: snapStarted,
                            selectedSigs: finalQueue,
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
          </div>
          {manualOverlayMode && effectiveSelectedSigsForUi.length === 0 && !oneShotForResultOverlay ? (
            <div className="pointer-events-none absolute inset-0 z-40 grid place-items-center">
              <div className="rounded-xl border border-yellow-300/40 bg-black/65 px-5 py-3 text-center">
                <p className="text-sm font-semibold text-yellow-100">수동 결과 데이터가 없습니다.</p>
                <p className="mt-1 text-xs text-yellow-200/90">
                  `/admin/sig-sales`에서 수동 5개를 적용한 뒤 다시 확인해 주세요.
                </p>
              </div>
            </div>
          ) : null}
          {/* 휠 아래·왼쪽(방송 화면 기준 시그 결과 영역). 휠 제거 시 위 플레이스홀더로 세로 위치 유지. hanbangOnly 시 한방만 화면 하단 고정 */}
          <div
            className={
              hanbangOnlyResultLayout && resultOverlayVisible
                ? "pointer-events-none fixed bottom-0 left-0 right-0 z-[80] flex w-full max-w-full justify-center overflow-visible px-3 pb-2 pt-1 md:px-6 md:pb-4"
                : "pointer-events-none relative z-[70] mt-2 w-full max-w-[min(960px,min(94vw,99vw))] shrink-0 self-center overflow-visible px-2 pb-2 pt-1 md:max-w-[min(1100px,96vw)] md:px-4 md:pb-3 md:pt-3"
            }
            aria-live="polite"
          >
            <div className="pointer-events-auto mx-auto flex min-w-0 w-full max-w-full justify-center overflow-visible overflow-y-visible">
              <AnimatePresence>
                {resultOverlayVisible ? (
                  <motion.div
                    key={`result-${spinCompletionKey}`}
                    layout={false}
                    initial={hideWheelAfterComplete ? false : { opacity: 0, y: 12 }}
                    animate={hideWheelAfterComplete ? undefined : { opacity: 1, y: 0 }}
                    exit={hideWheelAfterComplete ? undefined : { opacity: 0.95, y: 6 }}
                    transition={
                      hideWheelAfterComplete
                        ? undefined
                        : { duration: Math.min(0.35, revealMotionSec), ease: [0.22, 1, 0.36, 1] }
                    }
                    className="w-full min-w-0 max-w-full drop-shadow-[0_4px_24px_rgba(0,0,0,0.65)]"
                  >
                    <div
                      className="mx-auto flex w-full max-w-full justify-center overflow-visible px-1"
                      style={resultRowLayout.bandStyle}
                    >
                      <ResultOverlay
                        visible
                        selectedSigs={effectiveSelectedSigsForUi}
                        soldOutStampUrl={soldOutStampUrl}
                        soldOverrideSet={resultSoldOverrideSet}
                        oneShot={oneShotForResultOverlay}
                        signImageUrl={oneShotImageUrl || currentSignImageUrl}
                        showOneShotReveal={Boolean(oneShotForResultOverlay)}
                        cardScalePct={resultRowLayout.cardScalePct}
                        className="w-full max-w-full"
                        gifDelayMultiplier={sigGifDelayMultiplier}
                        entranceOnlyLatest={!hideWheelAfterComplete}
                        disableCardMotion={hideWheelAfterComplete}
                        hanbangOnly={hanbangOnlyResultLayout}
                        showConfirmedBadge={machine.phase === "CONFIRMED"}
                        sigImageUserId={sigImageUserId}
                      />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
          </div>
          {machine.phase === "CONFIRM_PENDING" ? (
            <div className="pointer-events-none absolute inset-0 z-50 grid max-md:bg-transparent place-items-center bg-black/55">
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
              inventory={wheelInventory || []}
              soldOutStampUrl={soldOutStampUrl}
              soldOverrideSet={resultSoldOverrideSet}
              sigSalesExcludedIds={state.sigSalesExcludedIds || []}
              memberFilterId={memberFilterId}
              overlayUserId={sigImageUserId}
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
