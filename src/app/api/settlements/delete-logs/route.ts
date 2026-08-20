export const runtime = "edge";
export const revalidate = 0;

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { upstashGetJson, upstashSetJsonWithSetPath } from "@/app/api/_shared/upstash";
import type { SettlementDeleteLog } from "@/types";

const DELETE_LOGS_KEY_BASE = "excel-broadcast-settlement-delete-logs-v1";
const memoryDeleteLogs: Record<string, SettlementDeleteLog[]> = {};

function deleteLogsKey(userId: string): string {
  return `${DELETE_LOGS_KEY_BASE}:${userId}`;
}

function normalizeDeleteLogs(logs: unknown): SettlementDeleteLog[] {
  if (!Array.isArray(logs)) return [];
  const now = Date.now();
  const threeYearsMs = 365 * 3 * 24 * 60 * 60 * 1000;
  const minAt = now - threeYearsMs;
  const byId = new Map<string, SettlementDeleteLog>();
  for (const raw of logs) {
    if (!raw || typeof raw !== "object") continue;
    const log = raw as SettlementDeleteLog;
    const recordId = String(log.recordId || "").trim();
    if (!recordId) continue;
    if ((log.deletedAt || 0) < minAt) continue;
    const prev = byId.get(recordId);
    if (!prev || (log.deletedAt || 0) > (prev.deletedAt || 0)) {
      byId.set(recordId, log);
    }
  }
  return Array.from(byId.values()).sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const fromKv = await upstashGetJson<SettlementDeleteLog[]>(deleteLogsKey(userId));
  const logs = Array.isArray(fromKv) && fromKv.length > 0 ? fromKv : memoryDeleteLogs[userId] || [];
  return new Response(JSON.stringify(normalizeDeleteLogs(logs)), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = await req.json().catch(() => []);
  const next = normalizeDeleteLogs(body);
  const ok = await upstashSetJsonWithSetPath(deleteLogsKey(userId), next);
  if (!ok) memoryDeleteLogs[userId] = next;
  return new Response(JSON.stringify({ ok: true, count: next.length }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
