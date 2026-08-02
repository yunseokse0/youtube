export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { getUserIdFromRequest } from "@/app/api/_shared/user-id";
import { extractToonationLinkKey } from "@/lib/donation/toonation/link-key";
import { readToonationListenerConfig } from "@/lib/donation/toonation/listener-config-store";

/** OBS 오버레이·릴레이 — 로그인 없이 `?u=` 로 투네 연동 설정 조회 */
export async function GET(req: Request) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: "missing_user" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const cfg = await readToonationListenerConfig(userId);
  if (!cfg?.enabled || !cfg.alertboxUrl) {
    return new Response(JSON.stringify({ enabled: false, userId }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }
  const linkKey = extractToonationLinkKey(cfg.alertboxUrl) || cfg.alertboxUrl;
  return new Response(
    JSON.stringify({
      enabled: true,
      userId,
      linkKey,
      ownerName: String(cfg.ownerName || "").trim(),
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
