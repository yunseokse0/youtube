export const revalidate = 0;

import { defaultState } from "@/lib/state";
import { upstashGetJson } from "@/app/api/_shared/upstash";

function getUserId(req: Request): string | null {
  const url = new URL(req.url);
  const fromUrl = url.searchParams.get("user");
  if (fromUrl && fromUrl.trim()) return fromUrl.trim();
  return null;
}

const STORAGE_KEY_BASE = "excel-broadcast-state-v1";
const STORAGE_KEY_LEGACY = "excel-broadcast-state-v1";
function stateKey(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : STORAGE_KEY_LEGACY;
}

export async function GET(req: Request) {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return new Response(JSON.stringify({ overlayPresets: [] }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        status: 200,
      });
    }
    const state = await upstashGetJson<Record<string, unknown>>(stateKey(userId));
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
