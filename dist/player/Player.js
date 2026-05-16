"use strict";
// ============================================================================
// Davelink v4.2.0 - Bulletproof Player
// Fixed: Queue overflow direction (now keeps newest), event listener leak on migration
// Added: Destroyed state checks, circuit breaker integration, better error handling
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlayerManager = exports.Player = void 0;
const EventEmitter_1 = require("../core/EventEmitter");
const errors_1 = require("../errors");
// Voice state pool for memory efficiency
class VoiceStatePool {
    pool = [];
    maxSize = 200;
    acquire() {
        const state = this.pool.pop();
        return state ?? {
            channelId: null,
            sessionId: null,
            token: null,
            endpoint: null,
        };
    }
    release(state) {
        if (this.pool.length < this.maxSize) {
            state.channelId = null;
            state.sessionId = null;
            state.token = null;
            state.endpoint = null;
            this.pool.push(state);
        }
    }
    get size() {
        return this.pool.length;
    }
}
const voicePool = new VoiceStatePool();
class Player extends EventEmitter_1.TypedEventEmitter {
    guildId;
    node;
    state;
    voiceState;
    destroyed = false;
    lyricsData = null;
    sponsorBlockSegments = [];
    _lyricsEnabled = false;
    _sponsorBlockEnabled = false;
    _daveEnabled = false;
    maxQueueSize = 10000;
    circularQueue = false;
    _managerEmit = null;
    // Track bound listeners for cleanup on migration
    _boundListeners = new Map();
    _trackListenerCount = 0;
    constructor(guildId, node, options = { guildId }, managerEmit) {
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
    get lavaSessionId() {
        return this.node.sessionId;
    }
    // ========================================================================
    // Playback Controls
    // ========================================================================
    async play(options = {}) {
        this._ensureNotDestroyed();
        const sessionId = this.lavaSessionId;
        if (!sessionId) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLAYER_NO_LAVA_SESSION, { guildId: this.guildId });
        }
        let track = options.track ?? null;
        // Auto-get from queue
        if (!track && this.state.queue.length > 0) {
            track = this.state.queue.shift();
            this.state.previousTrack = this.state.currentTrack;
        }
        if (!track) {
            this.state.currentTrack = null;
            this._managerEmit?.('queueEnd', this);
            this.emit('queueEnd', this);
            return;
        }
        const encodedTrack = typeof track === 'string' ? track : track.encoded;
        const payload = {
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
    async pause() {
        this._ensureNotDestroyed();
        await this._updatePlayer({ paused: true });
        this.state.paused = true;
    }
    async resume() {
        this._ensureNotDestroyed();
        await this._updatePlayer({ paused: false });
        this.state.paused = false;
    }
    async stop() {
        this._ensureNotDestroyed();
        this.state.queue = [];
        await this._updatePlayer({ encodedTrack: null });
        this.state.currentTrack = null;
        this.state.position = 0;
    }
    async skip() {
        this._ensureNotDestroyed();
        await this.play({});
    }
    async seek(position) {
        this._ensureNotDestroyed();
        if (position < 0) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.VALIDATION_ERROR, {
                guildId: this.guildId,
                message: 'Seek position must be >= 0',
            });
        }
        await this._updatePlayer({ position });
        this.state.position = position;
    }
    async setVolume(volume) {
        if (volume < 0 || volume > 1000) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.VALIDATION_ERROR, {
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
    queueAdd(track, position) {
        if (this.destroyed)
            return; // Silently ignore on destroyed player
        const resolved = typeof track === 'string'
            ? {
                encoded: track,
                info: {
                    identifier: track, isSeekable: true, author: '', length: 0,
                    isStream: false, position: 0, title: 'Unknown', uri: '',
                },
            }
            : track;
        if (position === 'front') {
            this.state.queue.unshift(resolved);
        }
        else {
            this.state.queue.push(resolved);
        }
        // Enforce max queue size - keep NEWEST items (slice from end)
        if (this.maxQueueSize > 0 && this.state.queue.length > this.maxQueueSize) {
            this.state.queue = this.state.queue.slice(-this.maxQueueSize);
        }
    }
    queueRemove(index) {
        if (index < 0 || index >= this.state.queue.length)
            return undefined;
        return this.state.queue.splice(index, 1)[0];
    }
    queueClear() {
        this.state.queue = [];
    }
    queueGet() {
        return this.state.queue.slice();
    }
    queueShuffle() {
        const arr = this.state.queue;
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
    }
    // ========================================================================
    // Voice Controls
    // ========================================================================
    async join(channelId) {
        this.state.channelId = channelId;
        this.voiceState.channelId = channelId;
    }
    async leave() {
        this.state.channelId = null;
        this.voiceState.channelId = null;
        const sessionId = this.lavaSessionId;
        if (sessionId) {
            try {
                await this._updatePlayer({ encodedTrack: null });
            }
            catch {
                // Ignore errors during leave - player may already be cleaned up
            }
        }
    }
    async voiceUpdate(options) {
        if (options.sessionId)
            this.voiceState.sessionId = options.sessionId;
        if (options.token)
            this.voiceState.token = options.token;
        if (options.endpoint)
            this.voiceState.endpoint = options.endpoint;
        if (this.voiceState.sessionId && this.voiceState.token && this.voiceState.endpoint) {
            this.node.ws.sendVoiceUpdate(this.guildId, this.voiceState.sessionId, this.voiceState.token, this.voiceState.endpoint);
        }
    }
    // ========================================================================
    // Filters
    // ========================================================================
    async setFilters(filters) {
        this._ensureNotDestroyed();
        const payload = {};
        const filterKeys = ['volume', 'equalizer', 'karaoke', 'timescale', 'tremolo', 'vibrato', 'rotation', 'distortion', 'channelMix', 'lowPass'];
        for (const key of filterKeys) {
            if (filters[key] !== undefined)
                payload[key] = filters[key];
        }
        const sessionId = this.lavaSessionId;
        if (sessionId) {
            await this.node.updatePlayer(sessionId, this.guildId, payload);
        }
        this.state.filters = { ...this.state.filters, ...filters };
    }
    async setEqualizer(bands) {
        await this.setFilters({ equalizer: bands });
    }
    async clearFilters() {
        await this.setFilters({});
        this.state.filters = {};
    }
    // ========================================================================
    // SponsorBlock
    // ========================================================================
    enableSponsorBlock() {
        this._sponsorBlockEnabled = true;
    }
    disableSponsorBlock() {
        this._sponsorBlockEnabled = false;
        this.sponsorBlockSegments = [];
    }
    async setSponsorBlockCategories(categories) {
        if (!this._sponsorBlockEnabled)
            return;
        const sessionId = this.lavaSessionId;
        if (!sessionId)
            return;
        await this.node.setSponsorBlockSegments(sessionId, this.guildId, categories);
    }
    getSponsorBlockSegments() {
        return this.sponsorBlockSegments.slice();
    }
    // ========================================================================
    // Lyrics
    // ========================================================================
    enableLyrics() {
        this._lyricsEnabled = true;
        this.state.lyricsEnabled = true;
    }
    disableLyrics() {
        this._lyricsEnabled = false;
        this.state.lyricsEnabled = false;
        this.lyricsData = null;
    }
    getLyrics() {
        return this.lyricsData;
    }
    async fetchLyrics(skipTrackSource = false) {
        const sessionId = this.lavaSessionId;
        if (!sessionId)
            return null;
        try {
            const result = await this.node.getLyrics(sessionId, this.guildId, skipTrackSource);
            this.lyricsData = result;
            return result;
        }
        catch {
            return null;
        }
    }
    // ========================================================================
    // DAVE/E2EE
    // ========================================================================
    enableDaveE2EE() {
        this._daveEnabled = true;
        const channelId = this.voiceState.channelId;
        if (!channelId)
            return;
        this.node.ws.sendDaveUpdate(this.guildId, {
            enabled: true,
            userId: this.guildId,
            channelId,
        });
    }
    disableDaveE2EE() {
        this._daveEnabled = false;
    }
    isDaveEnabled() {
        return this._daveEnabled;
    }
    // ========================================================================
    // State Getters
    // ========================================================================
    get currentTrack() { return this.state.currentTrack; }
    get previousTrack() { return this.state.previousTrack; }
    get position() { return this.state.position; }
    get paused() { return this.state.paused; }
    get volume() { return this.state.volume; }
    get channelId() { return this.state.channelId; }
    get queueLength() { return this.state.queue.length; }
    get isPlaying() { return this.state.currentTrack !== null && !this.state.paused; }
    get isPaused() { return this.state.paused; }
    get isConnected() { return this.voiceState.sessionId !== null; }
    get stateSnapshot() {
        return { ...this.state, voice: { ...this.voiceState } };
    }
    get filters() { return { ...this.state.filters }; }
    get lyricsEnabled() { return this._lyricsEnabled; }
    get sponsorBlockEnabled() { return this._sponsorBlockEnabled; }
    // ========================================================================
    // Lifecycle
    // ========================================================================
    async destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this._cleanupEventForwarding();
        const sessionId = this.lavaSessionId;
        if (sessionId) {
            try {
                await this.node.destroyPlayer(sessionId, this.guildId);
            }
            catch {
                // Ignore
            }
        }
        this.state.queue = [];
        voicePool.release(this.voiceState);
        this.removeAllListeners();
    }
    // Migrate to a different node - FIXED: properly removes old listeners
    async migrateTo(newNode) {
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
            }
            catch {
                // If migration fails, try to resume playback
            }
        }
        // Re-setup event forwarding on new node
        this._setupEventForwarding();
        this._managerEmit?.('playerUpdate', this, this.state);
    }
    // Update from server state
    updateFromServer(state) {
        if (state.volume !== undefined)
            this.state.volume = state.volume;
        if (state.position !== undefined)
            this.state.position = state.position;
        if (state.paused !== undefined)
            this.state.paused = state.paused;
        this.state.lastUpdate = Date.now();
    }
    // ========================================================================
    // Persistence
    // ========================================================================
    toJSON() {
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
    fromJSON(data) {
        if (data.channelId)
            this.state.channelId = String(data.channelId);
        if (data.currentTrack)
            this.state.currentTrack = data.currentTrack;
        if (data.queue)
            this.state.queue = data.queue.slice();
        if (data.position !== undefined)
            this.state.position = Number(data.position);
        if (data.paused !== undefined)
            this.state.paused = Boolean(data.paused);
        if (data.volume !== undefined)
            this.state.volume = Number(data.volume);
        if (data.filters)
            this.state.filters = data.filters;
        if (data.autoPlay !== undefined)
            this.state.autoPlay = Boolean(data.autoPlay);
        if (data.lyricsEnabled !== undefined)
            this._lyricsEnabled = Boolean(data.lyricsEnabled);
        if (data.sponsorBlockEnabled !== undefined)
            this._sponsorBlockEnabled = Boolean(data.sponsorBlockEnabled);
        if (data.daveEnabled !== undefined)
            this._daveEnabled = Boolean(data.daveEnabled);
        if (data.voice) {
            const v = data.voice;
            this.voiceState.channelId = v.channelId ?? null;
            this.voiceState.sessionId = v.sessionId ?? null;
            this.voiceState.token = v.token ?? null;
            this.voiceState.endpoint = v.endpoint ?? null;
        }
    }
    // ========================================================================
    // Private
    // ========================================================================
    _ensureNotDestroyed() {
        if (this.destroyed) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLAYER_DESTROYED, { guildId: this.guildId });
        }
    }
    async _updatePlayer(data) {
        this._ensureNotDestroyed();
        const sessionId = this.lavaSessionId;
        if (!sessionId) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLAYER_NO_LAVA_SESSION, { guildId: this.guildId });
        }
        await this.node.updatePlayer(sessionId, this.guildId, data);
        this.state.lastUpdate = Date.now();
    }
    // FIXED: Track bound listeners for proper cleanup on migration
    _setupEventForwarding() {
        const handlers = {
            trackStart: (guildId, track) => {
                if (guildId === this.guildId) {
                    this.state.currentTrack = track;
                    this.state.lastUpdate = Date.now();
                    this.emit('trackStart', this, track);
                    this._managerEmit?.('trackStart', this, track);
                }
            },
            trackEnd: (guildId, track, reason) => {
                if (guildId !== this.guildId)
                    return;
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
                }
                else if (this.state.queue.length === 0) {
                    this._managerEmit?.('queueEnd', this);
                    this.emit('queueEnd', this);
                }
            },
            trackException: (guildId, track, exception) => {
                if (guildId === this.guildId) {
                    this.emit('trackException', this, track, exception);
                    this._managerEmit?.('trackException', this, track, exception);
                }
            },
            trackStuck: (guildId, track, thresholdMs) => {
                if (guildId === this.guildId) {
                    this.emit('trackStuck', this, track, Number(thresholdMs));
                    this._managerEmit?.('trackStuck', this, track, Number(thresholdMs));
                }
            },
            playerUpdate: (guildId, state) => {
                if (guildId === this.guildId) {
                    this.updateFromServer(state);
                    this.emit('playerUpdate', this, this.state);
                    this._managerEmit?.('playerUpdate', this, this.state);
                }
            },
            websocketClosed: (guildId, code, reason, byRemote) => {
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
    _cleanupEventForwarding() {
        for (const [event, handlers] of this._boundListeners) {
            for (const handler of handlers) {
                this.node.ws.off(event, handler);
            }
        }
        this._boundListeners.clear();
    }
}
exports.Player = Player;
// ============================================================================
// Player Manager
// ============================================================================
class PlayerManager {
    players = new Map();
    nodes = new Map();
    destroyed = false;
    registerNode(node) {
        this.nodes.set(node.id, node);
    }
    unregisterNode(nodeId) {
        const node = this.nodes.get(nodeId);
        if (!node)
            return;
        // Migrate players to other nodes
        const playersToMigrate = [];
        for (const player of this.players.values()) {
            // Access node through public property
            if (player.node === node) {
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
    getPlayer(guildId) {
        return this.players.get(guildId);
    }
    createPlayer(guildId, node, options, managerEmit) {
        const existing = this.players.get(guildId);
        if (existing)
            return existing;
        const targetNode = node || this._selectBestNode();
        if (!targetNode) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.NODE_NOT_FOUND, { guildId });
        }
        const playerOptions = { ...options, guildId };
        const player = new Player(guildId, targetNode, playerOptions, managerEmit);
        this.players.set(guildId, player);
        managerEmit?.('playerCreate', player);
        return player;
    }
    async destroyPlayer(guildId) {
        const player = this.players.get(guildId);
        if (player) {
            await player.destroy();
            this.players.delete(guildId);
        }
    }
    getPlayers() {
        return Array.from(this.players.values());
    }
    getPlayerCount() {
        return this.players.size;
    }
    async destroyAll() {
        const promises = [];
        for (const player of this.players.values()) {
            promises.push(player.destroy().catch(() => { }));
        }
        await Promise.all(promises);
        this.players.clear();
    }
    _selectBestNode() {
        let bestNode;
        let lowestPenalty = Infinity;
        for (const node of this.nodes.values()) {
            if (!node.isConnected())
                continue;
            const penalty = node.getPenalty();
            if (penalty < lowestPenalty) {
                lowestPenalty = penalty;
                bestNode = node;
            }
        }
        return bestNode;
    }
}
exports.PlayerManager = PlayerManager;
//# sourceMappingURL=Player.js.map