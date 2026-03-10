export const runtime = "edge";
export const revalidate = 0;

import { defaultState } from "@/lib/state";

function getUserId(req: Request): string | null {
  const url = new URL(req.url);
  const fromUrl = url.searchParams.get("user");
  if (fromUrl && fromUrl.trim()) return fromUrl.trim();
  return null;
}

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

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";
function stateKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
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

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      // 사용자 식별 불가 시 빈 리스트 반환
      return new Response(JSON.stringify({ overlayPresets: [] }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        status: 200,
      });
    }
    const state = await upstashGet(stateKey(userId));
    const effective = state && typeof state === "object" ? state : defaultState();
    const list = Array.isArray(effective.overlayPresets) ? effective.overlayPresets : [];
    return new Response(JSON.stringify({ overlayPresets: list }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      status: 200,
    });
  } catch {
    return new Response(JSON.stringify({ overlayPresets: [] }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      status: 200,
    });
  }
}

