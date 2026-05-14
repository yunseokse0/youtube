import { NextRequest } from 'next/server';
import { createModuleLogger } from '@/lib/logger';

/** Edge는 장시간 SSE·인메모리 클라이언트 목록에 부적합한 환경이 많음(Render 등) → Node 런타임 유지 */

const logger = createModuleLogger('API/Events');

/** DevTools EventStream·서버 로그 부담을 줄이기 위해 ping은 길게 유지(프록시 idle 타임아웃보다 짧지 않게 환경에 맞게 조정) */
const SSE_PING_MS = 60_000;

let clients: ReadableStreamDefaultController[] = [];

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      clients.push(controller);

      // 연결 직후 재시도 지시 및 초기 keepalive 전송
      try {
        controller.enqueue(`retry: 5000\n\n`);
        controller.enqueue(`event: hello\ndata: "ok"\n\n`);
      } catch {}

      const interval = setInterval(() => {
        try {
          controller.enqueue(`data: ping\n\n`);
        } catch {
          clearInterval(interval);
          clients = clients.filter(c => c !== controller);
        }
      }, SSE_PING_MS);

      // 연결 종료 시 정리
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clients = clients.filter(c => c !== controller);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const maxBytes = 512_000;
    const cl = request.headers.get("content-length");
    if (cl && Number(cl) > maxBytes) {
      return new Response("Payload too large", { status: 413 });
    }
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
  } catch (error) {
    logger.error('이벤트 처리 실패', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}
