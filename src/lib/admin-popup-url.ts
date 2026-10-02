export type AdminPopupPanel = "timer" | "donors" | "high-society";

const POPUP_FEATURES =
  "menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes";

export function buildAdminTimerPopupUrl(userId?: string | null): string {
  const uid = String(userId || "").trim();
  return uid ? `/admin/timer?u=${encodeURIComponent(uid)}` : "/admin/timer";
}

export function buildAdminDonorListPopupUrl(userId?: string | null): string {
  const uid = String(userId || "").trim();
  return uid ? `/admin/donors?u=${encodeURIComponent(uid)}` : "/admin/donors";
}

export function openAdminTimerPopup(userId?: string | null): Window | null {
  if (typeof window === "undefined") return null;
  return window.open(
    buildAdminTimerPopupUrl(userId),
    "admin-timer-popup",
    `width=560,height=820,${POPUP_FEATURES}`
  );
}

export function buildAdminHighSocietyPopupUrl(userId?: string | null): string {
  const uid = String(userId || "").trim() || "finalent";
  return `/admin.html?u=${encodeURIComponent(uid)}`;
}

export function openAdminHighSocietyPopup(userId?: string | null): Window | null {
  if (typeof window === "undefined") return null;
  const url = buildAdminHighSocietyPopupUrl(userId);
  const win =
    window.open(
      url,
      "admin-high-society-popup",
      `width=1180,height=920,${POPUP_FEATURES}`
    ) ||
    window.open(url, "admin-high-society-popup") ||
    window.open(url, "_blank");
  try {
    win?.focus();
  } catch (_noop) {
    /* noop */
  }
  return win;
}

export function openAdminDonorListPopup(userId?: string | null): Window | null {
  if (typeof window === "undefined") return null;
  const url = buildAdminDonorListPopupUrl(userId);
  const availW = Number(window.screen?.availWidth) || 1440;
  const availH = Number(window.screen?.availHeight) || 920;
  const width = Math.max(1280, Math.min(availW - 16, 1920));
  const height = Math.max(820, Math.min(availH - 40, 1200));
  const win =
    window.open(url, "admin-donors-popup", `width=${width},height=${height},${POPUP_FEATURES}`) ||
    window.open(url, "admin-donors-popup") ||
    window.open(url, "_blank");
  try {
    win?.focus();
  } catch (_noop) {
    /* noop */
  }
  return win;
}
