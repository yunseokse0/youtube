/** `/api/donations/toonation/listener` GET status 요약 */
export type ToonationListenerSnapshot = {
  enabled?: boolean;
  connected?: boolean;
  alertboxUrl?: string;
  lastEventAt?: number;
  lastDonationAt?: number;
} | null;

/** 서버 WS 연결됐는데 후원만 안 오는 상태(OBS Alertbox가 후원 JSON을 가져감) */
const STALE_DONATION_WHILE_EVENTS_MS = 90_000;

/**
 * 7/29 방식: 서버 Node WS가 연결·후원 중이면 브라우저 릴레이 WS를 열지 않는다.
 * 서버 미연결·후원 정체 시에만 overlay/관리자 브라우저 릴레이 fallback.
 */
export function shouldRunBrowserToonationRelay(
  status: ToonationListenerSnapshot,
  now = Date.now()
): boolean {
  if (!status) return true;
  if (!status.connected) return true;

  const lastEvent = typeof status.lastEventAt === "number" ? status.lastEventAt : 0;
  const lastDonation = typeof status.lastDonationAt === "number" ? status.lastDonationAt : 0;

  if (lastEvent > 0 && lastDonation === 0 && now - lastEvent < STALE_DONATION_WHILE_EVENTS_MS) {
    return true;
  }
  if (
    lastDonation > 0 &&
    lastEvent > lastDonation &&
    now - lastDonation > STALE_DONATION_WHILE_EVENTS_MS
  ) {
    return true;
  }

  return false;
}

export function shouldPauseServerForBrowserRelayFallback(
  status: ToonationListenerSnapshot,
  now = Date.now()
): boolean {
  if (!status?.connected) return false;
  return shouldRunBrowserToonationRelay(status, now);
}
