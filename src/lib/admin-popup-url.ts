export type AdminPopupPanel = "timer" | "high-society";

const POPUP_FEATURES =
  "menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes";

export function buildAdminTimerPopupUrl(userId?: string | null): string {
  const uid = String(userId || "").trim();
  return uid ? `/admin/timer?u=${encodeURIComponent(uid)}` : "/admin/timer";
}

export function buildAdminHighSocietyPopupUrl(userId?: string | null): string {
  const uid = String(userId || "").trim();
  return uid ? `/admin/high-society?u=${encodeURIComponent(uid)}` : "/admin/high-society";
}

export function openAdminTimerPopup(userId?: string | null): Window | null {
  if (typeof window === "undefined") return null;
  return window.open(
    buildAdminTimerPopupUrl(userId),
    "admin-timer-popup",
    `width=560,height=820,${POPUP_FEATURES}`
  );
}

export function openAdminHighSocietyPopup(userId?: string | null): Window | null {
  if (typeof window === "undefined") return null;
  return window.open(
    buildAdminHighSocietyPopupUrl(userId),
    "admin-high-society-popup",
    `width=760,height=920,${POPUP_FEATURES}`
  );
}
