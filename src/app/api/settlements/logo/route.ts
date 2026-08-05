export const runtime = "edge";
export const revalidate = 0;

import { getUserIdFromRequest } from "../../_shared/user-id";
import { upstashGetJson, upstashSetJsonWithSetPath } from "../../_shared/upstash";

const STORAGE_KEY_BASE = "excel-broadcast-settlement-logo-v1";

type LogoPayload = {
  dataUrl: string;
  updatedAt: number;
};

const memoryLogo: Record<string, LogoPayload | null> = {};

function logoKey(userId: string): string {
  return `${STORAGE_KEY_BASE}:${userId}`;
}

function isValidDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/") && value.length < 1_500_000;
}

export async function GET(req: Request) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const remote = await upstashGetJson<LogoPayload>(logoKey(userId));
    const payload =
      remote && isValidDataUrl(remote.dataUrl)
        ? remote
        : memoryLogo[userId] && isValidDataUrl(memoryLogo[userId]?.dataUrl)
          ? memoryLogo[userId]
          : null;
    return new Response(JSON.stringify({ dataUrl: payload?.dataUrl || null }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch {
    return new Response(JSON.stringify({ dataUrl: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function POST(req: Request) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = (await req.json()) as { dataUrl?: unknown };
    if (!isValidDataUrl(body?.dataUrl)) {
      return new Response(JSON.stringify({ error: "invalid_logo" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const payload: LogoPayload = { dataUrl: body.dataUrl, updatedAt: Date.now() };
    memoryLogo[userId] = payload;
    await upstashSetJsonWithSetPath(logoKey(userId), payload);
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "save_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(req: Request) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!userId) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    memoryLogo[userId] = null;
    await upstashSetJsonWithSetPath(logoKey(userId), { dataUrl: null, updatedAt: Date.now() });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "delete_failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
