/** 오버레이 타이머 외형 — 기본 알약(pill) · 플립 · 원형 이미지 프레임 */
export type TimerDesignId = "pill" | "flip-countdown" | "countdown-ring" | "speedometer";

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
];

export const TIMER_FRAME_ASSETS: Partial<Record<TimerDesignId, string>> = {
  "countdown-ring": "/assets/timer-designs/countdown-ring-frame.png",
  speedometer: "/assets/timer-designs/speedometer-frame.png",
};

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
        primary: `${pad2(hours)}:${pad2(minutes)}`,
        secondary: `${pad2(seconds)}`,
        primaryScale: 0.62,
        secondaryScale: 0.28,
        defaultPrimaryColor: "#e2e8f0",
        defaultSecondaryColor: "#94a3b8",
      };
    }
    return {
      primary: String(minutes),
      secondary: "MIN",
      primaryScale: 0.78,
      secondaryScale: 0.26,
      defaultPrimaryColor: "#334155",
      defaultSecondaryColor: "#64748b",
    };
  }

  if (showHours || hours > 0) {
    return {
      primary: `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`,
      primaryScale: 0.52,
      secondaryScale: 0,
      defaultPrimaryColor: "#1f2937",
      defaultSecondaryColor: "#6b7280",
    };
  }
  return {
    primary: `${pad2(minutes)}:${pad2(seconds)}`,
    secondary: "min",
    primaryScale: 0.68,
    secondaryScale: 0.22,
    defaultPrimaryColor: "#111827",
    defaultSecondaryColor: "#374151",
  };
}
