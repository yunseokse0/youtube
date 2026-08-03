/** `/api/donations/toonation/listener` GET status 요약 */
export type ToonationListenerSnapshot = {
  enabled?: boolean;
  connected?: boolean;
  alertboxUrl?: string;
  lastEventAt?: number;
  lastDonationAt?: number;
} | null;

/**
 * 7/29 방식: 서버 Node WS가 연결·수집 중이면 브라우저 릴레이 WS를 열지 않는다.
 * 서버 WS가 끊긴 경우에만 overlay/관리자 브라우저 릴레이 fallback.
 *
 * (통합알림창·Alertbox가 후원 JSON을 가져가는 경우 브라우저 fallback+서버 pause는
 *  오히려 수집 0건을 만든다 → 서버 끊김일 때만 fallback)
 */
export function shouldRunBrowserToonationRelay(status: ToonationListenerSnapshot): boolean {
  if (!status) return true;
  return !status.connected;
}
