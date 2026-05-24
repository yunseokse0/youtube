import type { CSSProperties } from "react";
import type { MealGaugeEffects } from "@/types";

export type MealTimerTheme = "default" | "neon" | "minimal" | "danger";

const MEAL_TIMER_THEMES: MealTimerTheme[] = ["default", "neon", "minimal", "danger"];

export const DEFAULT_MEAL_GAUGE_EFFECTS: MealGaugeEffects = {
  critical: true,
  floatingScore: true,
  rankUp: true,
  timerTension: true,
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
  };
}

/** URL `fx` / `gaugeFx`: none | all | critical,floating,rank,timer (쉼표 목록만 켜짐) */
export function resolveMealGaugeEffects(
  stateEffects: MealGaugeEffects | undefined,
  sp: Pick<URLSearchParams, "get">
): MealGaugeEffects {
  const base = normalizeMealGaugeEffects(stateEffects);
  const raw = (sp.get("fx") || sp.get("gaugeFx") || "").trim();
  if (!raw) return base;
  const lower = raw.toLowerCase();
  if (lower === "none" || lower === "off" || lower === "0") {
    return { critical: false, floatingScore: false, rankUp: false, timerTension: false };
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
  const base = "mx-auto mt-2 inline-flex min-w-[5.5ch] items-center justify-center rounded-full px-5 py-2";
  switch (theme) {
    case "neon":
      return `${base} border-2 border-cyan-400/70 bg-black/55 backdrop-blur-md animate-neonPulse shadow-[0_0_24px_rgba(34,211,238,0.35)]`;
    case "minimal":
      return `${base} border-0 bg-transparent backdrop-blur-none px-2 py-0`;
    case "danger":
      return `${base} border-2 border-red-500/60 bg-red-950/50 backdrop-blur-md${paused ? " opacity-90" : ""}`;
    default:
      return `${base} border border-white/20 bg-white/40 backdrop-blur-md${paused ? " animate-pulse opacity-90" : ""}`;
  }
}

export function mealTimerShellStyle(theme: MealTimerTheme): CSSProperties | undefined {
  if (theme !== "default") return undefined;
  return { borderColor: "rgba(251, 207, 232, 0.55)", background: "rgba(251, 207, 232, 0.35)" };
}

export function mealTimerTextClass(theme: MealTimerTheme, paused: boolean, timerLowTime: boolean): string {
  const base = "font-extrabold tabular-nums pastel-text-outline";
  if (paused) {
    switch (theme) {
      case "neon":
        return `${base} text-cyan-300/75`;
      case "minimal":
        return `${base} text-neutral-400`;
      case "danger":
        return `${base} text-orange-300`;
      default:
        return `${base} text-pastel-orange`;
    }
  }
  if (timerLowTime) {
    switch (theme) {
      case "neon":
        return `${base} text-yellow-300 animate-pulse drop-shadow-[0_0_10px_rgba(250,204,21,0.8)]`;
      case "minimal":
        return `${base} text-red-500 font-black`;
      case "danger":
        return `${base} text-red-400 animate-pulse`;
      default:
        return `${base} text-pastel-alert animate-pastel-timer-low`;
    }
  }
  switch (theme) {
    case "neon":
      return `${base} text-cyan-100 drop-shadow-[0_0_10px_rgba(34,211,238,0.85)]`;
    case "minimal":
      return `${base} text-white`;
    case "danger":
      return `${base} text-white drop-shadow-[0_0_6px_rgba(239,68,68,0.6)]`;
    default:
      return `${base} text-pastel-ink`;
  }
}
