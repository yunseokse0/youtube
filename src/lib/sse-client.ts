import { useEffect, useRef, useState } from 'react';
import { createModuleLogger } from './logger';

const logger = createModuleLogger('SSE');

export function useSSEConnection(onMessage: (data: any) => void) {
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const connect = () => {
      const eventSource = new EventSource('/api/events');
      
      eventSource.onopen = () => {
        setConnected(true);
        logger.info('SSE 연결됨');
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
        
        logger.warn('SSE 연결 끊김, 1초 후 재연결');
        
        // 1초 후 재연결 (더 빠른 실시간 반영)
        setTimeout(() => {
          if (eventSourceRef.current === null) {
            connect();
          }
        }, 1000);
      };

      eventSourceRef.current = eventSource;
    };

    connect();

    return () => {
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