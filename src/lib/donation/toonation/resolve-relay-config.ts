import { extractToonationLinkKey, normalizeToonationAlertboxUrl } from "./link-key";
import { readToonationListenerConfig } from "./listener-config-store";

export type ToonationRelayConfigResolved = {
  enabled: boolean;
  userId: string;
  linkKey?: string;
  ownerName?: string;
  /** 서버 Node WS 리스너 ON 여부(오버레이 브라우저 릴레이와 별개) */
  serverListenerEnabled?: boolean;
};

function envLinkKeyForUser(userId: string): string | null {
  const safe = String(userId || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
  const perUser =
    (safe ? process.env[`TOONATION_LINK_KEY_${safe}`] : "") ||
    (safe ? process.env[`NEXT_PUBLIC_TOONATION_LINK_KEY_${safe}`] : "");
  const generic =
    process.env.TOONATION_LINK_KEY ||
    process.env.NEXT_PUBLIC_TOONATION_LINK_KEY ||
    "";
  const urlRaw =
    process.env.TOONATION_ALERTBOX_URL ||
    process.env.NEXT_PUBLIC_TOONATION_ALERTBOX_URL ||
    "";
  const fromUrl = urlRaw ? extractToonationLinkKey(urlRaw) || normalizeToonationAlertboxUrl(urlRaw) : null;
  const pick = String(perUser || generic || fromUrl || "").trim();
  return pick ? extractToonationLinkKey(pick) || pick : null;
}

function envOwnerForUser(userId: string): string {
  const safe = String(userId || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
  return String(
    (safe ? process.env[`TOONATION_OWNER_NAME_${safe}`] : "") ||
      process.env.TOONATION_OWNER_NAME ||
      process.env.NEXT_PUBLIC_TOONATION_OWNER_NAME ||
      ""
  ).trim();
}

/** OBS 엑셀표·관리자 릴레이 — Redis 연동키 우선, env fallback. `enabled`(서버 WS)와 분리 */
export async function resolveToonationRelayConfigForUser(
  userId: string
): Promise<ToonationRelayConfigResolved> {
  const uid = String(userId || "").trim();
  if (!uid) return { enabled: false, userId: "" };

  const cfg = await readToonationListenerConfig(uid);
  if (cfg?.alertboxUrl) {
    const linkKey = extractToonationLinkKey(cfg.alertboxUrl) || cfg.alertboxUrl;
    return {
      enabled: true,
      userId: uid,
      linkKey,
      ownerName: String(cfg.ownerName || envOwnerForUser(uid) || "").trim(),
      serverListenerEnabled: cfg.enabled,
    };
  }

  const linkKey = envLinkKeyForUser(uid);
  if (linkKey) {
    return {
      enabled: true,
      userId: uid,
      linkKey,
      ownerName: envOwnerForUser(uid),
      serverListenerEnabled: false,
    };
  }

  return { enabled: false, userId: uid };
}
