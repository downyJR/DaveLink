// ============================================================================
// Davelink v4.2.0 - Bulletproof Node
// Fixed: Health check not stopped on disconnect, penalty calculation with no stats
// Added: Circuit breaker, connection pooling, better error propagation
// ============================================================================

import { DavelinkError, ErrorCode } from '../errors';
import { RESTClient } from '../rest/RESTClient';
import { WebSocketClient } from '../ws/WebSocketClient';
import type { NodeOptions, Track } from '../types';

// Circuit breaker states
type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private nextAttempt = 0;
  private readonly threshold: number;
  private readonly timeout: number;
  private readonly halfOpenMax: number;
  private halfOpenRequests = 0;

  constructor(threshold = 5, timeout = 30000, halfOpenMax = 3) {
    this.threshold = threshold;
    this.timeout = timeout;
    this.halfOpenMax = halfOpenMax;
  }

  canExecute(): boolean {
    if (this.state === 'CLOSED') return true;
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

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenRequests++;
      if (this.halfOpenRequests >= this.halfOpenMax) {
        this.state = 'CLOSED';
        this.failures = 0;
      }
    } else {
      this.failures = 0;
    }
  }

  recordFailure(): void {
    this.failures++;
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
    } else if (this.failures >= this.threshold) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + this.timeout;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): Record<string, unknown> {
    return {
      state: this.state,
      failures: this.failures,
      threshold: this.threshold,
      timeout: this.timeout,
      nextAttempt: this.nextAttempt,
    };
  }

  reset(): void {
    this.state = 'CLOSED';
    this.failures = 0;
    this.halfOpenRequests = 0;
    this.nextAttempt = 0;
  }
}

export class Node {
  readonly id: string;
  readonly hostname: string;
  readonly port: number;
  readonly password: string;
  readonly secure: boolean;
  readonly retryDelay: number;
  readonly maxRetryAttempts: number;
  readonly maxReconnectDelay: number;
  readonly resumeEnabled: boolean;
  readonly resumeTimeout: number;
  readonly requestTimeout: number;
  ws: WebSocketClient;
  rest: RESTClient;
  destroyed = false;
  connected = false;
  stats: Record<string, unknown> = {};
  currentPenalty = 0;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private circuitBreaker: CircuitBreaker;
  private lastHealthCheck = 0;
  private healthCheckFailures = 0;

  constructor(options: NodeOptions) {
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
    this.ws = new WebSocketClient(options, options.userAgent ?? 'Davelink/4.2.0');
    this.rest = new RESTClient(options, options.userAgent ?? 'Davelink/4.2.0');
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
      this.stats = stats as Record<string, unknown>;
    });
    this.ws.on('ready', (sessionId: unknown, resumed: unknown) => {
      this.rest.setSessionId(String(sessionId));
    });
  }

  // ===================================================================
  // Connection
  // ===================================================================
  connect(userId: string): void {
    if (this.destroyed) return;
    if (!this.circuitBreaker.canExecute()) {
      (this.ws as unknown as { _emit: (event: string, ...args: unknown[]) => void })._emit('error', DavelinkError.fromPool(ErrorCode.NODE_CIRCUIT_OPEN, {
        nodeId: this.id,
        state: this.circuitBreaker.getState(),
      }));
      return;
    }
    this.ws.connect(userId);
  }

  disconnect(): void {
    // FIXED: Stop health check on disconnect
    this.stopHealthCheck();
    this.ws.disconnect();
    this.connected = false;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopHealthCheck();
    this.ws.destroy();
    this.rest.destroy();
  }

  // ===================================================================
  // Health Check
  // ===================================================================
  startHealthCheck(interval = 30000): void {
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
      } catch (error) {
        this.healthCheckFailures++;
        this.currentPenalty += this.healthCheckFailures * 10;
        this.circuitBreaker.recordFailure();
        (this.ws as unknown as { _emit: (event: string, ...args: unknown[]) => void })._emit('error', DavelinkError.fromPool(ErrorCode.NODE_DISCONNECTED, {
          nodeId: this.id,
          reason: error instanceof Error ? error.message : 'Health check failed',
          consecutiveFailures: this.healthCheckFailures,
        }));
      }
    }, interval);
  }

  stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  // ===================================================================
  // Penalty Calculation
  // ===================================================================
  getPenalty(): number {
    let penalty = this.currentPenalty;
    const stats = this.stats;

    if (stats && typeof stats === 'object') {
      const players = (stats.players as number) ?? 0;
      const playingPlayers = (stats.playingPlayers as number) ?? 0;
      penalty += (players - playingPlayers) * 10;
      penalty += playingPlayers * 5;
      penalty += Math.round(((stats.cpu as { systemLoad: number })?.systemLoad || 0) * 100);
      penalty += Math.round(((stats.cpu as { lavalinkLoad: number })?.lavalinkLoad || 0) * 100);

      const memUsed = ((stats.memory as { used: number })?.used ?? 0);
      const memFree = ((stats.memory as { free: number })?.free ?? 1);
      penalty += Math.round((memUsed / (memUsed + memFree)) * 100);

      const loadAverage = ((stats.cpu as { lavalinkLoad: number })?.lavalinkLoad ?? 0);
      if (loadAverage > 0.8) {
        penalty += 50;
      }
    }

    return Math.max(0, penalty);
  }

  // ===================================================================
  // Session
  // ===================================================================
  get sessionId(): string | null {
    return this.ws.getSessionId();
  }

  isConnected(): boolean {
    return this.ws.isConnected();
  }

  // ===================================================================
  // REST API
  // ===================================================================
  async loadTracks(query: string): Promise<Record<string, unknown>> {
    if (!this.circuitBreaker.canExecute()) {
      throw DavelinkError.fromPool(ErrorCode.NODE_CIRCUIT_OPEN, { nodeId: this.id });
    }
    try {
      const result = await this.rest.request('GET', `loadtracks?identifier=${encodeURIComponent(query)}`);
      this.circuitBreaker.recordSuccess();
      return result as Record<string, unknown>;
    } catch (error) {
      this.circuitBreaker.recordFailure();
      throw error;
    }
  }

  async decodeTrack(track: string): Promise<Record<string, unknown>> {
    return this.rest.request('GET', `decodetrack?encodedTrack=${encodeURIComponent(track)}`) as Promise<Record<string, unknown>>;
  }

  async decodeTracks(tracks: string[]): Promise<Record<string, unknown>[]> {
    return this.rest.request('POST', 'decodetracks', tracks) as Promise<Record<string, unknown>[]>;
  }

  async getLyrics(sessionId: string, guildId: string, skipTrackSource = false): Promise<unknown> {
    return this.rest.request('GET', `sessions/${sessionId}/players/${guildId}/lyrics?skipTrackSource=${skipTrackSource}`);
  }

  async setSponsorBlockSegments(sessionId: string, guildId: string, categories: string[]): Promise<unknown> {
    return this.rest.request('POST', `sessions/${sessionId}/players/${guildId}/sponsorblock/categories`, categories);
  }

  async getSponsorBlockSegments(sessionId: string, guildId: string): Promise<unknown> {
    return this.rest.request('GET', `sessions/${sessionId}/players/${guildId}/sponsorblock/categories`);
  }

  async updatePlayer(sessionId: string, guildId: string, data: Record<string, unknown>): Promise<void> {
    if (!sessionId) {
      throw DavelinkError.fromPool(ErrorCode.PLAYER_NO_LAVA_SESSION, { guildId });
    }
    await this.rest.request('PATCH', `sessions/${sessionId}/players/${guildId}`, data);
  }

  async destroyPlayer(sessionId: string, guildId: string): Promise<void> {
    await this.rest.request('DELETE', `sessions/${sessionId}/players/${guildId}`);
  }

  async getInfo(): Promise<Record<string, unknown>> {
    return this.rest.request('GET', 'info') as Promise<Record<string, unknown>>;
  }

  async getRoutePlannerStatus(): Promise<Record<string, unknown>> {
    return this.rest.request('GET', 'routeplanner/status') as Promise<Record<string, unknown>>;
  }

  async unmarkFailedAddress(address: string): Promise<void> {
    await this.rest.request('POST', 'routeplanner/free/address', { address });
  }

  async unmarkAllFailedAddresses(): Promise<void> {
    await this.rest.request('POST', 'routeplanner/free/all', {});
  }

  async getLyricsByTrack(encodedTrack: string): Promise<unknown> {
    return this.rest.request('GET', `loadlyrics?encodedTrack=${encodeURIComponent(encodedTrack)}`);
  }

  // ===================================================================
  // Circuit Breaker
  // ===================================================================
  getCircuitBreakerState(): string {
    return this.circuitBreaker.getState();
  }

  getCircuitBreakerStats(): Record<string, unknown> {
    return this.circuitBreaker.getStats();
  }

  resetCircuitBreaker(): void {
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
