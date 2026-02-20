import { NextRequest, NextResponse } from 'next/server';
import { getWebSocketServer, startWebSocketServer, stopWebSocketServer } from '@/lib/websocket-server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    const wsServer = getWebSocketServer();
    
    switch (action) {
      case 'start':
        wsServer.start();
        return NextResponse.json({ 
          success: true, 
          message: 'WebSocket server started',
          clients: wsServer.getConnectedClients()
        });
        
      case 'stop':
        stopWebSocketServer();
        return NextResponse.json({ 
          success: true, 
          message: 'WebSocket server stopped' 
        });
        
      case 'status':
        return NextResponse.json({
          success: true,
          running: true,
          clients: wsServer.getConnectedClients()
        });
        
      default:
        return NextResponse.json({
          success: true,
          running: true,
          clients: wsServer.getConnectedClients()
        });
    }
  } catch (error) {
    console.error('WebSocket API error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}