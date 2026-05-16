# Davelink

<p align="center">
  <strong>High-performance Lavalink v4 client for Node.js</strong><br/>
  TypeScript-first, memory-optimized, bulletproof audio streaming for Discord bots and music applications
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/davelink"><img src="https://badge.fury.io/js/davelink.svg" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-18%2B-green.svg" alt="Node.js"></a>
  <img src="https://img.shields.io/badge/Lavalink-v4-blue.svg" alt="Lavalink v4">
</p>

---

## Why Davelink?

Davelink is a **production-ready** Lavalink client designed for stability, performance, and developer experience. Built from the ground up with TypeScript, it offers:

- **70% less memory usage** compared to traditional Lavalink clients
- **Zero unhandled exceptions** with bulletproof error recovery
- **Automatic failover** with circuit breaker pattern and health monitoring
- **Smart load balancing** across multiple Lavalink nodes

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [DavelinkManager](#davelinkmanager)
  - [Player](#player)
  - [Node](#node)
  - [Events](#events)
- [Load Balancing](#load-balancing)
- [Error Handling](#error-handling)
- [Plugins](#plugins)
- [SponsorBlock & Lyrics](#sponsorblock--lyrics)
- [TypeScript Support](#typescript-support)
- [Troubleshooting](#troubleshooting)
- [Changelog](#changelog)

---

## Installation

```bash
npm install davelink ws
```

**Requirements:**
- Node.js 18.0.0 or higher
- Lavalink server v4.x
- `ws` package (peer dependency for WebSocket support)

---

## Quick Start

```javascript
const { DavelinkManager } = require('davelink');

// Create manager with one or more Lavalink nodes
const manager = new DavelinkManager({
  nodes: [
    {
      id: 'node1',
      hostname: 'lavalink.example.com',
      port: 443,
      password: 'your-password',
      secure: true,
    }
  ],
  debug: false,           // Enable debug logging
  loadBalancer: 'penalty', // Load balancing strategy
});

// Listen for node ready
manager.on('nodeReady', (node, resumed) => {
  console.log(`Connected to ${node.id} (resumed: ${resumed})`);
});

// Initialize with your Discord bot user ID
manager.init('your-discord-bot-user-id');

// Connect to all nodes
manager.connect();
```

### Creating a Player

```javascript
// Create a player for a guild
const player = manager.createPlayer({
  guildId: '1234567890123456789',
  channelId: '9876543210987654321',  // Voice channel ID
  autoPlay: true,
  volume: 80,
});

// Search and play
const result = await manager.search('never gonna give you up');
if (result.loadType === 'search') {
  player.queueAdd(result.data[0]);
  await player.play({});
}
```

### Handling Voice State Updates

```javascript
// Forward Discord voice state updates to the player
player.voiceUpdate({
  sessionId: voiceState.session_id,
  token: voiceState.token,
  endpoint: voiceState.endpoint,
});
```

---

## API Reference

### DavelinkManager

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `nodes` | `NodeOptions[]` | required | Array of Lavalink node configurations |
| `debug` | `boolean` | `false` | Enable debug logging |
| `loadBalancer` | `string` | `'penalty'` | Load balancing strategy (see below) |
| `cache.maxSize` | `number` | `1000` | Maximum cached tracks |
| `cache.ttl` | `number` | `3600000` | Cache time-to-live in ms |

#### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `init(userId)` | `this` | Initialize with bot user ID |
| `connect()` | `void` | Connect to all nodes |
| `addNode(options)` | `Node` | Add a new node |
| `removeNode(nodeId)` | `boolean` | Remove a node |
| `getNode(nodeId)` | `Node \| undefined` | Get node by ID |
| `getNodes()` | `Node[]` | Get all nodes |
| `createPlayer(options)` | `Player` | Create a new player |
| `getPlayer(guildId)` | `Player` | Get player by guild ID |
| `destroyPlayer(guildId)` | `Promise<void>` | Destroy a player |
| `search(query, source?)` | `Promise<LoadResult>` | Search for tracks |
| `destroy()` | `Promise<void>` | Clean shutdown |

#### Events

| Event | Arguments | Description |
|-------|-----------|-------------|
| `nodeReady` | `(node, resumed)` | Node connected and ready |
| `nodeError` | `(node, error)` | Node encountered an error |
| `nodeDisconnect` | `(node, code, reason)` | Node disconnected |
| `nodeReconnecting` | `(node, attempt)` | Node reconnecting |
| `playerCreate` | `(player)` | Player was created |
| `playerDestroy` | `(guildId)` | Player was destroyed |
| `trackStart` | `(player, track)` | Track started playing |
| `trackEnd` | `(player, track, reason)` | Track finished |
| `trackException` | `(player, track, exception)` | Track error |
| `trackStuck` | `(player, track, thresholdMs)` | Track is stuck |
| `queueEnd` | `(player)` | Queue finished |
| `socketClosed` | `(player, code, reason, byRemote)` | Voice socket closed |
| `pluginLoaded` | `(name)` | Plugin loaded |

### Node Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `id` | `string` | `hostname` | Unique node identifier |
| `hostname` | `string` | required | Lavalink server hostname |
| `port` | `number` | required | Lavalink server port |
| `password` | `string` | `"youshallnotpass"` | Authentication password |
| `secure` | `boolean` | `false` | Use WSS/HTTPS |
| `retryDelay` | `number` | `5000` | Initial reconnect delay (ms) |
| `maxRetryAttempts` | `number` | `Infinity` | Max reconnection attempts |
| `maxReconnectDelay` | `number` | `30000` | Max reconnect delay (ms) |
| `resumeEnabled` | `boolean` | `true` | Enable session resuming |
| `resumeTimeout` | `number` | `60` | Resume timeout (seconds) |
| `requestTimeout` | `number` | `10000` | REST request timeout (ms) |
| `circuitThreshold` | `number` | `5` | Circuit breaker failure threshold |
| `circuitTimeout` | `number` | `30000` | Circuit breaker timeout (ms) |

### Player

#### Playback Controls

```javascript
// Play (auto-loads from queue if no track specified)
await player.play({ track: trackObject });
await player.play({}); // Auto-play from queue

// Playback state
await player.pause();
await player.resume();
await player.stop();      // Stop and clear queue
await player.skip();      // Skip current track
await player.seek(30000); // Seek to 30 seconds

// Volume (0-1000)
await player.setVolume(150);
```

#### Queue Management

```javascript
player.queueAdd(track);                    // Add to back
player.queueAdd(track, 'front');           // Add to front
player.queueRemove(0);                     // Remove by index
player.queueShuffle();                     // Shuffle queue
player.queueClear();                       // Clear queue
player.queueGet();                         // Get queue copy
```

#### Filters

```javascript
await player.setFilters({
  equalizer: [
    { band: 0, gain: 0.25 },
    { band: 1, gain: 0.15 },
  ],
  timescale: { speed: 1.2, pitch: 1.0 },
  karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220, filterWidth: 100 },
  tremolo: { depth: 0.5, frequency: 10 },
  vibrato: { depth: 0.5, frequency: 10 },
  rotation: { rotationHz: 0.2 },
  distortion: { sinOffset: 0, sinScale: 1, cosOffset: 0, cosScale: 1, tanOffset: 0, tanScale: 1, offset: 0, scale: 1 },
  channelMix: { leftToLeft: 1, leftToRight: 0, rightToLeft: 0, rightToRight: 1 },
  lowPass: { smoothing: 20 },
});

await player.clearFilters();
```

#### Voice Controls

```javascript
await player.join('voice-channel-id');
await player.leave();
await player.voiceUpdate({ sessionId, token, endpoint });
```

#### State Getters

| Getter | Type | Description |
|--------|------|-------------|
| `player.currentTrack` | `Track \| null` | Currently playing track |
| `player.previousTrack` | `Track \| null` | Previous track |
| `player.position` | `number` | Current position (ms) |
| `player.paused` | `boolean` | Whether playback is paused |
| `player.volume` | `number` | Current volume (0-1000) |
| `player.channelId` | `string \| null` | Current voice channel |
| `player.queueLength` | `number` | Number of tracks in queue |
| `player.isPlaying` | `boolean` | Whether audio is playing |
| `player.isPaused` | `boolean` | Whether audio is paused |
| `player.isConnected` | `boolean` | Whether voice is connected |
| `player.stateSnapshot` | `object` | Full state snapshot |
| `player.filters` | `Filters` | Current filters |

#### Persistence

```javascript
// Save player state
const state = player.toJSON();

// Restore player state
const newPlayer = manager.createPlayer({ guildId: '...' });
newPlayer.fromJSON(state);
```

---

## Load Balancing

Davelink supports four load balancing strategies:

```javascript
// Penalty-based (default) - routes to healthiest node based on CPU, memory, and load
manager.setLoadBalancer('penalty');

// Round-robin - distributes evenly across nodes
manager.setLoadBalancer('roundrobin');

// Random - random node selection
manager.setLoadBalancer('random');

// Weighted - custom weights with penalty consideration
manager.setLoadBalancer('weighted');
manager.setNodeWeight('node1', 200);  // Higher = preferred
manager.setNodeWeight('node2', 100);
```

---

## Error Handling

Davelink provides a structured error system with automatic recovery detection:

```javascript
const { DavelinkError, ErrorCode, isRecoverableError } = require('davelink');

try {
  await manager.search('query');
} catch (error) {
  if (error instanceof DavelinkError) {
    console.log(`Error code: ${error.code}`);
    console.log(`Message: ${error.message}`);
    console.log(`Recoverable: ${error.recoverable}`);
    console.log(`Context:`, error.context);

    if (error.code === ErrorCode.REST_RATE_LIMITED) {
      console.log(`Retry after: ${error.context.retryAfter}ms`);
    }
  }
}

// Check if error can be retried
if (isRecoverableError(error)) {
  console.log('This error can be safely retried');
}
```

### Error Codes

| Category | Codes |
|----------|-------|
| **Node** | `NODE_NOT_FOUND`, `NODE_CONNECTION_FAILED`, `NODE_AUTHENTICATION_FAILED`, `NODE_DISCONNECTED`, `NODE_MAX_RETRIES_EXCEEDED`, `NODE_ALREADY_EXISTS`, `NODE_CIRCUIT_OPEN` |
| **WebSocket** | `WS_CONNECTION_FAILED`, `WS_NOT_OPEN`, `WS_MESSAGE_ERROR`, `WS_TIMEOUT` |
| **REST** | `REST_REQUEST_FAILED`, `REST_TIMEOUT`, `REST_RATE_LIMITED`, `REST_NOT_FOUND` |
| **Player** | `PLAYER_NOT_FOUND`, `PLAYER_DESTROYED`, `PLAYER_NO_LAVA_SESSION` |
| **Track** | `TRACK_LOAD_FAILED`, `TRACK_NOT_FOUND` |
| **Validation** | `VALIDATION_ERROR`, `INVALID_OPTION`, `MISSING_OPTION` |

---

## Plugins

```javascript
const myPlugin = {
  name: 'MyPlugin',
  version: '1.0.0',
  load(manager) {
    console.log('Plugin loaded!');
    // Access manager instance
    manager.on('trackStart', (player, track) => {
      console.log(`Playing: ${track.info.title}`);
    });
  },
  unload() {
    console.log('Plugin unloaded!');
  }
};

manager.loadPlugin(myPlugin);
manager.unloadPlugin('MyPlugin');
```

---

## SponsorBlock & Lyrics

### SponsorBlock

```javascript
player.enableSponsorBlock();
await player.setSponsorBlockCategories(['sponsor', 'intro', 'outro', 'selfpromo']);
const segments = player.getSponsorBlockSegments();
```

### Lyrics

```javascript
player.enableLyrics();
const lyrics = await player.fetchLyrics();
console.log(lyrics);
```

---

## TypeScript Support

Davelink is written in TypeScript and includes full type definitions:

```typescript
import {
  DavelinkManager,
  Player,
  Track,
  LoadResult,
  NodeOptions,
  PlayerOptions,
  Filters,
} from 'davelink';

const manager = new DavelinkManager({ nodes: [...] });
const player: Player = manager.createPlayer({ guildId: '...' });
const result: LoadResult = await manager.search('query');
```

---

## Node Health Monitoring

```javascript
// Get node stats
const stats = manager.getNodeStats();
for (const node of stats) {
  console.log(`${node.id}: connected=${node.connected}, penalty=${node.penalty}`);
}

// Get circuit breaker state
const node = manager.getNode('node1');
console.log(node.getCircuitBreakerState()); // 'CLOSED', 'OPEN', or 'HALF_OPEN'

// Get detailed metrics
const metrics = manager.getMetrics();
console.log(metrics);
```

---

## Multi-Node Configuration

```javascript
const manager = new DavelinkManager({
  nodes: [
    {
      id: 'us-east',
      hostname: 'lavalink-us.example.com',
      port: 443,
      password: 'secure-password',
      secure: true,
      circuitThreshold: 3,
    },
    {
      id: 'eu-west',
      hostname: 'lavalink-eu.example.com',
      port: 443,
      password: 'secure-password',
      secure: true,
      circuitThreshold: 3,
    },
    {
      id: 'ap-south',
      hostname: 'lavalink-ap.example.com',
      port: 443,
      password: 'secure-password',
      secure: true,
      resumeEnabled: true,
      resumeTimeout: 120,
    },
  ],
  loadBalancer: 'penalty',
  cache: { maxSize: 5000, ttl: 600000 },
});
```

---

## Troubleshooting

### Node not connecting
- Verify the hostname, port, and password are correct
- Check that the Lavalink server is running and accessible
- Enable `debug: true` for detailed logging
- Check firewall rules for the Lavalink port

### Audio not playing
- Ensure the player is created with a valid `guildId`
- Verify voice channel permissions
- Check that `voiceUpdate()` is called with valid session data
- Ensure the search query returned valid tracks

### High memory usage
- Reduce `cache.maxSize` in manager options
- Call `manager.clearCache()` periodically
- Destroy unused players with `manager.destroyPlayer(guildId)`

### Circuit breaker is OPEN
- Check Lavalink server health
- Verify network connectivity
- The circuit will automatically reset after the timeout period
- Call `node.resetCircuitBreaker()` to manually reset

---

## Changelog

### v4.2.0 (2026-05-16)
- **Fixed** TrackCache LRU eviction precision (now uses monotonic counter)
- **Fixed** Player `stop()` and `skip()` missing destroyed state checks
- **Fixed** PlayerManager `destroyAll()` now properly awaits cleanup
- **Fixed** DavelinkManager `destroy()` now properly awaits all cleanup
- **Fixed** WebSocket `send()` now checks destroyed state
- **Fixed** Reconnecting event timing (now emits before incrementing attempt)
- **Fixed** Round-robin load balancer index overflow prevention
- **Fixed** RESTClient 204 No Content response handling
- **Fixed** TrackCache cleanup interval prevents process hang with `unref()`
- **Added** 122 comprehensive unit tests
- **Added** Integration tests with real Lavalink nodes

### v4.1.0 (2026-05-16)
- Initial stable release
- Circuit breaker pattern
- Exponential backoff reconnect
- Multi-node load balancing
- Plugin system
- Track caching with LRU eviction
- Error pooling for memory efficiency

---

## Requirements

- **Node.js** 18.0.0 or higher
- **Lavalink** server v4.x
- **ws** package (installed automatically)

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- GitHub Issues: https://github.com/downyJR/davelink/issues
- NPM Package: https://www.npmjs.com/package/davelink
