import type { DonationTableColumnsOptions } from "@/types";

export type ResolvedDonationTableColumnsOptions = {
  showCombinedColumn: boolean;
  showContributionColumn: boolean;
  showRestroomColumn: boolean;
  showTableSumRow: boolean;
  showContributionSum: boolean;
};

export const DEFAULT_DONATION_TABLE_COLUMNS: ResolvedDonationTableColumnsOptions = {
  showCombinedColumn: true,
  showContributionColumn: true,
  showRestroomColumn: true,
  showTableSumRow: true,
  showContributionSum: true,
};

export function resolveDonationTableColumnsOptions(
  opts?: DonationTableColumnsOptions | null,
  fallback?: Partial<ResolvedDonationTableColumnsOptions>
): ResolvedDonationTableColumnsOptions {
  const fb = { ...DEFAULT_DONATION_TABLE_COLUMNS, ...fallback };
  return {
    showCombinedColumn: opts?.showCombinedColumn ?? fb.showCombinedColumn,
    showContributionColumn: opts?.showContributionColumn ?? fb.showContributionColumn,
    showRestroomColumn: opts?.showRestroomColumn ?? fb.showRestroomColumn,
    showTableSumRow: opts?.showTableSumRow ?? fb.showTableSumRow,
    showContributionSum: opts?.showContributionSum ?? fb.showContributionSum,
  };
}

export function normalizeDonationTableColumnsOptions(
  input?: DonationTableColumnsOptions | null
): DonationTableColumnsOptions {
  const src = input && typeof input === "object" ? input : {};
  return {
    showCombinedColumn: src.showCombinedColumn !== false,
    showContributionColumn: src.showContributionColumn !== false,
    showRestroomColumn: src.showRestroomColumn !== false,
    showTableSumRow: src.showTableSumRow !== false,
    showContributionSum: src.showContributionSum !== false,
  };
}

/** remote 프리셋에 열 옵션이 빠져 있을 때 local 값을 보존(새로고침 깜빡임 방지) */
export function mergeDonationTablePresetFields<
  T extends DonationTableColumnsOptions | null | undefined,
>(primary: T, fallback: T): T {
  const p = (primary && typeof primary === "object" ? primary : {}) as DonationTableColumnsOptions;
  const f = (fallback && typeof fallback === "object" ? fallback : {}) as DonationTableColumnsOptions;
  return {
    ...(primary && typeof primary === "object" ? primary : {}),
    showCombinedColumn: p.showCombinedColumn ?? f.showCombinedColumn,
    showContributionColumn: p.showContributionColumn ?? f.showContributionColumn,
    showRestroomColumn: p.showRestroomColumn ?? f.showRestroomColumn,
    showTableSumRow: p.showTableSumRow ?? f.showTableSumRow,
    showContributionSum: p.showContributionSum ?? f.showContributionSum,
  } as T;
}

const DONATION_TABLE_BOOL_KEYS = new Set([
  "showCombinedColumn",
  "showContributionColumn",
  "showRestroomColumn",
  "showTableSumRow",
  "showContributionSum",
]);

export function isDonationTableBoolKey(key: string): boolean {
  return DONATION_TABLE_BOOL_KEYS.has(key);
}
