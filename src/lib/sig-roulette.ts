import type { SigItem } from "@/types";
import { getServerMemoryRouletteLogs, setServerMemoryRouletteLogs } from "@/lib/server-memory-roulette-logs";

export const ONE_SHOT_SIG_ID = "sig_one_shot";

/** 회전판 메뉴 슬라이스 id(`실제SigId__wslot_n`) → 재고 `SigItem.id` */
export function canonicalSigIdFromWheelSliceId(sliceId: string): string {
  const raw = String(sliceId || "").trim();
  const m = /^(.+)__wslot_(\d+)$/.exec(raw);
  return m?.[1] || raw;
}
export const SPIN_SOUND_PATHS = {
  tick: "/sounds/spin-tick.wav",
  final: "/sounds/spin-final.wav",
  success: "/sounds/success.wav",
  oneShot: "/sounds/oneshot.wav",
} as const;
export const SOUND_ASSETS_ENABLED = true;
/** false: 회전판은 wav 대신 Web Audio 절차음만 사용(더 절제된 톤). 오버레이 한방 등 다른 경로는 `SOUND_ASSETS_ENABLED` 유지 */
export const ROULETTE_WHEEL_WAV_ASSETS_ENABLED = false;
/** false: 회전 틱·착지·한방 착지 효과음 전부 끔(추후 다시 켤 때 true) */
export const ROULETTE_WHEEL_SFX_ENABLED = false;

export function pickDistinctSigs(pool: SigItem[], count: number): SigItem[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = t;
  }
  return copy.slice(0, Math.max(0, Math.min(count, copy.length)));
}

export function calcOneShotPriceFromSelected(selected: SigItem[]): number {
  return selected.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.price || 0))), 0);
}

export function clampOverlayOpacity(opacity: number): number {
  if (!Number.isFinite(opacity)) return 0.85;
  return Math.max(0.4, Math.min(1, opacity));
}

export function formatWon(value: number): string {
  const safe = Math.max(0, Math.floor(value || 0));
  return `${safe.toLocaleString("ko-KR")}원`;
}

export type RouletteSessionLog = {
  id: string;
  sessionId: string;
  phase: "CONFIRMED" | "CANCELLED";
  selectedSigs: SigItem[];
  selectedSigIds: string[];
  oneShotPrice: number;
  totalPrice: number;
  timestamp: number;
  adminId?: string;
  reason?: string;
};

const LOG_KEY_PREFIX = "excel-broadcast-roulette-log-v1";

function getLogKey(userId: string) {
  return `${LOG_KEY_PREFIX}:${userId}`;
}

function getEnv() {
  const base = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";
  return { base, token };
}

async function upstashGetJson<T>(key: string): Promise<T | null> {
  const { base, token } = getEnv();
  if (!base || !token) return null;
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: string | null };
  if (!data?.result) return null;
  try {
    return JSON.parse(data.result) as T;
  } catch {
    return null;
  }
}

async function upstashSetJson(key: string, value: unknown): Promise<boolean> {
  const { base, token } = getEnv();
  if (!base || !token) return false;
  const url = `${base.replace(/\/$/, "")}/pipeline`;
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify([["SET", key, JSON.stringify(value)]]),
  });
  return res.ok;
}

export async function listRouletteLogs(userId: string): Promise<RouletteSessionLog[]> {
  const key = getLogKey(userId);
  const remote = await upstashGetJson<RouletteSessionLog[]>(key);
  if (Array.isArray(remote)) return remote;
  return getServerMemoryRouletteLogs(key);
}

export async function getRouletteHistory(userId: string, limit = 20, sessionId?: string): Promise<RouletteSessionLog[]> {
  const logs = await listRouletteLogs(userId);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 20)));
  const filtered = sessionId ? logs.filter((x) => x.sessionId === sessionId) : logs;
  return filtered.slice(0, safeLimit);
}

export async function saveRouletteLog(params: {
  userId: string;
  sessionId: string;
  phase: "CONFIRMED" | "CANCELLED";
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
    if (prev.phase === params.phase) return { ok: true, logId: prev.id, duplicate: true, logs: existing };
    const replaced = existing.map((x) =>
      x.sessionId === params.sessionId
        ? {
            ...x,
            phase: params.phase,
            reason: params.reason,
            timestamp: Date.now(),
          }
        : x
    );
    const savedRemote = await upstashSetJson(key, replaced);
    if (!savedRemote) setServerMemoryRouletteLogs(key, replaced);
    return { ok: true, logId: prev.id, duplicate: false, logs: replaced };
  }
  const totalPrice = params.selectedSigs.reduce((sum, s) => sum + Math.max(0, Math.floor(Number(s.price || 0))), 0);
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
  const savedRemote = await upstashSetJson(key, next);
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
