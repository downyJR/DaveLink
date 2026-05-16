// ============================================================================
// Davelink v4.2.0 - Complete Type Definitions
// Added: All missing types, better documentation
// ============================================================================

/**
 * Track information from Lavalink
 */
export interface TrackInfo {
  identifier: string;
  isSeekable: boolean;
  author: string;
  length: number;
  isStream: boolean;
  position: number;
  title: string;
  uri: string;
  sourceName?: string;
  artworkUrl?: string;
  isrc?: string;
}

/**
 * Track object
 */
export interface Track {
  encoded: string;
  info: TrackInfo;
  pluginInfo?: Record<string, unknown>;
}

/**
 * Track loading result
 */
export interface LoadResult {
  loadType: 'track' | 'playlist' | 'search' | 'empty' | 'error';
  data: Track[] | PlaylistData | { info: { identifier: string } }[];
  exception?: { message: string; severity: string };
}

/**
 * Playlist data
 */
export interface PlaylistData {
  info: {
    name: string;
    selectedTrack: number;
  };
  tracks: Track[];
  pluginInfo?: Record<string, unknown>;
}

/**
 * Player options
 */
export interface PlayerOptions {
  guildId: string;
  channelId?: string | null;
  autoPlay?: boolean;
  volume?: number;
  maxQueueSize?: number;
  circularQueue?: boolean;
  resume?: boolean;
}

/**
 * Play options
 */
export interface PlayOptions {
  track?: Track | string | null;
  startTime?: number;
  endTime?: number;
  volume?: number;
  pauseAfter?: boolean;
  noReplace?: boolean;
}

/**
 * Voice state
 */
export interface VoiceState {
  channelId: string | null;
  sessionId: string | null;
  token: string | null;
  endpoint: string | null;
}

/**
 * Voice update options
 */
export interface VoiceUpdateOptions {
  guildId?: string;
  sessionId?: string;
  token?: string;
  endpoint?: string;
}

/**
 * Player state
 */
export interface PlayerState {
  channelId: string | null;
  currentTrack: Track | null;
  previousTrack: Track | null;
  queue: Track[];
  position: number;
  paused: boolean;
  volume: number;
  filters: Filters;
  lastUpdate: number;
  autoPlay: boolean;
  lyricsEnabled: boolean;
}

/**
 * Audio filters
 */
export interface Filters {
  volume?: number;
  equalizer?: EqualizerBand[];
  karaoke?: { level: number; monoLevel: number; filterBand: number; filterWidth: number };
  timescale?: { speed: number; pitch: number; rate: number };
  tremolo?: { depth: number; frequency: number };
  vibrato?: { depth: number; frequency: number };
  rotation?: { rotationHz: number };
  distortion?: {
    sinOffset: number; sinScale: number; cosOffset: number; cosScale: number;
    tanOffset: number; tanScale: number; offset: number; scale: number;
  };
  channelMix?: {
    leftToLeft: number; leftToRight: number; rightToLeft: number; rightToRight: number;
  };
  lowPass?: { smoothing: number };
}

/**
 * Equalizer band
 */
export interface EqualizerBand {
  band: number;
  gain: number;
}

/**
 * Node options
 */
export interface NodeOptions {
  id?: string;
  hostname: string;
  port: number;
  password?: string;
  secure?: boolean;
  retryDelay?: number;
  maxRetryAttempts?: number;
  maxReconnectDelay?: number;
  resumeEnabled?: boolean;
  resumeTimeout?: number;
  requestTimeout?: number;
  userAgent?: string;
  circuitThreshold?: number;
  circuitTimeout?: number;
}

/**
 * Manager options
 */
export interface ManagerOptions {
  nodes: NodeOptions[];
  userAgent?: string;
  loadBalancer?: string;
  debug?: boolean;
  cache?: { maxSize?: number; ttl?: number };
}

/**
 * Plugin interface
 */
export interface Plugin {
  name: string;
  version?: string;
  load(manager: unknown): void;
  unload?(): void;
}

/**
 * Node stats
 */
export interface NodeStats {
  players: number;
  playingPlayers: number;
  uptime: number;
  memory: { free: number; used: number; allocated: number; reservable: number };
  cpu: { cores: number; systemLoad: number; lavalinkLoad: number };
  frameStats?: { sent: number; nulled: number; deficit: number };
}

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  startTime: number;
  endTime: number;
  duration: number;
  memoryDelta: number;
  memoryUsedMB: number;
}

/**
 * Benchmark utility
 */
export interface Benchmark {
  startTime: number;
  startMemory: number;
  start(): void;
  end(): BenchmarkResult;
}

// Search source identifiers
export type SearchSource = 'ytsearch' | 'spsearch' | 'amsearch' | 'scsearch' | 'dzsearch' | 'ytmsearch';
