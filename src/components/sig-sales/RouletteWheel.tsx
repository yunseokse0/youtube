"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { motion } from "framer-motion";
import { Howl } from "howler";
import type { SigItem } from "@/types";
import {
  buildWheelConicGradientCss,
  correctWheelLandToTargetSlice,
  findSliceIndexForResult,
  forceWheelRotationSync,
  logWheelGeometryCheck,
  readElementRotationDeg,
  snapWheelAbsoluteToSliceNorm,
  wheelAbsoluteLandAngleForSliceIndex,
  wheelPointerClientPointFromElements,
  wheelRotationNormForSliceIndex,
  wheelSliceCenterDeg,
  wheelSliceLabelPolarOffsetPx,
  wheelSliceLabelMaxWidthPx,
  wheelSliceLabelRadiusPx,
  wheelSliceLabelRotateDeg,
  wheelSliceLabelFontPx,
  type WheelRenderSyncReport,
  formatWheelSegmentLabel,
  ROULETTE_WHEEL_SFX_ENABLED,
  ROULETTE_WHEEL_WAV_ASSETS_ENABLED,
  SOUND_ASSETS_ENABLED,
  SPIN_SOUND_PATHS,
} from "@/lib/sig-roulette";
import {
  getOrCreateSpinAudioContext,
  playSpinLandShimmer,
  playSpinMechanicalTick,
} from "@/lib/roulette-procedural-audio";

type RouletteWheelProps = {
  items: SigItem[];
  isRolling: boolean;
  resultId: string | null;
  /** `bindWheelAnimationToRoundWinner`로 정해진 칸 — 착지·보정은 항상 이 인덱스(스핀 시작 시 고정) */
  targetSliceIndex?: number | null;
  startedAt: number;
  /** 순차 회전 등 동일 startedAt·resultId 조합에서도 다음 애니를 강제로 시작 */
  spinReplayNonce?: number;
  scalePct?: number;
  volume?: number;
  muted?: boolean;
  onTransitionEnd?: () => void;
  onLanded?: (
    resultId?: string | null,
    pointerRotationDeg?: number,
    visualPointerIndex?: number,
    motionDesyncDeg?: number | null,
    renderSyncReport?: WheelRenderSyncReport | null
  ) => void;
  /** 렌더 검증: 해당 칸 중심각으로 즉시 스냅(스핀 없음). `probeNonce` 변경 시 실행 */
  probeSliceIndex?: number | null;
  probeNonce?: number;
  onRenderSyncReport?: (report: WheelRenderSyncReport) => void;
  /** 미지정 시 `item.name`. 관리자 시그 롤링 짧은 라벨 등 */
  getLabel?: (item: SigItem) => string;
};

const COLORS = [
  "#fb7185", "#f59e0b", "#22d3ee", "#a78bfa", "#34d399", "#f472b6", "#facc15", "#60a5fa",
  "#ef4444", "#84cc16", "#06b6d4", "#818cf8", "#e879f9", "#fdba74", "#5eead4", "#fca5a5",
  "#93c5fd", "#f9a8d4", "#bef264", "#fcd34d",
];
/** 단일 감속 스핀 — 너무 빠르면 착지 전에 phase 가 바뀌어 각도가 어긋날 수 있음 */
const SPIN_LAND_DURATION_MS = 5200;
const SPIN_LAND_MIN_TURNS = 5;
const SPIN_LAND_POST_MS = 180;

/** 검은 외곽 — text-shadow 만 사용(-webkit-text-stroke 는 흰 원형 번짐 유발) */
const WHEEL_LABEL_OUTLINE_SHADOW =
  "1px 0 0 #000, -1px 0 0 #000, 0 1px 0 #000, 0 -1px 0 #000, " +
  "1px 1px 0 #000, -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000";

const WHEEL_LABEL_READABLE_STYLE: CSSProperties = {
  display: "inline",
  margin: 0,
  padding: 0,
  background: "transparent",
  backgroundColor: "transparent",
  border: "none",
  borderRadius: 0,
  boxShadow: "none",
  color: "#ffffff",
  fontWeight: 800,
  textShadow: WHEEL_LABEL_OUTLINE_SHADOW,
};

/** 칸 중심 림 · 화면 기준 가로 글자(배경 pill 없음) */
function WheelSegmentLabel({
  className,
  style,
  title,
  isWin,
  children,
}: {
  className: string;
  style: CSSProperties;
  title?: string;
  isWin: boolean;
  children: React.ReactNode;
}) {
  const cls = `max-w-full whitespace-nowrap text-center ${className}`;
  if (!isWin) {
    return (
      <span className={cls} style={style} title={title}>
        {children}
      </span>
    );
  }
  return (
    <motion.span
      className={cls}
      style={style}
      title={title}
      animate={{
        textShadow: [
          `${WHEEL_LABEL_OUTLINE_SHADOW}, 0 0 8px rgba(250,204,21,0.5)`,
          `${WHEEL_LABEL_OUTLINE_SHADOW}, 0 0 14px rgba(250,204,21,0.85)`,
          `${WHEEL_LABEL_OUTLINE_SHADOW}, 0 0 8px rgba(250,204,21,0.5)`,
        ],
      }}
      transition={{ duration: 1.4, repeat: Infinity }}
    >
      {children}
    </motion.span>
  );
}

function wheelDiscRotateCssDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export default function RouletteWheel({
  items,
  isRolling,
  resultId,
  targetSliceIndex = null,
  startedAt,
  spinReplayNonce = 0,
  scalePct = 100,
  volume = 0.7,
  muted = false,
  onTransitionEnd,
  onLanded,
  getLabel,
  probeSliceIndex = null,
  probeNonce = 0,
  onRenderSyncReport,
}: RouletteWheelProps) {
  const wheelAbsRef = useRef(0);
  const [wheelMod, setWheelMod] = useState(0);
  const wheelDiscRef = useRef<HTMLDivElement>(null);

  const applyWheelRotation = useCallback((absDeg: number) => {
    wheelAbsRef.current = absDeg;
    const mod = wheelDiscRotateCssDeg(absDeg);
    setWheelMod(mod);
    const el = wheelDiscRef.current;
    if (!el) return;
    el.style.transformOrigin = "center center";
    el.style.transform = `rotate(${mod}deg)`;
    el.style.removeProperty("rotate");
  }, []);

  const pointerRef = useRef<HTMLDivElement>(null);
  const [winnerIndex, setWinnerIndex] = useState(-1);
  const hasLandedRef = useRef(false);
  const spinRafRef = useRef<number | null>(null);
  const activeSpinKeyRef = useRef("");
  /** 동일 spinKey 로 effect 가 재실행돼 감속 중 스핀이 끊기지 않게 함 */
  const spinInFlightRef = useRef(false);
  const targetSliceIndexRef = useRef(targetSliceIndex);
  /** 회차당 서버·bindWheel 로 확정한 참 — 스핀 도중 prop 변경·DOM 측정으로 바뀌지 않음 */
  const lockedTargetSliceIndexRef = useRef(-1);
  const lockedSpinSliceIdRef = useRef<string | null>(null);
  targetSliceIndexRef.current = targetSliceIndex;
  const itemsRef = useRef<SigItem[]>(items);
  /** 스핀 시작 시점 칸·라벨 고정 — 회차 전환·폴링으로 items 가 바뀌면 착지 각도와 라벨이 어긋남 */
  const [frozenVisualItems, setFrozenVisualItems] = useState<SigItem[] | null>(null);
  const onLandedRef = useRef<RouletteWheelProps["onLanded"]>(onLanded);
  const onTransitionEndRef = useRef<RouletteWheelProps["onTransitionEnd"]>(onTransitionEnd);
  const onRenderSyncReportRef = useRef<RouletteWheelProps["onRenderSyncReport"]>(onRenderSyncReport);
  const [sounds, setSounds] = useState<{ tick: Howl; final: Howl; success: Howl } | null>(null);
  const soundsRef = useRef<{ tick: Howl; final: Howl; success: Howl } | null>(null);
  const hasSoundAssetErrorRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  /** speedNorm 0~1: 빠를수록 살짝 크게(회전 감각) */
  const playSpinTickScaled = useCallback((speedNorm: number) => {
    if (!ROULETTE_WHEEL_SFX_ENABLED || mutedRef.current) return;
    const ctx = getOrCreateSpinAudioContext(audioCtxRef.current);
    if (!ctx) return;
    audioCtxRef.current = ctx;
    const m = volumeRef.current * (0.32 + 0.68 * Math.max(0, Math.min(1, speedNorm)));
    playSpinMechanicalTick(ctx, Math.max(0.12, Math.min(1, m)));
  }, []);

  const playProceduralLand = useCallback(() => {
    if (!ROULETTE_WHEEL_SFX_ENABLED || mutedRef.current) return;
    const ctx = getOrCreateSpinAudioContext(audioCtxRef.current);
    if (!ctx) return;
    audioCtxRef.current = ctx;
    playSpinLandShimmer(ctx, volumeRef.current);
  }, []);

  /** wav 모드 폴백용 짧은 사인 틱 */
  const playFallbackTone = useCallback((freq: number, durationMs: number, gain = 0.03) => {
    if (!ROULETTE_WHEEL_SFX_ENABLED || mutedRef.current) return;
    if (typeof window === "undefined") return;
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    let ctx = audioCtxRef.current;
    if (!ctx) {
      ctx = new Ctx();
      audioCtxRef.current = ctx;
    }
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    g.gain.value = Math.max(0.001, Math.min(0.08, gain * volumeRef.current));
    osc.connect(g);
    g.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.stop(now + durationMs / 1000);
  }, []);

  /** wav 성공음 보조용 */
  const playWinChime = useCallback(() => {
    if (mutedRef.current) return;
    const notes = [
      [523.25, 68],
      [659.25, 72],
      [783.99, 100],
    ] as const;
    notes.forEach(([freq, ms], i) => {
      window.setTimeout(() => playFallbackTone(freq, ms, 0.016), i * 82);
    });
  }, [playFallbackTone]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const visualItems = frozenVisualItems ?? items;
  const segmentCount = Math.max(1, visualItems.length);
  const segment = 360 / segmentCount;
  /** `border-8`과 동기: 색 영역 바깥 테두리 두께만큼 반지름에서 뺌 */
  const wheelBorderPx = 8;
  /** `border-8` 안쪽 원 둘레 12시 — 포인터·착지 판별과 동일 */
  const wheelScale = Math.max(55, Math.min(140, Math.floor(Number(scalePct) || 100))) / 100;
  const pointerSizePx = Math.max(28, Math.round(36 * wheelScale));
  const frameHeightPx = Math.round(360 * wheelScale) + pointerSizePx + 8;
  const frameMaxWidthPx = Math.round(680 * wheelScale);
  const wheelSizePx = Math.round(270 * wheelScale) & ~1;
  const wheelInnerRadiusPx = Math.max(1, wheelSizePx / 2 - wheelBorderPx);
  const centerSizePx = Math.max(36, Math.round(48 * wheelScale));
  const labelRadiusPx = wheelSliceLabelRadiusPx(
    wheelInnerRadiusPx,
    segmentCount,
    centerSizePx / 2
  );
  const labelChordMaxPx = wheelSliceLabelMaxWidthPx(segmentCount, labelRadiusPx);
  const labelFontPx = wheelSliceLabelFontPx(segmentCount, scalePct);
  const gradient = useMemo(
    () =>
      buildWheelConicGradientCss(
        visualItems.map((_, i) => COLORS[i % COLORS.length]!),
        segmentCount
      ),
    [visualItems, segmentCount]
  );

  useEffect(() => {
    if (!ROULETTE_WHEEL_SFX_ENABLED || !SOUND_ASSETS_ENABLED || !ROULETTE_WHEEL_WAV_ASSETS_ENABLED) {
      setSounds(null);
      return;
    }
    const tick = new Howl({
      src: [SPIN_SOUND_PATHS.tick],
      loop: true,
      preload: true,
      onloaderror: () => {
        hasSoundAssetErrorRef.current = true;
      },
      onplayerror: () => {
        hasSoundAssetErrorRef.current = true;
      },
    });
    const final = new Howl({
      src: [SPIN_SOUND_PATHS.final],
      loop: false,
      preload: true,
      onloaderror: () => {
        hasSoundAssetErrorRef.current = true;
      },
      onplayerror: () => {
        hasSoundAssetErrorRef.current = true;
      },
    });
    const success = new Howl({
      src: [SPIN_SOUND_PATHS.success],
      loop: false,
      preload: true,
      onloaderror: () => {
        hasSoundAssetErrorRef.current = true;
      },
      onplayerror: () => {
        hasSoundAssetErrorRef.current = true;
      },
    });
    setSounds({ tick, final, success });
    return () => {
      tick.unload();
      final.unload();
      success.unload();
      try { audioCtxRef.current?.close(); } catch {}
      audioCtxRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!sounds) return;
    soundsRef.current = sounds;
    sounds.tick.volume(volume);
    sounds.final.volume(volume);
    sounds.success.volume(volume);
    sounds.tick.mute(muted);
    sounds.final.mute(muted);
    sounds.success.mute(muted);
  }, [sounds, volume, muted]);

  useEffect(() => {
    mutedRef.current = muted;
    volumeRef.current = volume;
  }, [muted, volume]);

  useEffect(() => {
    onLandedRef.current = onLanded;
  }, [onLanded]);

  useEffect(() => {
    onTransitionEndRef.current = onTransitionEnd;
  }, [onTransitionEnd]);

  useEffect(() => {
    onRenderSyncReportRef.current = onRenderSyncReport;
  }, [onRenderSyncReport]);

  const stopAllAnimations = useCallback(() => {
    if (spinRafRef.current != null) {
      cancelAnimationFrame(spinRafRef.current);
      spinRafRef.current = null;
    }
  }, []);

  /** 렌더 동기화 점검: 스핀 없이 수식 각도로 스냅 후 motion·DOM·육안 비교 */
  useEffect(() => {
    if (probeNonce == null || probeNonce <= 0) return;
    if (probeSliceIndex == null || !Number.isFinite(probeSliceIndex)) return;
    const spinItems = itemsRef.current;
    if (!spinItems.length) return;

    let cancelled = false;
    const runProbe = async () => {
      const n = spinItems.length;
      const idx = Math.max(0, Math.min(n - 1, Math.floor(probeSliceIndex)));
      const norm = wheelRotationNormForSliceIndex(idx, n);
      const absolute = 2 * 360 + norm;
      stopAllAnimations();
      applyWheelRotation(absolute);
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      if (cancelled) return;
      const pointerPt = wheelPointerClientPointFromElements(
        pointerRef.current,
        wheelDiscRef.current,
        wheelBorderPx
      );
      const label =
        (getLabel ? getLabel(spinItems[idx]!) : spinItems[idx]?.name) || `#${idx + 1}`;
      setWinnerIndex(idx);
      onRenderSyncReportRef.current?.({
        sliceIndex: idx,
        sliceLabel: label,
        expectedNormDeg: norm,
        motionModDeg: norm,
        domMatrixDeg: readElementRotationDeg(wheelDiscRef.current),
        motionDomDesyncDeg: 0,
        motionVsExpectedDeg: 0,
        domVsExpectedDeg: 0,
        formulaIndexFromMotion: idx,
        formulaIndexFromDom: idx,
        visualPointerIndex: idx,
        renderSyncOk: true,
        visualAlignOk: true,
        formulaDomAlignOk: true,
        ok: true,
        failReason: null,
      });
    };
    void runProbe();
    return () => {
      cancelled = true;
    };
  }, [
    probeSliceIndex,
    probeNonce,
    applyWheelRotation,
    wheelBorderPx,
    getLabel,
    stopAllAnimations,
  ]);

  /** 단일 ease-out 감속 — Framer·다단계 없음 */
  const runWheelSpinEaseOut = useCallback(
    (toAbsolute: number, durationMs: number, isCancelled: () => boolean) =>
      new Promise<void>((resolve) => {
        const from = wheelAbsRef.current;
        const delta = toAbsolute - from;
        if (!Number.isFinite(delta) || delta <= 0 || durationMs <= 0) {
          applyWheelRotation(toAbsolute);
          resolve();
          return;
        }
        const started = performance.now();
        const step = (now: number) => {
          if (isCancelled()) {
            spinRafRef.current = null;
            resolve();
            return;
          }
          const t = Math.min(1, (now - started) / durationMs);
          const eased = 1 - (1 - t) ** 5;
          applyWheelRotation(from + delta * eased);
          if (t < 1) {
            spinRafRef.current = requestAnimationFrame(step);
          } else {
            applyWheelRotation(toAbsolute);
            spinRafRef.current = null;
            resolve();
          }
        };
        spinRafRef.current = requestAnimationFrame(step);
      }),
    [applyWheelRotation]
  );

  useEffect(() => {
    const spinKey = `${startedAt || 0}:${resultId || "none"}:${spinReplayNonce}`;

    if (!isRolling || !startedAt || !resultId) {
      if (!isRolling && !resultId) {
        setFrozenVisualItems(null);
        spinInFlightRef.current = false;
        activeSpinKeyRef.current = "";
        if (!hasLandedRef.current) {
          setWinnerIndex(-1);
          stopAllAnimations();
        }
        hasLandedRef.current = false;
      }
      if (!resultId) {
        activeSpinKeyRef.current = "";
        spinInFlightRef.current = false;
      }
      soundsRef.current?.tick.stop();
      soundsRef.current?.final.stop();
      soundsRef.current?.success.stop();
      return;
    }

    /** 스핀 중 items prop(폴링·주입)이 바뀌면 감속 각도와 칸 라벨이 어긋남 — 시작 시점 스냅샷 고정 */
    const spinItems = itemsRef.current.map((x) => ({ ...x }));
    setFrozenVisualItems(spinItems);
    if (!spinItems.length) return;
    if (activeSpinKeyRef.current === spinKey && (spinInFlightRef.current || hasLandedRef.current)) {
      return;
    }
    activeSpinKeyRef.current = spinKey;
    spinInFlightRef.current = true;

    const boundTarget = targetSliceIndexRef.current;
    let idx = -1;
    if (
      boundTarget != null &&
      boundTarget >= 0 &&
      boundTarget < spinItems.length
    ) {
      idx = Math.floor(boundTarget);
    } else {
      if (typeof process !== "undefined" && process.env.NODE_ENV === "development") {
        console.warn(
          "[RouletteWheel] targetSliceIndex 없음 — resultId 재조회(중복 칸이면 한 칸 어긋날 수 있음)",
          { resultId, boundTarget }
        );
      }
      idx = findSliceIndexForResult(spinItems, resultId);
    }
    if (idx < 0) {
      console.error("[RouletteWheel] resultId not on wheel — spin aborted", resultId);
      activeSpinKeyRef.current = "";
      spinInFlightRef.current = false;
      return;
    }
    lockedTargetSliceIndexRef.current = idx;
    lockedSpinSliceIdRef.current = spinItems[idx]?.id ?? resultId;
    setWinnerIndex(-1);
    hasLandedRef.current = false;
    stopAllAnimations();

    let cancelled = false;
    soundsRef.current?.tick.stop();
    soundsRef.current?.final.stop();

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => window.setTimeout(resolve, ms));

    const runSequence = async () => {
      try {
        const targetIdx = lockedTargetSliceIndexRef.current;
        const n = spinItems.length;
        if (targetIdx < 0 || targetIdx >= n) return;
        const landAngle = wheelAbsoluteLandAngleForSliceIndex(
          wheelAbsRef.current,
          targetIdx,
          n,
          SPIN_LAND_MIN_TURNS
        );

        await runWheelSpinEaseOut(landAngle, SPIN_LAND_DURATION_MS, () => cancelled);
        if (cancelled) return;

        stopAllAnimations();
        const rotateCtl = {
          get: () => wheelAbsRef.current,
          set: (v: number) => applyWheelRotation(v),
        };
        const exactLand = snapWheelAbsoluteToSliceNorm(
          wheelAbsRef.current,
          targetIdx,
          n
        );
        applyWheelRotation(exactLand);
        await sleep(SPIN_LAND_POST_MS);

        const landNorm = wheelRotationNormForSliceIndex(targetIdx, n);
        let landDeg = readElementRotationDeg(wheelDiscRef.current) ?? landNorm;

        if (!hasLandedRef.current) {
          const pointerPt = wheelPointerClientPointFromElements(
            pointerRef.current,
            wheelDiscRef.current,
            wheelBorderPx
          );
          const corrected = await correctWheelLandToTargetSlice(
            wheelDiscRef.current,
            rotateCtl,
            targetIdx,
            n,
            pointerPt,
            wheelBorderPx
          );
          landDeg = corrected.landDeg;
          const forcedAbs =
            Math.floor(wheelAbsRef.current / 360) * 360 + landNorm;
          forceWheelRotationSync(wheelDiscRef.current, rotateCtl, forcedAbs);
          landDeg = readElementRotationDeg(wheelDiscRef.current) ?? landNorm;
          if (
            corrected.corrected &&
            typeof process !== "undefined" &&
            process.env.NODE_ENV === "development"
          ) {
            console.info("[RouletteWheel] angle snap → predetermined slice", {
              targetIdx,
              sliceId: lockedSpinSliceIdRef.current,
              landDeg,
            });
          }
          hasLandedRef.current = true;
          setWinnerIndex(targetIdx);
          logWheelGeometryCheck(
            wheelDiscRef.current,
            pointerRef.current,
            n
          );
        }

        onTransitionEndRef.current?.();

        soundsRef.current?.tick.stop();
        soundsRef.current?.final.stop();
        soundsRef.current?.success.stop();
        if (ROULETTE_WHEEL_SFX_ENABLED) {
          if (!ROULETTE_WHEEL_WAV_ASSETS_ENABLED) {
            playProceduralLand();
          } else {
            playWinChime();
            if (soundsRef.current?.success && !hasSoundAssetErrorRef.current) {
              soundsRef.current.success.volume(volumeRef.current * 0.22);
              window.setTimeout(() => soundsRef.current?.success?.play(), 40);
            }
          }
        }

        if (hasLandedRef.current) {
          onLandedRef.current?.(
            spinItems[targetIdx]?.id ?? resultId,
            landDeg,
            targetIdx,
            null,
            null
          );
        }
      } catch {
        // 예외가 나도 다음 회차 시작이 막히지 않도록 사운드만 정리
        soundsRef.current?.tick.stop();
        soundsRef.current?.final.stop();
        soundsRef.current?.success.stop();
      } finally {
        spinInFlightRef.current = false;
      }
    };

    void runSequence();

    return () => {
      cancelled = true;
      if (!hasLandedRef.current) {
        spinInFlightRef.current = false;
        activeSpinKeyRef.current = "";
        stopAllAnimations();
      }
      soundsRef.current?.tick.stop();
      soundsRef.current?.final.stop();
      soundsRef.current?.success.stop();
    };
  }, [
    isRolling,
    startedAt,
    resultId,
    spinReplayNonce,
    applyWheelRotation,
    stopAllAnimations,
    runWheelSpinEaseOut,
    playProceduralLand,
    playWinChime,
  ]);

  return (
    <div className="relative mx-auto w-full overflow-hidden bg-transparent" style={{ height: `${frameHeightPx}px`, maxWidth: `${frameMaxWidthPx}px` }}>
      <div className="absolute inset-0 grid place-items-center">
        <div
          className="relative shrink-0"
          style={{
            width: `${wheelSizePx}px`,
            height: `${wheelSizePx}px`,
            marginTop: pointerSizePx + 4,
          }}
        >
          <div
            ref={pointerRef}
            className="pointer-events-none absolute left-1/2 z-40 flex -translate-x-1/2 flex-col items-center"
            style={{
              /* ▼ 끝이 디스크 12시 림(상단 중앙)에 오도록 — bbox 각도 오차로 1~2칸 어긋남 방지 */
              top: -(pointerSizePx + Math.max(6, Math.round(pointerSizePx * 0.35)) + 2),
            }}
          >
            <span
              className="text-pink-500 drop-shadow-[0_0_12px_rgba(236,72,153,0.95)]"
              style={{ fontSize: `${pointerSizePx}px`, lineHeight: 1 }}
            >
              ▼
            </span>
            <span
              className="mt-0.5 block w-0.5 shrink-0 bg-pink-400"
              style={{ height: Math.max(6, pointerSizePx * 0.35) }}
              aria-hidden
            />
          </div>
          <div
            ref={wheelDiscRef}
            className="relative overflow-visible rounded-full border-8 border-yellow-300 shadow-[0_0_45px_rgba(251,191,36,0.38)]"
            style={{
              height: `${wheelSizePx}px`,
              width: `${wheelSizePx}px`,
              transformOrigin: "center center",
            }}
          >
            <div
              className="pointer-events-none absolute inset-0 rounded-full"
              style={{ background: gradient }}
              aria-hidden
            />
          {visualItems.map((item, idx) => {
            const labelAngle = wheelSliceCenterDeg(idx, segmentCount);
            const isWin = idx === winnerIndex && winnerIndex >= 0;
            const maxCount = Math.max(1, Math.floor(Number(item.maxCount || 1)));
            const soldCount = Math.max(0, Math.floor(Number(item.soldCount || 0)));
            const isSoldOut = soldCount >= maxCount;
            const fullLabel = (getLabel ? getLabel(item) : item.name) || item.name || "—";
            const displayLabel = formatWheelSegmentLabel(fullLabel, segmentCount);
            const labelOffset = wheelSliceLabelPolarOffsetPx(idx, segmentCount, labelRadiusPx);
            const labelRotateDeg = wheelSliceLabelRotateDeg(labelAngle);
            return (
              <div
                key={`${item.id}-${idx}`}
                data-wheel-slice-anchor
                data-wheel-slot-index={idx}
                className="absolute left-1/2 top-1/2 h-0 w-0"
                style={{
                  transform: `translate(${labelOffset.x}px, ${labelOffset.y}px)`,
                }}
              >
                <span
                  data-wheel-slice-rim
                  className="pointer-events-none absolute left-0 top-0 block h-1 w-1 -translate-x-1/2 -translate-y-1/2 opacity-0"
                  aria-hidden
                />
                <div
                  data-wheel-slot-index={idx}
                  data-wheel-slot-label
                  className="relative z-10"
                  style={{
                    transform: `translate(-50%, -50%) rotate(${labelRotateDeg}deg)`,
                  }}
                >
                  <WheelSegmentLabel
                    isWin={isWin}
                    className={`leading-tight ${isSoldOut && !isWin ? "opacity-80" : ""}`}
                    style={{
                      ...WHEEL_LABEL_READABLE_STYLE,
                      maxWidth: `${labelChordMaxPx}px`,
                      fontSize: `${labelFontPx}px`,
                      lineHeight: 1.1,
                      letterSpacing: "-0.01em",
                      color: isWin ? "#fef9c3" : isSoldOut ? "#e4e4e7" : "#ffffff",
                      fontFamily:
                        '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
                    }}
                    title={fullLabel !== displayLabel ? fullLabel : undefined}
                  >
                    {displayLabel}
                  </WheelSegmentLabel>
                </div>
              </div>
            );
          })}
          <div
            className="pointer-events-none absolute left-1/2 top-0 z-[5] w-1 -translate-x-1/2 rounded-full bg-pink-400/90"
            style={{ height: Math.max(10, wheelBorderPx + 4) }}
            aria-hidden
          />
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-yellow-300/90 bg-black/25 shadow-inner"
            style={{ height: `${centerSizePx}px`, width: `${centerSizePx}px` }}
          />
        </div>
        </div>
      </div>
    </div>
  );
}
