const { startWebSocketServer } = require('./src/lib/websocket-server.js');

console.log('Starting WebSocket server...');
startWebSocketServer();

// Keep the process alive
process.on('SIGINT', () => {
  console.log('\nShutting down WebSocket server...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down WebSocket server...');
  process.exit(0);
});

console.log('WebSocket server is running on port 8080');