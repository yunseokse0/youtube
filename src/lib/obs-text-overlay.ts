import type { AppState } from "@/types";
import {
  normalizeObsTextEffect,
  normalizeObsTextEffectSpeed,
  type ObsTextEffectId,
} from "@/lib/obs-text-effects";

export const OBS_TEXT_OVERLAY_STATE_KEY = "obsTextOverlayV1";
/** OBS 브라우저 소스 URL — 어떤 텍스트 오버레이 인스턴스인지 */
export const OBS_TEXT_ID_QUERY = "textId";
export const DEFAULT_OBS_TEXT_INSTANCE_ID = "default";
export const MAX_OBS_TEXT_INSTANCES = 24;
/** 인스턴스(OBS 소스 1개)당 최대 줄 수 */
export const MAX_OBS_TEXT_BLOCKS_PER_INSTANCE = 32;

export type { ObsTextEffectId } from "@/lib/obs-text-effects";

/** 독립 OBS 브라우저 소스 1개 = 인스턴스 1개 (각자 URL·위치·문구) */
export type ObsTextOverlayInstance = {
  id: string;
  name: string;
  config: ObsTextOverlayConfig;
};

export type ObsTextOverlayRegistry = {
  version: 2;
  instances: ObsTextOverlayInstance[];
};

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
  /* 유튜브·방송 채팅에서 흔한 이모지 (텍스트/이미지 URL 아님 — OBS 안전) */
  "ㅋㅋ",
  "ㅎㅎ",
  "ㄷㄷ",
  "ㄹㅇ",
  "ㅇㅇ",
  "ㅠㅠ",
  "ㅜㅜ",
  "🤔",
  "😮",
  "😱",
  "🤯",
  "😤",
  "🥺",
  "😇",
  "🤗",
  "🫡",
  "👀",
  "💀",
  "🗿",
  "🫠",
  "🤡",
  "👍",
  "👎",
  "✌️",
  "🤝",
  "💥",
  "💫",
  "🎯",
  "🎊",
  "🎈",
  "🧡",
  "💜",
  "💙",
  "💚",
  "🖤",
  "🤍",
  "🩷",
  "🩵",
  "🐱",
  "🐶",
  "🦊",
  "🐻",
  "🍕",
  "🍔",
  "☕",
  "🍺",
  "🎤",
  "📺",
  "🎬",
  "🏅",
  "🥇",
  "🥈",
  "🥉",
];

/** OBS remount 방지 — revision 제외한 표시용 서명 */
export function obsTextConfigSyncSignature(config: ObsTextOverlayConfig): string {
  const { revision: _r, ...rest } = config;
  return JSON.stringify(rest);
}

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

export function newObsTextInstanceId(): string {
  return `text_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultObsTextRegistry(): ObsTextOverlayRegistry {
  return {
    version: 2,
    instances: [
      {
        id: DEFAULT_OBS_TEXT_INSTANCE_ID,
        name: "텍스트 1",
        config: defaultObsTextOverlayConfig(),
      },
    ],
  };
}

function normalizeInstance(raw: unknown, idx: number): ObsTextOverlayInstance | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const config = normalizeObsTextOverlay(o.config ?? o);
  const id = String(o.id || `text_${idx + 1}`).trim() || `text_${idx + 1}`;
  const name = String(o.name || `텍스트 ${idx + 1}`).trim() || `텍스트 ${idx + 1}`;
  return { id, name, config };
}

/** v2 레지스트리 · 구버전 단일 config(v1) 자동 이전 */
export function normalizeObsTextRegistry(raw: unknown): ObsTextOverlayRegistry {
  if (!raw || typeof raw !== "object") return defaultObsTextRegistry();
  const o = raw as Record<string, unknown>;
  if (Array.isArray(o.instances)) {
    const instances = o.instances
      .map((item, i) => normalizeInstance(item, i))
      .filter((x): x is ObsTextOverlayInstance => !!x)
      .slice(0, MAX_OBS_TEXT_INSTANCES);
    if (instances.length > 0) return { version: 2, instances };
    return defaultObsTextRegistry();
  }
  if (Array.isArray(o.blocks)) {
    return {
      version: 2,
      instances: [
        {
          id: DEFAULT_OBS_TEXT_INSTANCE_ID,
          name: "텍스트 1",
          config: normalizeObsTextOverlay(raw),
        },
      ],
    };
  }
  return defaultObsTextRegistry();
}

export function readObsTextRegistryFromState(
  state: AppState | null | undefined
): ObsTextOverlayRegistry {
  const os = state?.overlaySettings;
  if (!os || typeof os !== "object") return defaultObsTextRegistry();
  const raw = (os as Record<string, unknown>)[OBS_TEXT_OVERLAY_STATE_KEY];
  return normalizeObsTextRegistry(raw);
}

export function resolveObsTextInstanceId(
  registry: ObsTextOverlayRegistry,
  textIdRaw?: string | null
): string {
  const want = String(textIdRaw ?? "").trim();
  if (want) {
    const hit = registry.instances.find((i) => i.id === want);
    if (hit) return hit.id;
  }
  return registry.instances[0]?.id ?? DEFAULT_OBS_TEXT_INSTANCE_ID;
}

export function getObsTextInstance(
  registry: ObsTextOverlayRegistry,
  instanceId?: string | null
): ObsTextOverlayInstance {
  const id = resolveObsTextInstanceId(registry, instanceId);
  return (
    registry.instances.find((i) => i.id === id) ??
    registry.instances[0] ?? {
      id: DEFAULT_OBS_TEXT_INSTANCE_ID,
      name: "텍스트 1",
      config: defaultObsTextOverlayConfig(),
    }
  );
}

export function readObsTextOverlayFromState(
  state: AppState | null | undefined,
  instanceId?: string | null
): ObsTextOverlayConfig {
  return getObsTextInstance(readObsTextRegistryFromState(state), instanceId).config;
}

export function createObsTextInstance(name?: string): ObsTextOverlayInstance {
  return {
    id: newObsTextInstanceId(),
    name: name?.trim() || "새 텍스트",
    config: defaultObsTextOverlayConfig(),
  };
}

function cloneObsTextConfig(config: ObsTextOverlayConfig): ObsTextOverlayConfig {
  return normalizeObsTextOverlay(JSON.parse(JSON.stringify(config)) as unknown);
}

/** 레지스트리에 인스턴스 추가 (최대 24) */
export function appendObsTextInstance(
  registry: ObsTextOverlayRegistry,
  name?: string
): { registry: ObsTextOverlayRegistry; instance: ObsTextOverlayInstance } | null {
  if (registry.instances.length >= MAX_OBS_TEXT_INSTANCES) return null;
  const instance = createObsTextInstance(
    name?.trim() || `텍스트 ${registry.instances.length + 1}`
  );
  return {
    registry: { version: 2, instances: [...registry.instances, instance] },
    instance,
  };
}

/** 선택 인스턴스 설정 복제 */
export function duplicateObsTextInstance(
  registry: ObsTextOverlayRegistry,
  sourceId: string
): { registry: ObsTextOverlayRegistry; instance: ObsTextOverlayInstance } | null {
  if (registry.instances.length >= MAX_OBS_TEXT_INSTANCES) return null;
  const src = registry.instances.find((i) => i.id === sourceId);
  if (!src) return null;
  const instance: ObsTextOverlayInstance = {
    id: newObsTextInstanceId(),
    name: `${src.name} 복사`.slice(0, 40),
    config: cloneObsTextConfig(src.config),
  };
  return {
    registry: { version: 2, instances: [...registry.instances, instance] },
    instance,
  };
}

/** 인스턴스 삭제 (최소 1개 유지) */
export function removeObsTextInstance(
  registry: ObsTextOverlayRegistry,
  id: string
): ObsTextOverlayRegistry | null {
  if (registry.instances.length <= 1) return null;
  const instances = registry.instances.filter((i) => i.id !== id);
  if (instances.length === registry.instances.length) return null;
  return { version: 2, instances };
}

export function renameObsTextInstance(
  registry: ObsTextOverlayRegistry,
  id: string,
  name: string
): ObsTextOverlayRegistry {
  return {
    version: 2,
    instances: registry.instances.map((i) =>
      i.id === id ? { ...i, name: name.trim() || i.name } : i
    ),
  };
}

/** OBS 등록용 — 인스턴스별 URL 목록(한 줄에 하나) */
export function formatObsTextOverlayUrlList(
  origin: string,
  userId: string,
  registry: ObsTextOverlayRegistry
): string {
  return registry.instances
    .map((inst) => `# ${inst.name} (${inst.id})\n${buildObsTextOverlayUrl(origin, userId, inst.id)}`)
    .join("\n\n");
}

export function mergeObsTextRegistryIntoState(
  state: AppState,
  registry: ObsTextOverlayRegistry
): AppState {
  const os =
    state.overlaySettings && typeof state.overlaySettings === "object"
      ? { ...(state.overlaySettings as Record<string, unknown>) }
      : {};
  return {
    ...state,
    overlaySettings: { ...os, [OBS_TEXT_OVERLAY_STATE_KEY]: registry },
    updatedAt: Date.now(),
  };
}

export function segmentsToPlainText(segments: ObsTextSegment[]): string {
  return segments.map((s) => s.text).join("");
}

export function createObsTextBlockId(): string {
  return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 블록 배열 → 편집용 여러 줄 문자열 */
export function multilineTextFromBlocks(blocks: ObsTextBlock[]): string {
  if (!blocks.length) return "";
  return blocks
    .map((b) => segmentsToPlainText(b.segments).replace(/\u00a0/g, " "))
    .join("\n");
}

function blockPlainLine(block: ObsTextBlock): string {
  return segmentsToPlainText(block.segments).replace(/\u00a0/g, " ");
}

function isCharColorBlock(block: ObsTextBlock): boolean {
  return (
    block.segments.length > 1 &&
    block.segments.every((s) => Array.from(s.text).length <= 1)
  );
}

function createDefaultObsTextBlock(text: string, defaultColor: string): ObsTextBlock {
  const line = text.length === 0 ? " " : text;
  return {
    id: createObsTextBlockId(),
    segments: [{ text: line, color: defaultColor }],
    visible: true,
    align: "center",
    effect: "none",
    effectSpeed: 1,
  };
}

/** 여러 줄 입력 → 블록 동기화(기존 줄은 id·효과·정렬 유지) */
export function blocksFromMultilineText(
  raw: string,
  prevBlocks: ObsTextBlock[],
  defaultColor: string
): ObsTextBlock[] {
  const lines = raw.split(/\r?\n/).slice(0, MAX_OBS_TEXT_BLOCKS_PER_INSTANCE);
  if (lines.length === 0) {
    return [createDefaultObsTextBlock(" ", defaultColor)];
  }
  return lines.map((line, idx) => {
    const prev = prevBlocks[idx];
    const normalized = line.length === 0 ? " " : line;
    if (!prev) {
      return createDefaultObsTextBlock(normalized, defaultColor);
    }
    if (isCharColorBlock(prev)) {
      return {
        ...prev,
        segments: mergeSegmentsFromPlainText(
          normalized,
          prev.segments,
          defaultColor
        ),
      };
    }
    const color = prev.segments[0]?.color ?? defaultColor;
    return {
      ...prev,
      segments: [{ text: normalized, color }],
    };
  });
}

/** 커서/선택 위치가 속한 줄 인덱스 */
export function lineIndexAtTextOffset(text: string, offset: number): number {
  const safe = Math.max(0, Math.min(offset, text.length));
  if (safe === 0) return 0;
  return text.slice(0, safe).split(/\r?\n/).length - 1;
}

/** 줄 인덱스 → 전체 문자열에서 해당 줄의 [start, end) */
export function lineCharRangeInMultiline(
  text: string,
  lineIndex: number
): { start: number; end: number; line: string } {
  const lines = text.split(/\r?\n/);
  const idx = Math.max(0, Math.min(lineIndex, lines.length - 1));
  let start = 0;
  for (let i = 0; i < idx; i++) {
    start += lines[i].length + 1;
  }
  const line = lines[idx] ?? "";
  return { start, end: start + line.length, line };
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
  instanceId?: string,
  extra?: Record<string, string>
): string {
  const params = new URLSearchParams({ u: userId, host: "obs" });
  const id = String(instanceId ?? "").trim();
  if (id) params.set(OBS_TEXT_ID_QUERY, id);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      if (v) params.set(k, v);
    }
  }
  return `${origin.replace(/\/$/, "")}/overlay/obs-text?${params.toString()}`;
}

export function obsTextOverlayPath(userId: string, instanceId: string): string {
  const q = new URLSearchParams({ u: userId, host: "obs", [OBS_TEXT_ID_QUERY]: instanceId });
  return `/overlay/obs-text?${q.toString()}`;
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
