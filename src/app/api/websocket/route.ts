import { NextRequest, NextResponse } from 'next/server';
import { getWebSocketServer, startWebSocketServer, stopWebSocketServer } from '@/lib/websocket-server';
import { createModuleLogger } from '@/lib/logger';

const logger = createModuleLogger('API/WebSocket');

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    const wsServer = getWebSocketServer();
    
    switch (action) {
      case 'start':
        wsServer.start();
        const startClients = wsServer.getConnectedClients();
        logger.info('WebSocket 서버 시작', { clients: startClients });
        return NextResponse.json({ 
          success: true, 
          message: 'WebSocket server started',
          clients: startClients
        });
        
      case 'stop':
        stopWebSocketServer();
        logger.info('WebSocket 서버 중지');
        return NextResponse.json({ 
          success: true, 
          message: 'WebSocket server stopped' 
        });
        
      case 'status':
        const statusClients = wsServer.getConnectedClients();
        logger.debug('WebSocket 상태 조회', { clients: statusClients });
        return NextResponse.json({
          success: true,
          running: true,
          clients: statusClients
        });
        
      default:
        const defaultClients = wsServer.getConnectedClients();
        logger.debug('WebSocket 기본 상태', { clients: defaultClients });
        return NextResponse.json({
          success: true,
          running: true,
          clients: defaultClients
        });
    }
  } catch (error) {
    logger.error('WebSocket API 오류', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}