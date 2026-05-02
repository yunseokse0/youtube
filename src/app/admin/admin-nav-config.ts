/**
 * 관리자(/admin) 좌측 메뉴 · 모바일 하단 탭 구성.
 * 개발 계획에 따라 메뉴를 줄이려면 `ADMIN_NAV_HIDDEN_KEYS`에 key를 추가하세요.
 * 메뉴에 없는 섹션은 `ADMIN_NAV_HIDDEN_KEYS`와 동일 기준으로 DOM에서도 렌더링하지 않습니다.
 */

export type AdminNavKey = "dashboard" | "settlement" | "donor" | "overlay" | "goal" | "logs";

export type AdminNavItem = {
  key: AdminNavKey;
  label: string;
  targetId: string;
  /** 모바일 하단 바에 표시할 때 짧은 라벨. 없으면 데스크톱 사이드바만 */
  mobileShort?: string;
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { key: "dashboard", label: "대시보드", targetId: "dashboard-summary", mobileShort: "홈" },
  { key: "settlement", label: "정산 관리", targetId: "settlement-member-board", mobileShort: "정산" },
  { key: "donor", label: "후원자", targetId: "donor-management", mobileShort: "후원자" },
  { key: "overlay", label: "오버레이 설정", targetId: "overlay-settings", mobileShort: "설정" },
  { key: "goal", label: "후원 목표", targetId: "overlay-goal-shortcut", mobileShort: "목표" },
  { key: "logs", label: "로그 / 데이터", targetId: "logs-data" },
];

/** 여기에 넣은 메뉴는 사이드바·모바일 탭에서 제외 (전부 숨기지 마세요 — 빈 네비가 됩니다) */
export const ADMIN_NAV_HIDDEN_KEYS: ReadonlySet<AdminNavKey> = new Set([
  // 예: "goal", "logs"
]);

export function getVisibleAdminNavItems(): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => !ADMIN_NAV_HIDDEN_KEYS.has(item.key));
}

export function isAdminNavSectionVisible(key: AdminNavKey): boolean {
  return !ADMIN_NAV_HIDDEN_KEYS.has(key);
}
