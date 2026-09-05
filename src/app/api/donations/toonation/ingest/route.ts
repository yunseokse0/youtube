export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { resolveWriteUserId, writeUserIdErrorResponse } from "@/app/api/_shared/user-id";
import { readToonationListenerConfig } from "@/lib/donation/toonation/listener-config-store";
import { ingestToonationWebSocketMessage } from "@/lib/donation/toonation/server-listener";
import {
  describeDonationIntakeMode,
  isDonationIntakeModeA,
} from "@/policies/donation-intake-mode";

/** ✅ A모드 (= 투네 직접 연결 모드) 에서만 처리함:
 *    .env TOONA_INTAKE_MODE=A 일때만 투네이션 WS 직접 릴레이(OBS/브라우저) 경로로 후원 유입.
 *    B모드 (DIN허브)일땐 스킵하고 /api/donations/ingest (DIN 허브 TOONA_INGEST_SECRET 인증 경로) 만 유효.
 *    후원 출처 1개 = 중복 2행 오입력 근본 방지. */
function isToonationDirectDisabled(): boolean {
  return !isDonationIntakeModeA();
}

export async function POST(req: Request) {
  if (isToonationDirectDisabled()) {
    return new Response(
      JSON.stringify({
        skipped: true,
        mode: describeDonationIntakeMode(),
        message:
          "현재 " +
          describeDonationIntakeMode() +
          " 이므로 투네 직접 경로 후원은 수신하지 않고 오직 DIN 허브(/api/donations/ingest) 경로로만 후원을 받습니다.",
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
