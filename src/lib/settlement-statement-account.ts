import { getUserById } from "@/lib/auth";
import { loadAccounts } from "@/lib/accounts-storage";
import {
  defaultSettlementStatementText,
  normalizeSettlementStatementText,
  type SettlementStatementText,
} from "@/lib/settlement-branding";

/** 계정 id → 회원가입 시 입력한 회사명 */
export async function resolveSettlementAccountCompanyName(userId: string): Promise<string> {
  const uid = String(userId || "").trim();
  if (!uid) return "";
  try {
    const accounts = await loadAccounts();
    const acc = accounts.find((a) => a.id === uid);
    if (acc?.companyName?.trim()) return acc.companyName.trim();
  } catch {
    // ignore
  }
  const legacy = getUserById(uid);
  if (legacy?.companyName?.trim()) return legacy.companyName.trim();
  return "";
}

export {
  getSettlementStatementTextPayload,
  saveSettlementStatementTextPayload,
  initSettlementStatementForNewAccount,
} from "@/lib/settlement-statement-store";

export function statementDefaultsForAccount(companyName: string): SettlementStatementText {
  return defaultSettlementStatementText(companyName);
}

export function normalizeStatementForAccount(
  input: Partial<SettlementStatementText> | null | undefined,
  companyName: string
): SettlementStatementText {
  return normalizeSettlementStatementText(input, companyName);
}
