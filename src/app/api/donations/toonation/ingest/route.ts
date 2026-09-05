export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { readToonationListenerConfig } from "@/lib/donation/toonation/listener-config-store";
import { ingestToonationWebSocketMessage } from "@/lib/donation/toonation/server-listener";

/** ★ DIN 허브 통일 모드 (B모드):
 *    .env 에 TOONA_INTAKE_MODE=din_only 설정시 투네이션 직접 경로(브라우저 릴레이/OBS WS) 스킵 →
 *    오직 /api/donations/ingest (DIN 허브 TOONA_INGEST_SECRET 인증 경로) 로만 후원 유입.
 *    경로 1개 = UUID 1종류 = 2행 중복 근본적으로 해결. */
function isDinOnlyIntakeMode(): boolean {
  const v = String(process.env.TOONA_INTAKE_MODE || process.env.DONATION_INTAKE_MODE || "").trim().toLowerCase();
  return v === "din_only" || v === "din-hub-only" || v === "b-mode";
}

export async function POST(req: Request) {
  if (isDinOnlyIntakeMode()) {
    return new Response(
      JSON.stringify({
        skipped: true,
        mode: "din_only",
        message: "DIN 허브 통일 모드: 직접 경로 후원은 스킵되고 오직 /api/donations/ingest DIN 허브 경로만 받습니다.",
      }),
      { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
    );
  }
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
