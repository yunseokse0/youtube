export const runtime = "nodejs";
export const revalidate = 0;

import { getUserIdFromRequest, resolveWriteUserId, writeUserIdErrorResponse } from "../../_shared/user-id";
import {
  getSettlementStatementTextPayload,
  saveSettlementStatementTextPayload,
} from "@/lib/settlement-statement-store";
import {
  resolveSettlementAccountCompanyName,
  statementDefaultsForAccount,
} from "@/lib/settlement-statement-account";
import type { SettlementStatementText } from "@/lib/settlement-branding";

export async function GET(req: Request) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const companyName = await resolveSettlementAccountCompanyName(userId);
    const payload = await getSettlementStatementTextPayload(userId);
    const defaults = statementDefaultsForAccount(companyName);
    const normalized = payload
      ? {
          thankYouMessage: payload.thankYouMessage,
          issuerLine: payload.issuerLine,
        }
      : defaults;
    return new Response(
      JSON.stringify({
        ...normalized,
        saved: Boolean(payload?.updatedAt),
        companyName,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch {
    return new Response(JSON.stringify({ error: "load_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(req: Request) {
  try {
    const writeUid = resolveWriteUserId(req);
    if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
    const userId = writeUid.userId;
    const companyName = await resolveSettlementAccountCompanyName(userId);
    const body = (await req.json()) as Partial<SettlementStatementText>;
    const normalized = await saveSettlementStatementTextPayload(userId, body, companyName);
    return new Response(JSON.stringify({ ok: true, ...normalized }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "save_failed";
    if (message === "persist_failed") {
      return new Response(JSON.stringify({ ok: false, error: "persist_failed" }), {
        status: 503,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "save_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
