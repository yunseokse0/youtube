/**
 * 관리자(/admin) 좌측 메뉴 · DIN 허브 스타일 재설계.
 * 원래 6대 탭 (대시보드/정산/후원자/오버레이/목표/시스템) 틀을 유지.
 * 소메뉴는 실제 존재하는 섹션 id에만 1:1 매칭.
 */

export type AdminNavKey =
  | "dashboard"
  | "settlement"
  | "donor"
  | "overlay"
  | "goal"
  | "logs";

export const LEGACY_TO_NEW_KEY: Record<string, AdminNavKey> = {
  "widget-hub": "dashboard",
  "my-account": "settlement",
  "donation-history": "donor",
  "din-overlay": "overlay",
  signature: "overlay",
  goal: "overlay",
  system: "settlement",
  logs: "settlement",
  chat: "donor",
  "donation-alert": "donor",
  "toon-alert": "donor",
  "auto-donation": "donor",
  "ending-credits": "donor",
};

export type AdminNavSubItem = {
  subKey: string;
  label: string;
  targetId: string;
  icon?: string;
  /** 있으면 섹션 스크롤 대신 이 경로로 이동 */
  href?: string;
};

export type AdminNavItem = {
  key: AdminNavKey;
  label: string;
  targetId: string;
  mobileShort?: string;
  icon: string;
  pinnedBottom?: boolean;
  subItems?: AdminNavSubItem[];
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    key: "dashboard",
    icon: "🏠",
    label: "대시보드",
    targetId: "dashboard-summary",
    mobileShort: "대시보드",
    subItems: [
      { subKey: "db-summary", label: "대시보드 요약", targetId: "dashboard-summary", icon: "📈" },
      { subKey: "db-board", label: "멤버 정산 보드", targetId: "settlement-member-board", icon: "📊" },
      { subKey: "db-positions", label: "직급 관리", targetId: "block-member-positions", icon: "🎖️" },
      { subKey: "db-zubzub", label: "대표 시그 줍줍", targetId: "block-zubzub-settings", icon: "🎁" },
      { subKey: "db-ticker", label: "하단 전광판", targetId: "block-ticker-settings", icon: "📢" },
      { subKey: "db-sync", label: "후원 동기화 · 시그 대전", targetId: "block-donation-sync-sig-match", icon: "⚔️" },
      { subKey: "db-meal", label: "식사 대전 관리", targetId: "block-meal-match", icon: "🍚" },
      { subKey: "db-timer", label: "타이머 제어", targetId: "timer-control-section", icon: "⏱️" },
    ],
  },
  {
    key: "overlay",
    icon: "🎨",
    label: "오버레이 스튜디오",
    targetId: "overlay-settings",
    mobileShort: "오버레이",
    subItems: [
      { subKey: "ov-manage", label: "오버레이 프리셋 설정", targetId: "overlay-settings", icon: "🖼️" },
      { subKey: "ov-battle-suite", label: "⚔️ 대전 오버레이 센터", targetId: "overlay-battle-suite", icon: "⚔️" },
      { subKey: "ov-donor-rankings", label: "후원 순위 오버레이", targetId: "donor-rankings-settings", icon: "👑" },
      { subKey: "ov-goal", label: "후원 목표바", targetId: "overlay-goal-shortcut", icon: "🎯" },
      { subKey: "ov-sig-inv", label: "시그 판매 관리", targetId: "sig-sales-inventory", icon: "🛒" },
      { subKey: "ov-sig", label: "수동 시그 판매", targetId: "sig-sales-manual-page", href: "/admin/sig-sales-manual", icon: "🎯" },
    ],
  },
  {
    key: "donor",
    icon: "📋",
    label: "후원 원장 관리",
    targetId: "donor-management",
    mobileShort: "후원자",
    subItems: [
      { subKey: "dr-link", label: "계정 연동 · 수동 입력", targetId: "donor-management", icon: "📥" },
      { subKey: "dr-contrib", label: "기여도 기록부", targetId: "contribution-management", icon: "📓" },
      { subKey: "dr-formula", label: "기여도 계산식", targetId: "contribution-formula", icon: "🧮" },
      { subKey: "dr-restroom", label: "화장실 기록부", targetId: "restroom-management", icon: "🚻" },
      { subKey: "dr-list", label: "후원자 리스트", targetId: "donor-list", icon: "🧾" },
      { subKey: "dr-logs", label: "기여도 로그", targetId: "contribution-logs", icon: "📜" },
      { subKey: "dr-cumulative", label: "후원자별 누적 합계", targetId: "donor-cumulative-totals", icon: "💹" },
      { subKey: "dr-mission", label: "미션 전광판", targetId: "mission-board", icon: "🎪" },
    ],
  },
  {
    key: "settlement",
    icon: "💰",
    label: "정산 및 시스템",
    targetId: "settlement-finalize",
    mobileShort: "정산",
    subItems: [
      { subKey: "st-final", label: "방송 종료 정산", targetId: "settlement-finalize", icon: "🏁" },
      { subKey: "st-logs", label: "시스템 데이터 & 동기화", targetId: "logs-data", icon: "🖥️" },
    ],
  },
];

export const ADMIN_NAV_HIDDEN_KEYS: ReadonlySet<AdminNavKey> = new Set([]);

export function getVisibleAdminNavItems(): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => !ADMIN_NAV_HIDDEN_KEYS.has(item.key));
}

export function isAdminNavSectionVisible(key: AdminNavKey): boolean {
  const resolved: AdminNavKey = LEGACY_TO_NEW_KEY[key] ?? key;
  return !ADMIN_NAV_HIDDEN_KEYS.has(resolved);
}

export function resolveNavKeyFromTargetId(targetId: string): AdminNavKey {
  for (const item of ADMIN_NAV_ITEMS) {
    if (item.targetId === targetId) return item.key;
    if (item.subItems?.some((s) => s.targetId === targetId)) return item.key;
  }
  return "dashboard";
}

export function resolveAdminNavKey(key: AdminNavKey): AdminNavKey {
  return LEGACY_TO_NEW_KEY[key] ?? key;
}
