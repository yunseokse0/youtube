export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { readToonationListenerConfig } from "@/lib/donation/toonation/listener-config-store";
import { ingestToonationWebSocketMessage } from "@/lib/donation/toonation/server-listener";

export async function POST(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => null)) as {
    raw?: string;
    ownerName?: string;
  } | null;
  const raw = String(body?.raw || "").trim();
  if (!raw) {
    return new Response(JSON.stringify({ error: "missing_raw" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const cfg = await readToonationListenerConfig(userId);
  const ownerName = String(body?.ownerName || cfg?.ownerName || "").trim();

  const result = await ingestToonationWebSocketMessage(
    userId,
    raw,
    ownerName || undefined,
    "browser-relay"
  );
  return new Response(JSON.stringify({ ok: true, result }), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
