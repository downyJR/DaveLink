"use strict";
// ============================================================================
// Davelink v4.2.0 - Bulletproof Node
// Fixed: Health check not stopped on disconnect, penalty calculation with no stats
// Added: Circuit breaker, connection pooling, better error propagation
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.Node = void 0;
const errors_1 = require("../errors");
const RESTClient_1 = require("../rest/RESTClient");
const WebSocketClient_1 = require("../ws/WebSocketClient");
class CircuitBreaker {
    state = 'CLOSED';
    failures = 0;
    nextAttempt = 0;
    threshold;
    timeout;
    halfOpenMax;
    halfOpenRequests = 0;
    constructor(threshold = 5, timeout = 30000, halfOpenMax = 3) {
        this.threshold = threshold;
        this.timeout = timeout;
        this.halfOpenMax = halfOpenMax;
    }
    canExecute() {
        if (this.state === 'CLOSED')
            return true;
        if (this.state === 'OPEN') {
            if (Date.now() >= this.nextAttempt) {
                this.state = 'HALF_OPEN';
                this.halfOpenRequests = 0;
                return true;
            }
            return false;
        }
        // HALF_OPEN
        return this.halfOpenRequests < this.halfOpenMax;
    }
    recordSuccess() {
        if (this.state === 'HALF_OPEN') {
            this.halfOpenRequests++;
            if (this.halfOpenRequests >= this.halfOpenMax) {
                this.state = 'CLOSED';
                this.failures = 0;
            }
        }
        else {
            this.failures = 0;
        }
    }
    recordFailure() {
        this.failures++;
        if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
        }
        else if (this.failures >= this.threshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
        }
    }
    getState() {
        return this.state;
    }
    getStats() {
        return {
            state: this.state,
            failures: this.failures,
            threshold: this.threshold,
            timeout: this.timeout,
            nextAttempt: this.nextAttempt,
        };
    }
    reset() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.halfOpenRequests = 0;
        this.nextAttempt = 0;
    }
}
class Node {
    id;
    hostname;
    port;
    password;
    secure;
    retryDelay;
    maxRetryAttempts;
    maxReconnectDelay;
    resumeEnabled;
    resumeTimeout;
    requestTimeout;
    ws;
    rest;
    destroyed = false;
    connected = false;
    stats = {};
    currentPenalty = 0;
    healthCheckInterval = null;
    circuitBreaker;
    lastHealthCheck = 0;
    healthCheckFailures = 0;
    constructor(options) {
        this.id = options.id ?? options.hostname;
        this.hostname = options.hostname;
        this.port = options.port;
        this.password = options.password ?? 'youshallnotpass';
        this.secure = options.secure ?? false;
        this.retryDelay = options.retryDelay ?? 5000;
        this.maxRetryAttempts = options.maxRetryAttempts ?? Infinity;
        this.maxReconnectDelay = options.maxReconnectDelay ?? 30000;
        this.resumeEnabled = options.resumeEnabled ?? true;
        this.resumeTimeout = options.resumeTimeout ?? 60;
        this.requestTimeout = options.requestTimeout ?? 10000;
        this.ws = new WebSocketClient_1.WebSocketClient(options, options.userAgent ?? 'Davelink/4.2.0');
        this.rest = new RESTClient_1.RESTClient(options, options.userAgent ?? 'Davelink/4.2.0');
        this.circuitBreaker = new CircuitBreaker(options.circuitThreshold ?? 5, options.circuitTimeout ?? 30000);
        // Forward events
        this.ws.on('open', () => {
            this.connected = true;
            this.circuitBreaker.reset();
        });
        this.ws.on('close', () => {
            this.connected = false;
        });
        this.ws.on('stats', (stats) => {
            this.stats = stats;
        });
        this.ws.on('ready', (sessionId, resumed) => {
            this.rest.setSessionId(String(sessionId));
        });
    }
    // ===================================================================
    // Connection
    // ===================================================================
    connect(userId) {
        if (this.destroyed)
            return;
        if (!this.circuitBreaker.canExecute()) {
            this.ws._emit('error', errors_1.DavelinkError.fromPool(errors_1.ErrorCode.NODE_CIRCUIT_OPEN, {
                nodeId: this.id,
                state: this.circuitBreaker.getState(),
            }));
            return;
        }
        this.ws.connect(userId);
    }
    disconnect() {
        // FIXED: Stop health check on disconnect
        this.stopHealthCheck();
        this.ws.disconnect();
        this.connected = false;
    }
    destroy() {
        if (this.destroyed)
            return;
        this.destroyed = true;
        this.stopHealthCheck();
        this.ws.destroy();
        this.rest.destroy();
    }
    // ===================================================================
    // Health Check
    // ===================================================================
    startHealthCheck(interval = 30000) {
        this.stopHealthCheck();
        this.healthCheckInterval = setInterval(async () => {
            try {
                const start = Date.now();
                await this.rest.request('GET', 'info');
                const latency = Date.now() - start;
                this.currentPenalty = Math.floor(latency / 100);
                this.lastHealthCheck = Date.now();
                this.healthCheckFailures = 0;
                this.circuitBreaker.recordSuccess();
            }
            catch (error) {
                this.healthCheckFailures++;
                this.currentPenalty += this.healthCheckFailures * 10;
                this.circuitBreaker.recordFailure();
                this.ws._emit('error', errors_1.DavelinkError.fromPool(errors_1.ErrorCode.NODE_DISCONNECTED, {
                    nodeId: this.id,
                    reason: error instanceof Error ? error.message : 'Health check failed',
                    consecutiveFailures: this.healthCheckFailures,
                }));
            }
        }, interval);
    }
    stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }
    // ===================================================================
    // Penalty Calculation
    // ===================================================================
    getPenalty() {
        let penalty = this.currentPenalty;
        const stats = this.stats;
        if (stats && typeof stats === 'object') {
            const players = stats.players ?? 0;
            const playingPlayers = stats.playingPlayers ?? 0;
            penalty += (players - playingPlayers) * 10;
            penalty += playingPlayers * 5;
            penalty += Math.round((stats.cpu?.systemLoad || 0) * 100);
            penalty += Math.round((stats.cpu?.lavalinkLoad || 0) * 100);
            const memUsed = (stats.memory?.used ?? 0);
            const memFree = (stats.memory?.free ?? 1);
            penalty += Math.round((memUsed / (memUsed + memFree)) * 100);
            const loadAverage = (stats.cpu?.lavalinkLoad ?? 0);
            if (loadAverage > 0.8) {
                penalty += 50;
            }
        }
        return Math.max(0, penalty);
    }
    // ===================================================================
    // Session
    // ===================================================================
    get sessionId() {
        return this.ws.getSessionId();
    }
    isConnected() {
        return this.ws.isConnected();
    }
    // ===================================================================
    // REST API
    // ===================================================================
    async loadTracks(query) {
        if (!this.circuitBreaker.canExecute()) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.NODE_CIRCUIT_OPEN, { nodeId: this.id });
        }
        try {
            const result = await this.rest.request('GET', `loadtracks?identifier=${encodeURIComponent(query)}`);
            this.circuitBreaker.recordSuccess();
            return result;
        }
        catch (error) {
            this.circuitBreaker.recordFailure();
            throw error;
        }
    }
    async decodeTrack(track) {
        return this.rest.request('GET', `decodetrack?encodedTrack=${encodeURIComponent(track)}`);
    }
    async decodeTracks(tracks) {
        return this.rest.request('POST', 'decodetracks', tracks);
    }
    async getLyrics(sessionId, guildId, skipTrackSource = false) {
        return this.rest.request('GET', `sessions/${sessionId}/players/${guildId}/lyrics?skipTrackSource=${skipTrackSource}`);
    }
    async setSponsorBlockSegments(sessionId, guildId, categories) {
        return this.rest.request('POST', `sessions/${sessionId}/players/${guildId}/sponsorblock/categories`, categories);
    }
    async getSponsorBlockSegments(sessionId, guildId) {
        return this.rest.request('GET', `sessions/${sessionId}/players/${guildId}/sponsorblock/categories`);
    }
    async updatePlayer(sessionId, guildId, data) {
        if (!sessionId) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.PLAYER_NO_LAVA_SESSION, { guildId });
        }
        await this.rest.request('PATCH', `sessions/${sessionId}/players/${guildId}`, data);
    }
    async destroyPlayer(sessionId, guildId) {
        await this.rest.request('DELETE', `sessions/${sessionId}/players/${guildId}`);
    }
    async getInfo() {
        return this.rest.request('GET', 'info');
    }
    async getRoutePlannerStatus() {
        return this.rest.request('GET', 'routeplanner/status');
    }
    async unmarkFailedAddress(address) {
        await this.rest.request('POST', 'routeplanner/free/address', { address });
    }
    async unmarkAllFailedAddresses() {
        await this.rest.request('POST', 'routeplanner/free/all', {});
    }
    async getLyricsByTrack(encodedTrack) {
        return this.rest.request('GET', `loadlyrics?encodedTrack=${encodeURIComponent(encodedTrack)}`);
    }
    // ===================================================================
    // Circuit Breaker
    // ===================================================================
    getCircuitBreakerState() {
        return this.circuitBreaker.getState();
    }
    getCircuitBreakerStats() {
        return this.circuitBreaker.getStats();
    }
    resetCircuitBreaker() {
        this.circuitBreaker.reset();
    }
    // ===================================================================
    // Metrics
    // ===================================================================
    getMetrics() {
        return {
            id: this.id,
            connected: this.connected,
            stats: this.stats,
            penalty: this.currentPenalty,
            latency: this.ws.getMetrics().latency,
            messagesReceived: this.ws.getMetrics().messagesReceived,
            messagesSent: this.ws.getMetrics().messagesSent,
            queueSize: this.ws.getMetrics().queueSize,
            reconnectAttempts: this.ws.getMetrics().reconnectAttempts,
            circuitState: this.circuitBreaker.getState(),
            healthCheckFailures: this.healthCheckFailures,
            lastHealthCheck: this.lastHealthCheck,
        };
    }
}
exports.Node = Node;
//# sourceMappingURL=Node.js.map