import type { CSSProperties } from "react";
import type { MealGaugeEffects } from "@/types";

export type MealTimerTheme = "default" | "neon" | "minimal" | "danger";

const MEAL_TIMER_THEMES: MealTimerTheme[] = ["default", "neon", "minimal", "danger"];

export const DEFAULT_MEAL_GAUGE_EFFECTS: MealGaugeEffects = {
  critical: true,
  floatingScore: true,
  rankUp: true,
  timerTension: true,
  gaugeMotion: true,
};

export function normalizeMealGaugeEffects(input: unknown): MealGaugeEffects {
  const base = DEFAULT_MEAL_GAUGE_EFFECTS;
  if (!input || typeof input !== "object") return { ...base };
  const v = input as Partial<MealGaugeEffects>;
  return {
    critical: typeof v.critical === "boolean" ? v.critical : base.critical,
    floatingScore: typeof v.floatingScore === "boolean" ? v.floatingScore : base.floatingScore,
    rankUp: typeof v.rankUp === "boolean" ? v.rankUp : base.rankUp,
    timerTension: typeof v.timerTension === "boolean" ? v.timerTension : base.timerTension,
    gaugeMotion: typeof v.gaugeMotion === "boolean" ? v.gaugeMotion : base.gaugeMotion,
  };
}

/** URL `fx` / `gaugeFx` / `ffx`(오타 호환): none | all | critical,floating,rank,timer,motion */
export function resolveMealGaugeEffects(
  stateEffects: MealGaugeEffects | undefined,
  sp: Pick<URLSearchParams, "get">
): MealGaugeEffects {
  const base = normalizeMealGaugeEffects(stateEffects);
  const raw = (sp.get("fx") || sp.get("gaugeFx") || sp.get("ffx") || "").trim();
  if (!raw) return base;
  const lower = raw.toLowerCase();
  if (lower === "none" || lower === "off" || lower === "0") {
    return {
      critical: false,
      floatingScore: false,
      rankUp: false,
      timerTension: false,
      gaugeMotion: false,
    };
  }
  if (lower === "all" || lower === "on" || lower === "1") {
    return { ...DEFAULT_MEAL_GAUGE_EFFECTS };
  }
  const tokens = lower.split(/[,+\s]+/).filter(Boolean);
  return {
    critical: tokens.some((t) => t === "critical" || t === "crit"),
    floatingScore: tokens.some((t) => t === "floating" || t === "float" || t === "floatingscore" || t === "score"),
    rankUp: tokens.some((t) => t === "rank" || t === "rankup"),
    timerTension: tokens.some((t) => t === "timer" || t === "timertension" || t === "tension"),
    gaugeMotion: tokens.some(
      (t) => t === "motion" || t === "gauge" || t === "gaugemotion" || t === "pulse"
    ),
  };
}

/** URL `timerTheme`이 있으면 상태보다 우선 */
export function resolveMealTimerTheme(
  stateTheme: string | undefined,
  sp: Pick<URLSearchParams, "get">
): MealTimerTheme {
  const raw = (sp.get("timerTheme") || "").trim().toLowerCase();
  if (MEAL_TIMER_THEMES.includes(raw as MealTimerTheme)) return raw as MealTimerTheme;
  if (stateTheme === "neon" || stateTheme === "minimal" || stateTheme === "danger") return stateTheme;
  return "default";
}

export function mealTimerShellClass(theme: MealTimerTheme, paused: boolean): string {
  const base =
    "mx-auto mt-2 inline-flex min-w-[5.5ch] items-center justify-center rounded-studio px-5 py-2";
  switch (theme) {
    case "neon":
      return `${base} border border-studio-blue/50 bg-[rgba(15,20,30,0.7)] backdrop-blur-studio shadow-studio-glow`;
    case "minimal":
      return `${base} border-0 bg-transparent backdrop-blur-none px-2 py-0`;
    case "danger":
      return `${base} border border-red-500/50 bg-red-950/45 backdrop-blur-studio${paused ? " opacity-90" : ""}`;
    default:
      return `${base} border border-white/12 bg-[rgba(15,20,30,0.7)] backdrop-blur-studio shadow-glass${paused ? " animate-pulse opacity-90" : ""}`;
  }
}

export function mealTimerShellStyle(theme: MealTimerTheme): CSSProperties | undefined {
  if (theme !== "default") return undefined;
  return { borderColor: "rgba(255, 255, 255, 0.12)", background: "rgba(15, 20, 30, 0.7)" };
}

export function mealTimerTextClass(theme: MealTimerTheme, paused: boolean, timerLowTime: boolean): string {
  const base = "font-extrabold tabular-nums studio-text-shadow";
  if (paused) {
    switch (theme) {
      case "neon":
        return `${base} text-cyan-300/75`;
      case "minimal":
        return `${base} text-neutral-400`;
      case "danger":
        return `${base} text-orange-300`;
      default:
        return `${base} text-white/70`;
    }
  }
  if (timerLowTime) {
    switch (theme) {
      case "neon":
        return `${base} text-studio-coral animate-pulse`;
      case "minimal":
        return `${base} text-red-400 font-black`;
      case "danger":
        return `${base} text-red-400 animate-pulse`;
      default:
        return `${base} text-studio-coral animate-pastel-timer-low`;
    }
  }
  switch (theme) {
    case "neon":
      return `${base} text-cyan-100`;
    case "minimal":
      return `${base} text-white`;
    case "danger":
      return `${base} text-white`;
    default:
      return `${base} text-white`;
  }
}
