import type { ContributionFormula, DonorTarget } from "@/types";

export const DEFAULT_CONTRIBUTION_FORMULA: ContributionFormula = {
  accountWeightPct: 100,
  toonWeightPct: 100,
};

const WEIGHT_MIN = 0;
const WEIGHT_MAX = 200;

export function clampContributionWeightPct(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 100;
  return Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, n));
}

export function normalizeContributionFormula(input: unknown): ContributionFormula {
  if (!input || typeof input !== "object") {
    return { ...DEFAULT_CONTRIBUTION_FORMULA };
  }
  const rec = input as Record<string, unknown>;
  return {
    accountWeightPct: clampContributionWeightPct(
      rec.accountWeightPct ?? rec.accountWeight ?? DEFAULT_CONTRIBUTION_FORMULA.accountWeightPct
    ),
    toonWeightPct: clampContributionWeightPct(
      rec.toonWeightPct ?? rec.toonWeight ?? DEFAULT_CONTRIBUTION_FORMULA.toonWeightPct
    ),
  };
}

export function isDefaultContributionFormula(formula: ContributionFormula | null | undefined): boolean {
  const f = normalizeContributionFormula(formula);
  return f.accountWeightPct === 100 && f.toonWeightPct === 100;
}

/** 단건 후원 → 기여도 점수 (저장 이후 후원부터 적용) */
export function computeContributionPoints(
  amount: number,
  target: DonorTarget | string | null | undefined,
  formula?: ContributionFormula | null
): number {
  const amt = Math.max(0, Math.round(Number(amount) || 0));
  if (amt <= 0) return 0;
  const f = normalizeContributionFormula(formula);
  const weight = (target === "toon" ? f.toonWeightPct : f.accountWeightPct) || 0;
  return Math.max(0, Math.round((amt * weight) / 100));
}

export type ContributionFormulaPresetId = "both" | "account" | "toon" | "custom";

export function contributionFormulaPresetId(formula: ContributionFormula): ContributionFormulaPresetId {
  const f = normalizeContributionFormula(formula);
  if (f.accountWeightPct === 100 && f.toonWeightPct === 100) return "both";
  if (f.accountWeightPct === 100 && f.toonWeightPct === 0) return "account";
  if (f.accountWeightPct === 0 && f.toonWeightPct === 100) return "toon";
  return "custom";
}

export function contributionFormulaFromPreset(preset: ContributionFormulaPresetId): ContributionFormula {
  switch (preset) {
    case "account":
      return { accountWeightPct: 100, toonWeightPct: 0 };
    case "toon":
      return { accountWeightPct: 0, toonWeightPct: 100 };
    case "both":
      return { ...DEFAULT_CONTRIBUTION_FORMULA };
    default:
      return { ...DEFAULT_CONTRIBUTION_FORMULA };
  }
}

export function describeContributionFormula(formula?: ContributionFormula | null): string {
  const f = normalizeContributionFormula(formula);
  const preset = contributionFormulaPresetId(f);
  if (preset === "both") return "계좌+투네 (원=점)";
  if (preset === "account") return "계좌만 (투네 0%)";
  if (preset === "toon") return "투네만 (계좌 0%)";
  return `커스텀 (계좌 ${f.accountWeightPct}% · 투네 ${f.toonWeightPct}%)`;
}
