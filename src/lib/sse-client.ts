import { useEffect, useRef, useState } from 'react';
import { createModuleLogger } from './logger';
import { shouldSuppressOverlaySseConnection } from './overlay-params';
import { sendSSEUpdate as postSseUpdate } from './sse-post';

const logger = createModuleLogger('SSE');

/** OBS Browser Source는 `visibilityState=hidden` 인 경우가 많아, 오버레이는 숨김 탭에서도 SSE를 연다 */
function shouldConnectSseDespiteHiddenTab(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname || "";
  return p.startsWith("/overlay");
}

export function useSSEConnection(onMessage: (data: any) => void, enabled = true) {
  const [connected, setConnected] = useState(false);
  /** 콜백이 매 렌더마다 바뀌어도 effect를 다시 돌리지 않음 → EventSource 무한 끊김·재연결 폭주 방지 */
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryDelayRef = useRef(1000); // ms, exponential backoff
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWarnAtRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!enabled) return () => {};
    /** 관리자 미리보기 iframe 등: SSE가 메인 탭과 겹쳐 `/api/events`·연쇄 GET 폭주 */
    if (shouldSuppressOverlaySseConnection()) {
      return () => {};
    }

    const scheduleReconnect = () => {
      if (reconnectTimerRef.current) return;
      const jitter = Math.floor(Math.random() * 400);
      const delay = retryDelayRef.current + jitter;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
      if (document.visibilityState === "hidden" && !shouldConnectSseDespiteHiddenTab()) {
        scheduleReconnect();
        return;
      }
      connect();
      }, delay);
    };

    const connect = () => {
      // 기존 연결 정리
      eventSourceRef.current?.close();
      eventSourceRef.current = null;

      if (document.visibilityState === "hidden" && !shouldConnectSseDespiteHiddenTab()) {
        scheduleReconnect();
        return;
      }

      const eventSource = new EventSource("/api/events");

      eventSource.onopen = () => {
        setConnected(true);
        logger.debug('SSE 연결됨');
        retryDelayRef.current = 1000; // 성공 시 지연 초기화
      };

      eventSource.onmessage = (event) => {
        if (event.data === 'ping') return;

        try {
          const data = JSON.parse(event.data);
          onMessageRef.current(data);
        } catch (error) {
          logger.error('메시지 파싱 실패', error);
        }
      };

      eventSource.onerror = () => {
        setConnected(false);
        if (eventSource.readyState !== EventSource.CLOSED) {
          eventSource.close();
        }
        if (eventSourceRef.current === eventSource) {
          eventSourceRef.current = null;
        }
        const now = Date.now();
        if (now - lastWarnAtRef.current > 3000) {
          logger.warn(`SSE 연결 끊김, ${retryDelayRef.current}ms 후 재연결`);
          lastWarnAtRef.current = now;
        }
        // 지수 백오프 (최대 30초)
        retryDelayRef.current = Math.min(retryDelayRef.current * 2, 30000);
        scheduleReconnect();
      };

      eventSourceRef.current = eventSource;
    };

    const onVisibility = () => {
      const es = eventSourceRef.current;
      const busy =
        es &&
        (es.readyState === EventSource.OPEN || es.readyState === EventSource.CONNECTING);
      if (document.visibilityState === 'visible' && !busy) {
        retryDelayRef.current = 1000;
        connect();
      }
    };

    connect();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', onVisibility);
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [enabled]);

  return { connected };
}

export async function sendSSEUpdate(data: any) {
  try {
    await postSseUpdate(data);
    logger.debug('SSE 업데이트 전송 성공', data);
  } catch (error) {
    logger.error('SSE 업데이트 전송 실패', error);
  }
}
