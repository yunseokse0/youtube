export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import {
  getToonationListenerStatusForUser,
  syncToonationServerListener,
} from "@/lib/donation/toonation/server-listener";
import { normalizeToonationAlertboxUrl } from "@/lib/donation/toonation/link-key";

export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const status = await getToonationListenerStatusForUser(userId);
  return new Response(JSON.stringify({ status }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = (await req.json().catch(() => null)) as {
    alertboxUrl?: string;
    linkKey?: string;
    enabled?: boolean;
  } | null;
  const alertboxUrlOrKey = String(body?.alertboxUrl || body?.linkKey || "").trim();
  const alertboxUrl = normalizeToonationAlertboxUrl(alertboxUrlOrKey) || "";
  const enabled = body?.enabled !== false;
  try {
    if (enabled && !alertboxUrl) {
      return new Response(JSON.stringify({ error: "invalid_toonation_link_key" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const status = await syncToonationServerListener(userId, alertboxUrl, enabled);
    return new Response(JSON.stringify({ ok: true, status }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function DELETE(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  await syncToonationServerListener(userId, "", false);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}
