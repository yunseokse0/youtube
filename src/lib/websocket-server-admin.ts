import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage } from 'http';

export interface WebSocketMessage {
  type: string;
  timestamp: number;
  data?: any;
}

interface WebSocketClient {
  ws: WebSocket;
  id: string;
  type: string;
}

export class OverlayWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: WebSocketClient[] = [];
  private port: number;

  constructor(port: number = 8080) {
    this.port = port;
  }

  start(): void {
    if (this.wss) {
      console.log('[WebSocket] Server already running');
      return;
    }

    this.wss = new WebSocketServer({ port: this.port });
    
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const url = new URL(request.url || '', `http://localhost:${this.port}`);
      const clientType = url.searchParams.get('type') || 'overlay';
      
      const client: WebSocketClient = { ws, id: clientId, type: clientType };
      this.clients.push(client);
      console.log(`[WebSocket] Client connected: ${clientId} (type: ${clientType})`);

      ws.on('close', () => {
        this.clients = this.clients.filter(c => c.id !== clientId);
        console.log(`[WebSocket] Client disconnected: ${clientId}`);
      });

      ws.on('error', (error) => {
        console.error(`[WebSocket] Client error: ${clientId}`, error);
        this.clients = this.clients.filter(c => c.id !== clientId);
      });
    });

    console.log(`[WebSocket] Server started on port ${this.port}`);
  }

  stop(): void {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
      this.clients = [];
      console.log('[WebSocket] Server stopped');
    }
  }

  broadcastToOverlays(message: WebSocketMessage): void {
    const messageStr = JSON.stringify(message);
    this.clients
      .filter(client => client.type === 'overlay')
      .forEach(client => {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(messageStr);
        }
      });
  }

  notifyOverlayUpdate(state: any): void {
    this.broadcastToOverlays({
      type: 'overlay_update',
      timestamp: Date.now(),
      data: state
    });
  }
}

let globalServer: OverlayWebSocketServer | null = null;

export function getWebSocketServer(): OverlayWebSocketServer {
  if (!globalServer) {
    globalServer = new OverlayWebSocketServer();
  }
  return globalServer;
}

export function startWebSocketServer(): OverlayWebSocketServer {
  const server = getWebSocketServer();
  server.start();
  return server;
}

export function stopWebSocketServer(): void {
  if (globalServer) {
    globalServer.stop();
    globalServer = null;
  }
}