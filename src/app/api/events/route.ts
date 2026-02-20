import { NextRequest } from 'next/server';

export const runtime = 'edge';

let clients: ReadableStreamDefaultController[] = [];

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      clients.push(controller);
      
      // 연결 유지를 위한 ping
      const interval = setInterval(() => {
        try {
          controller.enqueue(`data: ping\n\n`);
        } catch {
          clearInterval(interval);
          clients = clients.filter(c => c !== controller);
        }
      }, 30000);

      // 연결 종료 시 정리
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clients = clients.filter(c => c !== controller);
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
  const data = await request.json();
  
  // 모든 클라이언트에게 데이터 전송
  clients.forEach(controller => {
    try {
      controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
    } catch {
      // 연결 끊긴 클라이언트 제거
      clients = clients.filter(c => c !== controller);
    }
  });

  return new Response('OK', { status: 200 });
}