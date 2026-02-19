import { NextResponse } from "next/server";

export const runtime = "edge";

let stateCache: string | null = null;
let cacheUpdatedAt = 0;

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const STATE_KEY = "broadcast-state";

async function kvGet(): Promise<string | null> {
  if (!KV_URL || !KV_TOKEN) return null;
  try {
    const res = await fetch(`${KV_URL}/get/${STATE_KEY}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
      cache: "no-store",
    });
    const data = await res.json();
    return data.result || null;
  } catch {
    return null;
  }
}

async function kvSet(value: string): Promise<void> {
  if (!KV_URL || !KV_TOKEN) return;
  try {
    await fetch(KV_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${KV_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(["SET", STATE_KEY, value]),
    });
  } catch {}
}

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const kvData = await kvGet();
  if (kvData) {
    stateCache = kvData;
    return new NextResponse(kvData, { headers: CORS_HEADERS });
  }

  if (stateCache) {
    return new NextResponse(stateCache, { headers: CORS_HEADERS });
  }

  return NextResponse.json(null, { status: 404, headers: CORS_HEADERS });
}

export async function POST(req: Request) {
  const body = await req.text();
  stateCache = body;
  cacheUpdatedAt = Date.now();
  await kvSet(body);
  return NextResponse.json({ ok: true, updatedAt: cacheUpdatedAt }, { headers: CORS_HEADERS });
}
