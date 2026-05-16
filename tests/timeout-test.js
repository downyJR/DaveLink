// Quick timeout test
const { WebSocketClient } = require('../dist/ws/WebSocketClient.js');

console.log('Creating WS client for unreachable host...');
const ws = new WebSocketClient({
  hostname: '192.0.2.1', // TEST-NET-1, should be unreachable
  port: 9999,
  retryDelay: 1000,
  maxReconnectDelay: 3000,
  maxRetryAttempts: 2,
  requestTimeout: 3000,
});

ws.on('error', (err) => {
  console.log('Error event:', err.message || err);
});

ws.on('reconnecting', (attempt) => {
  console.log('Reconnecting attempt:', attempt);
});

ws.on('close', (code, reason) => {
  console.log('Close:', code, reason);
});

console.log('Connecting...');
const start = Date.now();
ws.connect('123');

// Force exit after 15 seconds no matter what
setTimeout(() => {
  console.log(`Test timed out after ${Date.now() - start}ms`);
  ws.destroy();
  process.exit(0);
}, 15000);
