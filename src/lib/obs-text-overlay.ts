import type { AppState } from "@/types";
import {
  normalizeObsTextEffect,
  normalizeObsTextEffectSpeed,
  type ObsTextEffectId,
} from "@/lib/obs-text-effects";

export const OBS_TEXT_OVERLAY_STATE_KEY = "obsTextOverlayV1";

export type { ObsTextEffectId } from "@/lib/obs-text-effects";

export type ObsTextSegment = {
  text: string;
  color: string;
};

export type ObsTextBlock = {
  id: string;
  segments: ObsTextSegment[];
  fontSizePx?: number;
  align?: "left" | "center" | "right";
  visible?: boolean;
  /** 줄 단위 연출 (OBS 브라우저 소스 CSS 애니메이션) */
  effect?: ObsTextEffectId;
  /** 연출 속도 배율 (0.35~3, 1=기본) */
  effectSpeed?: number;
};

export type ObsTextOverlayPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export type ObsTextOverlayConfig = {
  version: 1;
  blocks: ObsTextBlock[];
  defaultFontSizePx: number;
  defaultColor: string;
  fontFamily: string;
  fontWeight: number;
  lineGapPx: number;
  outlineEnabled: boolean;
  outlineColor: string;
  outlineWidthPx: number;
  position: ObsTextOverlayPosition;
  paddingPx: number;
  offsetX: number;
  offsetY: number;
  scalePct: number;
  revision?: number;
};

export const OBS_TEXT_EMOJI_PRESETS: string[] = [
  "❤️",
  "🔥",
  "✨",
  "💯",
  "👑",
  "🎉",
  "😂",
  "😭",
  "🥹",
  "💕",
  "⭐",
  "🌟",
  "💎",
  "🎁",
  "👏",
  "🙏",
  "💪",
  "🫶",
  "😎",
  "🤣",
  "😍",
  "🥳",
  "⚡",
  "🎵",
  "🎶",
  "💃",
  "🕺",
  "🏆",
  "📢",
  "‼️",
  "❗",
  "❓",
  "✅",
  "❌",
  "💬",
  "🎮",
  "🍀",
  "🌈",
  "☀️",
  "🌙",
];

const DEFAULT_COLOR = "#ffffff";
const DEFAULT_OUTLINE = "#000000";

export function defaultObsTextOverlayConfig(): ObsTextOverlayConfig {
  return {
    version: 1,
    blocks: [
      {
        id: "block-1",
        segments: [{ text: "방송 텍스트", color: DEFAULT_COLOR }],
        visible: true,
        align: "center",
      },
    ],
    defaultFontSizePx: 48,
    defaultColor: DEFAULT_COLOR,
    fontFamily: '"Pretendard Variable", Pretendard, "Noto Sans KR", sans-serif',
    fontWeight: 800,
    lineGapPx: 12,
    outlineEnabled: true,
    outlineColor: DEFAULT_OUTLINE,
    outlineWidthPx: 3,
    position: "bottom-center",
    paddingPx: 24,
    offsetX: 0,
    offsetY: 0,
    scalePct: 100,
    revision: 0,
  };
}

function normalizeHexColor(raw: unknown, fallback: string): string {
  const s = String(raw ?? "").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  return fallback;
}

function normalizeSegment(raw: unknown, defaultColor: string): ObsTextSegment | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const text = String(o.text ?? "");
  if (!text) return null;
  return {
    text,
    color: normalizeHexColor(o.color, defaultColor),
  };
}

function normalizeBlock(raw: unknown, defaultColor: string, idx: number): ObsTextBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const segsRaw = Array.isArray(o.segments) ? o.segments : [];
  const segments = segsRaw
    .map((s) => normalizeSegment(s, defaultColor))
    .filter((s): s is ObsTextSegment => !!s);
  if (segments.length === 0) return null;
  const alignRaw = String(o.align ?? "center");
  const align =
    alignRaw === "left" || alignRaw === "right" || alignRaw === "center" ? alignRaw : "center";
  return {
    id: String(o.id || `block-${idx + 1}`),
    segments,
    fontSizePx:
      typeof o.fontSizePx === "number" && Number.isFinite(o.fontSizePx)
        ? Math.max(12, Math.min(200, o.fontSizePx))
        : undefined,
    align,
    visible: o.visible !== false,
    effect: normalizeObsTextEffect(o.effect),
    effectSpeed: normalizeObsTextEffectSpeed(o.effectSpeed),
  };
}

const POSITIONS: ObsTextOverlayPosition[] = [
  "top-left",
  "top-center",
  "top-right",
  "center",
  "bottom-left",
  "bottom-center",
  "bottom-right",
];

export function normalizeObsTextOverlay(raw: unknown): ObsTextOverlayConfig {
  const base = defaultObsTextOverlayConfig();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const defaultColor = normalizeHexColor(o.defaultColor, base.defaultColor);
  const blocksRaw = Array.isArray(o.blocks) ? o.blocks : [];
  const blocks = blocksRaw
    .map((b, i) => normalizeBlock(b, defaultColor, i))
    .filter((b): b is ObsTextBlock => !!b);
  const positionRaw = String(o.position ?? base.position);
  const position = POSITIONS.includes(positionRaw as ObsTextOverlayPosition)
    ? (positionRaw as ObsTextOverlayPosition)
    : base.position;
  return {
    version: 1,
    blocks: blocks.length > 0 ? blocks : base.blocks,
    defaultFontSizePx:
      typeof o.defaultFontSizePx === "number" && Number.isFinite(o.defaultFontSizePx)
        ? Math.max(12, Math.min(200, o.defaultFontSizePx))
        : base.defaultFontSizePx,
    defaultColor,
    fontFamily: String(o.fontFamily || base.fontFamily),
    fontWeight:
      typeof o.fontWeight === "number" && Number.isFinite(o.fontWeight)
        ? Math.max(400, Math.min(900, o.fontWeight))
        : base.fontWeight,
    lineGapPx:
      typeof o.lineGapPx === "number" && Number.isFinite(o.lineGapPx)
        ? Math.max(0, Math.min(80, o.lineGapPx))
        : base.lineGapPx,
    outlineEnabled: o.outlineEnabled !== false,
    outlineColor: normalizeHexColor(o.outlineColor, base.outlineColor),
    outlineWidthPx:
      typeof o.outlineWidthPx === "number" && Number.isFinite(o.outlineWidthPx)
        ? Math.max(0, Math.min(12, o.outlineWidthPx))
        : base.outlineWidthPx,
    position,
    paddingPx:
      typeof o.paddingPx === "number" && Number.isFinite(o.paddingPx)
        ? Math.max(0, Math.min(200, o.paddingPx))
        : base.paddingPx,
    offsetX:
      typeof o.offsetX === "number" && Number.isFinite(o.offsetX)
        ? Math.max(-800, Math.min(800, o.offsetX))
        : base.offsetX,
    offsetY:
      typeof o.offsetY === "number" && Number.isFinite(o.offsetY)
        ? Math.max(-800, Math.min(800, o.offsetY))
        : base.offsetY,
    scalePct:
      typeof o.scalePct === "number" && Number.isFinite(o.scalePct)
        ? Math.max(25, Math.min(300, o.scalePct))
        : base.scalePct,
    revision: typeof o.revision === "number" ? o.revision : base.revision,
  };
}

export function readObsTextOverlayFromState(state: AppState | null | undefined): ObsTextOverlayConfig {
  const os = state?.overlaySettings;
  if (!os || typeof os !== "object") return defaultObsTextOverlayConfig();
  const raw = (os as Record<string, unknown>)[OBS_TEXT_OVERLAY_STATE_KEY];
  return normalizeObsTextOverlay(raw);
}

export function segmentsToPlainText(segments: ObsTextSegment[]): string {
  return segments.map((s) => s.text).join("");
}

/** 유니코드 코드 포인트 단위 분할(이모지 1개 = 1칸) */
export function splitTextToCharSegments(text: string, color: string): ObsTextSegment[] {
  const chars = Array.from(text);
  if (chars.length === 0) return [{ text: " ", color }];
  return chars.map((ch) => ({ text: ch, color }));
}

export function mergeSegmentsFromPlainText(
  text: string,
  existing: ObsTextSegment[] | undefined,
  defaultColor: string
): ObsTextSegment[] {
  const prev = existing && existing.length > 0 ? existing : undefined;
  if (!prev) return text ? [{ text, color: defaultColor }] : [{ text: " ", color: defaultColor }];
  const oldPlain = segmentsToPlainText(prev);
  if (oldPlain === text) return prev;
  if (!text) return [{ text: " ", color: defaultColor }];
  const nextChars = Array.from(text);
  const oldChars = Array.from(oldPlain);
  if (nextChars.length === oldChars.length) {
    return nextChars.map((ch, i) => ({
      text: ch,
      color: prev[i]?.color ?? defaultColor,
    }));
  }
  return [{ text, color: prev[0]?.color ?? defaultColor }];
}

export function buildObsTextOverlayUrl(
  origin: string,
  userId: string,
  extra?: Record<string, string>
): string {
  const params = new URLSearchParams({ u: userId, host: "obs" });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  return `${origin.replace(/\/$/, "")}/overlay/obs-text?${params.toString()}`;
}

export function positionToFlexStyle(
  position: ObsTextOverlayPosition,
  paddingPx: number,
  offsetX: number,
  offsetY: number
): {
  justifyContent: string;
  alignItems: string;
  padding: string;
  transform: string;
} {
  const pad = `${paddingPx}px`;
  const tx = `translate(${offsetX}px, ${offsetY}px)`;
  switch (position) {
    case "top-left":
      return { justifyContent: "flex-start", alignItems: "flex-start", padding: pad, transform: tx };
    case "top-center":
      return { justifyContent: "center", alignItems: "flex-start", padding: pad, transform: tx };
    case "top-right":
      return { justifyContent: "flex-end", alignItems: "flex-start", padding: pad, transform: tx };
    case "center":
      return { justifyContent: "center", alignItems: "center", padding: pad, transform: tx };
    case "bottom-left":
      return { justifyContent: "flex-start", alignItems: "flex-end", padding: pad, transform: tx };
    case "bottom-right":
      return { justifyContent: "flex-end", alignItems: "flex-end", padding: pad, transform: tx };
    case "bottom-center":
    default:
      return { justifyContent: "center", alignItems: "flex-end", padding: pad, transform: tx };
  }
}

export function buildTextOutlineShadow(
  enabled: boolean,
  color: string,
  widthPx: number
): string | undefined {
  if (!enabled || widthPx <= 0) return undefined;
  const w = Math.round(widthPx);
  const parts: string[] = [];
  for (let dx = -w; dx <= w; dx++) {
    for (let dy = -w; dy <= w; dy++) {
      if (dx === 0 && dy === 0) continue;
      if (dx * dx + dy * dy > w * w + 1) continue;
      parts.push(`${dx}px ${dy}px 0 ${color}`);
    }
  }
  parts.push(`0 ${Math.max(2, w)}px ${w * 2}px rgba(0,0,0,0.45)`);
  return parts.join(", ");
}
