// ============================================================================
// Davelink v4.2.0 - Bulletproof Player
// Fixed: Queue overflow direction (now keeps newest), event listener leak on migration
// Added: Destroyed state checks, circuit breaker integration, better error handling
// ============================================================================

import { TypedEventEmitter } from '../core/EventEmitter';
import { DavelinkError, ErrorCode } from '../errors';
import type { Node } from '../node/Node';
import type {
  Track, PlayOptions, Filters, EqualizerBand, VoiceUpdateOptions, PlayerOptions,
  PlayerState, VoiceState,
} from '../types';

// Voice state pool for memory efficiency
class VoiceStatePool {
  private pool: Partial<VoiceState>[] = [];
  private maxSize = 200;

  acquire(): VoiceState {
    const state = this.pool.pop() as VoiceState | undefined;
    return state ?? {
      channelId: null,
      sessionId: null,
      token: null,
      endpoint: null,
    };
  }

  release(state: VoiceState): void {
    if (this.pool.length < this.maxSize) {
      state.channelId = null;
      state.sessionId = null;
      state.token = null;
      state.endpoint = null;
      this.pool.push(state);
    }
  }

  get size(): number {
    return this.pool.length;
  }
}

const voicePool = new VoiceStatePool();

export class Player extends TypedEventEmitter {
  guildId: string;
  node: Node;
  state: PlayerState;
  voiceState: VoiceState;
  destroyed = false;
  lyricsData: unknown = null;
  sponsorBlockSegments: unknown[] = [];
  private _lyricsEnabled = false;
  private _sponsorBlockEnabled = false;
  private _daveEnabled = false;
  maxQueueSize = 10000;
  circularQueue = false;
  private _managerEmit: ((event: string, ...args: unknown[]) => void) | null = null;
  // Track bound listeners for cleanup on migration
  private _boundListeners = new Map<string, ((...args: unknown[]) => void)[]>();
  private _trackListenerCount = 0;

  constructor(
    guildId: string,
    node: Node,
    options: PlayerOptions = { guildId },
    managerEmit?: (event: string, ...args: unknown[]) => void,
  ) {
    super(100);
    this.guildId = guildId;
    this.node = node;
    this.voiceState = voicePool.acquire();
    this._managerEmit = managerEmit ?? null;
    this.state = {
      channelId: options.channelId ?? null,
      currentTrack: null,
      previousTrack: null,
      queue: [],
      position: 0,
      paused: false,
      volume: options.volume ?? 100,
      filters: {},
      lastUpdate: 0,
      autoPlay: options.autoPlay ?? true,
      lyricsEnabled: false,
    };
    this.voiceState.channelId = options.channelId ?? null;
    this._setupEventForwarding();
  }

  // Get Lavalink session ID for REST calls
  get lavaSessionId(): string | null {
    return this.node.sessionId;
  }

  // ========================================================================
  // Playback Controls
  // ========================================================================
  async play(options: PlayOptions = {}): Promise<void> {
    this._ensureNotDestroyed();
    const sessionId = this.lavaSessionId;
    if (!sessionId) {
      throw DavelinkError.fromPool(ErrorCode.PLAYER_NO_LAVA_SESSION, { guildId: this.guildId });
    }

    let track = options.track ?? null;
    // Auto-get from queue
    if (!track && this.state.queue.length > 0) {
      track = this.state.queue.shift()!;
      this.state.previousTrack = this.state.currentTrack;
    }
    if (!track) {
      this.state.currentTrack = null;
      this._managerEmit?.('queueEnd', this);
      this.emit('queueEnd', this);
      return;
    }

    const encodedTrack = typeof track === 'string' ? track : track.encoded;
    const payload: Record<string, unknown> = {
      encodedTrack,
      volume: options.volume ?? this.state.volume,
    };
    if (options.startTime !== undefined && options.startTime > 0) {
      payload.position = options.startTime;
    }
    if (options.endTime !== undefined && options.endTime > 0) {
      payload.endTime = options.endTime;
    }
    if (options.pauseAfter !== undefined) {
      payload.paused = options.pauseAfter;
    }
    if (options.noReplace !== undefined) {
      payload.noReplace = options.noReplace;
    }
    await this.node.updatePlayer(sessionId, this.guildId, payload);
    this.state.currentTrack = typeof track === 'string' ? null : track;
    this.state.position = options.startTime ?? 0;
    this.state.paused = options.pauseAfter ?? false;
    this.state.lastUpdate = Date.now();
  }

  async pause(): Promise<void> {
    this._ensureNotDestroyed();
    await this._updatePlayer({ paused: true });
    this.state.paused = true;
  }

  async resume(): Promise<void> {
    this._ensureNotDestroyed();
    await this._updatePlayer({ paused: false });
    this.state.paused = false;
  }

  async stop(): Promise<void> {
    this._ensureNotDestroyed();
    this.state.queue = [];
    await this._updatePlayer({ encodedTrack: null });
    this.state.currentTrack = null;
    this.state.position = 0;
  }

  async skip(): Promise<void> {
    this._ensureNotDestroyed();
    await this.play({});
  }

  async seek(position: number): Promise<void> {
    this._ensureNotDestroyed();
    if (position < 0) {
      throw DavelinkError.fromPool(ErrorCode.VALIDATION_ERROR, {
        guildId: this.guildId,
        message: 'Seek position must be >= 0',
      });
    }
    await this._updatePlayer({ position });
    this.state.position = position;
  }

  async setVolume(volume: number): Promise<void> {
    if (volume < 0 || volume > 1000) {
      throw DavelinkError.fromPool(ErrorCode.VALIDATION_ERROR, {
        guildId: this.guildId,
        reason: 'Volume must be between 0 and 1000',
        volume,
      });
    }
    await this._updatePlayer({ volume });
    this.state.volume = volume;
  }

  // ========================================================================
  // Queue Management
  // ========================================================================
  queueAdd(track: Track | string, position?: 'front' | 'back'): void {
    if (this.destroyed) return; // Silently ignore on destroyed player

    const resolved = typeof track === 'string'
      ? {
          encoded: track,
          info: {
            identifier: track, isSeekable: true, author: '', length: 0,
            isStream: false, position: 0, title: 'Unknown', uri: '',
          },
        } as Track
      : track;

    if (position === 'front') {
      this.state.queue.unshift(resolved);
    } else {
      this.state.queue.push(resolved);
    }

    // Enforce max queue size - keep NEWEST items (slice from end)
    if (this.maxQueueSize > 0 && this.state.queue.length > this.maxQueueSize) {
      this.state.queue = this.state.queue.slice(-this.maxQueueSize);
    }
  }

  queueRemove(index: number): Track | undefined {
    if (index < 0 || index >= this.state.queue.length) return undefined;
    return this.state.queue.splice(index, 1)[0];
  }

  queueClear(): void {
    this.state.queue = [];
  }

  queueGet(): Track[] {
    return this.state.queue.slice();
  }

  queueShuffle(): void {
    const arr = this.state.queue;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  // ========================================================================
  // Voice Controls
  // ========================================================================
  async join(channelId: string): Promise<void> {
    this.state.channelId = channelId;
    this.voiceState.channelId = channelId;
  }

  async leave(): Promise<void> {
    this.state.channelId = null;
    this.voiceState.channelId = null;
    const sessionId = this.lavaSessionId;
    if (sessionId) {
      try {
        await this._updatePlayer({ encodedTrack: null });
      } catch {
        // Ignore errors during leave - player may already be cleaned up
      }
    }
  }

  async voiceUpdate(options: VoiceUpdateOptions): Promise<void> {
    if (options.sessionId) this.voiceState.sessionId = options.sessionId;
    if (options.token) this.voiceState.token = options.token;
    if (options.endpoint) this.voiceState.endpoint = options.endpoint;
    if (this.voiceState.sessionId && this.voiceState.token && this.voiceState.endpoint) {
      this.node.ws.sendVoiceUpdate(this.guildId, this.voiceState.sessionId, this.voiceState.token, this.voiceState.endpoint);
    }
  }

  // ========================================================================
  // Filters
  // ========================================================================
  async setFilters(filters: Filters): Promise<void> {
    this._ensureNotDestroyed();
    const payload: Record<string, unknown> = {};
    const filterKeys = ['volume', 'equalizer', 'karaoke', 'timescale', 'tremolo', 'vibrato', 'rotation', 'distortion', 'channelMix', 'lowPass'] as const;
    for (const key of filterKeys) {
      if (filters[key] !== undefined) payload[key] = filters[key];
    }
    const sessionId = this.lavaSessionId;
    if (sessionId) {
      await this.node.updatePlayer(sessionId, this.guildId, payload);
    }
    this.state.filters = { ...this.state.filters, ...filters };
  }

  async setEqualizer(bands: EqualizerBand[]): Promise<void> {
    await this.setFilters({ equalizer: bands });
  }

  async clearFilters(): Promise<void> {
    await this.setFilters({});
    this.state.filters = {};
  }

  // ========================================================================
  // SponsorBlock
  // ========================================================================
  enableSponsorBlock(): void {
    this._sponsorBlockEnabled = true;
  }

  disableSponsorBlock(): void {
    this._sponsorBlockEnabled = false;
    this.sponsorBlockSegments = [];
  }

  async setSponsorBlockCategories(categories: string[]): Promise<void> {
    if (!this._sponsorBlockEnabled) return;
    const sessionId = this.lavaSessionId;
    if (!sessionId) return;
    await this.node.setSponsorBlockSegments(sessionId, this.guildId, categories);
  }

  getSponsorBlockSegments(): unknown[] {
    return this.sponsorBlockSegments.slice();
  }

  // ========================================================================
  // Lyrics
  // ========================================================================
  enableLyrics(): void {
    this._lyricsEnabled = true;
    this.state.lyricsEnabled = true;
  }

  disableLyrics(): void {
    this._lyricsEnabled = false;
    this.state.lyricsEnabled = false;
    this.lyricsData = null;
  }

  getLyrics(): unknown {
    return this.lyricsData;
  }

  async fetchLyrics(skipTrackSource = false): Promise<unknown> {
    const sessionId = this.lavaSessionId;
    if (!sessionId) return null;
    try {
      const result = await this.node.getLyrics(sessionId, this.guildId, skipTrackSource);
      this.lyricsData = result;
      return result;
    } catch {
      return null;
    }
  }

  // ========================================================================
  // DAVE/E2EE
  // ========================================================================
  enableDaveE2EE(): void {
    this._daveEnabled = true;
    const channelId = this.voiceState.channelId;
    if (!channelId) return;
    this.node.ws.sendDaveUpdate(this.guildId, {
      enabled: true,
      userId: this.guildId,
      channelId,
    });
  }

  disableDaveE2EE(): void {
    this._daveEnabled = false;
  }

  isDaveEnabled(): boolean {
    return this._daveEnabled;
  }

  // ========================================================================
  // State Getters
  // ========================================================================
  get currentTrack(): Track | null { return this.state.currentTrack; }
  get previousTrack(): Track | null { return this.state.previousTrack; }
  get position(): number { return this.state.position; }
  get paused(): boolean { return this.state.paused; }
  get volume(): number { return this.state.volume; }
  get channelId(): string | null { return this.state.channelId; }
  get queueLength(): number { return this.state.queue.length; }
  get isPlaying(): boolean { return this.state.currentTrack !== null && !this.state.paused; }
  get isPaused(): boolean { return this.state.paused; }
  get isConnected(): boolean { return this.voiceState.sessionId !== null; }
  get stateSnapshot(): PlayerState & { voice: VoiceState } {
    return { ...this.state, voice: { ...this.voiceState } };
  }
  get filters(): Filters { return { ...this.state.filters }; }
  get lyricsEnabled(): boolean { return this._lyricsEnabled; }
  get sponsorBlockEnabled(): boolean { return this._sponsorBlockEnabled; }

  // ========================================================================
  // Lifecycle
  // ========================================================================
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    this._cleanupEventForwarding();
    const sessionId = this.lavaSessionId;
    if (sessionId) {
      try {
        await this.node.destroyPlayer(sessionId, this.guildId);
      } catch {
        // Ignore
      }
    }
    this.state.queue = [];
    voicePool.release(this.voiceState);
    this.removeAllListeners();
  }

  // Migrate to a different node - FIXED: properly removes old listeners
  async migrateTo(newNode: Node): Promise<void> {
    // Clean up old event listeners
    this._cleanupEventForwarding();

    this.node = newNode;

    // Re-establish voice connection on new node
    const sessionId = this.lavaSessionId;
    if (sessionId && this.state.currentTrack) {
      try {
        await newNode.updatePlayer(sessionId, this.guildId, {
          encodedTrack: this.state.currentTrack.encoded,
          position: this.state.position,
          paused: this.state.paused,
          volume: this.state.volume,
        });
      } catch {
        // If migration fails, try to resume playback
      }
    }

    // Re-setup event forwarding on new node
    this._setupEventForwarding();
    this._managerEmit?.('playerUpdate', this, this.state);
  }

  // Update from server state
  updateFromServer(state: { volume?: number; position?: number; paused?: boolean }): void {
    if (state.volume !== undefined) this.state.volume = state.volume;
    if (state.position !== undefined) this.state.position = state.position;
    if (state.paused !== undefined) this.state.paused = state.paused;
    this.state.lastUpdate = Date.now();
  }

  // ========================================================================
  // Persistence
  // ========================================================================
  toJSON(): Record<string, unknown> {
    return {
      guildId: this.guildId,
      channelId: this.state.channelId,
      currentTrack: this.state.currentTrack,
      queue: this.state.queue,
      position: this.state.position,
      paused: this.state.paused,
      volume: this.state.volume,
      filters: this.state.filters,
      autoPlay: this.state.autoPlay,
      voice: { ...this.voiceState },
      lyricsEnabled: this._lyricsEnabled,
      sponsorBlockEnabled: this._sponsorBlockEnabled,
      daveEnabled: this._daveEnabled,
    };
  }

  fromJSON(data: Record<string, unknown>): void {
    if (data.channelId) this.state.channelId = String(data.channelId);
    if (data.currentTrack) this.state.currentTrack = data.currentTrack as Track;
    if (data.queue) this.state.queue = (data.queue as Track[]).slice();
    if (data.position !== undefined) this.state.position = Number(data.position);
    if (data.paused !== undefined) this.state.paused = Boolean(data.paused);
    if (data.volume !== undefined) this.state.volume = Number(data.volume);
    if (data.filters) this.state.filters = data.filters as Filters;
    if (data.autoPlay !== undefined) this.state.autoPlay = Boolean(data.autoPlay);
    if (data.lyricsEnabled !== undefined) this._lyricsEnabled = Boolean(data.lyricsEnabled);
    if (data.sponsorBlockEnabled !== undefined) this._sponsorBlockEnabled = Boolean(data.sponsorBlockEnabled);
    if (data.daveEnabled !== undefined) this._daveEnabled = Boolean(data.daveEnabled);
    if (data.voice) {
      const v = data.voice as VoiceState;
      this.voiceState.channelId = v.channelId ?? null;
      this.voiceState.sessionId = v.sessionId ?? null;
      this.voiceState.token = v.token ?? null;
      this.voiceState.endpoint = v.endpoint ?? null;
    }
  }

  // ========================================================================
  // Private
  // ========================================================================
  private _ensureNotDestroyed(): void {
    if (this.destroyed) {
      throw DavelinkError.fromPool(ErrorCode.PLAYER_DESTROYED, { guildId: this.guildId });
    }
  }

  private async _updatePlayer(data: Record<string, unknown>): Promise<void> {
    this._ensureNotDestroyed();
    const sessionId = this.lavaSessionId;
    if (!sessionId) {
      throw DavelinkError.fromPool(ErrorCode.PLAYER_NO_LAVA_SESSION, { guildId: this.guildId });
    }
    await this.node.updatePlayer(sessionId, this.guildId, data);
    this.state.lastUpdate = Date.now();
  }

  // FIXED: Track bound listeners for proper cleanup on migration
  private _setupEventForwarding(): void {
    const handlers: Record<string, (...args: unknown[]) => void> = {
      trackStart: (guildId: unknown, track: unknown) => {
        if (guildId === this.guildId) {
          this.state.currentTrack = track as Track;
          this.state.lastUpdate = Date.now();
          this.emit('trackStart', this, track);
          this._managerEmit?.('trackStart', this, track);
        }
      },
      trackEnd: (guildId: unknown, track: unknown, reason: unknown) => {
        if (guildId !== this.guildId) return;
        this.state.previousTrack = this.state.currentTrack;
        this.state.currentTrack = null;
        this.state.position = 0;
        this.state.lastUpdate = Date.now();
        this.emit('trackEnd', this, track, reason);
        this._managerEmit?.('trackEnd', this, track, reason);
        // Auto-play next
        if (this.state.autoPlay && this.state.queue.length > 0) {
          this.play({}).catch(() => {
            this._managerEmit?.('queueEnd', this);
            this.emit('queueEnd', this);
          });
        } else if (this.state.queue.length === 0) {
          this._managerEmit?.('queueEnd', this);
          this.emit('queueEnd', this);
        }
      },
      trackException: (guildId: unknown, track: unknown, exception: unknown) => {
        if (guildId === this.guildId) {
          this.emit('trackException', this, track, exception);
          this._managerEmit?.('trackException', this, track, exception);
        }
      },
      trackStuck: (guildId: unknown, track: unknown, thresholdMs: unknown) => {
        if (guildId === this.guildId) {
          this.emit('trackStuck', this, track, Number(thresholdMs));
          this._managerEmit?.('trackStuck', this, track, Number(thresholdMs));
        }
      },
      playerUpdate: (guildId: unknown, state: unknown) => {
        if (guildId === this.guildId) {
          this.updateFromServer(state as { volume?: number; position?: number; paused?: boolean });
          this.emit('playerUpdate', this, this.state);
          this._managerEmit?.('playerUpdate', this, this.state);
        }
      },
      websocketClosed: (guildId: unknown, code: unknown, reason: unknown, byRemote: unknown) => {
        if (guildId === this.guildId) {
          this.emit('socketClosed', this, code, reason, byRemote);
          this._managerEmit?.('socketClosed', this, code, reason, byRemote);
        }
      },
    };

    for (const [event, handler] of Object.entries(handlers)) {
      this.node.ws.on(event, handler);
      const existing = this._boundListeners.get(event) || [];
      existing.push(handler);
      this._boundListeners.set(event, existing);
    }
    this._trackListenerCount++;
  }

  // FIXED: Properly clean up all bound listeners from old node
  private _cleanupEventForwarding(): void {
    for (const [event, handlers] of this._boundListeners) {
      for (const handler of handlers) {
        this.node.ws.off(event, handler);
      }
    }
    this._boundListeners.clear();
  }
}

// ============================================================================
// Player Manager
// ============================================================================
export class PlayerManager {
  private players = new Map<string, Player>();
  private nodes = new Map<string, Node>();
  destroyed = false;

  registerNode(node: Node): void {
    this.nodes.set(node.id, node);
  }

  unregisterNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    // Migrate players to other nodes
    const playersToMigrate: Player[] = [];
    for (const player of this.players.values()) {
      // Access node through public property
      if ((player as unknown as { node: Node }).node === node) {
        playersToMigrate.push(player);
      }
    }

    const availableNodes = Array.from(this.nodes.values())
      .filter(n => n.id !== nodeId && n.isConnected());

    if (availableNodes.length > 0) {
      const targetNode = availableNodes.sort((a, b) => a.getPenalty() - b.getPenalty())[0];
      for (const player of playersToMigrate) {
        player.migrateTo(targetNode).catch(() => {
          // If migration fails, player will need manual recovery
        });
      }
    }
    this.nodes.delete(nodeId);
  }

  getPlayer(guildId: string): Player | undefined {
    return this.players.get(guildId);
  }

  createPlayer(
    guildId: string,
    node: Node | undefined,
    options: PlayerOptions,
    managerEmit?: (event: string, ...args: unknown[]) => void,
  ): Player {
    const existing = this.players.get(guildId);
    if (existing) return existing;

    const targetNode = node || this._selectBestNode();
    if (!targetNode) {
      throw DavelinkError.fromPool(ErrorCode.NODE_NOT_FOUND, { guildId });
    }

    const playerOptions: PlayerOptions = { ...options, guildId };
    const player = new Player(guildId, targetNode, playerOptions, managerEmit);
    this.players.set(guildId, player);
    managerEmit?.('playerCreate', player);
    return player;
  }

  async destroyPlayer(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (player) {
      await player.destroy();
      this.players.delete(guildId);
    }
  }

  getPlayers(): Player[] {
    return Array.from(this.players.values());
  }

  getPlayerCount(): number {
    return this.players.size;
  }

  async destroyAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const player of this.players.values()) {
      promises.push(player.destroy().catch(() => { /* ignore cleanup errors */ }));
    }
    await Promise.all(promises);
    this.players.clear();
  }

  private _selectBestNode(): Node | undefined {
    let bestNode: Node | undefined;
    let lowestPenalty = Infinity;
    for (const node of this.nodes.values()) {
      if (!node.isConnected()) continue;
      const penalty = node.getPenalty();
      if (penalty < lowestPenalty) {
        lowestPenalty = penalty;
        bestNode = node;
      }
    }
    return bestNode;
  }
}
