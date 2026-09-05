import type { OverlayConfig } from "@/types";
import { sanitizeOverlayEmbedMediaUrl } from "@/lib/gif-url";
import { normalizeOverlayPresetDonationGoals } from "@/lib/goal-preset-math";

export function normalizeOverlayBodyImagePosition(input: unknown): OverlayConfig["bodyImagePosition"] {
  const raw = String(input || "").trim();
  if (raw === "abovePanel" || raw === "belowList") return raw;
  return "belowTitle";
}

export function normalizeOverlayConfig(input: unknown): OverlayConfig {
  const v = input && typeof input === "object" ? (input as Partial<OverlayConfig>) : {};
  const urlRaw = typeof v.bgGifUrl === "string" ? v.bgGifUrl.trim() : "";
  let op = Number(v.bgOpacity);
  if (!Number.isFinite(op)) op = 40;
  op = Math.max(0, Math.min(100, Math.round(op)));
  const bgGifUrl = sanitizeOverlayEmbedMediaUrl(urlRaw);
  const bodyUrlRaw = typeof v.bodyImageUrl === "string" ? v.bodyImageUrl.trim() : "";
  const bodyImageUrl = sanitizeOverlayEmbedMediaUrl(bodyUrlRaw);
  let bodyOp = Number(v.bodyImageOpacity);
  if (!Number.isFinite(bodyOp)) bodyOp = 100;
  bodyOp = Math.max(0, Math.min(100, Math.round(bodyOp)));
  const frameUrlRaw = typeof v.frameUrl === "string" ? v.frameUrl.trim() : "";
  const frameUrl = sanitizeOverlayEmbedMediaUrl(frameUrlRaw);
  let frameOp = Number(v.frameOpacity);
  if (!Number.isFinite(frameOp)) frameOp = 100;
  frameOp = Math.max(0, Math.min(100, Math.round(frameOp)));
  let frameInset = Number(v.frameInset);
  if (!Number.isFinite(frameInset)) frameInset = 32;
  frameInset = Math.max(0, Math.min(120, Math.round(frameInset)));
  return {
    bgGifUrl,
    bgOpacity: op,
    isBgEnabled: bgGifUrl ? v.isBgEnabled !== false : false,
    bodyImageUrl,
    bodyImageOpacity: bodyOp,
    isBodyImageEnabled: Boolean(bodyImageUrl && v.isBodyImageEnabled),
    bodyImagePosition: normalizeOverlayBodyImagePosition(v.bodyImagePosition),
    frameUrl,
    frameOpacity: frameOp,
    frameInset,
    isFrameEnabled: Boolean(frameUrl && v.isFrameEnabled),
  };
}

export function normalizeDonationListsOverlayConfig(input: unknown): OverlayConfig {
  return normalizeOverlayConfig(input);
}

export function normalizeLegacyOverlaySettings(input: unknown): OverlayConfig {
  return normalizeOverlayConfig(input);
}

export function normalizeOverlayConfigSafe(input: unknown): OverlayConfig {
  try {
    return normalizeOverlayConfig(input);
  } catch {
    return normalizeOverlayConfig(null);
  }
}

function normalizeOverlayPresetsMedia(input: unknown): unknown[] {
  if (!Array.isArray(input)) return [];
  const withMedia = input.map((p) => {
    if (!p || typeof p !== "object") return p;
    const o = p as Record<string, unknown>;
    const next = { ...o };
    if (typeof o.tableBgGifUrl === "string") {
      next.tableBgGifUrl = sanitizeOverlayEmbedMediaUrl(o.tableBgGifUrl);
    }
    if (typeof o.tableFrameUrl === "string") {
      next.tableFrameUrl = sanitizeOverlayEmbedMediaUrl(o.tableFrameUrl);
    }
    if (typeof o.goalBarGifUrl === "string") {
      next.goalBarGifUrl = sanitizeOverlayEmbedMediaUrl(o.goalBarGifUrl);
    }
    return next;
  });
  return normalizeOverlayPresetDonationGoals(withMedia) as unknown[];
}

export { normalizeOverlayPresetsMedia };
