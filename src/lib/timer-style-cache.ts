import type { TimerDisplayStyle } from "@/types";
import { normalizeTimerDisplayStyle } from "@/presentation/theme-normalizer.presentation";

const KEY = "yt-timer-display-style-v1";

function storageKey(userId?: string) {
  const id = String(userId || "default").trim() || "default";
  return `${KEY}:${id}`;
}

/** OBS 새로고침 직후 기본 pill 이 먼저 나오지 않게, 마지막으로 본 타이머 스타일 */
export function readCachedTimerDisplayStyle(userId?: string): TimerDisplayStyle | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return null;
    return normalizeTimerDisplayStyle(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeCachedTimerDisplayStyle(
  userId: string | undefined,
  style: TimerDisplayStyle | null | undefined
) {
  if (typeof window === "undefined" || !style) return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(normalizeTimerDisplayStyle(style)));
  } catch {
    /* quota */
  }
}
