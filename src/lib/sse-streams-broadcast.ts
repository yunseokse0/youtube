import {
  getRedisEnv,
  isRedisConfigured,
  isKillSwitchForceMysqlOnly,
} from "@/app/api/_shared/upstash";

const REDIS_STREAMS_DEFAULT_KEY = "din:sse:events:v1";
const REDIS_STREAMS_MAX_LEN_APPROX = 10_000;
const REDIS_STREAMS_READ_BLOCK_MS = 4_000;

export function sseStreamsKey(): string {
  return (
    String(process.env.DIN_SSE_REDIS_STREAM_KEY || "").trim() ||
    REDIS_STREAMS_DEFAULT_KEY
  );
}

export function isRedisStreamsEnabled(): boolean {
  if (isKillSwitchForceMysqlOnly()) return false;
  if (!isRedisConfigured()) return false;
  const override = String(
    process.env.DIN_ENABLE_REDIS_SSE_STREAMS || ""
  ).trim().toLowerCase();
  if (override === "1" || override === "true" || override === "yes")
    return true;
  if (override === "0" || override === "false" || override === "no")
    return false;
  return process.env.NODE_ENV === "production";
}

type UpstashPipelineCommand = unknown[];

async function runUpstashPipelineSingle<T = unknown>(
  cmds: UpstashPipelineCommand[]
): Promise<{ ok: boolean; result: T | null; raw?: unknown }> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return { ok: false, result: null };
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
      signal: AbortSignal.timeout(6_000),
    });
    if (!res.ok) return { ok: false, result: null };
    const arr = (await res.json().catch(() => null)) as
      | Array<{ result?: T; error?: unknown } | null>
      | null;
    if (!Array.isArray(arr) || arr.length === 0)
      return { ok: false, result: null };
    const first = arr[0];
    if (!first || first.error) return { ok: false, result: null, raw: arr };
    return { ok: true, result: (first.result ?? null) as T | null, raw: arr };
  } catch {
    return { ok: false, result: null };
  }
}

export async function redisStreamPublishEvent(
  payload: unknown,
  opts?: { streamKey?: string; approxMaxLen?: number }
): Promise<{ ok: boolean; id?: string | null }> {
  if (!isRedisStreamsEnabled()) return { ok: false };
  const key = opts?.streamKey || sseStreamsKey();
  const maxLen = Math.max(
    100,
    opts?.approxMaxLen ?? REDIS_STREAMS_MAX_LEN_APPROX
  );
  const fieldData: Record<string, string> = {};
  try {
    fieldData.t = String(Date.now());
    fieldData.j = JSON.stringify(payload);
  } catch {
    return { ok: false };
  }
  const fieldList: string[] = [];
  for (const [k, v] of Object.entries(fieldData)) {
    fieldList.push(k, v);
  }
  const cmd: UpstashPipelineCommand = [
    "XADD",
    key,
    "MAXLEN",
    "~",
    String(maxLen),
    "*",
    ...fieldList,
  ];
  const res = await runUpstashPipelineSingle<string | null>([cmd]);
  return { ok: res.ok, id: res.result };
}

export type RedisStreamsEntry = {
  id: string;
  t?: number;
  payload: unknown;
};

export async function redisStreamReadNewer(
  lastId: string,
  opts?: { streamKey?: string; blockMs?: number; count?: number }
): Promise<{ ok: boolean; entries: RedisStreamsEntry[]; nextId: string }> {
  if (!isRedisStreamsEnabled())
    return { ok: false, entries: [], nextId: lastId || "$" };
  const key = opts?.streamKey || sseStreamsKey();
  const count = Math.max(1, Math.min(256, opts?.count ?? 32));
  const block = Math.max(
    500,
    Math.min(30_000, opts?.blockMs ?? REDIS_STREAMS_READ_BLOCK_MS)
  );
  const cursor = lastId && lastId !== "$" ? lastId : "$";
  const cmd: UpstashPipelineCommand = [
    "XREAD",
    "BLOCK",
    String(block),
    "COUNT",
    String(count),
    "STREAMS",
    key,
    cursor,
  ];
  const res = await runUpstashPipelineSingle<unknown>([cmd]);
  const entries: RedisStreamsEntry[] = [];
  let nextId = cursor;
  if (!res.ok || !res.result) return { ok: res.ok, entries, nextId };
  try {
    const outer = res.result as unknown[];
    if (!Array.isArray(outer) || outer.length === 0)
      return { ok: true, entries, nextId };
    const firstStream = outer[0] as unknown[];
    if (!Array.isArray(firstStream) || firstStream.length < 2)
      return { ok: true, entries, nextId };
    const rows = firstStream[1] as unknown[];
    if (!Array.isArray(rows)) return { ok: true, entries, nextId };
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const id = String(row[0] || "");
      const fields = row[1] as string[] | undefined;
      if (!id || !Array.isArray(fields)) continue;
      const fieldMap: Record<string, string> = {};
      for (let i = 0; i + 1 < fields.length; i += 2) {
        fieldMap[String(fields[i] || "")] = String(fields[i + 1] || "");
      }
      const tRaw = fieldMap.t;
      const t = tRaw ? Number(tRaw) || 0 : 0;
      let payload: unknown = null;
      try {
        payload = fieldMap.j ? JSON.parse(fieldMap.j) : null;
      } catch {
        payload = null;
      }
      entries.push({ id, t, payload });
      nextId = id;
    }
  } catch {
    /* ignore */
  }
  return { ok: true, entries, nextId };
}
