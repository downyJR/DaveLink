// ============================================================================
// Davelink - Real Lavalink Node Connection Test
// Tests: Connection, REST API, Search, Stats
// Nodes: 3 public Lavalink servers
// ============================================================================

const { DavelinkManager } = require('../dist/index.js');

const NODES = [
  {
    id: 'trinium',
    hostname: 'lavalink.triniumhost.com',
    port: 4333,
    password: 'free',
    secure: false,
    requestTimeout: 15000,
  },
  {
    id: 'nexcloud',
    hostname: 'n3.nexcloud.in',
    port: 2026,
    password: 'nexcloud',
    secure: false,
    requestTimeout: 15000,
  },
  {
    id: 'ajieblogs',
    hostname: 'lava-v4.ajieblogs.eu.org',
    port: 443,
    password: 'https://dsc.gg/ajidevserver',
    secure: true,
    requestTimeout: 15000,
  },
];

const TEST_USER_ID = '123456789012345678';

let passCount = 0;
let failCount = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passCount++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failCount++;
    failures.push({ name, error: err.message });
    console.log(`  \u2717 ${name}`);
    console.log(`    \u2192 ${err.message}`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  Davelink Real Lavalink Node Integration Test');
console.log('═══════════════════════════════════════════════════════════════\n');

async function runTests() {
  // Create manager
  const manager = new DavelinkManager({
    nodes: NODES,
    debug: true,
  });

  manager.init(TEST_USER_ID);

  // Track events
  const events = {
    nodeReady: [],
    nodeError: [],
    nodeDisconnect: [],
    nodeReconnecting: [],
  };

  manager.on('nodeReady', (node, resumed) => {
    events.nodeReady.push({ nodeId: node.id, resumed });
    console.log(`  [EVENT] Node ready: ${node.id} (resumed: ${resumed})`);
  });

  manager.on('nodeError', (node, error) => {
    events.nodeError.push({ nodeId: node.id, error: error?.message || String(error) });
    console.log(`  [EVENT] Node error: ${node.id} - ${error?.message || error}`);
  });

  manager.on('nodeDisconnect', (node, code, reason) => {
    events.nodeDisconnect.push({ nodeId: node.id, code, reason });
    console.log(`  [EVENT] Node disconnect: ${node.id} - ${code} ${reason}`);
  });

  manager.on('nodeReconnecting', (node, attempt) => {
    events.nodeReconnecting.push({ nodeId: node.id, attempt });
    console.log(`  [EVENT] Node reconnecting: ${node.id} (attempt ${attempt})`);
  });

  // Wait a moment then connect
  console.log('Connecting to nodes...\n');
  manager.connect();

  // Wait for connections (up to 15 seconds)
  await new Promise(r => setTimeout(r, 12000));

  console.log('\n--- Connection Results ---');

  for (const node of manager.getNodes()) {
    const connected = node.isConnected();
    const circuitState = node.getCircuitBreakerState();
    console.log(`  Node ${node.id}: connected=${connected}, circuit=${circuitState}`);
  }

  // Tests
  console.log('\n--- Tests ---');

  await test('At least one node connected', () => {
    const connected = manager.getNodes().filter(n => n.isConnected());
    if (connected.length === 0) {
      throw new Error('No nodes connected');
    }
  });

  await test('Node IDs are correct', () => {
    const ids = manager.getNodes().map(n => n.id);
    if (!ids.includes('trinium') && !ids.includes('nexcloud') && !ids.includes('ajieblogs')) {
      throw new Error('Expected node IDs not found');
    }
  });

  await test('Node stats retrieved after connection', () => {
    for (const node of manager.getNodes()) {
      if (node.isConnected() && Object.keys(node.stats).length === 0) {
        throw new Error(`Node ${node.id} connected but no stats received`);
      }
    }
  });

  await test('getNodeStats returns data', () => {
    const stats = manager.getNodeStats();
    if (!Array.isArray(stats) || stats.length === 0) {
      throw new Error('getNodeStats should return array');
    }
  });

  await test('getMetrics returns data', () => {
    const metrics = manager.getMetrics();
    if (typeof metrics.nodeCount !== 'number') {
      throw new Error('getMetrics should return nodeCount');
    }
  });

  await test('Manager debug info is valid', () => {
    const info = manager.getDebugInfo();
    if (info.version !== '4.1.0') {
      throw new Error(`Expected version 4.1.0, got ${info.version}`);
    }
  });

  // Test REST API - loadtracks
  await test('REST: loadtracks endpoint (search)', async () => {
    let searchSuccess = false;
    for (const node of manager.getNodes()) {
      if (!node.isConnected()) continue;
      try {
        const result = await node.loadTracks('ytsearch:never gonna give you up');
        if (result && typeof result === 'object') {
          searchSuccess = true;
          console.log(`    Node ${node.id} search result: loadType=${result.loadType || 'unknown'}`);
          break;
        }
      } catch (err) {
        console.log(`    Node ${node.id} search failed: ${err.message}`);
      }
    }
    if (!searchSuccess) {
      throw new Error('Search failed on all connected nodes');
    }
  });

  // Test REST API - info endpoint
  await test('REST: info endpoint', async () => {
    let infoSuccess = false;
    for (const node of manager.getNodes()) {
      if (!node.isConnected()) continue;
      try {
        const info = await node.getInfo();
        if (info && typeof info === 'object') {
          infoSuccess = true;
          console.log(`    Node ${node.id} info: version=${info.version || 'unknown'}, build=${info.buildTime || 'unknown'}`);
          break;
        }
      } catch (err) {
        console.log(`    Node ${node.id} info failed: ${err.message}`);
      }
    }
    if (!infoSuccess) {
      throw new Error('Info endpoint failed on all connected nodes');
    }
  });

  // Test REST API - routeplanner
  await test('REST: routeplanner status', async () => {
    let rpSuccess = false;
    for (const node of manager.getNodes()) {
      if (!node.isConnected()) continue;
      try {
        const rp = await node.getRoutePlannerStatus();
        rpSuccess = true;
        console.log(`    Node ${node.id} routeplanner: class=${rp?.class || 'none'}`);
        break;
      } catch (err) {
        // 404 is expected if no routeplanner configured
        if (err.message?.includes('404') || err.context?.statusCode === 404) {
          rpSuccess = true;
          console.log(`    Node ${node.id}: no routeplanner (expected)`);
          break;
        }
        console.log(`    Node ${node.id} routeplanner failed: ${err.message}`);
      }
    }
    if (!rpSuccess) {
      throw new Error('RoutePlanner failed on all nodes');
    }
  });

  // Test manager.search()
  await test('Manager search method', async () => {
    const result = await manager.search('never gonna give you up', 'ytsearch');
    if (!result || typeof result !== 'object') {
      throw new Error('Search returned invalid result');
    }
    console.log(`    Search result: loadType=${result.loadType}, tracks=${Array.isArray(result.data) ? result.data.length : 'N/A'}`);
  });

  // Test session ID
  await test('Session ID is set after connection', () => {
    for (const node of manager.getNodes()) {
      if (node.isConnected() && !node.sessionId) {
        throw new Error(`Node ${node.id} connected but no session ID`);
      }
    }
  });

  // Test circuit breaker state
  await test('Circuit breaker is CLOSED for connected nodes', () => {
    for (const node of manager.getNodes()) {
      if (node.isConnected() && node.getCircuitBreakerState() !== 'CLOSED') {
        throw new Error(`Node ${node.id} connected but circuit is ${node.getCircuitBreakerState()}`);
      }
    }
  });

  // Test node metrics
  await test('Node getMetrics returns data', () => {
    for (const node of manager.getNodes()) {
      if (node.isConnected()) {
        const metrics = node.getMetrics();
        if (typeof metrics.latency !== 'number') {
          throw new Error(`Node ${node.id} metrics missing latency`);
        }
      }
    }
  });

  // Test player creation
  await test('Player creation with connected node', () => {
    const player = manager.createPlayer({
      guildId: '123456789012345678',
      channelId: '876543210987654321',
      volume: 80,
    });
    if (!player) {
      throw new Error('Player creation failed');
    }
    if (player.volume !== 80) {
      throw new Error(`Expected volume 80, got ${player.volume}`);
    }
  });

  await test('Player queueAdd and queueGet', () => {
    const player = manager.getPlayer('123456789012345678');
    const track = {
      encoded: 'test_encoded_track',
      info: {
        identifier: 'test_id',
        title: 'Test Track',
        author: 'Test Artist',
        length: 180000,
        isSeekable: true,
        isStream: false,
        position: 0,
        uri: 'https://example.com/track',
      },
    };
    player.queueAdd(track);
    const queue = player.queueGet();
    if (queue.length !== 1) {
      throw new Error(`Expected queue length 1, got ${queue.length}`);
    }
  });

  await test('Player toJSON/fromJSON roundtrip', () => {
    const player = manager.getPlayer('123456789012345678');
    const json = player.toJSON();
    const newPlayer = manager.createPlayer({ guildId: '999999999999999999' });
    newPlayer.fromJSON(json);
    if (newPlayer.volume !== 80) {
      throw new Error(`fromJSON volume mismatch: expected 80, got ${newPlayer.volume}`);
    }
  });

  // Test destroy
  await test('Manager destroy is clean', async () => {
    manager.destroy();
    if (!manager.destroyed) {
      throw new Error('Manager should be destroyed');
    }
  });

  // Results
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  Results: ${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    for (const f of failures) {
      console.log(`    - ${f.name}: ${f.error}`);
    }
  }
  console.log('═══════════════════════════════════════════════════════════════');

  process.exit(failCount > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
