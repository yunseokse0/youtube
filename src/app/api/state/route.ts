import { NextResponse } from "next/server";

let stateCache: string | null = null;
let updatedAt = 0;

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

export async function GET() {
  const kvData = await kvGet();
  if (kvData) {
    stateCache = kvData;
    return new NextResponse(kvData, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (stateCache) {
    return new NextResponse(stateCache, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return NextResponse.json(null, {
    status: 404,
    headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" },
  });
}

export async function POST(req: Request) {
  const body = await req.text();
  stateCache = body;
  updatedAt = Date.now();
  await kvSet(body);
  return NextResponse.json({ ok: true, updatedAt });
}
