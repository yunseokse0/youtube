export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { normalizeToonationAlertboxUrl } from "@/lib/donation/toonation/link-key";
import { resolveToonationWsPayload } from "@/lib/donation/toonation/resolve-payload";

/** OBS 릴레이·진단 — Alertbox HTML에서 WS payload 토큰 조회 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const keyOrUrl = String(
    url.searchParams.get("key") || url.searchParams.get("linkKey") || url.searchParams.get("alertboxUrl") || ""
  ).trim();
  const alertboxUrl = normalizeToonationAlertboxUrl(keyOrUrl);
  if (!alertboxUrl) {
    return new Response(JSON.stringify({ error: "invalid_toonation_link_key" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  try {
    const payload = await resolveToonationWsPayload(alertboxUrl);
    return new Response(JSON.stringify({ ok: true, alertboxUrl, payload }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}
