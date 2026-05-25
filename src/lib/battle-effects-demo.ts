import { MEAL_GAUGE_DEMO_SCENARIOS, getMealGaugeDemoHubPath, getMealGaugeOverlayPath } from "@/lib/meal-gauge-demo-paths";
import {
  SIG_MATCH_DEMO_SCENARIOS,
  buildSigMatchDemoOverlayPathFromScenario,
  getSigMatchDemoHubPath,
  type SigMatchDemoScenario,
} from "@/lib/sig-match-demo";
import type { MealGaugeOverlayQuery } from "@/lib/meal-gauge-demo-paths";
import { appendBattleEffectsHubPreviewParams } from "@/lib/overlay-ui-revision";

export type BattleEffectsBattle = "meal" | "sig";

export type BattleEffectsDemoScenario = {
  id: string;
  battle: BattleEffectsBattle;
  label: string;
  description: string;
  /** 식사 대전 URL (SSR 가능) */
  mealOpts?: MealGaugeOverlayQuery;
  /** 시그 대전 — 브라우저에서 snap 인코딩 필요 */
  sigScenario?: SigMatchDemoScenario;
  recommended?: boolean;
};

export function getBattleEffectsDemoHubPath(): string {
  return "/overlay/battle-effects-demo";
}

export const BATTLE_EFFECTS_DEMO_SCENARIOS: BattleEffectsDemoScenario[] = [
  ...MEAL_GAUGE_DEMO_SCENARIOS.map((s) => ({
    id: `meal-${s.id}`,
    battle: "meal" as const,
    label: s.label,
    description: s.description,
    mealOpts: s.opts,
    recommended: s.id === "all-default",
  })),
  ...SIG_MATCH_DEMO_SCENARIOS.map((s) => ({
    id: `sig-${s.id}`,
    battle: "sig" as const,
    label: s.label,
    description: s.description,
    sigScenario: s,
    recommended: s.id === "dual-pools-live",
  })),
];

export function getMealScenarioOverlayPath(scenario: BattleEffectsDemoScenario): string {
  return getMealGaugeOverlayPath(scenario.mealOpts ?? {});
}

export function getSigScenarioOverlayPath(scenario: BattleEffectsDemoScenario): string {
  if (!scenario.sigScenario) {
    return buildSigMatchDemoOverlayPathFromScenario(SIG_MATCH_DEMO_SCENARIOS[0]!);
  }
  return buildSigMatchDemoOverlayPathFromScenario(scenario.sigScenario);
}

export function getBattleEffectsScenarioPath(scenario: BattleEffectsDemoScenario): string {
  const base =
    scenario.battle === "meal" ? getMealScenarioOverlayPath(scenario) : getSigScenarioOverlayPath(scenario);
  return appendBattleEffectsHubPreviewParams(base, scenario.battle);
}

export { getMealGaugeDemoHubPath, getSigMatchDemoHubPath };
