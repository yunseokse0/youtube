/**
 * 관리자(/admin) 좌측 메뉴 · 모바일 하단 탭 구성.
 * 대분류(Category) + 소메뉴(SubItem) 계층 구조로 세부 기능에 바로 접근 가능.
 * 개발 계획에 따라 메뉴를 줄이려면 `ADMIN_NAV_HIDDEN_KEYS`에 key를 추가하세요.
 * 메뉴에 없는 섹션은 `ADMIN_NAV_HIDDEN_KEYS`와 동일 기준으로 DOM에서도 렌더링하지 않습니다.
 */

export type AdminNavKey = "dashboard" | "settlement" | "donor" | "overlay" | "goal" | "logs";

export type AdminNavSubItem = {
  /** 소메뉴 고유 키 (사이드바 내 unique) */
  subKey: string;
  /** 소메뉴 표시 라벨 */
  label: string;
  /** 클릭 시 이동할 AdminCollapsibleSection id */
  targetId: string;
};

export type AdminNavItem = {
  key: AdminNavKey;
  label: string;
  /** 대분류 기본 targetId (대분류 헤더 클릭시 이동할 상단 섹션) */
  targetId: string;
  /** 모바일 하단 바에 표시할 때 짧은 라벨. 없으면 데스크톱 사이드바만 */
  mobileShort?: string;
  /** 소메뉴 목록 — 비어있으면 대분류 단독 메뉴로 렌더 */
  subItems?: AdminNavSubItem[];
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  {
    key: "dashboard",
    label: "대시보드",
    targetId: "dashboard-summary",
    mobileShort: "홈",
    subItems: [
      { subKey: "dash-summary", label: "1. 대시보드 요약", targetId: "dashboard-summary" },
    ],
  },
  {
    key: "settlement",
    label: "정산 관리",
    targetId: "settlement-member-board",
    mobileShort: "정산",
    subItems: [
      { subKey: "settle-board", label: "1. 멤버 정산 보드", targetId: "settlement-member-board" },
      { subKey: "settle-positions", label: "2. 직급 관리", targetId: "block-member-positions" },
      { subKey: "settle-sync", label: "3. 후원 동기화 · 시그 대전", targetId: "block-donation-sync-sig-match" },
      { subKey: "settle-meal", label: "4. 식사 대전 관리", targetId: "block-meal-match" },
      { subKey: "settle-timer", label: "5. 타이머 제어", targetId: "timer-control-section" },
      { subKey: "settle-final", label: "6. 방송 종료 정산", targetId: "settlement-finalize" },
    ],
  },
  {
    key: "donor",
    label: "후원자",
    targetId: "donor-management",
    mobileShort: "후원자",
    subItems: [
      { subKey: "donor-sync", label: "1. 계정 연동 · 수동 입력", targetId: "donor-management" },
      { subKey: "donor-formula", label: "2. 기여도 계산식", targetId: "contribution-formula" },
      { subKey: "donor-contrib", label: "3. 기여도 기록부", targetId: "contribution-management" },
      { subKey: "donor-restroom", label: "4. 화장실 기록부", targetId: "restroom-management" },
      { subKey: "donor-territory", label: "5. 영토 기록부 (HS)", targetId: "territory-management" },
      { subKey: "donor-chatcopy", label: "6. 채팅용 복사 & 보안", targetId: "chat-copy-security" },
      { subKey: "donor-list", label: "7. 후원자 리스트", targetId: "donor-list" },
      { subKey: "donor-logs", label: "8. 기여도 로그", targetId: "contribution-logs" },
      { subKey: "donor-cumulative", label: "9. 후원자별 누적 합계", targetId: "donor-cumulative-totals" },
      { subKey: "donor-mission", label: "10. 미션 전광판", targetId: "mission-board" },
    ],
  },
  {
    key: "overlay",
    label: "오버레이 설정",
    targetId: "overlay-settings",
    mobileShort: "설정",
    subItems: [
      { subKey: "ov-manage", label: "1. 오버레이 관리 (다중)", targetId: "overlay-settings" },
      { subKey: "ov-rank", label: "2. 후원 순위 · 글자·색상", targetId: "overlay-settings" },
      { subKey: "ov-rankchange", label: "3. 순위 변동 연출", targetId: "overlay-settings" },
      { subKey: "ov-bg", label: "4. 배경 GIF · 본문 이미지", targetId: "overlay-settings" },
      { subKey: "ov-hs", label: "5. HS 세로(9:16) 오버레이", targetId: "overlay-settings" },
      { subKey: "ov-sig", label: "6. 수동 시그 판매", targetId: "overlay-settings" },
      { subKey: "ov-obs", label: "7. OBS 텍스트 오버레이", targetId: "overlay-settings" },
      { subKey: "ov-goal", label: "8. 후원 목표", targetId: "overlay-goal-shortcut" },
    ],
  },
  {
    key: "goal",
    label: "후원 목표",
    targetId: "overlay-goal-shortcut",
    mobileShort: "목표",
    subItems: [
      { subKey: "goal-direct", label: "1. 후원 목표 (바로가기)", targetId: "overlay-goal-shortcut" },
    ],
  },
  {
    key: "logs",
    label: "로그 / 데이터",
    targetId: "logs-data",
    subItems: [
      { subKey: "logs-data", label: "1. 데이터 관리", targetId: "logs-data" },
    ],
  },
];

/** ✅ 간소화 메뉴: 핵심 4개만 보이고 나머지 고급 기능은 숨김 */
export const ADMIN_NAV_HIDDEN_KEYS: ReadonlySet<AdminNavKey> = new Set([
  // 숨길 메뉴는 여기에
]);

export function getVisibleAdminNavItems(): AdminNavItem[] {
  return ADMIN_NAV_ITEMS.filter((item) => !ADMIN_NAV_HIDDEN_KEYS.has(item.key));
}

export function isAdminNavSectionVisible(key: AdminNavKey): boolean {
  return !ADMIN_NAV_HIDDEN_KEYS.has(key);
}

/**
 * 소메뉴 targetId → 대분류 AdminNavKey 매핑 룩업.
 * 소메뉴 클릭시 어떤 탭(activeNav)을 활성화해야 할지 결정에 사용.
 */
export function resolveNavKeyFromTargetId(targetId: string): AdminNavKey {
  for (const item of ADMIN_NAV_ITEMS) {
    if (item.targetId === targetId) return item.key;
    if (item.subItems?.some((s) => s.targetId === targetId)) return item.key;
  }
  return "dashboard";
}
