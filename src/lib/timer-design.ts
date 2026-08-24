/** 오버레이 타이머 외형 — 기본 알약(pill) · 플립 · 원형 이미지 프레임 · LED 매트릭스 */
export type TimerDesignId = "pill" | "flip-countdown" | "countdown-ring" | "speedometer" | "led-matrix";

export const TIMER_DESIGN_OPTIONS: { id: TimerDesignId; label: string; description: string }[] = [
  { id: "pill", label: "기본 · 알약", description: "둥근 배경 + 숫자" },
  {
    id: "flip-countdown",
    label: "플립 카운트다운",
    description: "플립 시계형 일·시·분·초 블록",
  },
  {
    id: "countdown-ring",
    label: "원형 · 분 눈금 링",
    description: "5~60분 카운트다운 팩 — 코랄 눈금 원형",
  },
  {
    id: "speedometer",
    label: "스피드미터 · 인포그래픽",
    description: "게이지형 원형 타이머 (인포그래픽 템플릿)",
  },
  {
    id: "led-matrix",
    label: "LED · 7-segment",
    description: "흰 7-seg 숫자 · 검은 패널 · 고스트 88 · 레드 코너",
  },
];

/** @deprecated PNG 프레임 — 템플릿 숫자(60·30 MIN)가 박혀 동적 타이머와 충돌. SVG 렌더 사용 */
export const TIMER_FRAME_ASSETS: Partial<Record<TimerDesignId, string>> = {
  "countdown-ring": "/assets/timer-designs/countdown-ring-frame.png",
  speedometer: "/assets/timer-designs/speedometer-frame.png",
};

export const COUNTDOWN_RING_TICK_COUNT = 60;
export const COUNTDOWN_RING_COLORS = {
  active: "#e8675a",
  inactive: "#c8cdd4",
  text: "#111827",
  subtext: "#374151",
} as const;
export const SPEEDOMETER_COLORS = {
  track: "#3d4852",
  fill: "#00c4dc",
  tick: "#cbd5e1",
  needle: "#f8fafc",
  text: "#e2e8f0",
  subtext: "#94a3b8",
} as const;

/** SVG 게이지 중심·숫자 앵커 — SpeedometerSvg cy 와 동일 */
export const SPEEDOMETER_LAYOUT = {
  centerYRatio: 0.54,
  textMinWidthCh: 4.5,
} as const;

/** 코랄 링 — 남은 분(올림)만큼 눈금 강조, 최대 60 */
export function computeCountdownRingFilledTicks(remainingSec: number | null | undefined): number {
  const safe = Math.max(0, Math.floor(Number(remainingSec) || 0));
  if (safe <= 0) return 0;
  return Math.min(COUNTDOWN_RING_TICK_COUNT, Math.ceil(safe / 60));
}

/** 스피드미터 호 — 0~1. 링과 동일하게 남은 분(올림) / 60 */
export function computeSpeedometerFillRatio(remainingSec: number | null | undefined): number {
  return computeCountdownRingFilledTicks(remainingSec) / COUNTDOWN_RING_TICK_COUNT;
}

/** CircularImageTimer px — 관리자 미리보기·오버레이 동일 공식 */
export function resolveCircularImageTimerFontSize(args: {
  timerOnlyMode: boolean;
  memberSizePx?: number;
  scalePercent?: number;
}): number {
  const scale =
    Math.max(50, Math.min(250, Math.round(Number(args.scalePercent) || 100))) / 100;
  const memberSize = Math.max(10, Math.round(Number(args.memberSizePx) || 18));
  const base = args.timerOnlyMode ? 56 : Math.max(28, Math.round(memberSize * 1.45));
  return Math.max(14, Math.round(base * scale));
}

export function normalizeTimerDesign(raw: unknown): TimerDesignId {
  const v = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (
    v === "flip" ||
    v === "flip-countdown" ||
    v === "countdown" ||
    v === "flip-clock" ||
    v === "vector"
  ) {
    return "flip-countdown";
  }
  if (
    v === "countdown-ring" ||
    v === "ring" ||
    v === "minute-ring" ||
    v === "clock-ring" ||
    v === "coral-ring"
  ) {
    return "countdown-ring";
  }
  if (v === "speedometer" || v === "gauge" || v === "infographic" || v === "speedo") {
    return "speedometer";
  }
  if (
    v === "led-matrix" ||
    v === "led" ||
    v === "digital-led" ||
    v === "dot-matrix" ||
    v === "dotmatrix" ||
    v === "ledmatrix" ||
    v === "7segment" ||
    v === "7-segment" ||
    v === "led-7segment" ||
    v === "led7segment" ||
    v === "dseg"
  ) {
    return "led-matrix";
  }
  return "pill";
}

export function isDefaultTimerDesign(raw: unknown): boolean {
  return normalizeTimerDesign(raw) === "pill";
}

export function isImageFrameTimerDesign(
  design: TimerDesignId
): design is Extract<TimerDesignId, "countdown-ring" | "speedometer"> {
  return design === "countdown-ring" || design === "speedometer";
}

export function resolveTimerFrameAssetUrl(design: TimerDesignId): string | null {
  return TIMER_FRAME_ASSETS[design] ?? null;
}

export type FlipCountdownSegment = { value: string; label: string };

export type CircularImageTimerDisplay = {
  primary: string;
  secondary?: string;
  primaryScale: number;
  secondaryScale: number;
  defaultPrimaryColor: string;
  defaultSecondaryColor: string;
};

/** 남은 초 → 플립 블록 (24h 이상이면 일 포함) */
export function buildFlipCountdownSegments(
  totalSec: number | null | undefined,
  showHours: boolean
): FlipCountdownSegment[] {
  const safe = Math.max(0, Math.floor(Number(totalSec) || 0));
  const pad2 = (n: number) => String(Math.min(99, n)).padStart(2, "0");
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (days > 0) {
    return [
      { value: pad2(days), label: "DAYS" },
      { value: pad2(hours), label: "HOURS" },
      { value: pad2(minutes), label: "MINUTES" },
      { value: pad2(seconds), label: "SECONDS" },
    ];
  }
  if (showHours || hours > 0 || safe >= 3600) {
    return [
      { value: pad2(hours), label: "HOURS" },
      { value: pad2(minutes), label: "MINUTES" },
      { value: pad2(seconds), label: "SECONDS" },
    ];
  }
  return [
    { value: pad2(minutes), label: "MINUTES" },
    { value: pad2(seconds), label: "SECONDS" },
  ];
}

/** 원형 이미지 타이머 중앙 표시 */
export function buildCircularImageTimerDisplay(
  totalSec: number | null | undefined,
  showHours: boolean,
  design: Extract<TimerDesignId, "countdown-ring" | "speedometer">
): CircularImageTimerDisplay | null {
  if (totalSec == null || !Number.isFinite(totalSec)) return null;
  const safe = Math.max(0, Math.floor(Number(totalSec) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");

  if (design === "speedometer") {
    if (showHours || hours > 0) {
      return {
        primary: `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`,
        primaryScale: 0.48,
        secondaryScale: 0,
        defaultPrimaryColor: SPEEDOMETER_COLORS.text,
        defaultSecondaryColor: SPEEDOMETER_COLORS.subtext,
      };
    }
    return {
      primary: `${pad2(minutes)}:${pad2(seconds)}`,
      primaryScale: 0.58,
      secondaryScale: 0,
      defaultPrimaryColor: SPEEDOMETER_COLORS.text,
      defaultSecondaryColor: SPEEDOMETER_COLORS.subtext,
    };
  }

  if (showHours || hours > 0) {
    return {
      primary: `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`,
      primaryScale: 0.52,
      secondaryScale: 0,
      defaultPrimaryColor: COUNTDOWN_RING_COLORS.text,
      defaultSecondaryColor: COUNTDOWN_RING_COLORS.subtext,
    };
  }
  return {
    primary: `${pad2(minutes)}:${pad2(seconds)}`,
    secondary: "min",
    primaryScale: 0.68,
    secondaryScale: 0.22,
    defaultPrimaryColor: COUNTDOWN_RING_COLORS.text,
    defaultSecondaryColor: COUNTDOWN_RING_COLORS.subtext,
  };
}

export const LED_MATRIX_COLORS = {
  digit: "#f8fafc",
  digitHot: "#ffffff",
  /** 비점등 세그먼트 — 실제 LED처럼 아주 옅게만 */
  ghost: "rgba(255, 255, 255, 0.1)",
  corner: "#ef4444",
  border: "#ef4444",
  panel: "#000000",
} as const;

export const LED_SEGMENT_FONT_FAMILY =
  '"DSEG7 Classic", "Share Tech Mono", "DS-Digital", ui-monospace, monospace';

/** a=상단 … g=중앙. SVG 7-seg 점등 마스크 */
export const LED_SEVEN_SEGMENT_MASK: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abged",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
};

export function ledSevenSegmentIsOn(
  digit: string,
  segment: "a" | "b" | "c" | "d" | "e" | "f" | "g"
): boolean {
  return (LED_SEVEN_SEGMENT_MASK[digit] || "").includes(segment);
}

/** LED 패널에 표시할 MM:SS 또는 HH:MM:SS */
export function buildLedMatrixTimerText(
  totalSec: number | null | undefined,
  showHours: boolean
): string | null {
  if (totalSec == null || !Number.isFinite(totalSec)) return null;
  const safe = Math.max(0, Math.floor(Number(totalSec) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad2 = (n: number) => String(n).padStart(2, "0");
  if (showHours || hours > 0) {
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

/** 고스트(비점등) 세그먼트 — DSEG7에서 8은 전 세그먼트 ON */
export function buildLedMatrixGhostText(showHours: boolean): string {
  return showHours ? "88:88:88" : "88:88";
}
