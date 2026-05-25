import type { MealTimerTheme } from "@/lib/meal-gauge-effects";

export type MealGaugeDemoMode = "member" | "team" | "individual";

export type MealGaugeAnimStyle =
  import("@/lib/meal-gauge-motion").MealGaugeAnimStyle;

export type MealGaugeOverlayQuery = {
  demo?: boolean;
  demoMode?: MealGaugeDemoMode;
  /** `all` | `none` | `critical,floating,rank,timer,motion` */
  fx?: string;
  gaugeFx?: string;
  /** 게이지 막대 연출: flow | stream | shimmer | breathe | wave | stripe | default | none */
  gaugeAnim?: MealGaugeAnimStyle | string;
  timerTheme?: MealTimerTheme;
  /** 점수·랭크·플로팅 자동 연출 */
  gaugePreview?: boolean;
  /** gaugePreview 시 타이머 카운트다운 시작 초(기본 15) */
  demoTimerSec?: number;
  scalePct?: number;
};

export function buildMealGaugeOverlayQuery(opts: MealGaugeOverlayQuery): string {
  const q = new URLSearchParams();
  if (opts.demo !== false) q.set("demo", "true");
  if (opts.demoMode) q.set("demoMode", opts.demoMode);
  const fx = (opts.gaugeFx || opts.fx || "").trim();
  if (fx) q.set("fx", fx);
  if (opts.gaugeAnim) q.set("gaugeAnim", String(opts.gaugeAnim));
  if (opts.timerTheme) q.set("timerTheme", opts.timerTheme);
  if (opts.gaugePreview) q.set("gaugePreview", "1");
  if (opts.demoTimerSec != null && Number.isFinite(opts.demoTimerSec)) {
    q.set("demoTimerSec", String(Math.max(3, Math.min(120, Math.floor(opts.demoTimerSec)))));
  }
  if (opts.scalePct != null && Number.isFinite(opts.scalePct)) {
    q.set("scalePct", String(Math.max(50, Math.min(200, Math.floor(opts.scalePct)))));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function getMealGaugeOverlayPath(opts: MealGaugeOverlayQuery = {}): string {
  return `/overlay/meal-match${buildMealGaugeOverlayQuery({ demo: true, ...opts })}`;
}

export function getMealGaugeDemoHubPath(): string {
  return "/overlay/meal-match/gauge-demo";
}

/** 관리자 식사 대전 섹션에서 열기 좋은 기본 프리뷰 */
export function getMealGaugeAdminPreviewPath(): string {
  return getMealGaugeOverlayPath({
    demoMode: "member",
    fx: "all",
    gaugePreview: true,
    demoTimerSec: 15,
    timerTheme: "default",
  });
}

export const MEAL_GAUGE_DEMO_SCENARIOS: {
  id: string;
  label: string;
  description: string;
  opts: MealGaugeOverlayQuery;
}[] = [
  {
    id: "all-default",
    label: "연출 전체 + 기본 타이머",
    description: "critical · floating · rank · timer · motion + 15초 카운트다운",
    opts: { fx: "all", gaugePreview: true, demoTimerSec: 15, timerTheme: "default" },
  },
  {
    id: "all-neon",
    label: "연출 전체 + neon 타이머",
    description: "timerTheme=neon, 저시간 긴장 연출",
    opts: { fx: "all", gaugePreview: true, demoTimerSec: 12, timerTheme: "neon" },
  },
  {
    id: "floating-only",
    label: "플로팅 점수만",
    description: "3초마다 점수 상승 → +N 떠오름",
    opts: { fx: "floating", gaugePreview: true, demoMode: "member" },
  },
  {
    id: "motion-only",
    label: "게이지 막대 연출만",
    description: "점수 상승 맥동 · 기본 끝단 펄스 (fx=motion)",
    opts: { fx: "motion", gaugePreview: true, demoMode: "member" },
  },
  {
    id: "anim-flow",
    label: "게이지 · 흐름(flow)",
    description: "gaugeAnim=flow · 물결 그라데이션이 채움을 따라 흐름",
    opts: { fx: "motion", gaugeAnim: "flow", gaugePreview: true, demoMode: "member" },
  },
  {
    id: "anim-stream",
    label: "게이지 · 스트림(stream)",
    description: "gaugeAnim=stream · 빛이 막대를 가로질러 스윕",
    opts: { fx: "motion", gaugeAnim: "stream", gaugePreview: true, demoMode: "member" },
  },
  {
    id: "anim-shimmer",
    label: "게이지 · 시머(shimmer)",
    description: "gaugeAnim=shimmer · 대각 반짝이 지나감",
    opts: { fx: "motion", gaugeAnim: "shimmer", gaugePreview: true, demoMode: "member" },
  },
  {
    id: "anim-breathe",
    label: "게이지 · 호흡(breathe)",
    description: "gaugeAnim=breathe · 채움 밝기가 숨쉬듯 변화",
    opts: { fx: "motion", gaugeAnim: "breathe", gaugePreview: true, demoMode: "member" },
  },
  {
    id: "anim-wave",
    label: "게이지 · 웨이브(wave)",
    description: "gaugeAnim=wave · 세로 물결 줄무늬",
    opts: { fx: "motion", gaugeAnim: "wave", gaugePreview: true, demoMode: "member" },
  },
  {
    id: "anim-stripe",
    label: "게이지 · 줄무늬(stripe)",
    description: "gaugeAnim=stripe · 가로 줄무늬가 흐름",
    opts: { fx: "motion", gaugeAnim: "stripe", gaugePreview: true, demoMode: "member" },
  },
  {
    id: "rank-only",
    label: "1등 왕관만",
    description: "현재 1등 멤버 이름 옆 👑",
    opts: { fx: "rank", gaugePreview: true, demoMode: "member" },
  },
  {
    id: "critical-fill",
    label: "크리티컬(채움 90%+)",
    description: "개인 단일 게이지 · 높은 점수",
    opts: { fx: "critical", demoMode: "individual", gaugePreview: true },
  },
  {
    id: "timer-danger",
    label: "타이머 긴장 · danger",
    description: "10초 미만 펄스 · timerTheme=danger",
    opts: { fx: "timer", gaugePreview: true, demoTimerSec: 8, timerTheme: "danger" },
  },
  {
    id: "team-split",
    label: "팀 분할 게이지",
    description: "팀 A/B 막대 · 연출 전체",
    opts: { demoMode: "team", fx: "all", gaugePreview: true },
  },
  {
    id: "fx-none",
    label: "연출 OFF",
    description: "fx=none — 비교용",
    opts: { fx: "none", gaugePreview: false, demoTimerSec: 30 },
  },
];
