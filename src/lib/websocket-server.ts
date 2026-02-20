import { WebSocketServer, WebSocket } from 'ws';
import { AppState } from './state';

export interface WebSocketClient {
  ws: WebSocket;
  id: string;
  type: 'overlay' | 'admin' | 'broadcast';
}

export class OverlayWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: WebSocketClient[] = [];
  private port: number;

  constructor(port = 8080) {
    this.port = port;
  }

  start() {
    if (this.wss) {
      console.log('[WebSocket] Server already running');
      return;
    }

    this.wss = new WebSocketServer({ port: this.port });
    
    this.wss.on('connection', (ws, request) => {
      const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const url = new URL(request.url || '', `http://localhost:${this.port}`);
      const clientType = url.searchParams.get('type') as 'overlay' | 'admin' | 'broadcast' || 'overlay';
      
      const client: WebSocketClient = {
        ws,
        id: clientId,
        type: clientType
      };
      
      this.clients.push(client);
      console.log(`[WebSocket] Client connected: ${clientId} (type: ${clientType})`);
      
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(client, message);
        } catch (error) {
          console.error('[WebSocket] Error parsing message:', error);
        }
      });
      
      ws.on('close', () => {
        this.clients = this.clients.filter(c => c.id !== clientId);
        console.log(`[WebSocket] Client disconnected: ${clientId}`);
      });
      
      ws.on('error', (error) => {
        console.error(`[WebSocket] Client error ${clientId}:`, error);
        this.clients = this.clients.filter(c => c.id !== clientId);
      });

      // Send welcome message
      this.sendToClient(clientId, {
        type: 'connected',
        clientId,
        timestamp: Date.now()
      });
    });

    console.log(`[WebSocket] Server started on port ${this.port}`);
  }

  stop() {
    if (this.wss) {
      this.wss.close();
      this.wss = null;
      this.clients = [];
      console.log('[WebSocket] Server stopped');
    }
  }

  private handleMessage(client: WebSocketClient, message: any) {
    console.log(`[WebSocket] Message from ${client.id}:`, message);
    
    switch (message.type) {
      case 'ping':
        this.sendToClient(client.id, { type: 'pong', timestamp: Date.now() });
        break;
        
      case 'subscribe':
        // Handle subscription to specific updates
        break;
        
      default:
        console.log(`[WebSocket] Unknown message type: ${message.type}`);
    }
  }

  broadcastToOverlays(data: any) {
    const overlayClients = this.clients.filter(c => c.type === 'overlay');
    console.log(`[WebSocket] Broadcasting to ${overlayClients.length} overlay clients`);
    
    overlayClients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(data));
      }
    });
  }

  broadcastToAdmins(data: any) {
    const adminClients = this.clients.filter(c => c.type === 'admin');
    console.log(`[WebSocket] Broadcasting to ${adminClients.length} admin clients`);
    
    adminClients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(data));
      }
    });
  }

  broadcast(data: any) {
    console.log(`[WebSocket] Broadcasting to all ${this.clients.length} clients`);
    
    this.clients.forEach(client => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify(data));
      }
    });
  }

  sendToClient(clientId: string, data: any) {
    const client = this.clients.find(c => c.id === clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(data));
    }
  }

  notifyOverlayUpdate(state: Partial<AppState>) {
    this.broadcastToOverlays({
      type: 'overlay_update',
      timestamp: Date.now(),
      data: state
    });
  }

  getConnectedClients() {
    return {
      total: this.clients.length,
      overlays: this.clients.filter(c => c.type === 'overlay').length,
      admins: this.clients.filter(c => c.type === 'admin').length,
      broadcasts: this.clients.filter(c => c.type === 'broadcast').length
    };
  }
}

// Global instance
let wsServer: OverlayWebSocketServer | null = null;

export function getWebSocketServer(): OverlayWebSocketServer {
  if (!wsServer) {
    wsServer = new OverlayWebSocketServer();
  }
  return wsServer;
}

export function startWebSocketServer() {
  const server = getWebSocketServer();
  server.start();
  return server;
}

export function stopWebSocketServer() {
  if (wsServer) {
    wsServer.stop();
    wsServer = null;
  }
}