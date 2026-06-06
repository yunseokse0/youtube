const PAYLOAD_RE = /"payload"\s*:\s*"([a-zA-Z0-9]+)"/;

/** Alertbox HTML에서 ws.toon.at 연결용 payload 추출 */
export async function resolveToonationWsPayload(alertboxUrl: string): Promise<string> {
  const url = alertboxUrl.trim();
  if (!url) throw new Error("invalid_toonation_alertbox_url");

  const res = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "FinalEnt-Broadcast/1.0",
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`toonation_alertbox_fetch_failed:${res.status}`);
  }
  const html = await res.text();
  const matched = html.match(PAYLOAD_RE);
  if (!matched?.[1]) {
    throw new Error("toonation_payload_not_found");
  }
  return matched[1];
}
