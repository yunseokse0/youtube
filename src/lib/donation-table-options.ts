import type { DonationTableColumnsOptions } from "@/types";

export type ResolvedDonationTableColumnsOptions = {
  showRankColumn: boolean;
  showRoleColumn: boolean;
  showAccountColumn: boolean;
  showToonColumn: boolean;
  showCombinedColumn: boolean;
  showContributionColumn: boolean;
  showRestroomColumn: boolean;
  showTableSumRow: boolean;
  showContributionSum: boolean;
  showCustomColumn: boolean;
  tableSplit: boolean;
  tablePill: boolean;
  contributionExcludedMemberIds?: string[];
};

export const DEFAULT_DONATION_TABLE_COLUMNS: ResolvedDonationTableColumnsOptions = {
  showRankColumn: true,
  showRoleColumn: true,
  showAccountColumn: true,
  showToonColumn: true,
  showCombinedColumn: true,
  showContributionColumn: true,
  showRestroomColumn: true,
  showTableSumRow: true,
  showContributionSum: true,
  showCustomColumn: true,
  tableSplit: true,
  tablePill: false,
};

export function resolveDonationTableColumnsOptions(
  opts?: (DonationTableColumnsOptions & { day777Calc?: boolean; name?: string; theme?: string; membersTheme?: string }) | null,
  fallback?: Partial<ResolvedDonationTableColumnsOptions>
): ResolvedDonationTableColumnsOptions {
  const isPongdang =
    Boolean(opts?.day777Calc) ||
    String(opts?.name || "").includes("퐁당") ||
    opts?.theme === "excelPongdang" ||
    opts?.membersTheme === "excelPongdang";
  const defaultRoleCol = isPongdang ? false : DEFAULT_DONATION_TABLE_COLUMNS.showRoleColumn;
  const fb = { ...DEFAULT_DONATION_TABLE_COLUMNS, showRoleColumn: defaultRoleCol, ...fallback };
  return {
    showRankColumn: opts?.showRankColumn ?? fb.showRankColumn,
    showRoleColumn: opts?.showRoleColumn ?? fb.showRoleColumn,
    showAccountColumn: opts?.showAccountColumn ?? fb.showAccountColumn,
    showToonColumn: opts?.showToonColumn ?? fb.showToonColumn,
    showCombinedColumn: opts?.showCombinedColumn ?? fb.showCombinedColumn,
    showContributionColumn: opts?.showContributionColumn ?? fb.showContributionColumn,
    showRestroomColumn: opts?.showRestroomColumn ?? fb.showRestroomColumn,
    showTableSumRow: opts?.showTableSumRow ?? fb.showTableSumRow,
    showContributionSum: opts?.showContributionSum ?? fb.showContributionSum,
    showCustomColumn: opts?.showCustomColumn ?? fb.showCustomColumn,
    tableSplit: opts?.tableSplit ?? fb.tableSplit,
    tablePill: (opts?.tablePill ?? opts?.pillStyle) ?? fb.tablePill,
    contributionExcludedMemberIds: Array.isArray(opts?.contributionExcludedMemberIds)
      ? opts.contributionExcludedMemberIds
      : typeof opts?.contributionExcludedMemberIds === "string"
      ? opts.contributionExcludedMemberIds.split(",").map((s) => s.trim()).filter(Boolean)
      : fb.contributionExcludedMemberIds,
  };
}

export function normalizeDonationTableColumnsOptions(
  input?: DonationTableColumnsOptions | null
): DonationTableColumnsOptions {
  const src = input && typeof input === "object" ? input : {};
  return {
    showRankColumn: src.showRankColumn !== false,
    showRoleColumn: src.showRoleColumn !== false,
    showAccountColumn: src.showAccountColumn !== false,
    showToonColumn: src.showToonColumn !== false,
    showCombinedColumn: src.showCombinedColumn !== false,
    showContributionColumn: src.showContributionColumn !== false,
    showRestroomColumn: src.showRestroomColumn !== false,
    showTableSumRow: src.showTableSumRow !== false,
    showContributionSum: src.showContributionSum !== false,
    showCustomColumn: src.showCustomColumn !== false,
    tableSplit: src.tableSplit !== false,
    tablePill: src.tablePill === true || src.pillStyle === true,
    contributionExcludedMemberIds: Array.isArray(src.contributionExcludedMemberIds)
      ? src.contributionExcludedMemberIds.map((x) => String(x || "").trim()).filter(Boolean)
      : typeof src.contributionExcludedMemberIds === "string"
      ? src.contributionExcludedMemberIds.split(",").map((s) => s.trim()).filter(Boolean)
      : undefined,
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
    showRankColumn: p.showRankColumn ?? f.showRankColumn,
    showRoleColumn: p.showRoleColumn ?? f.showRoleColumn,
    showAccountColumn: p.showAccountColumn ?? f.showAccountColumn,
    showToonColumn: p.showToonColumn ?? f.showToonColumn,
    showCombinedColumn: p.showCombinedColumn ?? f.showCombinedColumn,
    showContributionColumn: p.showContributionColumn ?? f.showContributionColumn,
    showRestroomColumn: p.showRestroomColumn ?? f.showRestroomColumn,
    showTableSumRow: p.showTableSumRow ?? f.showTableSumRow,
    showContributionSum: p.showContributionSum ?? f.showContributionSum,
    showCustomColumn: p.showCustomColumn ?? f.showCustomColumn,
    tableSplit: p.tableSplit ?? f.tableSplit,
    tablePill: (p.tablePill ?? p.pillStyle) ?? (f.tablePill ?? f.pillStyle),
    customCellMode: p.customCellMode ?? f.customCellMode,
    customCellLinkMode: p.customCellLinkMode ?? f.customCellLinkMode,
    customHeaderLabel: p.customHeaderLabel ?? f.customHeaderLabel,
    rankCustomCells: p.rankCustomCells ?? f.rankCustomCells,
    memberCustomCells: p.memberCustomCells ?? f.memberCustomCells,
  } as T;
}

const DONATION_TABLE_BOOL_KEYS = new Set([
  "showRankColumn",
  "showRoleColumn",
  "showAccountColumn",
  "showToonColumn",
  "showCombinedColumn",
  "showContributionColumn",
  "showRestroomColumn",
  "showTableSumRow",
  "showContributionSum",
  "showCustomColumn",
  "tableSplit",
  "tablePill",
  "pillStyle",
]);

export function isDonationTableBoolKey(key: string): boolean {
  return DONATION_TABLE_BOOL_KEYS.has(key);
}
