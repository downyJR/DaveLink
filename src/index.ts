// ============================================================================
// Davelink v4.2.0 - The Ultimate Lavalink Client
// TypeScript-first, memory-optimized, bulletproof audio
// ============================================================================

// Core
export { DavelinkManager, NodeStore, createBenchmark } from './Davelink';
export { TypedEventEmitter } from './core/EventEmitter';

// Node
export { Node } from './node/Node';

// Player
export { Player, PlayerManager } from './player/Player';

// WebSocket
export { WebSocketClient, createWebSocketClient } from './ws/WebSocketClient';

// REST
export { RESTClient } from './rest/RESTClient';

// Cache
export { TrackCache } from './cache/TrackCache';

// Errors
export {
  DavelinkError, ErrorCode, ErrorCodes, ErrorMessages,
  NodeError, PlayerError, TrackError, RESTError,
  WebSocketError, ValidationError, PluginError,
  fromRESTError, fromWSCloseCode, isRecoverableError,
  validateString, validateRange, assert,
} from './errors';

// Types
export type {
  Track, TrackInfo, LoadResult, PlaylistData,
  PlayerOptions, PlayerState, PlayOptions,
  VoiceState, VoiceUpdateOptions,
  Filters, EqualizerBand,
  NodeOptions, ManagerOptions,
  Plugin, NodeStats,
  Benchmark, BenchmarkResult,
  SearchSource,
} from './types';

// Version
export const VERSION = '4.2.0';

// Package info
export const name = 'davelink';
export const description = 'High-performance Lavalink client for Node.js';

// Helper to format duration
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

// Helper to parse search queries
export function parseSearchQuery(query: string): { source: string; query: string } {
  const match = query.match(/^([a-z]+)search:(.+)$/i);
  if (match) {
    return { source: match[1].toLowerCase(), query: match[2] };
  }
  return { source: 'yt', query };
}
