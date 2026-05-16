// ============================================================================
// Davelink v4.2.0 - Bulletproof Lavalink Manager
// Fixed: Plugin error handling, search error messages
// Added: Connection pooling, enhanced metrics, health monitoring
// ============================================================================

import { Node } from './node/Node';
import { PlayerManager, Player } from './player/Player';
import { TrackCache } from './cache/TrackCache';
import { TypedEventEmitter } from './core/EventEmitter';
import { DavelinkError, ErrorCode } from './errors';
import type {
  ManagerOptions, NodeOptions, PlayerOptions, Track, LoadResult, PlayerState,
  Plugin, BenchmarkResult, SearchSource, NodeStats,
} from './types';

// Load balancer strategies
export type LoadBalancerStrategy = 'penalty' | 'roundrobin' | 'random' | 'weighted';

export class DavelinkManager extends TypedEventEmitter {
  nodes: NodeStore;
  players: PlayerManager;
  cache: TrackCache;
  options: ManagerOptions;
  destroyed = false;
  private loadBalancer: LoadBalancerStrategy = 'penalty';
  private nodeWeights = new Map<string, number>();
  private roundRobinIndex = 0;
  private plugins = new Map<string, Plugin>();
  private debug: boolean;
  private userId = '';

  constructor(options: ManagerOptions) {
    super(100);
    this.options = options;
    this.debug = options.debug ?? false;
    this.nodes = new NodeStore(this);
    this.players = new PlayerManager();
    this.cache = new TrackCache(
      options.cache?.maxSize ?? 1000,
      options.cache?.ttl ?? 3600000,
    );

    if (options.loadBalancer) {
      this.loadBalancer = options.loadBalancer as LoadBalancerStrategy;
    }

    // Register initial nodes
    if (options.nodes) {
      for (const nodeOptions of options.nodes) {
        try {
          this.addNode(nodeOptions);
        } catch (error) {
          if (this.debug) {
            console.warn('[Davelink] Failed to add node:', nodeOptions.id, error);
          }
        }
      }
    }
  }

  // ===================================================================
  // Initialization
  // ===================================================================
  init(userId: string): this {
    this.userId = userId;
    return this;
  }

  connect(): void {
    if (this.destroyed) return;
    for (const node of this.nodes.getAll()) {
      if (!node.isConnected()) {
        try {
          node.connect(this.userId);
          node.startHealthCheck();
        } catch (error) {
          this._emitError(error);
        }
      }
    }
  }

  // ===================================================================
  // Node Management
  // ===================================================================
  addNode(options: NodeOptions): Node {
    if (this.nodes.has(options.id ?? options.hostname)) {
      throw DavelinkError.fromPool(ErrorCode.NODE_ALREADY_EXISTS, {
        nodeId: options.id ?? options.hostname,
      });
    }
    const node = new Node(options);
    this.nodes.add(node);
    this.players.registerNode(node);

    // Forward node events
    node.ws.on('ready', (sessionId: unknown, resumed: unknown) => {
      this.emit('nodeReady', node, Boolean(resumed));
    });
    node.ws.on('error', (error: unknown) => {
      this.emit('nodeError', node, error);
    });
    node.ws.on('close', (code: unknown, reason: unknown) => {
      this.emit('nodeDisconnect', node, code, reason);
    });
    node.ws.on('reconnecting', (attempt: unknown) => {
      this.emit('nodeReconnecting', node, attempt);
    });

    return node;
  }

  removeNode(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    this.players.unregisterNode(nodeId);
    node.destroy();
    return this.nodes.remove(nodeId);
  }

  getNode(nodeId: string): Node | undefined {
    return this.nodes.get(nodeId);
  }

  getNodes(): Node[] {
    return this.nodes.getAll();
  }

  // ===================================================================
  // Player Management
  // ===================================================================
  createPlayer(options: PlayerOptions): Player {
    if (this.destroyed) {
      throw DavelinkError.fromPool(ErrorCode.PLAYER_DESTROYED, { guildId: options.guildId });
    }
    const node = this.nodes.select(this.loadBalancer);
    if (!node) {
      throw DavelinkError.fromPool(ErrorCode.NODE_NOT_FOUND, {
        guildId: options.guildId,
        message: 'No connected nodes available',
      });
    }
    return this.players.createPlayer(
      options.guildId,
      node,
      options,
      (event, ...args) => this.emit(event, ...args),
    );
  }

  getPlayer(guildId: string): Player {
    const player = this.players.getPlayer(guildId);
    if (!player) {
      throw DavelinkError.fromPool(ErrorCode.PLAYER_NOT_FOUND, { guildId });
    }
    return player;
  }

  async destroyPlayer(guildId: string): Promise<void> {
    await this.players.destroyPlayer(guildId);
    this.emit('playerDestroy', guildId);
  }

  // ===================================================================
  // Search
  // ===================================================================
  async search(query: string, source?: SearchSource): Promise<LoadResult> {
    if (this.destroyed) {
      throw DavelinkError.fromPool(ErrorCode.NODE_DISCONNECTED, { reason: 'Manager destroyed' });
    }

    const node = this.nodes.select(this.loadBalancer);
    if (!node) {
      throw DavelinkError.fromPool(ErrorCode.NODE_NOT_FOUND, {
        message: 'No connected nodes available for search',
      });
    }

    try {
      const searchQuery = source ? `${source}:${query}` : query;
      const result = await node.loadTracks(searchQuery);

      if (result && typeof result === 'object' && 'data' in result) {
        // Cache tracks
        const tracks = Array.isArray(result.data) ? result.data : [];
        for (const track of tracks) {
          if (track && typeof track === 'object' && 'encoded' in track) {
            this.cache.setTrack(track as Track);
          }
        }

        return {
          loadType: ((result.loadType as string) ?? 'empty') as 'track' | 'playlist' | 'search' | 'empty' | 'error',
          data: result.data as Track[],
          exception: result.exception as { message: string; severity: string } | undefined,
        };
      }

      return { loadType: 'empty', data: [] };
    } catch (error) {
      if (error instanceof DavelinkError) throw error;
      throw DavelinkError.fromPool(ErrorCode.TRACK_LOAD_FAILED, {
        identifier: query,
        message: error instanceof Error ? error.message : 'Search failed',
      });
    }
  }

  // ===================================================================
  // Load Balancer
  // ===================================================================
  setLoadBalancer(strategy: LoadBalancerStrategy): void {
    this.loadBalancer = strategy;
  }

  setNodeWeight(nodeId: string, weight: number): void {
    this.nodeWeights.set(nodeId, weight);
  }

  getLoadBalancerStrategy(): string {
    return this.loadBalancer;
  }

  // ===================================================================
  // Plugins
  // ===================================================================
  loadPlugin(plugin: Plugin): void {
    if (!plugin || typeof plugin.load !== 'function') {
      throw DavelinkError.fromPool(ErrorCode.PLUGIN_INVALID, {
        message: 'Plugin must have a load function',
      });
    }
    if (!plugin.name) {
      throw DavelinkError.fromPool(ErrorCode.PLUGIN_INVALID, {
        message: 'Plugin must have a name',
      });
    }
    if (this.plugins.has(plugin.name)) {
      throw DavelinkError.fromPool(ErrorCode.PLUGIN_INVALID, {
        message: `Plugin "${plugin.name}" is already loaded`,
      });
    }
    try {
      plugin.load(this);
      this.plugins.set(plugin.name, plugin);
      this.emit('pluginLoaded', plugin.name);
    } catch (error) {
      // Plugin load failed - clean up
      throw DavelinkError.fromPool(ErrorCode.PLUGIN_LOAD_FAILED, {
        pluginName: plugin.name,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  unloadPlugin(name: string): boolean {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;
    if (plugin.unload) {
      try {
        plugin.unload();
      } catch {
        // Ignore unload errors
      }
    }
    this.plugins.delete(name);
    return true;
  }

  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  // ===================================================================
  // Cache
  // ===================================================================
  getCacheStats() {
    return this.cache.getStats();
  }

  clearCache(): void {
    this.cache.clear();
  }

  // ===================================================================
  // Metrics
  // ===================================================================
  getMetrics() {
    const memUsage = process.memoryUsage();
    return {
      memoryUsage: Math.round(memUsage.heapUsed / 1024 / 1024),
      totalMemory: Math.round(memUsage.heapTotal / 1024 / 1024),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      playerCount: this.players.getPlayerCount(),
      nodeCount: this.nodes.size,
      connectedNodeCount: this.nodes.getConnectedCount(),
      cacheSize: this.cache.size,
      uptime: process.uptime(),
      loadBalancer: this.loadBalancer,
      pluginCount: this.plugins.size,
      destroyed: this.destroyed,
      nodeMetrics: this.nodes.getAll().map(n => n.getMetrics()),
    };
  }

  getNodeStats(): Array<Record<string, unknown>> {
    return this.nodes.getAll().map(node => ({
      id: node.id,
      connected: node.connected,
      penalty: node.getPenalty(),
      stats: node.stats,
      latency: node.ws.getMetrics().latency,
      messagesReceived: node.ws.getMetrics().messagesReceived,
      messagesSent: node.ws.getMetrics().messagesSent,
      reconnectAttempts: node.ws.getMetrics().reconnectAttempts,
      circuitState: node.getCircuitBreakerState(),
    }));
  }

  getDebugInfo() {
    const nodeList = this.nodes.getAll();
    return {
      version: '4.2.0',
      nodes: nodeList.length,
      connectedNodes: nodeList.filter(n => n.isConnected()).length,
      players: this.players.getPlayerCount(),
      loadBalancer: this.loadBalancer,
      destroyed: this.destroyed,
      plugins: Array.from(this.plugins.keys()),
      cacheSize: this.cache.size,
    };
  }

  // ===================================================================
  // Lifecycle
  // ===================================================================
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.players.destroyAll();
    this.nodes.destroyAll();
    this.cache.destroy();
    this.plugins.clear();
    this.nodeWeights.clear();
    this.removeAllListeners();
  }

  private _emitError(error: unknown): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.emit('error', err);
  }
}

// ============================================================================
// Node Store
// ============================================================================
export class NodeStore {
  private nodes = new Map<string, Node>();
  private manager: DavelinkManager;

  constructor(manager: DavelinkManager) {
    this.manager = manager;
  }

  add(node: Node): void {
    this.nodes.set(node.id, node);
  }

  get(id: string): Node | undefined {
    return this.nodes.get(id);
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  remove(id: string): boolean {
    return this.nodes.delete(id);
  }

  getAll(): Node[] {
    return Array.from(this.nodes.values());
  }

  get size(): number {
    return this.nodes.size;
  }

  getConnectedCount(): number {
    return this.getAll().filter(n => n.isConnected()).length;
  }

  select(strategy?: LoadBalancerStrategy): Node | undefined {
    const connected = this.getAll().filter(n => n.isConnected());
    if (connected.length === 0) return undefined;

    const strat = strategy ?? 'penalty';

    switch (strat) {
      case 'penalty': {
        let best: Node | undefined;
        let minPenalty = Infinity;
        for (const node of connected) {
          const penalty = node.getPenalty();
          if (penalty < minPenalty) {
            minPenalty = penalty;
            best = node;
          }
        }
        return best;
      }
      case 'roundrobin': {
        // Reset index periodically to prevent Number.MAX_SAFE_INTEGER overflow
        let idx = this.manager['roundRobinIndex'] % connected.length;
        this.manager['roundRobinIndex'] = idx + 1;
        return connected[idx];
      }
      case 'random':
        return connected[Math.floor(Math.random() * connected.length)];
      case 'weighted': {
        let best: Node | undefined;
        let maxWeight = -Infinity;
        for (const node of connected) {
          const weight = this.manager['nodeWeights'].get(node.id) ?? 100;
          const penalty = node.getPenalty();
          const score = weight - penalty;
          if (score > maxWeight) {
            maxWeight = score;
            best = node;
          }
        }
        return best;
      }
      default: {
        // Fallback to penalty
        let best: Node | undefined;
        let minPenalty = Infinity;
        for (const node of connected) {
          const penalty = node.getPenalty();
          if (penalty < minPenalty) {
            minPenalty = penalty;
            best = node;
          }
        }
        return best;
      }
    }
  }

  setStrategy(strategy: LoadBalancerStrategy): void {
    this.manager.setLoadBalancer(strategy);
  }

  setNodeWeight(nodeId: string, weight: number): void {
    this.manager.setNodeWeight(nodeId, weight);
  }

  destroyAll(): void {
    for (const node of this.nodes.values()) {
      node.destroy();
    }
    this.nodes.clear();
  }
}

// ============================================================================
// Benchmark Utility
// ============================================================================
export function createBenchmark(): { startTime: number; startMemory: number; start(): void; end(): BenchmarkResult } {
  let startTime = 0;
  let startMemory = 0;

  return {
    startTime: 0,
    startMemory: 0,
    start() {
      startTime = Date.now();
      startMemory = process.memoryUsage().heapUsed;
    },
    end() {
      return {
        startTime,
        endTime: Date.now(),
        duration: Date.now() - startTime,
        memoryDelta: process.memoryUsage().heapUsed - startMemory,
        memoryUsedMB: Math.round((process.memoryUsage().heapUsed - startMemory) / 1024 / 1024),
      };
    },
  };
}

export { TypedEventEmitter, PlayerManager, Player, Node, TrackCache, DavelinkError, ErrorCode };
