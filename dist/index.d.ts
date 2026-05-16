export { DavelinkManager, NodeStore, createBenchmark } from './Davelink';
export { TypedEventEmitter } from './core/EventEmitter';
export { Node } from './node/Node';
export { Player, PlayerManager } from './player/Player';
export { WebSocketClient, createWebSocketClient } from './ws/WebSocketClient';
export { RESTClient } from './rest/RESTClient';
export { TrackCache } from './cache/TrackCache';
export { DavelinkError, ErrorCode, ErrorCodes, ErrorMessages, NodeError, PlayerError, TrackError, RESTError, WebSocketError, ValidationError, PluginError, fromRESTError, fromWSCloseCode, isRecoverableError, validateString, validateRange, assert, } from './errors';
export type { Track, TrackInfo, LoadResult, PlaylistData, PlayerOptions, PlayerState, PlayOptions, VoiceState, VoiceUpdateOptions, Filters, EqualizerBand, NodeOptions, ManagerOptions, Plugin, NodeStats, Benchmark, BenchmarkResult, SearchSource, } from './types';
export declare const VERSION = "4.2.0";
export declare const name = "davelink";
export declare const description = "High-performance Lavalink client for Node.js";
export declare function formatDuration(ms: number): string;
export declare function parseSearchQuery(query: string): {
    source: string;
    query: string;
};
//# sourceMappingURL=index.d.ts.map