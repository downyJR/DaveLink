import { Node } from './node/Node';
import { PlayerManager, Player } from './player/Player';
import { TrackCache } from './cache/TrackCache';
import { TypedEventEmitter } from './core/EventEmitter';
import { DavelinkError, ErrorCode } from './errors';
import type { ManagerOptions, NodeOptions, PlayerOptions, LoadResult, Plugin, BenchmarkResult, SearchSource } from './types';
export type LoadBalancerStrategy = 'penalty' | 'roundrobin' | 'random' | 'weighted';
export declare class DavelinkManager extends TypedEventEmitter {
    nodes: NodeStore;
    players: PlayerManager;
    cache: TrackCache;
    options: ManagerOptions;
    destroyed: boolean;
    private loadBalancer;
    private nodeWeights;
    private roundRobinIndex;
    private plugins;
    private debug;
    private userId;
    constructor(options: ManagerOptions);
    init(userId: string): this;
    connect(): void;
    addNode(options: NodeOptions): Node;
    removeNode(nodeId: string): boolean;
    getNode(nodeId: string): Node | undefined;
    getNodes(): Node[];
    createPlayer(options: PlayerOptions): Player;
    getPlayer(guildId: string): Player;
    destroyPlayer(guildId: string): Promise<void>;
    search(query: string, source?: SearchSource): Promise<LoadResult>;
    setLoadBalancer(strategy: LoadBalancerStrategy): void;
    setNodeWeight(nodeId: string, weight: number): void;
    getLoadBalancerStrategy(): string;
    loadPlugin(plugin: Plugin): void;
    unloadPlugin(name: string): boolean;
    getPlugins(): Plugin[];
    getCacheStats(): {
        trackCache: {
            size: number;
            maxSize: number;
            hits: number;
            misses: number;
            hitRate: number;
            evictions: number;
            memoryEstimate: number;
            memoryEstimateBytes: number;
        };
        totalMemoryEstimate: number;
    };
    clearCache(): void;
    getMetrics(): {
        memoryUsage: number;
        totalMemory: number;
        rss: number;
        playerCount: number;
        nodeCount: number;
        connectedNodeCount: number;
        cacheSize: number;
        uptime: number;
        loadBalancer: LoadBalancerStrategy;
        pluginCount: number;
        destroyed: boolean;
        nodeMetrics: {
            id: string;
            connected: boolean;
            stats: Record<string, unknown>;
            penalty: number;
            latency: number;
            messagesReceived: number;
            messagesSent: number;
            queueSize: number;
            reconnectAttempts: number;
            circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
            healthCheckFailures: number;
            lastHealthCheck: number;
        }[];
    };
    getNodeStats(): Array<Record<string, unknown>>;
    getDebugInfo(): {
        version: string;
        nodes: number;
        connectedNodes: number;
        players: number;
        loadBalancer: LoadBalancerStrategy;
        destroyed: boolean;
        plugins: string[];
        cacheSize: number;
    };
    destroy(): Promise<void>;
    private _emitError;
}
export declare class NodeStore {
    private nodes;
    private manager;
    constructor(manager: DavelinkManager);
    add(node: Node): void;
    get(id: string): Node | undefined;
    has(id: string): boolean;
    remove(id: string): boolean;
    getAll(): Node[];
    get size(): number;
    getConnectedCount(): number;
    select(strategy?: LoadBalancerStrategy): Node | undefined;
    setStrategy(strategy: LoadBalancerStrategy): void;
    setNodeWeight(nodeId: string, weight: number): void;
    destroyAll(): void;
}
export declare function createBenchmark(): {
    startTime: number;
    startMemory: number;
    start(): void;
    end(): BenchmarkResult;
};
export { TypedEventEmitter, PlayerManager, Player, Node, TrackCache, DavelinkError, ErrorCode };
//# sourceMappingURL=Davelink.d.ts.map