/** 서버 전용 — 클라이언트 번들에 mysql2가 섞이지 않도록 sig-roulette 과 분리 */
import type { SigItem } from "@/types";
import {
  isPersistentKvConfigured,
  upstashGetJson,
  upstashSetJsonWithPipeline,
} from "@/app/api/_shared/upstash";
import { getServerMemoryRouletteLogs, setServerMemoryRouletteLogs } from "@/lib/server-memory-roulette-logs";
import type { RouletteSessionLog } from "@/lib/sig-roulette";

const LOG_KEY_PREFIX = "excel-broadcast-roulette-log-v1";

function getLogKey(userId: string) {
  return `${LOG_KEY_PREFIX}:${userId}`;
}

export async function listRouletteLogs(userId: string): Promise<RouletteSessionLog[]> {
  const key = getLogKey(userId);
  if (isPersistentKvConfigured()) {
    const remote = await upstashGetJson<RouletteSessionLog[]>(key);
    if (Array.isArray(remote)) return remote;
  }
  return getServerMemoryRouletteLogs(key);
}

export async function getRouletteHistory(
  userId: string,
  limit = 20,
  sessionId?: string
): Promise<RouletteSessionLog[]> {
  const logs = await listRouletteLogs(userId);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
  const filtered = sessionId ? logs.filter((x) => x.sessionId === sessionId) : logs;
  return filtered.slice(0, safeLimit);
}

export async function saveRouletteLog(params: {
  userId: string;
  sessionId: string;
  phase: "LANDED" | "CONFIRMED" | "CANCELLED";
  selectedSigs: SigItem[];
  oneShotPrice: number;
  adminId?: string;
  reason?: string;
}): Promise<{ ok: true; logId: string; duplicate: boolean; logs: RouletteSessionLog[] }> {
  const key = getLogKey(params.userId);
  const existing = await listRouletteLogs(params.userId);
  const duplicate = existing.some((x) => x.sessionId === params.sessionId);
  if (duplicate) {
    const prev = existing.find((x) => x.sessionId === params.sessionId)!;
    const totalPrice = params.selectedSigs.reduce(
      (sum, s) => sum + Math.max(0, Math.floor(Number(s.price || 0))),
      0
    );
    const nextLog: RouletteSessionLog = {
      ...prev,
      phase: params.phase,
      selectedSigs: params.selectedSigs.map((x) => ({ ...x })),
      selectedSigIds: params.selectedSigs.map((x) => x.id),
      oneShotPrice: Math.max(0, Math.floor(params.oneShotPrice || 0)),
      totalPrice,
      timestamp: Date.now(),
      adminId: params.adminId ?? prev.adminId,
      reason: params.reason !== undefined ? params.reason : prev.reason,
    };
    const unchanged =
      prev.phase === nextLog.phase &&
      prev.oneShotPrice === nextLog.oneShotPrice &&
      prev.totalPrice === nextLog.totalPrice &&
      prev.selectedSigIds.join(",") === nextLog.selectedSigIds.join(",");
    if (unchanged) {
      return { ok: true, logId: prev.id, duplicate: true, logs: existing };
    }
    const replaced = existing.map((x) => (x.sessionId === params.sessionId ? nextLog : x));
    const savedRemote =
      isPersistentKvConfigured() && (await upstashSetJsonWithPipeline(key, replaced));
    if (!savedRemote) setServerMemoryRouletteLogs(key, replaced);
    return { ok: true, logId: prev.id, duplicate: false, logs: replaced };
  }
  const totalPrice = params.selectedSigs.reduce(
    (sum, s) => sum + Math.max(0, Math.floor(Number(s.price || 0))),
    0
  );
  const log: RouletteSessionLog = {
    id: `rlog_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sessionId: params.sessionId,
    phase: params.phase,
    selectedSigs: params.selectedSigs.map((x) => ({ ...x })),
    selectedSigIds: params.selectedSigs.map((x) => x.id),
    oneShotPrice: Math.max(0, Math.floor(params.oneShotPrice || 0)),
    totalPrice,
    timestamp: Date.now(),
    adminId: params.adminId,
    reason: params.reason,
  };
  const next = [log, ...existing].slice(0, 50);
  const savedRemote =
    isPersistentKvConfigured() && (await upstashSetJsonWithPipeline(key, next));
  if (!savedRemote) setServerMemoryRouletteLogs(key, next);
  return { ok: true, logId: log.id, duplicate: false, logs: next };
}

export async function cancelRouletteSession(params: {
  userId: string;
  sessionId: string;
  selectedSigs: SigItem[];
  oneShotPrice: number;
  adminId?: string;
  reason?: string;
}) {
  return saveRouletteLog({
    userId: params.userId,
    sessionId: params.sessionId,
    phase: "CANCELLED",
    selectedSigs: params.selectedSigs,
    oneShotPrice: params.oneShotPrice,
    adminId: params.adminId,
    reason: params.reason || "operator_cancelled",
  });
}
