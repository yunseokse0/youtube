type RedisEnv = {
  base: string;
  token: string;
};

export function getRedisEnv(): RedisEnv {
  const base =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    "";
  return { base, token };
}

export async function upstashGetJson<T = unknown>(key: string): Promise<T | null> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return null;
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { result?: string | null };
  if (!data || data.result == null) return null;
  try {
    return JSON.parse(data.result as string) as T;
  } catch {
    return null;
  }
}

export async function upstashSetJsonWithSetPath(
  key: string,
  value: unknown
): Promise<boolean> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return false;
  const json = JSON.stringify(value);
  const url = `${base.replace(/\/$/, "")}/set/${encodeURIComponent(
    key
  )}/${encodeURIComponent(json)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return response.ok;
}

export async function upstashSetJsonWithPipeline(
  key: string,
  value: unknown
): Promise<boolean> {
  const { base, token } = getRedisEnv();
  if (!base || !token) return false;
  const json = JSON.stringify(value);
  const url = `${base.replace(/\/$/, "")}/pipeline`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([["SET", key, json]]),
  });
  return response.ok;
}
