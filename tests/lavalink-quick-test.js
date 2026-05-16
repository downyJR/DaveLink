// Quick Lavalink connection test with short timeout
const { DavelinkManager } = require('../dist/index.js');

const manager = new DavelinkManager({
  nodes: [
    { id: 'trinium', hostname: 'lavalink.triniumhost.com', port: 4333, password: 'free', secure: false, requestTimeout: 8000 },
    { id: 'nexcloud', hostname: 'n3.nexcloud.in', port: 2026, password: 'nexcloud', secure: false, requestTimeout: 8000 },
    { id: 'ajieblogs', hostname: 'lava-v4.ajieblogs.eu.org', port: 443, password: 'https://dsc.gg/ajidevserver', secure: true, requestTimeout: 8000 },
  ],
  debug: true,
});

manager.init('123456789012345678');

manager.on('nodeReady', (node, resumed) => {
  console.log(`[READY] ${node.id} (resumed: ${resumed})`);
});

manager.on('nodeError', (node, error) => {
  console.log(`[ERROR] ${node.id}: ${error?.message || error}`);
});

manager.on('nodeDisconnect', (node, code, reason) => {
  console.log(`[DISCONNECT] ${node.id}: ${code} ${reason}`);
});

manager.on('nodeReconnecting', (node, attempt) => {
  console.log(`[RECONNECTING] ${node.id} attempt ${attempt}`);
});

console.log('Connecting...');
manager.connect();

// Check status after 8 seconds
setTimeout(async () => {
  console.log('\n--- Status after 8s ---');
  for (const node of manager.getNodes()) {
    const conn = node.isConnected();
    const circuit = node.getCircuitBreakerState();
    const sess = node.sessionId;
    const stats = node.stats;
    console.log(`  ${node.id}: connected=${conn}, circuit=${circuit}, session=${sess ? 'yes' : 'no'}, stats=${Object.keys(stats).length > 0 ? 'yes' : 'no'}`);
  }

  const connected = manager.getNodes().filter(n => n.isConnected());
  console.log(`\nTotal connected: ${connected.length}/${manager.getNodes().length}`);

  if (connected.length > 0) {
    // Try a search
    console.log('\n--- Testing search ---');
    try {
      const result = await manager.search('ytsearch:never gonna give you up');
      console.log(`Search result: loadType=${result.loadType}, tracks=${result.data?.length || 0}`);
    } catch (err) {
      console.log(`Search error: ${err.message}`);
    }

    // Try info endpoint
    console.log('\n--- Testing REST info ---');
    for (const node of connected) {
      try {
        const info = await node.getInfo();
        console.log(`  ${node.id}: version=${info.version}, plugins=${info.plugins?.length || 0}`);
      } catch (err) {
        console.log(`  ${node.id}: error - ${err.message}`);
      }
    }
  }

  console.log('\n--- Destroying ---');
  manager.destroy();
  console.log('Done.');
  process.exit(0);
}, 8000);
