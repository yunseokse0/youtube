import { normalizeToonationAlertboxUrl } from "./link-key";

/** 구형 Alertbox HTML: "payload": "abc123" */
const LEGACY_PAYLOAD_RE = /"payload"\s*:\s*"([a-zA-Z0-9]+)"/;
/** 신형(2024~): window.payload = JSON.parse("{\\u0022payload\\u0022:\\u0022eyJ...\\u0022}") */
const UNICODE_JSON_PAYLOAD_RE = /payload\\u0022:\\u0022(eyJ[A-Za-z0-9+/=]+)/;
const BASE64_PAYLOAD_RE = /(eyJ[A-Za-z0-9+/=]{20,})/;

export function extractToonationWsPayloadFromHtml(html: string): string | null {
  const legacy = html.match(LEGACY_PAYLOAD_RE);
  if (legacy?.[1]) return legacy[1];

  const unicodeJson = html.match(UNICODE_JSON_PAYLOAD_RE);
  if (unicodeJson?.[1]) return unicodeJson[1];

  const windowPayloadMatch = html.match(/window\.payload\s*=\s*JSON\.parse\("([\s\S]*?)"\)/);
  if (windowPayloadMatch?.[1]) {
    try {
      const innerJson = JSON.parse(
        `"${windowPayloadMatch[1].replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`.replace(/\\\\u/g, "\\u")
      );
      const parsed = JSON.parse(innerJson) as { payload?: unknown };
      const p = String(parsed.payload || "").trim();
      if (p) return p;
    } catch {
      /* fall through */
    }
  }

  const allEyJ = [...html.matchAll(new RegExp(BASE64_PAYLOAD_RE.source, "g"))].map((m) => m[1]);
  for (const token of allEyJ) {
    if (token.includes("auth") || token.length >= 40) return token;
  }
  return allEyJ[0] || null;
}

/** Alertbox HTML에서 ws.toon.at 연결용 payload 추출 */
export async function resolveToonationWsPayload(alertboxUrlOrKey: string): Promise<string> {
  const url = normalizeToonationAlertboxUrl(alertboxUrlOrKey);
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
  const payload = extractToonationWsPayloadFromHtml(html);
  if (!payload) {
    throw new Error("toonation_payload_not_found");
  }
  return payload;
}
