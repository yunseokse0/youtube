import {
  ensureMysqlKvBackend,
  isPersistentKvConfigured,
  upstashGetJson,
  upstashSetJsonWithSetPath,
} from "@/app/api/_shared/upstash";
import {
  DEFAULT_SETTLEMENT_THANK_YOU,
  buildSettlementIssuerLineFromCompanyName,
  defaultSettlementStatementText,
  normalizeSettlementStatementText,
  type SettlementStatementText,
} from "@/lib/settlement-branding";

const STORAGE_KEY_BASE = "excel-broadcast-settlement-statement-text-v1";

export type SettlementStatementTextPayload = SettlementStatementText & { updatedAt: number };

const memoryText: Record<string, SettlementStatementTextPayload | null> = {};

function textKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

function clampLine(value: unknown, max = 200): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function getSettlementStatementTextPayload(
  userId: string
): Promise<SettlementStatementTextPayload | null> {
  await ensureMysqlKvBackend();
  const remote = await upstashGetJson<SettlementStatementTextPayload>(textKey(userId));
  return remote || memoryText[userId] || null;
}

export async function saveSettlementStatementTextPayload(
  userId: string,
  text: Partial<SettlementStatementText>,
  companyName?: string | null
): Promise<SettlementStatementText> {
  await ensureMysqlKvBackend();
  const normalized = normalizeSettlementStatementText(
    {
      thankYouMessage: clampLine(text.thankYouMessage, 160),
      issuerLine: clampLine(text.issuerLine, 120),
    },
    companyName
  );
  const payload: SettlementStatementTextPayload = { ...normalized, updatedAt: Date.now() };
  memoryText[userId] = payload;
  const persisted = await upstashSetJsonWithSetPath(textKey(userId), payload);
  if (!persisted && isPersistentKvConfigured()) {
    throw new Error("persist_failed");
  }
  return normalized;
}

/** 신규 계정 — 감사 문구 기본 + 발행자=회사명 */
export async function initSettlementStatementForNewAccount(
  userId: string,
  companyName: string
): Promise<SettlementStatementText> {
  return saveSettlementStatementTextPayload(userId, defaultSettlementStatementText(companyName), companyName);
}
