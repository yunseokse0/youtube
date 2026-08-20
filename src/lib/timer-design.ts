/** 오버레이 타이머 외형 — 기본 알약(pill) · 플립 카운트다운 */
export type TimerDesignId = "pill" | "flip-countdown";

export const TIMER_DESIGN_OPTIONS: { id: TimerDesignId; label: string; description: string }[] = [
  { id: "pill", label: "기본 · 알약", description: "둥근 배경 + 숫자" },
  {
    id: "flip-countdown",
    label: "플립 카운트다운",
    description: "플립 시계형 일·시·분·초 블록",
  },
];

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
  return "pill";
}

export function isDefaultTimerDesign(raw: unknown): boolean {
  return normalizeTimerDesign(raw) === "pill";
}

export type FlipCountdownSegment = { value: string; label: string };

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
      { value: pad2(days), label: "일" },
      { value: pad2(hours), label: "시" },
      { value: pad2(minutes), label: "분" },
      { value: pad2(seconds), label: "초" },
    ];
  }
  if (showHours || hours > 0 || safe >= 3600) {
    return [
      { value: pad2(hours), label: "시" },
      { value: pad2(minutes), label: "분" },
      { value: pad2(seconds), label: "초" },
    ];
  }
  return [
    { value: pad2(minutes), label: "분" },
    { value: pad2(seconds), label: "초" },
  ];
}
