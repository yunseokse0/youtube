import type { SettlementUiOptions } from "@/types";
import { settlementOptionsStorageKey } from "@/lib/state";

export function defaultSettlementUiOptions(): SettlementUiOptions {
  return {
    accountRatioInput: "70",
    toonRatioInput: "60",
    taxRateInput: "3.3",
    vatIncluded: false,
    taxInvoiceIssued: false,
    useMemberRatioOverrides: false,
    memberRatioInputs: {},
    omitTreasuryFromSettlement: false,
    includeTreasuryInFullStatement: false,
  };
}

export function normalizeSettlementUiOptions(
  input: Partial<SettlementUiOptions> | null | undefined
): SettlementUiOptions {
  const defaults = defaultSettlementUiOptions();
  const memberRatioInputs: Record<string, { account: string; toon: string }> = {};
  if (input?.memberRatioInputs && typeof input.memberRatioInputs === "object") {
    Object.entries(input.memberRatioInputs).forEach(([memberId, value]) => {
      memberRatioInputs[memberId] = {
        account: typeof value?.account === "string" ? value.account : "",
        toon: typeof value?.toon === "string" ? value.toon : "",
      };
    });
  }
  return {
    accountRatioInput:
      typeof input?.accountRatioInput === "string" && input.accountRatioInput.trim()
        ? input.accountRatioInput
        : defaults.accountRatioInput,
    toonRatioInput:
      typeof input?.toonRatioInput === "string" && input.toonRatioInput.trim()
        ? input.toonRatioInput
        : defaults.toonRatioInput,
    taxRateInput:
      typeof input?.taxRateInput === "string" && input.taxRateInput.trim()
        ? input.taxRateInput
        : defaults.taxRateInput,
    vatIncluded: Boolean(input?.vatIncluded),
    taxInvoiceIssued: Boolean(input?.taxInvoiceIssued),
    useMemberRatioOverrides: Boolean(input?.useMemberRatioOverrides),
    memberRatioInputs,
    omitTreasuryFromSettlement: Boolean(input?.omitTreasuryFromSettlement),
    includeTreasuryInFullStatement: Boolean(input?.includeTreasuryInFullStatement),
  };
}

/** 구버전 localStorage 1회 마이그레이션용 */
export function readLegacySettlementUiOptionsFromLocalStorage(
  userId?: string | null
): SettlementUiOptions | null {
  if (typeof window === "undefined" || !userId) return null;
  try {
    const key = settlementOptionsStorageKey(userId);
    const legacyKey = "excel-broadcast-settlement-options-v1";
    const raw = window.localStorage.getItem(key) || window.localStorage.getItem(legacyKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SettlementUiOptions>;
    return normalizeSettlementUiOptions(parsed);
  } catch {
    return null;
  }
}

export function buildSettlementUiOptionsFromForm(input: {
  accountRatioInput: string;
  toonRatioInput: string;
  taxRateInput: string;
  vatIncluded: boolean;
  taxInvoiceIssued: boolean;
  useMemberRatioOverrides: boolean;
  memberRatioInputs: Record<string, { account: string; toon: string }>;
  omitTreasuryFromSettlement: boolean;
  includeTreasuryInFullStatement: boolean;
}): SettlementUiOptions {
  return normalizeSettlementUiOptions(input);
}

export function settlementUiOptionsEqual(a: SettlementUiOptions, b: SettlementUiOptions): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
