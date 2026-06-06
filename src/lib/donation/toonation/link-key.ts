export const TOONATION_ALERTBOX_BASE_URL = "https://toon.at/widget/alertbox";

/** 계정설정 연동키·Alertbox URL·경로 조각 → 표준 Alertbox URL */
export function normalizeToonationAlertboxUrl(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const key = u.pathname.split("/").filter(Boolean).pop();
      if (u.hostname.includes("toon.at") && key && isToonationLinkKey(key)) {
        return `${TOONATION_ALERTBOX_BASE_URL}/${key}`;
      }
    } catch {
      return null;
    }
    return null;
  }

  const pathMatch = raw.match(/(?:^|\/)widget\/alertbox\/([a-zA-Z0-9_-]+)/i);
  if (pathMatch?.[1]) {
    return `${TOONATION_ALERTBOX_BASE_URL}/${pathMatch[1]}`;
  }

  if (isToonationLinkKey(raw)) {
    return `${TOONATION_ALERTBOX_BASE_URL}/${raw}`;
  }

  return null;
}

export function isToonationLinkKey(value: string): boolean {
  const v = String(value || "").trim();
  if (!v || v.includes("/") || v.includes(".")) return false;
  return /^[a-zA-Z0-9_-]{6,64}$/.test(v);
}

export function extractToonationLinkKey(input: string): string | null {
  const url = normalizeToonationAlertboxUrl(input);
  if (!url) return null;
  return url.split("/").filter(Boolean).pop() || null;
}
