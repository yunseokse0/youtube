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

/** UI placeholder·구버전 기본값 — 타 PC에서 이 키로 서버 설정을 덮지 않음 */
export const EXAMPLE_TOONATION_LINK_KEY = "f28dc2204fbaf86fd9df74c12f435c73";

export function isExampleToonationLinkKey(input: string): boolean {
  const key = extractToonationLinkKey(input) || String(input || "").trim();
  return key === EXAMPLE_TOONATION_LINK_KEY;
}

/** localStorage 키 기본명 — 반드시 계정 id를 붙여 사용 */
export const TOONATION_LS_ALERTBOX = "donationAutomation.toonation.alertboxUrl";
export const TOONATION_LS_SOCKET = "donationAutomation.toonation.socketEnabled";
export const TOONATION_LS_OWNER = "donationAutomation.toonation.ownerName";
export const TOONATION_LS_UPDATED_AT = "donationAutomation.toonation.settingsUpdatedAt";

export function toonationSettingStorageKey(base: string, userId: string): string {
  const uid = String(userId || "").trim();
  if (!uid) return base;
  return `${base}:${uid}`;
}

export function readToonationAlertboxFromLocal(userId: string): string {
  if (typeof window === "undefined" || !userId) return "";
  try {
    const scoped = window.localStorage.getItem(toonationSettingStorageKey(TOONATION_LS_ALERTBOX, userId)) || "";
    if (scoped) return isExampleToonationLinkKey(scoped) ? "" : scoped;
    return "";
  } catch {
    return "";
  }
}

export function readToonationSocketEnabledFromLocal(userId: string): boolean {
  if (typeof window === "undefined" || !userId) return false;
  try {
    const v = window.localStorage.getItem(toonationSettingStorageKey(TOONATION_LS_SOCKET, userId));
    if (v == null) return false;
    return v !== "false";
  } catch {
    return false;
  }
}

export function readToonationOwnerFromLocal(userId: string): string {
  if (typeof window === "undefined" || !userId) return "";
  try {
    return window.localStorage.getItem(toonationSettingStorageKey(TOONATION_LS_OWNER, userId)) || "";
  } catch {
    return "";
  }
}

export function readToonationSettingsUpdatedAtFromLocal(userId: string): number {
  if (typeof window === "undefined" || !userId) return 0;
  try {
    const raw = window.localStorage.getItem(toonationSettingStorageKey(TOONATION_LS_UPDATED_AT, userId));
    const n = Number(raw || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * 연동키 변경 직후 서버(Redis) 동기화가 늦거나 실패해도, 더 최신 로컬 설정을 유지.
 */
export function shouldPreferLocalToonationSettingsOverServer(opts: {
  localKey: string;
  serverKey: string;
  localUpdatedAt: number;
  serverUpdatedAt: number;
}): boolean {
  const localKey = String(opts.localKey || "").trim();
  const serverKey = String(opts.serverKey || "").trim();
  if (!localKey || isExampleToonationLinkKey(localKey)) return false;
  if (!serverKey || isExampleToonationLinkKey(serverKey)) return true;
  if (localKey === serverKey) return false;
  const localAt = Number(opts.localUpdatedAt || 0);
  const serverAt = Number(opts.serverUpdatedAt || 0);
  if (localAt > 0 && serverAt > 0) return localAt > serverAt;
  /** 키가 다르면 로컬 편집 우선(서버가 옛 연동키를 들고 있는 경우) */
  return true;
}

export function writeToonationSettingsToLocal(
  userId: string,
  values: { alertboxUrl?: string; socketEnabled?: boolean; ownerName?: string }
): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    let touched = false;
    if (typeof values.socketEnabled === "boolean") {
      window.localStorage.setItem(
        toonationSettingStorageKey(TOONATION_LS_SOCKET, userId),
        String(values.socketEnabled)
      );
      touched = true;
    }
    if (typeof values.alertboxUrl === "string") {
      const key = toonationSettingStorageKey(TOONATION_LS_ALERTBOX, userId);
      if (!values.alertboxUrl || isExampleToonationLinkKey(values.alertboxUrl)) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, values.alertboxUrl);
      }
      touched = true;
    }
    if (typeof values.ownerName === "string") {
      window.localStorage.setItem(
        toonationSettingStorageKey(TOONATION_LS_OWNER, userId),
        values.ownerName
      );
      touched = true;
    }
    if (touched) {
      window.localStorage.setItem(
        toonationSettingStorageKey(TOONATION_LS_UPDATED_AT, userId),
        String(Date.now())
      );
    }
  } catch {
    // noop
  }
}
