import { useEffect, useRef, useState } from 'react';
import { createModuleLogger } from './logger';

const logger = createModuleLogger('SSE');

export function useSSEConnection(onMessage: (data: any) => void) {
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryDelayRef = useRef(1000); // ms, exponential backoff
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastWarnAtRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const scheduleReconnect = () => {
      if (reconnectTimerRef.current) return;
      const delay = retryDelayRef.current;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (document.visibilityState === 'hidden') {
          // 대기: 탭 비활성화 시 과도한 재연결 방지
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

      // 가시성 체크: 숨겨진 상태면 잠시 대기
      if (document.visibilityState === 'hidden') {
        scheduleReconnect();
        return;
      }

      const eventSource = new EventSource('/api/events');
      
      eventSource.onopen = () => {
        setConnected(true);
        logger.info('SSE 연결됨');
        retryDelayRef.current = 1000; // 성공 시 지연 초기화
      };

      eventSource.onmessage = (event) => {
        if (event.data === 'ping') return;
        
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (error) {
          logger.error('메시지 파싱 실패', error);
        }
      };

      eventSource.onerror = () => {
        setConnected(false);
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        const now = Date.now();
        if (now - lastWarnAtRef.current > 3000) {
          logger.warn(`SSE 연결 끊김, ${retryDelayRef.current}ms 후 재연결`);
          lastWarnAtRef.current = now;
        }
        // 지수 백오프 (최대 15초)
        retryDelayRef.current = Math.min(retryDelayRef.current * 2, 15000);
        scheduleReconnect();
      };

      eventSourceRef.current = eventSource;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !eventSourceRef.current) {
        // 즉시 재연결
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
  }, [onMessage]);

  return { connected };
}

export async function sendSSEUpdate(data: any) {
  try {
    await fetch('/api/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
    logger.debug('SSE 업데이트 전송 성공', data);
  } catch (error) {
    logger.error('SSE 업데이트 전송 실패', error);
  }
}
