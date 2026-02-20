const { WebSocketServer } = require('ws');

class OverlayWebSocketServer {
  constructor(port = 8080) {
    this.wss = null;
    this.clients = [];
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
      const clientType = url.searchParams.get('type') || 'overlay';
      
      const client = {
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

  handleMessage(client, message) {
    console.log(`[WebSocket] Message from ${client.id}:`, message);
    
    switch (message.type) {
      case 'ping':
        this.sendToClient(client.id, { type: 'pong', timestamp: Date.now() });
        break;
        
      default:
        console.log(`[WebSocket] Unknown message type: ${message.type}`);
    }
  }

  broadcastToOverlays(data) {
    const overlayClients = this.clients.filter(c => c.type === 'overlay');
    console.log(`[WebSocket] Broadcasting to ${overlayClients.length} overlay clients`);
    
    overlayClients.forEach(client => {
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(JSON.stringify(data));
      }
    });
  }

  broadcastToAdmins(data) {
    const adminClients = this.clients.filter(c => c.type === 'admin');
    console.log(`[WebSocket] Broadcasting to ${adminClients.length} admin clients`);
    
    adminClients.forEach(client => {
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(JSON.stringify(data));
      }
    });
  }

  broadcast(data) {
    console.log(`[WebSocket] Broadcasting to all ${this.clients.length} clients`);
    
    this.clients.forEach(client => {
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(JSON.stringify(data));
      }
    });
  }

  sendToClient(clientId, data) {
    const client = this.clients.find(c => c.id === clientId);
    if (client && client.ws.readyState === 1) { // WebSocket.OPEN
      client.ws.send(JSON.stringify(data));
    }
  }

  notifyOverlayUpdate(state) {
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
let wsServer = null;

function getWebSocketServer() {
  if (!wsServer) {
    wsServer = new OverlayWebSocketServer();
  }
  return wsServer;
}

function startWebSocketServer() {
  const server = getWebSocketServer();
  server.start();
  return server;
}

function stopWebSocketServer() {
  if (wsServer) {
    wsServer.stop();
    wsServer = null;
  }
}

module.exports = {
  OverlayWebSocketServer,
  getWebSocketServer,
  startWebSocketServer,
  stopWebSocketServer
};