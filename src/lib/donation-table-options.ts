import type { DonationTableColumnsOptions } from "@/types";

export type ResolvedDonationTableColumnsOptions = {
  showCombinedColumn: boolean;
  showContributionColumn: boolean;
  showTableSumRow: boolean;
  showContributionSum: boolean;
};

export const DEFAULT_DONATION_TABLE_COLUMNS: ResolvedDonationTableColumnsOptions = {
  showCombinedColumn: true,
  showContributionColumn: true,
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
    showTableSumRow: src.showTableSumRow !== false,
    showContributionSum: src.showContributionSum !== false,
  };
}
