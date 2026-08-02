export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { resolveToonationRelayConfigForUser } from "@/lib/donation/toonation/resolve-relay-config";

/** OBS 엑셀표 overlay — 로그인 없이 `?u=` 로 투네 릴레이 설정 조회 (서버 WS enabled 와 무관) */
export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "missing_user" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const cfg = await resolveToonationRelayConfigForUser(userId);
  return new Response(JSON.stringify(cfg), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
