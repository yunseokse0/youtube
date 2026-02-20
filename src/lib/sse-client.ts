import { useEffect, useRef, useState } from 'react';

export function useSSEConnection(onMessage: (data: any) => void) {
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const connect = () => {
      const eventSource = new EventSource('/api/events');
      
      eventSource.onopen = () => {
        setConnected(true);
        console.log('[SSE] Connected');
      };

      eventSource.onmessage = (event) => {
        if (event.data === 'ping') return;
        
        try {
          const data = JSON.parse(event.data);
          onMessage(data);
        } catch (error) {
          console.error('[SSE] Failed to parse message:', error);
        }
      };

      eventSource.onerror = () => {
        setConnected(false);
        eventSourceRef.current?.close();
        eventSourceRef.current = null;
        
        // 5초 후 재연결
        setTimeout(() => {
          if (eventSourceRef.current === null) {
            connect();
          }
        }, 5000);
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
  } catch (error) {
    console.error('[SSE] Failed to send update:', error);
  }
}