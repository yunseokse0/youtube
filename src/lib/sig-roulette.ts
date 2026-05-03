import type { SigItem } from "@/types";
import { getServerMemoryRouletteLogs, setServerMemoryRouletteLogs } from "@/lib/server-memory-roulette-logs";

export const ONE_SHOT_SIG_ID = "sig_one_shot";

/** 회전판 메뉴 슬라이스 id(`실제SigId__wslot_n`) → 재고 `SigItem.id` */
export function canonicalSigIdFromWheelSliceId(sliceId: string): string {
  const raw = String(sliceId || "").trim();
  const m = /^(.+)__wslot_(\d+)$/.exec(raw);
  return m?.[1] || raw;
}

/**
 * 휠 조각 id(`원본id__wslot_N`)와 서버에서 넘어오는 당첨 id(캐노니컬만)가 다를 때 `===` 매칭이 실패해
 * 항상 0번 칸으로 착지하던 문제를 막는다.
 */
export function findSliceIndexForResult(items: SigItem[], resultId: string | null): number {
  if (!resultId || items.length === 0) return 0;
  const exact = items.findIndex((x) => x.id === resultId);
  if (exact >= 0) return exact;
  const targetCanon = canonicalSigIdFromWheelSliceId(resultId);
  const byCanon = items.findIndex((x) => canonicalSigIdFromWheelSliceId(x.id) === targetCanon);
  return byCanon >= 0 ? byCanon : 0;
}

/**
 * 시네마틱 휠 감속 구간 최종 회전 각도(도). `RouletteWheel`과 동일한 수식.
 */
export function calculateSpinFinalAngle(
  items: SigItem[],
  targetId: string | null,
  count: number,
  currentBase: number,
  minTurns: number
): number {
  if (!targetId || !items.length) return currentBase + Math.max(1, minTurns) * 360;
  const idx = findSliceIndexForResult(items, targetId);
  const seg = 360 / Math.max(1, count);
  const targetCenter = idx * seg + seg / 2;
  const normalizedTarget = ((360 - targetCenter) % 360 + 360) % 360;
  const currentNorm = ((currentBase % 360) + 360) % 360;
  const deltaToTarget = ((normalizedTarget - currentNorm) % 360 + 360) % 360;
  return currentBase + minTurns * 360 + deltaToTarget;
}

/**
 * 방송 오버레이·휠은 재고 `sigInventory` 기준 이름/이미지를 쓰고, 당첨 배열은 API 스냅샷이라 불일치할 수 있음.
 * 동일 시그 id로 인벤 행을 합쳐 표시를 맞춘다(당첨 금액은 요청 항목 우선).
 */
export function hydrateSigItemFromInventory(item: SigItem, inventory: SigItem[] | undefined): SigItem {
  const canon = canonicalSigIdFromWheelSliceId(item.id);
  if (!inventory?.length) {
    return { ...item, id: canon };
  }
  const fromInv =
    inventory.find((x) => x.id === canon) ||
    inventory.find((x) => x.id === item.id);
  if (!fromInv) {
    return { ...item, id: canon };
  }
  const price = Math.max(0, Math.floor(Number(item.price ?? fromInv.price ?? 0)));
  return {
    ...fromInv,
    id: canon,
    price,
  };
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
  /** LANDED: 방송 착지(결과 확정), CONFIRMED: 판매 확정, CANCELLED: 취소 */
  phase: "LANDED" | "CONFIRMED" | "CANCELLED";
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
      0,
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
