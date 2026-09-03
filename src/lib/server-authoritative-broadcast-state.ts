import type { AppState } from "@/types";

const sessionByUser = new Map<string, AppState>();

function cacheKey(userId?: string | null): string {
  return String(userId || "").trim() || "__default__";
}

/** 방송 AppState 정본은 서버(MySQL)만 — localStorage·세션은 정본이 아님.
 *  관리자(/admin) React state는 서버 스냅샷의 화면 캐시일 뿐, 「브라우저 저장본」이 아니다.
 *  툴·API가 DB를 바꾸면 Node 메모리·SSE로 UI가 따라온다. UI가 DB를 옛 스냅샷으로 되돌리면 안 됨.
 *  후원 변경은 `/api/donations/*` 등 서버 파이프라인만; 테마·오버레이 등은 omitDonationFields PATCH.
 *  세션 Map은 같은 탭 즉시 미리보기용이며 디스크·다른 PC와 공유되지 않는다. */
export function isServerAuthoritativeBroadcastState(): boolean {
  return true;
}

/** 브라우저가 POST /api/state 로 보낼 수 있는 옵션 (saveStateAsync·persistState 공통) */
export type BrowserPersistOptionsInput = {
  donorsAuthoritative?: boolean;
  donorsReplace?: boolean;
  settlementReset?: boolean;
  omitDonationFields?: boolean;
  membersAuthoritative?: boolean;
  omitHighSocietyFields?: boolean;
  clearSigSoldOutStamp?: boolean;
  /** 시그 목록 「전체 지우기」·기본 초기화 — 서버 축소 차단·백업 복구를 건너뜀 */
  clearSigInventory?: boolean;
  highSocietySettingsOnly?: boolean;
};

/**
 * 서버 정본 모드: 브라우저 React/세션 스냅샷으로 후원·금액을 DB에 쓰지 않게 옵션을 제한한다.
 * 정산 리셋(settlementReset)만 donorsAuthoritative 허용. 후원 편집은 persistDonationStateViaApi 경유.
 */
export function clampBrowserPersistOptionsForServerAuthority(
  opts?: BrowserPersistOptionsInput
): BrowserPersistOptionsInput | undefined {
  if (!isServerAuthoritativeBroadcastState()) return opts;
  if (opts?.settlementReset === true) {
    return {
      ...opts,
      settlementReset: true,
      donorsAuthoritative: true,
    };
  }
  const { donorsAuthoritative: _da, donorsReplace: _dr, ...rest } = opts ?? {};
  return {
    ...rest,
    omitDonationFields: true,
  };
}

export function readSessionBroadcastState(userId?: string | null): AppState | null {
  if (typeof window === "undefined") return null;
  return sessionByUser.get(cacheKey(userId)) ?? null;
}

export function writeSessionBroadcastState(state: AppState, userId?: string | null): void {
  if (typeof window === "undefined") return;
  sessionByUser.set(cacheKey(userId), state);
}

export function clearSessionBroadcastState(userId?: string | null): void {
  if (typeof window === "undefined") return;
  sessionByUser.delete(cacheKey(userId));
}
