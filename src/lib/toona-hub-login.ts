/** DIN 허브 로그인 POST가 시그/기여도 후처리에 막히지 않게 하는 계약값 */

/** youtube `/api/toona/hub` 라우트 maxDuration (초). route.ts 의 `export const maxDuration = 60` 과 같아야 한다. */
export const TOONA_HUB_ROUTE_MAX_DURATION_SEC = 60;

/** 허브 `/api/auth/login` — 실제 거절은 ~50ms, hang 시에만 끊음 */
export const TOONA_HUB_LOGIN_FETCH_MS = 8_000;

/** 허브 youtubegit PATCH */
export const TOONA_HUB_PATCH_FETCH_MS = 8_000;

/** 연동 세션 KV 저장. 로그인 응답을 막지 않도록 상한 */
export const TOONA_HUB_SESSION_WRITE_MS = 8_000;

/** 브라우저가 youtube POST를 기다리는 시간. youtube 큐 지연 + 허브 login+PATCH+세션저장 */
export const TOONA_HUB_CLIENT_CONNECT_TIMEOUT_MS = 45_000;

/** 로그인 응답은 후처리를 기다리지 않음 (시그·기여도는 백그라운드) */
export const TOONA_HUB_POST_LINK_WAIT_MS = 0;

export type ToonaHubDeferredSigImport = {
  ok: false;
  count: 0;
  added: 0;
  updated: 0;
  error: "deferred";
};

export function toonaHubDeferredSigImport(): ToonaHubDeferredSigImport {
  return { ok: false, count: 0, added: 0, updated: 0, error: "deferred" };
}

export function toonaHubLoginSuccessBody<TSession>(session: TSession): {
  ok: true;
  session: TSession;
  logs: [];
  sigImport: ToonaHubDeferredSigImport;
} {
  return {
    ok: true,
    session,
    logs: [],
    sigImport: toonaHubDeferredSigImport(),
  };
}
