import type { Donor } from "@/types";
import {
  getRedisEnv,
  isRedisConfigured,
  isKillSwitchForceMysqlOnly,
} from "@/app/api/_shared/upstash";

const SHARD_KEY_BASE = "din:donors:v1";
const DEFAULT_SHARD_RECENT_WINDOW_MS = 1000 * 60 * 60 * 6;
const DEFAULT_SHARD_MAX_HYDRATE = 20_000;

export function isDonorShardEnabled(): boolean {
  if (isKillSwitchForceMysqlOnly()) return false;
  if (!isRedisConfigured()) return false;
  const flag = String(process.env.DIN_ENABLE_DONOR_SHARD_STORE || "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  if (flag === "0" || flag === "false" || flag === "no") return false;
  return process.env.NODE_ENV === "production";
}

export function donorShardStateKey(userId: string): string {
  return `${SHARD_KEY_BASE}:state:${userId}`;
}

export function donorShardMetaKey(userId: string): string {
  return `${SHARD_KEY_BASE}:meta:${userId}`;
}

function donorShardHashKeyForId(userId: string, donorId: string): string {
  return `${SHARD_KEY_BASE}:h:${userId}:${donorId}`;
}

function sanitizeDonorId(raw: unknown): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  return s;
}

type UpstashPipelineResult = Array<{ result?: unknown; error?: unknown } | null>;

async function runUpstashPipeline<T = unknown>(
  cmds: unknown[][]
): Promise<{ ok: boolean; results: T[] | null; raw?: UpstashPipelineResult }> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return { ok: false, results: null };
  const url = `${base.replace(/\/$/, "")}/pipeline`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cmds),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { ok: false, results: null };
    const arr = (await res.json().catch(() => null)) as UpstashPipelineResult | null;
    if (!Array.isArray(arr)) return { ok: false, results: null };
    const results: T[] = [];
    for (const item of arr) {
      if (item && !item.error && "result" in item) {
        results.push(item.result as T);
      } else {
        results.push(null as T);
      }
    }
    return { ok: true, results, raw: arr };
  } catch {
    return { ok: false, results: null };
  }
}

function donorToHashFields(d: Donor): Record<string, string> {
  const fields: Record<string, string> = {};
  const safe = d as unknown as Record<string, unknown>;
  const simpleStrKeys = ["id", "donorName", "name", "displayName", "message", "target", "memberId", "donorKey", "externalId", "primaryKey", "type", "source", "tier", "badge"];
  const numKeys = ["amount", "points", "contribution", "at"];
  const boolKeys = ["excluded", "hsTerritoryExcluded", "groupSplit", "groupSplitSource", "operating", "manual", "verified"];
  const objKeys = ["meta", "raw", "extra"];
  for (const k of simpleStrKeys) {
    const v = safe[k];
    if (v == null) continue;
    fields[k] = typeof v === "string" ? v : String(v);
  }
  for (const k of numKeys) {
    const v = safe[k];
    if (v == null || v === "") continue;
    const n = Number(v);
    fields[k] = Number.isFinite(n) ? String(n) : String(v);
  }
  for (const k of boolKeys) {
    const v = safe[k];
    if (v == null) continue;
    fields[k] = v ? "1" : "0";
  }
  for (const k of objKeys) {
    const v = safe[k];
    if (v == null) continue;
    try {
      fields[k] = JSON.stringify(v);
    } catch {
      /* ignore */
    }
  }
  return fields;
}

function hashToDonor(fields: Record<string, string | null>): Donor | null {
  const obj: Record<string, unknown> = {};
  if (!fields || Object.keys(fields).length === 0) return null;
  const id = sanitizeDonorId(fields.id);
  if (!id) return null;
  const simpleStrKeys = ["id", "donorName", "name", "displayName", "message", "target", "memberId", "donorKey", "externalId", "primaryKey", "type", "source", "tier", "badge"];
  const numKeys = ["amount", "points", "contribution", "at"];
  const boolKeys = ["excluded", "hsTerritoryExcluded", "groupSplit", "groupSplitSource", "operating", "manual", "verified"];
  const objKeys = ["meta", "raw", "extra"];
  for (const k of simpleStrKeys) {
    const v = fields[k];
    if (v != null && v !== "") obj[k] = v;
  }
  for (const k of numKeys) {
    const v = fields[k];
    if (v == null || v === "") continue;
    const n = Number(v);
    obj[k] = Number.isFinite(n) ? n : v;
  }
  for (const k of boolKeys) {
    const v = fields[k];
    if (v == null || v === "") continue;
    obj[k] = v === "1" || v === "true" || (v as unknown as boolean) === true;
  }
  for (const k of objKeys) {
    const v = fields[k];
    if (!v) continue;
    try {
      obj[k] = JSON.parse(v);
    } catch {
      obj[k] = v;
    }
  }
  return obj as Donor;
}

export type DonorSkeleton = {
  ids: string[];
  total: number;
  hydratedAt: number;
};

export async function donorShardWriteDonorBulk(
  userId: string,
  donors: Donor[]
): Promise<{ ok: boolean; written: number }> {
  if (!isDonorShardEnabled() || !donors || donors.length === 0)
    return { ok: false, written: 0 };
  const ids: string[] = [];
  const cmds: unknown[][] = [];
  for (const d of donors) {
    const id = sanitizeDonorId((d as unknown as { id?: unknown }).id);
    if (!id) continue;
    ids.push(id);
    const fields = donorToHashFields(d);
    const fkv: string[] = [];
    for (const [k, v] of Object.entries(fields)) fkv.push(k, v);
    if (fkv.length === 0) continue;
    cmds.push(["HSET", donorShardHashKeyForId(userId, id), ...fkv]);
  }
  if (cmds.length === 0) return { ok: false, written: 0 };
  const r = await runUpstashPipeline(cmds);
  if (!r.ok) return { ok: false, written: 0 };
  return { ok: true, written: ids.length };
}

export async function donorShardHydrateSkeleton(
  userId: string,
  skeleton: DonorSkeleton,
  opts?: { limit?: number; recentWindowMs?: number }
): Promise<{ ok: boolean; donors: Donor[]; notFoundCount: number }> {
  if (!isDonorShardEnabled()) return { ok: false, donors: [], notFoundCount: 0 };
  const limit = Math.max(1, Math.min(100_000, opts?.limit ?? DEFAULT_SHARD_MAX_HYDRATE));
  const window = Math.max(60_000, opts?.recentWindowMs ?? DEFAULT_SHARD_RECENT_WINDOW_MS);
  const cutoffTs = Date.now() - window;
  const sliceIds = skeleton.ids.slice(0, limit);
  const cmds: unknown[][] = sliceIds.map((id) => [
    "HGETALL",
    donorShardHashKeyForId(userId, id),
  ]);
  if (cmds.length === 0) return { ok: true, donors: [], notFoundCount: 0 };
  const r = await runUpstashPipeline<Array<[string, string]> | null>(cmds);
  if (!r.ok || !r.results) return { ok: false, donors: [], notFoundCount: 0 };
  const donors: Donor[] = [];
  let notFoundCount = 0;
  for (let i = 0; i < r.results.length; i++) {
    const raw = r.results[i];
    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      notFoundCount += 1;
      continue;
    }
    const fm: Record<string, string> = {};
    for (let j = 0; j + 1 < raw.length; j += 2) {
      fm[String(raw[j] || "")] = String(raw[j + 1] || "");
    }
    const donor = hashToDonor(fm);
    if (!donor) {
      notFoundCount += 1;
      continue;
    }
    const at = Number((donor as unknown as { at?: unknown }).at) || 0;
    if (at < cutoffTs) continue;
    donors.push(donor);
  }
  return { ok: true, donors, notFoundCount };
}

export async function donorShardWriteStateMeta(
  userId: string,
  skeleton: DonorSkeleton
): Promise<boolean> {
  if (!isDonorShardEnabled()) return false;
  const payload = JSON.stringify(skeleton);
  const r = await runUpstashPipeline([
    ["SET", donorShardMetaKey(userId), payload],
  ]);
  return r.ok;
}

export async function donorShardReadStateMeta(userId: string): Promise<DonorSkeleton | null> {
  if (!isDonorShardEnabled()) return null;
  const r = await runUpstashPipeline<string | null>([
    ["GET", donorShardMetaKey(userId)],
  ]);
  if (!r.ok || !r.results || !r.results[0]) return null;
  try {
    const parsed = JSON.parse(r.results[0]);
    if (!parsed || !Array.isArray(parsed.ids)) return null;
    return parsed as DonorSkeleton;
  } catch {
    return null;
  }
}

export async function donorShardWipeForReset(userId: string): Promise<{ ok: boolean; deleted: number }> {
  if (!isDonorShardEnabled()) return { ok: false, deleted: 0 };
  const meta = await donorShardReadStateMeta(userId);
  const cmds: unknown[][] = [];
  let deleted = 0;
  if (meta && meta.ids && meta.ids.length > 0) {
    const ids = meta.ids.slice(0, 100_000);
    for (const id of ids) {
      cmds.push(["DEL", donorShardHashKeyForId(userId, id)]);
      deleted += 1;
    }
  }
  cmds.push(["DEL", donorShardMetaKey(userId)]);
  if (cmds.length === 0) return { ok: true, deleted: 0 };
  const r = await runUpstashPipeline(cmds);
  return { ok: r.ok, deleted };
}

export type DonorShardCoalesceResult = {
  final: AppStateLikeDonors;
  wroteShard: boolean;
  hydratedFromShard: number;
  baseInlineCount: number;
};

export type AppStateLikeDonors = {
  donors: Donor[];
};

/**
 * Opt-In donor shard 계층 (callerMode 기반으로 revive 방지):
 *   SAVE mode + resetAt>0 + donors=[]: SHARD WIPE (revive 원봉쇄)
 *   SAVE mode + resetAt=0 + donors 있음: Shard bulk upsert + meta 저장
 *   SAVE mode + resetAt=0 + donors 없음: NOOP (skeleton hydrate 하지 않음)
 *   LOAD mode + donors 있음: NOOP (최신 inline donors 우선. shard write 불필요)
 *   LOAD mode + resetAt>0 + donors=[]: NOOP (정산 reset 후 빈 배열 유지. hydrate 금지)
 *   LOAD mode + resetAt=0 + donors=[]: Skeleton hydrate 시도 (shard meta 있으면 recent window 복구)
 *   Flag off / Redis 미설정: NOOP (기존 monolith 그대로)
 */
export async function donorShardCoalesceOnSave<T extends AppStateLikeDonors>(
  userId: string,
  state: T,
  opts?: {
    isSkeletonInline?: boolean;
    maxWindowMs?: number;
    hydrateLimit?: number;
    callerMode?: "save" | "load";
    effectiveSettlementResetAt?: number;
  }
): Promise<DonorShardCoalesceResult> {
  if (!isDonorShardEnabled()) {
    return {
      final: state,
      wroteShard: false,
      hydratedFromShard: 0,
      baseInlineCount: Array.isArray(state.donors) ? state.donors.length : 0,
    };
  }
  const mode = opts?.callerMode ?? "save";
  const resetAt = Number(opts?.effectiveSettlementResetAt || 0);
  const donorsInline = Array.isArray(state.donors) ? state.donors : [];
  const baseInlineCount = donorsInline.length;
  const skeletonInline = Boolean(opts?.isSkeletonInline);

  if (resetAt > 0 && baseInlineCount === 0) {
    if (mode === "save") {
      const w = await donorShardWipeForReset(userId).catch(() => ({ ok: false, deleted: 0 }));
      return {
        final: state,
        wroteShard: w.ok,
        hydratedFromShard: 0,
        baseInlineCount,
      };
    }
    return { final: state, wroteShard: false, hydratedFromShard: 0, baseInlineCount };
  }

  if (mode === "load" && baseInlineCount > 0) {
    return { final: state, wroteShard: false, hydratedFromShard: 0, baseInlineCount };
  }

  if (!skeletonInline && baseInlineCount > 0) {
    const ids = donorsInline
      .map((d) => sanitizeDonorId((d as unknown as { id?: unknown }).id))
      .filter((v): v is string => Boolean(v));
    const w = await donorShardWriteDonorBulk(userId, donorsInline);
    const meta: DonorSkeleton = {
      ids,
      total: ids.length,
      hydratedAt: Date.now(),
    };
    const metaOk = await donorShardWriteStateMeta(userId, meta);
    return {
      final: state,
      wroteShard: w.ok && metaOk,
      hydratedFromShard: 0,
      baseInlineCount,
    };
  }

  if (mode === "save" && baseInlineCount === 0) {
    return { final: state, wroteShard: false, hydratedFromShard: 0, baseInlineCount };
  }

  const meta = await donorShardReadStateMeta(userId);
  if (!meta) {
    return {
      final: state,
      wroteShard: false,
      hydratedFromShard: 0,
      baseInlineCount,
    };
  }
  const existingIds = new Set(
    donorsInline
      .map((d) => sanitizeDonorId((d as unknown as { id?: unknown }).id))
      .filter((v): v is string => Boolean(v))
  );
  const r = await donorShardHydrateSkeleton(userId, meta, {
    limit: opts?.hydrateLimit,
    recentWindowMs: opts?.maxWindowMs,
  });
  if (!r.ok) {
    return {
      final: state,
      wroteShard: false,
      hydratedFromShard: 0,
      baseInlineCount,
    };
  }
  const merged: Donor[] = [...donorsInline];
  for (const d of r.donors) {
    const id = sanitizeDonorId((d as unknown as { id?: unknown }).id);
    if (!id) continue;
    if (existingIds.has(id)) continue;
    merged.push(d);
    existingIds.add(id);
  }
  return {
    final: { ...state, donors: merged },
    wroteShard: false,
    hydratedFromShard: r.donors.length,
    baseInlineCount,
  };
}
