"use strict";
// ============================================================================
// Davelink v4.2.0 - Bulletproof Lavalink Manager
// Fixed: Plugin error handling, search error messages
// Added: Connection pooling, enhanced metrics, health monitoring
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCode = exports.DavelinkError = exports.TrackCache = exports.Node = exports.Player = exports.PlayerManager = exports.TypedEventEmitter = exports.NodeStore = exports.DavelinkManager = void 0;
exports.createBenchmark = createBenchmark;
const Node_1 = require("./node/Node");
Object.defineProperty(exports, "Node", { enumerable: true, get: function () { return Node_1.Node; } });
const Player_1 = require("./player/Player");
Object.defineProperty(exports, "PlayerManager", { enumerable: true, get: function () { return Player_1.PlayerManager; } });
Object.defineProperty(exports, "Player", { enumerable: true, get: function () { return Player_1.Player; } });
const TrackCache_1 = require("./cache/TrackCache");
Object.defineProperty(exports, "TrackCache", { enumerable: true, get: function () { return TrackCache_1.TrackCache; } });
const EventEmitter_1 = require("./core/EventEmitter");
Object.defineProperty(exports, "TypedEventEmitter", { enumerable: true, get: function () { return EventEmitter_1.TypedEventEmitter; } });
const errors_1 = require("./errors");
Object.defineProperty(exports, "DavelinkError", { enumerable: true, get: function () { return errors_1.DavelinkError; } });
Object.defineProperty(exports, "ErrorCode", { enumerable: true, get: function () { return errors_1.ErrorCode; } });
class DavelinkManager extends EventEmitter_1.TypedEventEmitter {
    nodes;
    players;
    cache;
    options;
    destroyed = false;
    loadBalancer = 'penalty';
    nodeWeights = new Map();
    roundRobinIndex = 0;
    plugins = new Map();
    debug;
    userId = '';
    constructor(options) {
        super(100);
        this.options = options;
        this.debug = options.debug ?? false;
        this.nodes = new NodeStore(this);
        this.players = new Player_1.PlayerManager();
        this.cache = new TrackCache_1.TrackCache(options.cache?.maxSize ?? 1000, options.cache?.ttl ?? 3600000);
        if (options.loadBalancer) {
            this.loadBalancer = options.loadBalancer;
        }
        // Register initial nodes
        if (options.nodes) {
            for (const nodeOptions of options.nodes) {
                try {
                    this.addNode(nodeOptions);
                }
                catch (error) {
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
    init(userId) {
        this.userId = userId;
        return this;
    }
    connect() {
        if (this.destroyed)
            return;
        for (const node of this.nodes.getAll()) {
            if (!node.isConnected()) {
                try {
                    node.connect(this.userId);
                    node.startHealthCheck();
                }
                catch (error) {
                    this._emitError(error);
                }
            }
        }
    }
    // ===================================================================
    // Node Management
    // ===================================================================
    addNode(options) {
        if (this.nodes.has(options.id ?? options.hostname)) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.NODE_ALREADY_EXISTS, {
                nodeId: options.id ?? options.hostname,
            });
        }
        const node = new Node_1.Node(options);
        this.nodes.add(node);
        this.players.registerNode(node);
        // Forward node events
        node.ws.on('ready', (sessionId, resumed) => {
            this.emit('nodeReady', node, Boolean(resumed));
        });
        node.ws.on('error', (error) => {
            this.emit('nodeError', node, error);
        });
        node.ws.on('close', (code, reason) => {
            this.emit('nodeDisconnect', node, code, reason);
        });
        node.ws.on('reconnecting', (attempt) => {
            this.emit('nodeReconnecting', node, attempt);
        });
        return node;
    }
    removeNode(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node)
            return false;
        this.players.unregisterNode(nodeId);
        node.destroy();
        return this.nodes.remove(nodeId);
    }
    getNode(nodeId) {
        return this.nodes.get(nodeId);
    }
    getNodes() {
        return this.nodes.getAll();
    }
    // ===================================================================
    // Player Management
    // ===================================================================
    createPlayer(options) {
        if (this.destroyed) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLAYER_DESTROYED, { guildId: options.guildId });
        }
        const node = this.nodes.select(this.loadBalancer);
        if (!node) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.NODE_NOT_FOUND, {
                guildId: options.guildId,
                message: 'No connected nodes available',
            });
        }
        return this.players.createPlayer(options.guildId, node, options, (event, ...args) => this.emit(event, ...args));
    }
    getPlayer(guildId) {
        const player = this.players.getPlayer(guildId);
        if (!player) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLAYER_NOT_FOUND, { guildId });
        }
        return player;
    }
    async destroyPlayer(guildId) {
        await this.players.destroyPlayer(guildId);
        this.emit('playerDestroy', guildId);
    }
    // ===================================================================
    // Search
    // ===================================================================
    async search(query, source) {
        if (this.destroyed) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.NODE_DISCONNECTED, { reason: 'Manager destroyed' });
        }
        const node = this.nodes.select(this.loadBalancer);
        if (!node) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.NODE_NOT_FOUND, {
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
                        this.cache.setTrack(track);
                    }
                }
                return {
                    loadType: (result.loadType ?? 'empty'),
                    data: result.data,
                    exception: result.exception,
                };
            }
            return { loadType: 'empty', data: [] };
        }
        catch (error) {
            if (error instanceof errors_1.DavelinkError)
                throw error;
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.TRACK_LOAD_FAILED, {
                identifier: query,
                message: error instanceof Error ? error.message : 'Search failed',
            });
        }
    }
    // ===================================================================
    // Load Balancer
    // ===================================================================
    setLoadBalancer(strategy) {
        this.loadBalancer = strategy;
    }
    setNodeWeight(nodeId, weight) {
        this.nodeWeights.set(nodeId, weight);
    }
    getLoadBalancerStrategy() {
        return this.loadBalancer;
    }
    // ===================================================================
    // Plugins
    // ===================================================================
    loadPlugin(plugin) {
        if (!plugin || typeof plugin.load !== 'function') {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLUGIN_INVALID, {
                message: 'Plugin must have a load function',
            });
        }
        if (!plugin.name) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLUGIN_INVALID, {
                message: 'Plugin must have a name',
            });
        }
        if (this.plugins.has(plugin.name)) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLUGIN_INVALID, {
                message: `Plugin "${plugin.name}" is already loaded`,
            });
        }
        try {
            plugin.load(this);
            this.plugins.set(plugin.name, plugin);
            this.emit('pluginLoaded', plugin.name);
        }
        catch (error) {
            // Plugin load failed - clean up
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLUGIN_LOAD_FAILED, {
                pluginName: plugin.name,
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }
    unloadPlugin(name) {
        const plugin = this.plugins.get(name);
        if (!plugin)
            return false;
        if (plugin.unload) {
            try {
                plugin.unload();
            }
            catch {
                // Ignore unload errors
            }
        }
        this.plugins.delete(name);
        return true;
    }
    getPlugins() {
        return Array.from(this.plugins.values());
    }
    // ===================================================================
    // Cache
    // ===================================================================
    getCacheStats() {
        return this.cache.getStats();
    }
    clearCache() {
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
    getNodeStats() {
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
    async destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        await this.players.destroyAll();
        this.nodes.destroyAll();
        this.cache.destroy();
        this.plugins.clear();
        this.nodeWeights.clear();
        this.removeAllListeners();
    }
    _emitError(error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.emit('error', err);
    }
}
exports.DavelinkManager = DavelinkManager;
// ============================================================================
// Node Store
// ============================================================================
class NodeStore {
    nodes = new Map();
    manager;
    constructor(manager) {
        this.manager = manager;
    }
    add(node) {
        this.nodes.set(node.id, node);
    }
    get(id) {
        return this.nodes.get(id);
    }
    has(id) {
        return this.nodes.has(id);
    }
    remove(id) {
        return this.nodes.delete(id);
    }
    getAll() {
        return Array.from(this.nodes.values());
    }
    get size() {
        return this.nodes.size;
    }
    getConnectedCount() {
        return this.getAll().filter(n => n.isConnected()).length;
    }
    select(strategy) {
        const connected = this.getAll().filter(n => n.isConnected());
        if (connected.length === 0)
            return undefined;
        const strat = strategy ?? 'penalty';
        switch (strat) {
            case 'penalty': {
                let best;
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
                let best;
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
                let best;
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
    setStrategy(strategy) {
        this.manager.setLoadBalancer(strategy);
    }
    setNodeWeight(nodeId, weight) {
        this.manager.setNodeWeight(nodeId, weight);
    }
    destroyAll() {
        for (const node of this.nodes.values()) {
            node.destroy();
        }
        this.nodes.clear();
    }
}
exports.NodeStore = NodeStore;
// ============================================================================
// Benchmark Utility
// ============================================================================
function createBenchmark() {
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
//# sourceMappingURL=Davelink.js.map