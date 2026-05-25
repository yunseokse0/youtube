/** 게이지 막대 채움 연출 프리셋 — URL `gaugeAnim` */

export type MealGaugeAnimStyle =
  | "default"
  | "flow"
  | "stream"
  | "shimmer"
  | "breathe"
  | "wave"
  | "stripe"
  | "none";

export const MEAL_GAUGE_ANIM_STYLES: MealGaugeAnimStyle[] = [
  "default",
  "flow",
  "stream",
  "shimmer",
  "breathe",
  "wave",
  "stripe",
  "none",
];

export const MEAL_GAUGE_ANIM_LABELS: Record<MealGaugeAnimStyle, string> = {
  default: "기본 (끝단 펄스)",
  flow: "흐름 (물결 그라데이션)",
  stream: "스트림 (빛 스윕)",
  shimmer: "시머 (대각 반짝)",
  breathe: "브리드 (호흡 밝기)",
  wave: "웨이브 (세로 물결)",
  stripe: "줄무늬 흐름",
  none: "없음",
};

export function resolveMealGaugeAnimStyle(
  sp: Pick<URLSearchParams, "get">,
  gaugeMotionEnabled: boolean
): MealGaugeAnimStyle {
  const raw = (sp.get("gaugeAnim") || sp.get("gaugeMotionStyle") || "").trim().toLowerCase();
  if (raw && MEAL_GAUGE_ANIM_STYLES.includes(raw as MealGaugeAnimStyle)) {
    return raw as MealGaugeAnimStyle;
  }
  if (!gaugeMotionEnabled) return "none";
  return "default";
}
