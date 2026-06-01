/** OBS 텍스트 오버레이 — 줄(블록) 단위 연출 */

export type ObsTextEffectId =
  | "none"
  | "pulse"
  | "bounce"
  | "shake"
  | "glow"
  | "rainbow"
  | "wave"
  | "blink"
  | "float"
  | "neon"
  | "heartbeat"
  | "gradient"
  | "zoom"
  | "wiggle"
  | "sparkle";

export type ObsTextEffectOption = {
  id: ObsTextEffectId;
  label: string;
  hint: string;
};

export const OBS_TEXT_EFFECT_OPTIONS: ObsTextEffectOption[] = [
  { id: "none", label: "없음", hint: "기본" },
  { id: "pulse", label: "맥동", hint: "크기 반복" },
  { id: "bounce", label: "통통", hint: "위아래 튀김" },
  { id: "shake", label: "흔들림", hint: "좌우 진동" },
  { id: "glow", label: "빛남", hint: "글로우" },
  { id: "rainbow", label: "무지개", hint: "색상 회전" },
  { id: "wave", label: "파도", hint: "글자별 웨이브" },
  { id: "blink", label: "깜빡", hint: "점멸" },
  { id: "float", label: "둥실", hint: "상하 부유" },
  { id: "neon", label: "네온", hint: "네온 깜빡" },
  { id: "heartbeat", label: "두근", hint: "심장 박동" },
  { id: "gradient", label: "그라데이션", hint: "색 흐름" },
  { id: "zoom", label: "줌", hint: "확대·축소" },
  { id: "wiggle", label: "흔들", hint: "살랑 회전" },
  { id: "sparkle", label: "반짝", hint: "밝기 반짝" },
];

const EFFECT_IDS = new Set(OBS_TEXT_EFFECT_OPTIONS.map((o) => o.id));

export function normalizeObsTextEffect(raw: unknown): ObsTextEffectId {
  const v = String(raw ?? "none").trim() as ObsTextEffectId;
  return EFFECT_IDS.has(v) ? v : "none";
}

export function normalizeObsTextEffectSpeed(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0.35, Math.min(3, n));
}

/** 기본 주기(초) — speed 1 기준 */
const BASE_DUR_SEC: Record<ObsTextEffectId, number> = {
  none: 0,
  pulse: 1.4,
  bounce: 1.1,
  shake: 0.55,
  glow: 1.8,
  rainbow: 3,
  wave: 1.6,
  blink: 1,
  float: 2.4,
  neon: 1.2,
  heartbeat: 1.1,
  gradient: 3.5,
  zoom: 1.6,
  wiggle: 0.7,
  sparkle: 1.5,
};

export function obsTextEffectDurationSec(effect: ObsTextEffectId, speed = 1): string {
  if (effect === "none") return "0s";
  const base = BASE_DUR_SEC[effect] || 1.5;
  const sec = base / normalizeObsTextEffectSpeed(speed);
  return `${sec.toFixed(2)}s`;
}

export function obsTextEffectClass(effect: ObsTextEffectId): string {
  if (effect === "none") return "";
  return `obs-text-fx obs-text-fx-${effect}`;
}

/** wave 등 글자 단위 연출 */
export function obsTextEffectUsesCharSpans(effect: ObsTextEffectId): boolean {
  return effect === "wave";
}

export const OBS_TEXT_EFFECT_STYLES_CSS = `
@keyframes obs-tx-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.08); }
}
@keyframes obs-tx-bounce {
  0%, 100% { transform: translateY(0); }
  40% { transform: translateY(-14%); }
  60% { transform: translateY(-6%); }
}
@keyframes obs-tx-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-6px); }
  40% { transform: translateX(6px); }
  60% { transform: translateX(-4px); }
  80% { transform: translateX(4px); }
}
@keyframes obs-tx-glow {
  0%, 100% { filter: drop-shadow(0 0 2px currentColor); }
  50% { filter: drop-shadow(0 0 14px currentColor) drop-shadow(0 0 22px currentColor); }
}
@keyframes obs-tx-rainbow {
  0% { filter: hue-rotate(0deg); }
  100% { filter: hue-rotate(360deg); }
}
@keyframes obs-tx-wave-char {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-0.35em); }
}
@keyframes obs-tx-blink {
  0%, 45% { opacity: 1; }
  50%, 95% { opacity: 0.35; }
  100% { opacity: 1; }
}
@keyframes obs-tx-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
@keyframes obs-tx-neon {
  0%, 100% {
    text-shadow: 0 0 4px #fff, 0 0 8px currentColor, 0 0 16px currentColor;
    opacity: 1;
  }
  50% {
    text-shadow: 0 0 2px #fff, 0 0 20px currentColor, 0 0 36px currentColor, 0 0 48px currentColor;
    opacity: 0.92;
  }
}
@keyframes obs-tx-heartbeat {
  0%, 100% { transform: scale(1); }
  14% { transform: scale(1.12); }
  28% { transform: scale(1); }
  42% { transform: scale(1.08); }
  70% { transform: scale(1); }
}
@keyframes obs-tx-gradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes obs-tx-zoom {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.14); }
}
@keyframes obs-tx-wiggle {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-3deg); }
  75% { transform: rotate(3deg); }
}
@keyframes obs-tx-sparkle {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.45); }
}
.obs-text-fx {
  display: inline-block;
  transform-origin: center center;
}
.obs-text-fx-pulse { animation: obs-tx-pulse var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-bounce { animation: obs-tx-bounce var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-shake { animation: obs-tx-shake var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-glow { animation: obs-tx-glow var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-rainbow { animation: obs-tx-rainbow var(--obs-tx-dur) linear infinite; }
.obs-text-fx-blink { animation: obs-tx-blink var(--obs-tx-dur) steps(2, end) infinite; }
.obs-text-fx-float { animation: obs-tx-float var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-neon { animation: obs-tx-neon var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-heartbeat { animation: obs-tx-heartbeat var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-zoom { animation: obs-tx-zoom var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-wiggle { animation: obs-tx-wiggle var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-sparkle { animation: obs-tx-sparkle var(--obs-tx-dur) ease-in-out infinite; }
.obs-text-fx-gradient {
  background: linear-gradient(90deg, #ff6b9d, #ffc857, #4ade80, #38bdf8, #c084fc, #ff6b9d);
  background-size: 320% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent !important;
  animation: obs-tx-gradient var(--obs-tx-dur) ease infinite;
}
.obs-text-fx-gradient span { color: transparent !important; -webkit-text-fill-color: transparent; }
.obs-text-fx-wave { /* wrapper only */ }
.obs-text-fx-wave-char {
  display: inline-block;
  animation: obs-tx-wave-char var(--obs-tx-dur) ease-in-out infinite;
}
`;
