// ============================================================================
// Davelink v4.1.0+ - Comprehensive Test Suite
// Tests: Core functionality, bug detection, stability verification
// ============================================================================

const { DavelinkManager, DavelinkError, ErrorCode, isRecoverableError, Player, Node, TrackCache, TypedEventEmitter, formatDuration, parseSearchQuery } = require('../dist/index.js');
const assert = require('assert');

let passCount = 0;
let failCount = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passCount++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failCount++;
    failures.push({ name, error: err.message });
    process.stdout.write(`  ✗ ${name}\n    → ${err.message}\n`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passCount++;
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (err) {
    failCount++;
    failures.push({ name, error: err.message });
    process.stdout.write(`  ✗ ${name}\n    → ${err.message}\n`);
  }
}

function expectError(fn, expectedCode) {
  try {
    fn();
    throw new Error(`Expected error ${expectedCode} but no error was thrown`);
  } catch (err) {
    if (!(err instanceof DavelinkError)) throw err;
    if (expectedCode && err.code !== expectedCode) {
      throw new Error(`Expected error code ${expectedCode} but got ${err.code}`);
    }
  }
}

async function expectErrorAsync(fn, expectedCode) {
  try {
    await fn();
    throw new Error(`Expected error ${expectedCode} but no error was thrown`);
  } catch (err) {
    if (!(err instanceof DavelinkError)) throw err;
    if (expectedCode && err.code !== expectedCode) {
      throw new Error(`Expected error code ${expectedCode} but got ${err.code}`);
    }
  }
}

process.stdout.write('\n═══════════════════════════════════════════════════════════════\n');
process.stdout.write('  Davelink Comprehensive Test Suite\n');
process.stdout.write('═══════════════════════════════════════════════════════════════\n\n');

// ============================================================================
// SECTION 1: EventEmitter Tests
// ============================================================================
process.stdout.write('Section 1: EventEmitter\n');

test('EventEmitter: basic on/emit', () => {
  const emitter = new TypedEventEmitter();
  let received = false;
  emitter.on('test', () => { received = true; });
  emitter.emit('test');
  assert.strictEqual(received, true);
});

test('EventEmitter: multiple listeners', () => {
  const emitter = new TypedEventEmitter();
  let count = 0;
  emitter.on('test', () => count++);
  emitter.on('test', () => count++);
  emitter.emit('test');
  assert.strictEqual(count, 2);
});

test('EventEmitter: once listener fires only once', () => {
  const emitter = new TypedEventEmitter();
  let count = 0;
  emitter.once('test', () => count++);
  emitter.emit('test');
  emitter.emit('test');
  assert.strictEqual(count, 1);
});

test('EventEmitter: off removes listener', () => {
  const emitter = new TypedEventEmitter();
  let count = 0;
  const handler = () => count++;
  emitter.on('test', handler);
  emitter.off('test', handler);
  emitter.emit('test');
  assert.strictEqual(count, 0);
});

test('EventEmitter: removeAllListeners clears all', () => {
  const emitter = new TypedEventEmitter();
  let count = 0;
  emitter.on('test', () => count++);
  emitter.removeAllListeners();
  emitter.emit('test');
  assert.strictEqual(count, 0);
});

test('EventEmitter: listenerCount is accurate', () => {
  const emitter = new TypedEventEmitter();
  emitter.on('test', () => {});
  emitter.on('test', () => {});
  assert.strictEqual(emitter.listenerCount('test'), 2);
});

test('EventEmitter: max listeners warning', () => {
  const emitter = new TypedEventEmitter(2);
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  emitter.on('test', () => {});
  emitter.on('test', () => {});
  emitter.on('test', () => {}); // Should trigger warning
  console.warn = origWarn;
  assert.strictEqual(warnings.length, 1);
  assert.ok(warnings[0].includes('MaxListenersExceededWarning'));
});

test('EventEmitter: destroyed emitter rejects operations', () => {
  const emitter = new TypedEventEmitter();
  let received = false;
  emitter.on('test', () => { received = true; });
  emitter.destroy();
  emitter.emit('test');
  assert.strictEqual(received, false);
});

test('EventEmitter: error in listener does not crash', () => {
  const emitter = new TypedEventEmitter();
  let secondFired = false;
  emitter.on('test', () => { throw new Error('listener error'); });
  emitter.on('test', () => { secondFired = true; });
  // Should not throw
  emitter.emit('test');
  assert.strictEqual(secondFired, true);
});

test('EventEmitter: eventNames returns correct names', () => {
  const emitter = new TypedEventEmitter();
  emitter.on('eventA', () => {});
  emitter.on('eventB', () => {});
  const names = emitter.eventNames();
  assert.ok(names.includes('eventA'));
  assert.ok(names.includes('eventB'));
});

// ============================================================================
// SECTION 2: Error System Tests
// ============================================================================
process.stdout.write('\nSection 2: Error System\n');

test('DavelinkError: basic error creation', () => {
  const err = DavelinkError.fromPool(ErrorCode.NODE_NOT_FOUND, { nodeId: 'test' });
  assert.ok(err instanceof Error);
  assert.ok(err instanceof DavelinkError);
  assert.strictEqual(err.code, ErrorCode.NODE_NOT_FOUND);
  assert.ok(err.message.includes('test'));
});

test('DavelinkError: recoverable detection', () => {
  const recoverable = DavelinkError.fromPool(ErrorCode.NODE_DISCONNECTED);
  const nonRecoverable = DavelinkError.fromPool(ErrorCode.PLAYER_DESTROYED);
  assert.strictEqual(recoverable.recoverable, true);
  assert.strictEqual(nonRecoverable.recoverable, false);
});

test('DavelinkError: toJSON serialization', () => {
  const err = DavelinkError.fromPool(ErrorCode.NODE_NOT_FOUND, { nodeId: 'test' });
  const json = err.toJSON();
  assert.strictEqual(json.code, ErrorCode.NODE_NOT_FOUND);
  assert.ok(json.message);
});

test('DavelinkError: error pooling/reuse', () => {
  const err1 = DavelinkError.fromPool(ErrorCode.NODE_NOT_FOUND, { nodeId: 'a' });
  err1.release();
  const err2 = DavelinkError.fromPool(ErrorCode.NODE_NOT_FOUND, { nodeId: 'b' });
  assert.strictEqual(err2.code, ErrorCode.NODE_NOT_FOUND);
  assert.ok(err2.message.includes('b'));
});

test('DavelinkError: message interpolation', () => {
  const err = DavelinkError.fromPool(ErrorCode.NODE_DISCONNECTED, { nodeId: 'node1', reason: 'timeout' });
  assert.ok(err.message.includes('node1'));
});

test('isRecoverableError: returns correct value', () => {
  const recoverable = DavelinkError.fromPool(ErrorCode.REST_TIMEOUT);
  assert.strictEqual(isRecoverableError(recoverable), true);
  const nonRecoverable = DavelinkError.fromPool(ErrorCode.VALIDATION_ERROR);
  assert.strictEqual(isRecoverableError(nonRecoverable), false);
  assert.strictEqual(isRecoverableError(new Error('regular')), false);
});

test('DavelinkError: assert function', () => {
  // Should not throw for true
  require('../dist/index.js').assert(true, ErrorCode.VALIDATION_ERROR, 'test');
  // Should throw for false
  try {
    require('../dist/index.js').assert(false, ErrorCode.VALIDATION_ERROR, 'test');
    throw new Error('Expected assert to throw');
  } catch (e) {
    assert.ok(e instanceof DavelinkError);
  }
});

test('validateString: rejects non-strings', () => {
  const { validateString } = require('../dist/index.js');
  expectError(() => validateString(123, 'name'), ErrorCode.VALIDATION_ERROR);
  expectError(() => validateString('', 'name', 1), ErrorCode.VALIDATION_ERROR);
  // Should not throw for valid
  validateString('hello', 'name');
});

test('validateRange: rejects out of range', () => {
  const { validateRange } = require('../dist/index.js');
  expectError(() => validateRange(5, 'vol', 0, 3), ErrorCode.VALIDATION_ERROR);
  expectError(() => validateRange(NaN, 'vol', 0, 3), ErrorCode.VALIDATION_ERROR);
  validateRange(2, 'vol', 0, 3); // Should not throw
});

test('Error reinitialize resets stack', () => {
  const err = new DavelinkError(ErrorCode.NODE_NOT_FOUND, { nodeId: 'old' });
  const oldStack = err.stack;
  err.reinitialize(ErrorCode.NODE_CONNECTION_FAILED, { reason: 'new' });
  assert.strictEqual(err.code, ErrorCode.NODE_CONNECTION_FAILED);
  assert.notStrictEqual(err.stack, oldStack);
});

// ============================================================================
// SECTION 3: TrackCache Tests
// ============================================================================
process.stdout.write('\nSection 3: TrackCache\n');

test('TrackCache: basic set/get', () => {
  const cache = new TrackCache(100, 60000);
  const track = { encoded: 'abc123', info: { identifier: 'id1', title: 'Test', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  cache.setTrack(track);
  const result = cache.getTrack('abc123');
  assert.strictEqual(result?.info.title, 'Test');
  cache.destroy();
});

test('TrackCache: get non-existent returns undefined', () => {
  const cache = new TrackCache(100, 60000);
  assert.strictEqual(cache.getTrack('nonexistent'), undefined);
  cache.destroy();
});

test('TrackCache: hasTrack works', () => {
  const cache = new TrackCache(100, 60000);
  const track = { encoded: 'abc', info: { identifier: 'id1', title: 'T', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  cache.setTrack(track);
  assert.strictEqual(cache.hasTrack('abc'), true);
  assert.strictEqual(cache.hasTrack('xyz'), false);
  cache.destroy();
});

test('TrackCache: deleteTrack', () => {
  const cache = new TrackCache(100, 60000);
  const track = { encoded: 'del', info: { identifier: 'id', title: 'T', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  cache.setTrack(track);
  assert.strictEqual(cache.deleteTrack('del'), true);
  assert.strictEqual(cache.hasTrack('del'), false);
  cache.destroy();
});

test('TrackCache: LRU eviction', () => {
  const cache = new TrackCache(2, 60000);
  const t1 = { encoded: 'a', info: { identifier: 'i', title: 'T1', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  const t2 = { encoded: 'b', info: { identifier: 'i', title: 'T2', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  const t3 = { encoded: 'c', info: { identifier: 'i', title: 'T3', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  cache.setTrack(t1);
  cache.setTrack(t2);
  // Access t1 to make it more recent
  cache.getTrack('a');
  cache.setTrack(t3); // Should evict 'b'
  assert.strictEqual(cache.hasTrack('a'), true, 'Most recently accessed should be kept');
  assert.strictEqual(cache.hasTrack('b'), false, 'Least recently accessed should be evicted');
  assert.strictEqual(cache.hasTrack('c'), true, 'New track should be added');
  cache.destroy();
});

test('TrackCache: TTL expiration', async () => {
  const cache = new TrackCache(100, 50); // 50ms TTL
  const track = { encoded: 'ttl', info: { identifier: 'i', title: 'T', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  cache.setTrack(track);
  assert.strictEqual(cache.hasTrack('ttl'), true);
  await new Promise(r => setTimeout(r, 100));
  assert.strictEqual(cache.hasTrack('ttl'), false);
  cache.destroy();
});

test('TrackCache: clear resets everything', () => {
  const cache = new TrackCache(100, 60000);
  const track = { encoded: 'clr', info: { identifier: 'i', title: 'T', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  cache.setTrack(track);
  cache.clear();
  assert.strictEqual(cache.size, 0);
  cache.destroy();
});

test('TrackCache: stats tracking', () => {
  const cache = new TrackCache(100, 60000);
  const track = { encoded: 'stats', info: { identifier: 'i', title: 'T', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  cache.setTrack(track);
  cache.getTrack('stats'); // hit
  cache.getTrack('missing'); // miss
  const stats = cache.getStats();
  assert.strictEqual(stats.trackCache.hits, 1);
  assert.strictEqual(stats.trackCache.misses, 1);
  cache.destroy();
});

test('TrackCache: handles invalid tracks gracefully', () => {
  const cache = new TrackCache(100, 60000);
  // No crash on null
  cache.setTrack(null);
  cache.setTrack(undefined);
  cache.setTrack({ encoded: '', info: {} });
  cache.setTrack({});
  assert.strictEqual(cache.size, 0);
  cache.destroy();
});

test('TrackCache: getStats hit rate calculation', () => {
  const cache = new TrackCache(100, 60000);
  const track = { encoded: 'hr', info: { identifier: 'i', title: 'T', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  cache.setTrack(track);
  cache.getTrack('hr');
  cache.getTrack('missing');
  const stats = cache.getStats();
  assert.strictEqual(stats.trackCache.hitRate, 0.5);
  cache.destroy();
});

// ============================================================================
// SECTION 4: Manager Tests (without real nodes)
// ============================================================================
process.stdout.write('\nSection 4: Manager (no real nodes)\n');

test('Manager: creation with empty nodes', () => {
  const manager = new DavelinkManager({ nodes: [] });
  assert.strictEqual(manager.nodes.size, 0);
  assert.strictEqual(manager.getNodes().length, 0);
  manager.destroy();
});

test('Manager: init returns this', () => {
  const manager = new DavelinkManager({ nodes: [] });
  const result = manager.init('123456');
  assert.strictEqual(result, manager);
  manager.destroy();
});

test('Manager: connect with no nodes does not crash', () => {
  const manager = new DavelinkManager({ nodes: [] });
  manager.init('123');
  manager.connect(); // Should not throw
  manager.destroy();
});

test('Manager: addNode throws for duplicate', () => {
  const manager = new DavelinkManager({ nodes: [] });
  manager.addNode({ id: 'node1', hostname: 'localhost', port: 2333 });
  expectError(() => {
    manager.addNode({ id: 'node1', hostname: 'localhost', port: 2333 });
  }, ErrorCode.NODE_ALREADY_EXISTS);
  manager.destroy();
});

test('Manager: removeNode returns false for non-existent', () => {
  const manager = new DavelinkManager({ nodes: [] });
  assert.strictEqual(manager.removeNode('nonexistent'), false);
  manager.destroy();
});

test('Manager: getNode returns undefined for non-existent', () => {
  const manager = new DavelinkManager({ nodes: [] });
  assert.strictEqual(manager.getNode('nope'), undefined);
  manager.destroy();
});

test('Manager: setLoadBalancer changes strategy', () => {
  const manager = new DavelinkManager({ nodes: [] });
  manager.setLoadBalancer('roundrobin');
  assert.strictEqual(manager.getLoadBalancerStrategy(), 'roundrobin');
  manager.setLoadBalancer('random');
  assert.strictEqual(manager.getLoadBalancerStrategy(), 'random');
  manager.destroy();
});

test('Manager: search throws with no nodes', async () => {
  const manager = new DavelinkManager({ nodes: [] });
  await expectErrorAsync(() => manager.search('test'), ErrorCode.NODE_NOT_FOUND);
  manager.destroy();
});

test('Manager: destroy sets destroyed flag', () => {
  const manager = new DavelinkManager({ nodes: [] });
  manager.destroy();
  assert.strictEqual(manager.destroyed, true);
});

test('Manager: double destroy is safe', () => {
  const manager = new DavelinkManager({ nodes: [] });
  manager.destroy();
  manager.destroy(); // Should not throw
  assert.strictEqual(manager.destroyed, true);
});

test('Manager: createPlayer throws when destroyed', () => {
  const manager = new DavelinkManager({ nodes: [] });
  manager.destroy();
  expectError(() => manager.createPlayer({ guildId: '123' }), ErrorCode.PLAYER_DESTROYED);
});

test('Manager: search throws when destroyed', async () => {
  const manager = new DavelinkManager({ nodes: [] });
  manager.destroy();
  await expectErrorAsync(() => manager.search('test'), ErrorCode.NODE_DISCONNECTED);
});

test('Manager: getDebugInfo returns structured data', () => {
  const manager = new DavelinkManager({ nodes: [], debug: true });
  const info = manager.getDebugInfo();
  assert.strictEqual(info.version, '4.2.0');
  assert.strictEqual(info.nodes, 0);
  assert.strictEqual(info.destroyed, false);
  manager.destroy();
});

test('Manager: getMetrics returns data', () => {
  const manager = new DavelinkManager({ nodes: [] });
  const metrics = manager.getMetrics();
  assert.ok(typeof metrics.memoryUsage === 'number');
  assert.ok(typeof metrics.playerCount === 'number');
  assert.ok(typeof metrics.nodeCount === 'number');
  assert.ok(typeof metrics.uptime === 'number');
  manager.destroy();
});

test('Manager: plugin load/unload', () => {
  const manager = new DavelinkManager({ nodes: [] });
  let loaded = false;
  let unloaded = false;
  const plugin = {
    name: 'TestPlugin',
    load() { loaded = true; },
    unload() { unloaded = true; }
  };
  manager.loadPlugin(plugin);
  assert.strictEqual(loaded, true);
  assert.strictEqual(manager.getPlugins().length, 1);
  manager.unloadPlugin('TestPlugin');
  assert.strictEqual(unloaded, true);
  assert.strictEqual(manager.getPlugins().length, 0);
  manager.destroy();
});

test('Manager: plugin load without name throws', () => {
  const manager = new DavelinkManager({ nodes: [] });
  expectError(() => manager.loadPlugin({ load() {} }), ErrorCode.PLUGIN_INVALID);
  manager.destroy();
});

test('Manager: plugin load without load function throws', () => {
  const manager = new DavelinkManager({ nodes: [] });
  expectError(() => manager.loadPlugin({ name: 'Bad' }), ErrorCode.PLUGIN_INVALID);
  manager.destroy();
});

test('Manager: duplicate plugin throws', () => {
  const manager = new DavelinkManager({ nodes: [] });
  const plugin = { name: 'Dup', load() {} };
  manager.loadPlugin(plugin);
  expectError(() => manager.loadPlugin(plugin), ErrorCode.PLUGIN_INVALID);
  manager.destroy();
});

test('Manager: plugin with failing load throws', () => {
  const manager = new DavelinkManager({ nodes: [] });
  expectError(() => manager.loadPlugin({
    name: 'Fail',
    load() { throw new Error('fail'); }
  }), ErrorCode.PLUGIN_LOAD_FAILED);
  manager.destroy();
});

test('Manager: unloadPlugin returns false for non-existent', () => {
  const manager = new DavelinkManager({ nodes: [] });
  assert.strictEqual(manager.unloadPlugin('nope'), false);
  manager.destroy();
});

test('Manager: setNodeWeight and getNodeStats', () => {
  const manager = new DavelinkManager({ nodes: [] });
  manager.setNodeWeight('node1', 200);
  const stats = manager.getNodeStats();
  assert.ok(Array.isArray(stats));
  manager.destroy();
});

test('Manager: cache operations', () => {
  const manager = new DavelinkManager({ nodes: [] });
  const stats = manager.getCacheStats();
  assert.ok(stats.trackCache);
  manager.clearCache();
  manager.destroy();
});

test('Manager: node added with auto-id from hostname', () => {
  const manager = new DavelinkManager({ nodes: [] });
  const node = manager.addNode({ hostname: 'auto-host', port: 2333 });
  assert.strictEqual(node.id, 'auto-host');
  manager.destroy();
});

// ============================================================================
// SECTION 5: Player Tests (without real connection)
// ============================================================================
process.stdout.write('\nSection 5: Player (no real connection)\n');

test('Player: state initialization', () => {
  const manager = new DavelinkManager({ nodes: [] });
  // Create a mock node
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('guild1', mockNode, { guildId: 'guild1' });
  assert.strictEqual(player.guildId, 'guild1');
  assert.strictEqual(player.state.paused, false);
  assert.strictEqual(player.state.volume, 100);
  assert.strictEqual(player.state.queue.length, 0);
  player.destroy();
  manager.destroy();
});

test('Player: queueAdd adds to back', () => {
  const manager = new DavelinkManager({ nodes: [] });
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  const track = { encoded: 't1', info: { identifier: 'i', title: 'Song', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  player.queueAdd(track);
  assert.strictEqual(player.queueLength, 1);
  player.destroy();
  manager.destroy();
});

test('Player: queueAdd adds to front', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  const t1 = { encoded: 'a', info: { identifier: 'i', title: 'First', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  const t2 = { encoded: 'b', info: { identifier: 'i', title: 'Second', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  player.queueAdd(t1);
  player.queueAdd(t2, 'front');
  const queue = player.queueGet();
  assert.strictEqual(queue[0].encoded, 'b');
  assert.strictEqual(queue[1].encoded, 'a');
  player.destroy();
});

test('Player: queueRemove returns undefined for invalid index', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  assert.strictEqual(player.queueRemove(0), undefined);
  assert.strictEqual(player.queueRemove(-1), undefined);
  player.destroy();
});

test('Player: queueClear empties queue', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  const track = { encoded: 't', info: { identifier: 'i', title: 'S', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } };
  player.queueAdd(track);
  player.queueClear();
  assert.strictEqual(player.queueLength, 0);
  player.destroy();
});

test('Player: queueShuffle changes order', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  for (let i = 0; i < 20; i++) {
    player.queueAdd({ encoded: `t${i}`, info: { identifier: `i${i}`, title: `S${i}`, author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } });
  }
  const before = player.queueGet().map(t => t.encoded).join(',');
  player.queueShuffle();
  const after = player.queueGet().map(t => t.encoded).join(',');
  // With 20 items, shuffling should almost certainly change order
  // (probability of same order is astronomically low)
  assert.notStrictEqual(before, after, 'Shuffle should change order');
  player.destroy();
});

test('Player: maxQueueSize enforcement', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  player.maxQueueSize = 5;
  for (let i = 0; i < 10; i++) {
    player.queueAdd({ encoded: `t${i}`, info: { identifier: `i${i}`, title: `S${i}`, author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } });
  }
  assert.strictEqual(player.queueLength, 5);
  // Should keep newest (last 5)
  const queue = player.queueGet();
  assert.strictEqual(queue[0].encoded, 't5');
  assert.strictEqual(queue[4].encoded, 't9');
  player.destroy();
});

test('Player: seek validation rejects negative', async () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => true, sessionId: 'sess1',
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  await expectErrorAsync(() => player.seek(-1), ErrorCode.VALIDATION_ERROR);
  player.destroy();
});

test('Player: volume validation rejects out of range', async () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => true, sessionId: 'sess1',
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  await expectErrorAsync(() => player.setVolume(-1), ErrorCode.VALIDATION_ERROR);
  await expectErrorAsync(() => player.setVolume(1001), ErrorCode.VALIDATION_ERROR);
  player.destroy();
});

test('Player: double destroy is safe', async () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    destroyPlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  await player.destroy();
  await player.destroy(); // Should not throw
});

test('Player: toJSON serialization', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1', channelId: 'ch1', volume: 80 });
  const json = player.toJSON();
  assert.strictEqual(json.guildId, 'g1');
  assert.strictEqual(json.channelId, 'ch1');
  assert.strictEqual(json.volume, 80);
  player.destroy();
});

test('Player: fromJSON deserialization', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  player.fromJSON({
    channelId: 'ch2',
    volume: 50,
    paused: true,
    autoPlay: false,
    lyricsEnabled: true,
    sponsorBlockEnabled: true,
    daveEnabled: true,
  });
  assert.strictEqual(player.channelId, 'ch2');
  assert.strictEqual(player.volume, 50);
  assert.strictEqual(player.paused, true);
  player.destroy();
});

test('Player: getters return correct values', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  assert.strictEqual(player.isPlaying, false);
  assert.strictEqual(player.isPaused, false);
  assert.strictEqual(player.isConnected, false);
  player.destroy();
});

test('Player: stateSnapshot includes voice state', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  const snap = player.stateSnapshot;
  assert.ok(snap.voice);
  assert.strictEqual(snap.voice.channelId, null);
  player.destroy();
});

test('Player: voiceUpdate sets state', async () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    sendVoiceUpdate: () => true,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  await player.voiceUpdate({ sessionId: 'sess', token: 'tok', endpoint: 'ep' });
  assert.strictEqual(player.voiceState.sessionId, 'sess');
  assert.strictEqual(player.voiceState.token, 'tok');
  assert.strictEqual(player.voiceState.endpoint, 'ep');
  player.destroy();
});

test('Player: join sets channel', async () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  await player.join('vc1');
  assert.strictEqual(player.channelId, 'vc1');
  assert.strictEqual(player.voiceState.channelId, 'vc1');
  player.destroy();
});

test('Player: leave clears channel', async () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  await player.join('vc1');
  await player.leave();
  assert.strictEqual(player.channelId, null);
  assert.strictEqual(player.voiceState.channelId, null);
  player.destroy();
});

test('Player: sponsorBlock enable/disable', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  player.enableSponsorBlock();
  assert.strictEqual(player.sponsorBlockEnabled, true);
  player.disableSponsorBlock();
  assert.strictEqual(player.sponsorBlockEnabled, false);
  assert.strictEqual(player.getSponsorBlockSegments().length, 0);
  player.destroy();
});

test('Player: lyrics enable/disable', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  player.enableLyrics();
  assert.strictEqual(player.lyricsEnabled, true);
  player.disableLyrics();
  assert.strictEqual(player.lyricsEnabled, false);
  assert.strictEqual(player.getLyrics(), null);
  player.destroy();
});

test('Player: DAVE E2EE enable/disable', () => {
  const { WebSocketClient } = require('../dist/ws/WebSocketClient.js');
  const mockWs = new WebSocketClient({ hostname: 'localhost', port: 2333 });
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: mockWs,
    isConnected: () => false, sessionId: null,
    sendDaveUpdate: () => true,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  player.join('ch1');
  player.enableDaveE2EE();
  assert.strictEqual(player.isDaveEnabled(), true);
  player.disableDaveE2EE();
  assert.strictEqual(player.isDaveEnabled(), false);
  player.destroy();
  mockWs.destroy();
});

test('Player: queueAdd with string track creates synthetic', () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  player.queueAdd('encodedTrackString');
  const queue = player.queueGet();
  assert.strictEqual(queue[0].encoded, 'encodedTrackString');
  assert.strictEqual(queue[0].info.title, 'Unknown');
  player.destroy();
});

test('Player: destroyed player operations throw', async () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => true, sessionId: 'sess',
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  await player.destroy();

  expectError(() => player.pause(), ErrorCode.PLAYER_DESTROYED);
  expectError(() => player.resume(), ErrorCode.PLAYER_DESTROYED);
  await expectErrorAsync(() => player.seek(0), ErrorCode.PLAYER_DESTROYED);
  await expectErrorAsync(() => player.setVolume(50), ErrorCode.PLAYER_DESTROYED);
  expectError(() => player.play(), ErrorCode.PLAYER_DESTROYED);
});

test('Player: destroyed player queueAdd is silently ignored', async () => {
  const mockNode = {
    id: 'mock', hostname: 'localhost', port: 2333,
    ws: new (require('../dist/core/EventEmitter.js').TypedEventEmitter)(),
    isConnected: () => false, sessionId: null,
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode, { guildId: 'g1' });
  await player.destroy();
  // Should not throw
  player.queueAdd({ encoded: 't', info: { identifier: 'i', title: 'S', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } });
  assert.strictEqual(player.queueLength, 0);
});

// ============================================================================
// SECTION 6: Utility Function Tests
// ============================================================================
process.stdout.write('\nSection 6: Utility Functions\n');

test('formatDuration: formats correctly', () => {
  assert.strictEqual(formatDuration(65000), '1:05');
  assert.strictEqual(formatDuration(3661000), '1:01:01');
  assert.strictEqual(formatDuration(0), '0:00');
  assert.strictEqual(formatDuration(59000), '0:59');
});

test('parseSearchQuery: parses source prefix', () => {
  const result = parseSearchQuery('ytsearch:hello world');
  assert.strictEqual(result.source, 'yt');
  assert.strictEqual(result.query, 'hello world');
});

test('parseSearchQuery: defaults to yt', () => {
  const result = parseSearchQuery('hello world');
  assert.strictEqual(result.source, 'yt');
  assert.strictEqual(result.query, 'hello world');
});

test('parseSearchQuery: handles other sources', () => {
  const sp = parseSearchQuery('spsearch:artist name');
  assert.strictEqual(sp.source, 'sp');
  const sc = parseSearchQuery('scsearch:track name');
  assert.strictEqual(sc.source, 'sc');
});

// ============================================================================
// SECTION 7: Node Store Tests
// ============================================================================
process.stdout.write('\nSection 7: NodeStore\n');

test('NodeStore: basic add/get/has/remove', () => {
  const manager = new DavelinkManager({ nodes: [] });
  const store = manager.nodes;
  // Can't easily test with mock nodes since Node requires ws
  assert.strictEqual(store.size, 0);
  assert.strictEqual(store.get('nonexistent'), undefined);
  assert.strictEqual(store.has('nonexistent'), false);
  assert.strictEqual(store.remove('nonexistent'), false);
  manager.destroy();
});

test('NodeStore: select with no connected nodes returns undefined', () => {
  const manager = new DavelinkManager({ nodes: [] });
  const store = manager.nodes;
  assert.strictEqual(store.select('penalty'), undefined);
  assert.strictEqual(store.select('random'), undefined);
  assert.strictEqual(store.select('roundrobin'), undefined);
  assert.strictEqual(store.select('weighted'), undefined);
  manager.destroy();
});

// ============================================================================
// SECTION 8: Node Tests
// ============================================================================
process.stdout.write('\nSection 8: Node\n');

test('Node: default options', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  assert.strictEqual(node.id, 'localhost');
  assert.strictEqual(node.password, 'youshallnotpass');
  assert.strictEqual(node.secure, false);
  assert.strictEqual(node.resumeEnabled, true);
  assert.strictEqual(node.destroyed, false);
  node.destroy();
});

test('Node: custom options', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({
    id: 'custom', hostname: 'host', port: 443,
    password: 'secret', secure: true,
    retryDelay: 1000, maxRetryAttempts: 10,
    resumeEnabled: false,
  });
  assert.strictEqual(node.id, 'custom');
  assert.strictEqual(node.password, 'secret');
  assert.strictEqual(node.secure, true);
  assert.strictEqual(node.retryDelay, 1000);
  assert.strictEqual(node.maxRetryAttempts, 10);
  assert.strictEqual(node.resumeEnabled, false);
  node.destroy();
});

test('Node: penalty calculation with no stats', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  const penalty = node.getPenalty();
  assert.strictEqual(typeof penalty, 'number');
  assert.ok(penalty >= 0);
  node.destroy();
});

test('Node: double destroy is safe', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  node.destroy();
  node.destroy(); // Should not throw
  assert.strictEqual(node.destroyed, true);
});

test('Node: not connected initially', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  assert.strictEqual(node.isConnected(), false);
  node.destroy();
});

test('Node: circuit breaker initial state', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  assert.strictEqual(node.getCircuitBreakerState(), 'CLOSED');
  node.destroy();
});

test('Node: sessionId is null initially', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  assert.strictEqual(node.sessionId, null);
  node.destroy();
});

test('Node: health check start/stop', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  node.startHealthCheck(1000);
  node.stopHealthCheck();
  // Should not crash
  node.destroy();
});

test('Node: stopHealthCheck is safe when not started', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  node.stopHealthCheck(); // Should not crash
  node.destroy();
});

test('Node: connect when destroyed does not crash', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  node.destroy();
  node.connect('123'); // Should not throw
});

test('Node: disconnect when destroyed does not crash', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  node.destroy();
  node.disconnect(); // Should not throw
});

test('Node: resetCircuitBreaker', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  node.resetCircuitBreaker();
  assert.strictEqual(node.getCircuitBreakerState(), 'CLOSED');
  node.destroy();
});

test('Node: getMetrics returns data', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  const metrics = node.getMetrics();
  assert.ok(typeof metrics.id === 'string');
  assert.ok(typeof metrics.connected === 'boolean');
  assert.ok(typeof metrics.penalty === 'number');
  assert.ok(typeof metrics.circuitState === 'string');
  node.destroy();
});

// ============================================================================
// SECTION 9: WebSocketClient Tests
// ============================================================================
process.stdout.write('\nSection 9: WebSocketClient\n');

test('WebSocketClient: creation', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  assert.ok(ws);
  assert.strictEqual(ws.isConnected(), false);
  assert.strictEqual(ws.getSessionId(), null);
  ws.destroy();
});

test('WebSocketClient: default options', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  const metrics = ws.getMetrics();
  assert.strictEqual(metrics.connected, false);
  assert.strictEqual(metrics.reconnectAttempts, 0);
  assert.strictEqual(metrics.queueSize, 0);
  ws.destroy();
});

test('WebSocketClient: send when not connected queues message', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  const result = ws.send({ op: 'test' });
  assert.strictEqual(result, false);
  assert.strictEqual(ws.getMetrics().queueSize, 1);
  ws.destroy();
});

test('WebSocketClient: destroyed client send returns false', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  ws.destroy();
  const result = ws.send({ op: 'test' });
  assert.strictEqual(result, false);
});

test('WebSocketClient: setUserId/getSessionId', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  ws.setUserId('12345');
  assert.strictEqual(ws.getSessionId(), null);
  ws.destroy();
});

test('WebSocketClient: setResumeKey', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  ws.setResumeKey('key123');
  ws.destroy();
});

test('WebSocketClient: destroy when not connected', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  ws.destroy(); // Should not throw
});

test('WebSocketClient: double destroy', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  ws.destroy();
  ws.destroy(); // Should not throw
});

test('WebSocketClient: connect without userId', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  ws.connect(); // Should not throw even without userId
  // Clean up
  setTimeout(() => ws.destroy(), 100);
});

test('WebSocketClient: disconnect when not connected', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  ws.disconnect(); // Should not throw
  ws.destroy();
});

test('WebSocketClient: event on/off', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  let called = false;
  const handler = () => { called = true; };
  ws.on('test', handler);
  ws._emit('test');
  assert.strictEqual(called, true);
  called = false;
  ws.off('test', handler);
  ws._emit('test');
  assert.strictEqual(called, false);
  ws.destroy();
});

test('WebSocketClient: once listener', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  let count = 0;
  ws.once('test', () => count++);
  ws._emit('test');
  ws._emit('test');
  assert.strictEqual(count, 1);
  ws.destroy();
});

test('WebSocketClient: _emit with no listeners does not crash', () => {
  const { WebSocketClient: WS } = require('../dist/ws/WebSocketClient.js');
  const ws = new WS({ hostname: 'localhost', port: 2333 });
  ws._emit('nonexistent'); // Should not throw
  ws.destroy();
});

test('WebSocketClient: createWebSocketClient factory', () => {
  const { createWebSocketClient } = require('../dist/ws/WebSocketClient.js');
  const ws = createWebSocketClient({ hostname: 'localhost', port: 2333 });
  assert.ok(ws);
  ws.destroy();
});

// ============================================================================
// SECTION 10: REST Client Tests
// ============================================================================
process.stdout.write('\nSection 10: RESTClient\n');

test('RESTClient: creation', () => {
  const { RESTClient: REST } = require('../dist/rest/RESTClient.js');
  const rest = new REST({ hostname: 'localhost', port: 2333 });
  rest.setSessionId('sess1');
  rest.destroy();
});

test('RESTClient: destroy prevents requests', async () => {
  const { RESTClient: REST } = require('../dist/rest/RESTClient.js');
  const rest = new REST({ hostname: 'localhost', port: 2333 });
  rest.destroy();
  await expectErrorAsync(() => rest.request('GET', 'info'), ErrorCode.REST_CLIENT_DESTROYED);
});

test('RESTClient: default password', () => {
  const { RESTClient: REST } = require('../dist/rest/RESTClient.js');
  const rest = new REST({ hostname: 'localhost', port: 2333 });
  rest.destroy();
});

// ============================================================================
// SECTION 11: Benchmark Tests
// ============================================================================
process.stdout.write('\nSection 11: Benchmark\n');

test('Benchmark: start/end produces valid result', () => {
  const { createBenchmark } = require('../dist/index.js');
  const bench = createBenchmark();
  bench.start();
  // Do some work
  for (let i = 0; i < 1000000; i++) { Math.sqrt(i); }
  const result = bench.end();
  assert.ok(result.duration >= 0);
  assert.ok(result.endTime >= result.startTime);
  assert.ok(typeof result.memoryDelta === 'number');
});

test('Benchmark: memoryUsedMB is a number', () => {
  const { createBenchmark } = require('../dist/index.js');
  const bench = createBenchmark();
  bench.start();
  const result = bench.end();
  assert.ok(typeof result.memoryUsedMB === 'number');
});

// ============================================================================
// SECTION 12: Version Export Tests
// ============================================================================
process.stdout.write('\nSection 12: Version/Package\n');

test('VERSION is exported', () => {
  assert.strictEqual(require('../dist/index.js').VERSION, '4.2.0');
});

test('name is exported', () => {
  assert.strictEqual(require('../dist/index.js').name, 'davelink');
});

test('description is exported', () => {
  assert.ok(require('../dist/index.js').description.length > 0);
});

// ============================================================================
// SECTION 13: Event Forwarding Tests
// ============================================================================
process.stdout.write('\nSection 13: Event Forwarding\n');

test('Player: event forwarding cleanup on migration', async () => {
  const emitter1 = new TypedEventEmitter();
  const emitter2 = new TypedEventEmitter();
  const mockNode1 = {
    id: 'node1', hostname: 'h1', port: 1,
    ws: emitter1, isConnected: () => true, sessionId: 's1',
    updatePlayer: async () => {},
  };
  const mockNode2 = {
    id: 'node2', hostname: 'h2', port: 2,
    ws: emitter2, isConnected: () => true, sessionId: 's2',
    updatePlayer: async () => {},
  };
  const player = new (require('../dist/player/Player.js').Player)('g1', mockNode1, { guildId: 'g1' });

  // Emit on old node - should be received
  let receivedOnOld = false;
  player.on('trackStart', () => { receivedOnOld = true; });

  // Migrate
  await player.migrateTo(mockNode2);

  // Emit on old node - should NOT be received after migration
  emitter1._emit('trackStart', 'g1', { encoded: 't', info: { identifier: 'i', title: 'S', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } });
  assert.strictEqual(receivedOnOld, false, 'Should not receive events from old node after migration');

  // Emit on new node - should be received
  let receivedOnNew = false;
  player.on('trackStart', () => { receivedOnNew = true; });
  emitter2._emit('trackStart', 'g1', { encoded: 't', info: { identifier: 'i', title: 'S', author: 'A', length: 1000, isSeekable: true, isStream: false, position: 0, uri: '' } });
  assert.strictEqual(receivedOnNew, true, 'Should receive events from new node');

  player.destroy();
});

// ============================================================================
// SECTION 14: Node Penalty Calculation Tests
// ============================================================================
process.stdout.write('\nSection 14: Penalty Calculation\n');

test('Node: penalty with stats', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  // Simulate stats update
  node.stats = {
    players: 10,
    playingPlayers: 5,
    cpu: { systemLoad: 0.5, lavalinkLoad: 0.3 },
    memory: { used: 500000000, free: 500000000 },
  };
  const penalty = node.getPenalty();
  assert.ok(penalty > 0, 'Penalty should be positive with load');
  node.destroy();
});

test('Node: penalty is never negative', () => {
  const { Node: NodeClass } = require('../dist/node/Node.js');
  const node = new NodeClass({ hostname: 'localhost', port: 2333 });
  const penalty = node.getPenalty();
  assert.ok(penalty >= 0, 'Penalty should never be negative');
  node.destroy();
});

// ============================================================================
// SECTION 15: Integration-style Tests
// ============================================================================
process.stdout.write('\nSection 15: Integration Patterns\n');

test('Manager with node: full lifecycle', () => {
  const manager = new DavelinkManager({ nodes: [] });
  const node = manager.addNode({
    id: 'test-node',
    hostname: 'localhost',
    port: 2333,
    password: 'test-pass',
    secure: false,
  });
  assert.strictEqual(manager.nodes.has('test-node'), true);
  assert.strictEqual(manager.getNode('test-node').id, 'test-node');
  assert.strictEqual(manager.getNodes().length, 1);

  manager.removeNode('test-node');
  assert.strictEqual(manager.nodes.has('test-node'), false);
  assert.strictEqual(manager.getNodes().length, 0);
  manager.destroy();
});

test('Manager: multiple nodes', () => {
  const manager = new DavelinkManager({ nodes: [] });
  manager.addNode({ id: 'n1', hostname: 'h1', port: 2333 });
  manager.addNode({ id: 'n2', hostname: 'h2', port: 2333 });
  assert.strictEqual(manager.nodes.size, 2);
  manager.destroy();
});

// Wait for async tests and cleanup
process.stdout.write('\n═══════════════════════════════════════════════════════════════\n');
process.stdout.write(`  Results: ${passCount} passed, ${failCount} failed\n`);
if (failures.length > 0) {
  process.stdout.write('\n  Failures:\n');
  for (const f of failures) {
    process.stdout.write(`    - ${f.name}: ${f.error}\n`);
  }
}
process.stdout.write('═══════════════════════════════════════════════════════════════\n');

process.exit(failCount > 0 ? 1 : 0);
