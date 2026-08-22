export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { readToonationListenerConfig } from "@/lib/donation/toonation/listener-config-store";
import { ingestToonationWebSocketMessage } from "@/lib/donation/toonation/server-listener";

export async function POST(req: Request) {
  /** OBS 브라우저 릴레이 — 로그인 쿠키 없이 `?u=` 허용 (기존 동작 유지) */
  const writeUid = resolveWriteUserId(req, { allowAnonymousUrlUser: true });
  if (!writeUid.ok) return writeUserIdErrorResponse(writeUid);
  const userId = writeUid.userId;

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
