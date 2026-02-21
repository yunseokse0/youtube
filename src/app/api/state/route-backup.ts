export const runtime = "edge";
export const revalidate = 0;

const STORAGE_KEY = "excel-broadcast-state-v1";

function getEnv() {
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

async function upstashGet(key: string) {
  const { base, token } = getEnv();
  if (!base || !token) return null;
  const url = `${base.replace(/\/$/, "")}/get/${encodeURIComponent(key)}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!r.ok) return null;
  const data = (await r.json()) as { result?: string | null };
  if (!data || data.result == null) return null;
  try {
    return JSON.parse(data.result as string);
  } catch {
    return null;
  }
}

async function upstashSet(key: string, value: unknown) {
  const { base, token } = getEnv();
  if (!base || !token) return false;
  const json = JSON.stringify(value);
  const url = `${base.replace(/\/$/, "")}/set/${encodeURIComponent(
    key
  )}/${encodeURIComponent(json)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return r.ok;
}

export async function GET() {
  try {
    const state = await upstashGet(STORAGE_KEY);
    return new Response(JSON.stringify(state || {}), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
      },
    });
  } catch {
    return new Response(JSON.stringify({}), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ok = await upstashSet(STORAGE_KEY, body);
    return new Response(JSON.stringify({ ok }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0, s-maxage=0, stale-while-revalidate=0",
      },
      status: ok ? 200 : 500,
    });
  } catch {
    return new Response(JSON.stringify({ ok: false }), {
      headers: { "Content-Type": "application/json" },
      status: 500,
    });
  }
}

