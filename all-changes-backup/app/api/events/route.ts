import { NextRequest } from 'next/server';
import { createModuleLogger } from '@/lib/logger';

export const runtime = 'edge';

const logger = createModuleLogger('API/Events');

let clients: ReadableStreamDefaultController[] = [];

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      clients.push(controller);
      logger.debug('새로운 SSE 클라이언트 연결', { totalClients: clients.length });
      
      // 연결 유지를 위한 ping (더 자주 연결 상태 확인)
      const interval = setInterval(() => {
        try {
          controller.enqueue(`data: ping\n\n`);
          logger.debug('SSE ping 전송');
        } catch {
          clearInterval(interval);
          clients = clients.filter(c => c !== controller);
          logger.debug('연결 끊긴 클라이언트 제거', { totalClients: clients.length });
        }
      }, 10000); // 30초 → 10초로 단축

      // 연결 종료 시 정리
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clients = clients.filter(c => c !== controller);
        logger.debug('클라이언트 연결 종료', { totalClients: clients.length });
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const data = await request.json();
    logger.debug('이벤트 데이터 수신', { dataType: typeof data, hasData: !!data });
    
    // 모든 클라이언트에게 데이터 전송
    clients.forEach(controller => {
      try {
        controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        // 연결 끊긴 클라이언트 제거
        clients = clients.filter(c => c !== controller);
      }
    });

    logger.debug('이벤트 브로드캐스트 완료', { totalClients: clients.length });
    return new Response('OK', { status: 200 });
  } catch (error) {
    logger.error('이벤트 처리 실패', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}