import {
  softOverlayOpacityFrac,
  liftRgbForFade,
  backgroundWithOpacityFrac,
  solidBackgroundWithOpacityFrac,
} from "@/lib/donor-rankings-opacity";

export function normalizeOpacityPct(input: unknown, fallback: number = 100): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function normalizeOpacityFrac(input: unknown, fallback: number = 1): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

export function normalizeBorderWidthPx(input: unknown, fallback: number = 0, maxPx: number = 20): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(maxPx, Math.round(n * 100) / 100));
}

export function normalizeShadowBlurPx(input: unknown, fallback: number = 0, maxPx: number = 100): number {
  const n = Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(maxPx, Math.round(n)));
}

export function normalizeColorString(input: unknown, fallback: string = "transparent"): string {
  const raw = String(input ?? "").trim();
  if (!raw) return fallback;
  return raw;
}

export {
  softOverlayOpacityFrac,
  liftRgbForFade,
  backgroundWithOpacityFrac,
  solidBackgroundWithOpacityFrac,
};
