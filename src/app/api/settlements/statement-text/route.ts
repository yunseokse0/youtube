export const runtime = "edge";
export const revalidate = 0;

import { getUserIdFromRequest } from "../../_shared/user-id";
import { upstashGetJson, upstashSetJsonWithSetPath } from "../../_shared/upstash";
import {
  DEFAULT_SETTLEMENT_ISSUER_LINE,
  DEFAULT_SETTLEMENT_THANK_YOU,
  normalizeSettlementStatementText,
  type SettlementStatementText,
} from "@/lib/settlement-branding";

const STORAGE_KEY_BASE = "excel-broadcast-settlement-statement-text-v1";

type TextPayload = SettlementStatementText & { updatedAt: number };

const memoryText: Record<string, TextPayload | null> = {};

function textKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

function clampLine(value: unknown, max = 200): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export async function GET(req: Request) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const remote = await upstashGetJson<TextPayload>(textKey(userId));
    const payload = remote || memoryText[userId] || null;
    const normalized = normalizeSettlementStatementText(
      payload || {
        thankYouMessage: DEFAULT_SETTLEMENT_THANK_YOU,
        issuerLine: DEFAULT_SETTLEMENT_ISSUER_LINE,
      }
    );
    return new Response(JSON.stringify(normalized), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return new Response(
      JSON.stringify(
        normalizeSettlementStatementText({
          thankYouMessage: DEFAULT_SETTLEMENT_THANK_YOU,
          issuerLine: DEFAULT_SETTLEMENT_ISSUER_LINE,
        })
      ),
      { headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = (await req.json()) as Partial<SettlementStatementText>;
    const normalized = normalizeSettlementStatementText({
      thankYouMessage: clampLine(body?.thankYouMessage, 160),
      issuerLine: clampLine(body?.issuerLine, 120),
    });
    const payload: TextPayload = { ...normalized, updatedAt: Date.now() };
    memoryText[userId] = payload;
    await upstashSetJsonWithSetPath(textKey(userId), payload);
    return new Response(JSON.stringify({ ok: true, ...normalized }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "save_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
