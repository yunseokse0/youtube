import type { DonationAlertShowItem } from "./types";

/** 외부 프로젝트는 이 인터페이스만 구현하면 큐·UI에 연결 가능 */
export type DonationAlertSource = {
  /** 알림 수신 구독 — 반환값은 unsubscribe */
  subscribe: (onAlert: (item: DonationAlertShowItem) => void) => () => void;
};

/** 수동 push / 테스트용 */
export function createManualDonationAlertSource(): DonationAlertSource & {
  push: (item: DonationAlertShowItem) => void;
} {
  const listeners = new Set<(item: DonationAlertShowItem) => void>();
  return {
    subscribe(onAlert) {
      listeners.add(onAlert);
      return () => listeners.delete(onAlert);
    },
    push(item) {
      for (const fn of listeners) fn(item);
    },
  };
}

/** 여러 소스(SSE + 폴링 등)를 하나로 합침 */
export function mergeDonationAlertSources(...sources: DonationAlertSource[]): DonationAlertSource {
  return {
    subscribe(onAlert) {
      const unsubs = sources.map((s) => s.subscribe(onAlert));
      return () => unsubs.forEach((u) => u());
    },
  };
}
