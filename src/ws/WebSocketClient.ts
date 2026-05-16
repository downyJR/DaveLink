// ============================================================================
// Davelink v4.2.0 - Bulletproof WebSocket Client
// Fixed: Unhandled error on terminate during CONNECTING state
// Added: Message queue clearing on disconnect, proper error handling
// ============================================================================

import WebSocket from 'ws';
import { DavelinkError, ErrorCode } from '../errors';
import type { NodeOptions } from '../types';

interface ExponentialBackoffConfig {
  baseDelay?: number;
  maxDelay?: number;
  multiplier?: number;
  jitter?: number;
}

class ExponentialBackoff {
  private attempt = 0;
  private baseDelay: number;
  private maxDelay: number;
  private multiplier: number;
  private jitter: number;

  constructor(config: ExponentialBackoffConfig = {}) {
    this.baseDelay = config.baseDelay ?? 1000;
    this.maxDelay = config.maxDelay ?? 30000;
    this.multiplier = config.multiplier ?? 1.5;
    this.jitter = config.jitter ?? 1000;
  }

  getDelay(): number {
    this.attempt++;
    const exponential = this.baseDelay * Math.pow(this.multiplier, this.attempt - 1);
    const jitter = Math.random() * this.jitter;
    return Math.min(exponential + jitter, this.maxDelay);
  }

  reset(): void {
    this.attempt = 0;
  }

  getAttempt(): number {
    return this.attempt;
  }
}

// Helper to build URL without default ports
function buildWSUrl(hostname: string, port: number, secure: boolean): string {
  const protocol = secure ? 'wss' : 'ws';
  const isDefaultPort = (secure && port === 443) || (!secure && port === 80);
  if (isDefaultPort) {
    return `${protocol}://${hostname}/v4/websocket`;
  }
  return `${protocol}://${hostname}:${port}/v4/websocket`;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private node: Required<Pick<NodeOptions, 'hostname' | 'port' | 'password' | 'secure' | 'maxRetryAttempts' | 'retryDelay' | 'maxReconnectDelay' | 'resumeEnabled' | 'resumeTimeout'>> & { id: string; userAgent: string; requestTimeout: number };
  private userId = '0';
  private resumeKey: string | null = null;
  private connected = false;
  private destroyed = false;
  private connecting = false;
  private sessionIdValue: string | null = null;
  private resumeEnabled = true;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private heartbeatAck = true;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectTimeout: NodeJS.Timeout | null = null;
  private heartbeatTimer = 30000;
  private messageQueue: unknown[] = [];
  private backoff: ExponentialBackoff;
  private lastPingTime = 0;
  private latencyValue = 0;
  private pongTime = 0;
  private messagesReceived = 0;
  private messagesSent = 0;
  private reconnectAttempts = 0;
  private userAgent: string;
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private sessionTimeout: NodeJS.Timeout | null = null;
  private connectErrorHandler: ((err: Error) => void) | null = null;

  constructor(node: NodeOptions, userAgent = 'Davelink/4.2.0') {
    this.node = {
      id: node.id ?? `node-${Date.now()}`,
      hostname: node.hostname,
      port: node.port,
      password: node.password ?? 'youshallnotpass',
      secure: node.secure ?? false,
      maxRetryAttempts: node.maxRetryAttempts ?? Infinity,
      retryDelay: node.retryDelay ?? 5000,
      maxReconnectDelay: node.maxReconnectDelay ?? 30000,
      resumeEnabled: node.resumeEnabled ?? true,
      resumeTimeout: node.resumeTimeout ?? 60,
      requestTimeout: node.requestTimeout ?? 10000,
      userAgent,
    };
    this.userAgent = userAgent;
    this.resumeEnabled = this.node.resumeEnabled;
    this.backoff = new ExponentialBackoff({
      baseDelay: node.retryDelay ?? 1000,
      maxDelay: node.maxReconnectDelay ?? 30000,
      multiplier: 1.5,
      jitter: 500,
    });
  }

  // ===================================================================
  // Public API
  // ===================================================================
  connect(userId?: string): void {
    if (this.destroyed) return;
    if (this.connected || this.connecting) return;
    if (userId) this.userId = userId;
    this.connecting = true;

    const url = buildWSUrl(this.node.hostname, this.node.port, this.node.secure);
    const headers: Record<string, string> = {
      'Authorization': this.node.password,
      'User-Id': this.userId,
      'Client-Name': this.userAgent,
    };

    if (this.resumeKey && this.resumeEnabled) {
      headers['Resume-Key'] = this.resumeKey;
      headers['Session-Id'] = this.sessionIdValue ?? '';
    }

    // Connection timeout
    this.connectTimeout = setTimeout(() => {
      if (this.ws?.readyState === WebSocket.CONNECTING) {
        // FIXED: Use close instead of terminate to avoid unhandled error
        try {
          this.ws.close(1006, 'Connection timeout');
        } catch {
          // If close fails, force terminate with error handler
          this._safeTerminate();
        }
      }
      this._handleReconnect('Connection timeout (10s)');
    }, 10000);

    try {
      this.ws = new WebSocket(url, {
        headers,
        handshakeTimeout: 10000,
        perMessageDeflate: true,
        followRedirects: true,
        maxRedirects: 5,
      });

      // FIXED: Store error handler reference for proper cleanup
      this.connectErrorHandler = (err: Error) => {
        if (!this.destroyed) {
          clearTimeout(this.connectTimeout!);
          this.connecting = false;
          this._handleReconnect(err.message);
        }
      };

      this.ws.once('error', this.connectErrorHandler);
      this.ws.once('open', () => {
        // Remove the connect error handler once connected
        if (this.connectErrorHandler) {
          this.ws?.off('error', this.connectErrorHandler);
          this.connectErrorHandler = null;
        }
      });

      this._setupEventHandlers();
    } catch (error) {
      clearTimeout(this.connectTimeout!);
      this.connecting = false;
      this._handleReconnect(error instanceof Error ? error.message : 'Unknown error');
    }
  }

  disconnect(code = 1000, reason = 'Client disconnecting'): void {
    if (this.destroyed) return;
    this._cleanup();
    // FIXED: Clear message queue on disconnect
    this.messageQueue = [];
    try {
      this.ws?.close(code, reason);
    } catch {
      // Ignore close errors
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this._cleanup();

    if (this.ws) {
      const ws = this.ws;
      this.ws = null;

      // FIXED: Remove all error listeners before terminating
      ws.removeAllListeners('error');
      ws.removeAllListeners('close');

      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.close(1000, 'Client destroyed');
        } catch { /* ignore */ }
      } else if (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.CLOSING) {
        // FIXED: Use _safeTerminate to prevent unhandled errors
        this._safeTerminate(ws);
      }
    }
    this.listeners.clear();
    this.messageQueue = [];
  }

  send(data: unknown): boolean {
    if (this.destroyed) return false;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.messageQueue.push(data);
      return false;
    }
    try {
      const json = typeof data === 'string' ? data : JSON.stringify(data);
      this.ws.send(json);
      this.messagesSent++;
      return true;
    } catch {
      this.messageQueue.push(data);
      return false;
    }
  }

  sendVoiceUpdate(guildId: string, sessionId: string, token: string, endpoint: string): boolean {
    return this.send({
      op: 'voiceUpdate',
      guildId,
      sessionId,
      event: { token, endpoint, guild_id: guildId },
    });
  }

  sendPlayerUpdate(guildId: string, data: Record<string, unknown>): boolean {
    return this.send({
      op: 'playerUpdate',
      guildId,
      ...data,
    });
  }

  sendDaveUpdate(guildId: string, config: Record<string, unknown>): boolean {
    return this.send({
      op: 'dave',
      type: 'init',
      guildId,
      config,
    });
  }

  setUserId(userId: string): void {
    this.userId = userId;
  }

  setResumeKey(key: string): void {
    this.resumeKey = key;
  }

  getSessionId(): string | null {
    return this.sessionIdValue;
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  getMetrics() {
    return {
      latency: this.latencyValue,
      messagesReceived: this.messagesReceived,
      messagesSent: this.messagesSent,
      queueSize: this.messageQueue.length,
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      sessionId: this.sessionIdValue,
    };
  }

  // ===================================================================
  // Event System
  // ===================================================================
  on(event: string, listener: (...args: unknown[]) => void): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  once(event: string, listener: (...args: unknown[]) => void): this {
    const onceListener = (...args: unknown[]) => {
      this.off(event, onceListener);
      listener(...args);
    };
    return this.on(event, onceListener);
  }

  off(event: string, listener: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  _emit(event: string, ...args: unknown[]): void {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.size === 0) return;
    const snapshot = Array.from(listeners);
    for (const listener of snapshot) {
      try {
        listener(...args);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this._emitError(err);
      }
    }
  }

  // ===================================================================
  // Private Handlers
  // ===================================================================
  private _setupEventHandlers(): void {
    if (!this.ws) return;
    this.ws.on('open', () => this._handleOpen());
    this.ws.on('message', (data: WebSocket.Data) => this._handleMessage(data));
    this.ws.on('close', (code: number, reason: Buffer) => this._handleClose(code, reason));
    // Note: error handler is set via once in connect() and removed on open
    this.ws.on('ping', () => this.ws?.pong());
    this.ws.on('pong', () => this._handlePong());
  }

  private _handleOpen(): void {
    clearTimeout(this.connectTimeout!);
    this.connecting = false;
    this.connected = true;
    this.reconnectAttempts = 0;
    this.backoff.reset();
    this._emit('open');
  }

  private _handleMessage(data: WebSocket.Data): void {
    this.messagesReceived++;
    try {
      const payload = JSON.parse(data.toString());
      this._emit('raw', payload);
      switch (payload.op) {
        case 'ready':
          this._handleReady(payload);
          break;
        case 'stats':
          this._handleStats(payload);
          break;
        case 'playerUpdate':
          this._handlePlayerUpdate(payload);
          break;
        case 'event':
          this._handleEvent(payload);
          break;
        default:
          this._emit('message', payload);
      }
    } catch (error) {
      this._emitError(DavelinkError.fromPool(ErrorCode.WS_MESSAGE_ERROR, {
        nodeId: this.node.id,
        reason: error instanceof Error ? error.message : 'Parse error',
      }));
    }
  }

  private _handleReady(payload: { sessionId: string; resumed?: boolean }): void {
    this.sessionIdValue = payload.sessionId;
    this.resumeKey = payload.sessionId;
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
    this._startHeartbeat();
    this._emit('ready', this.sessionIdValue, payload.resumed ?? false);
    this._flushMessageQueue();
  }

  private _handleStats(stats: unknown): void {
    this._emit('stats', stats);
  }

  private _handlePlayerUpdate(payload: { guildId: string | number; state: unknown }): void {
    const guildId = String(payload.guildId);
    const state = payload.state;
    this._emit('playerUpdate', guildId, state);
  }

  private _handleEvent(payload: { guildId: string; type: string; track?: unknown; reason?: string; exception?: unknown; thresholdMs?: number; code?: number; byRemote?: boolean }): void {
    const { guildId, type } = payload;
    switch (type) {
      case 'TrackStartEvent': {
        this._emit('trackStart', guildId, payload.track);
        break;
      }
      case 'TrackEndEvent': {
        this._emit('trackEnd', guildId, payload.track, payload.reason);
        break;
      }
      case 'TrackExceptionEvent': {
        this._emit('trackException', guildId, payload.track, payload.exception);
        break;
      }
      case 'TrackStuckEvent': {
        this._emit('trackStuck', guildId, payload.track, payload.thresholdMs);
        break;
      }
      case 'WebSocketClosedEvent': {
        this._emit('websocketClosed', guildId, payload.code, payload.reason, payload.byRemote);
        break;
      }
    }
    this._emit('message', payload);
  }

  private _handleClose(code: number, reason: Buffer): void {
    this.connected = false;
    this._stopHeartbeat();
    clearTimeout(this.connectTimeout!);
    const reasonStr = reason.toString();
    this._emit('close', code, reasonStr);
    if (code === 1000 || code === 1001) return;
    if (code === 4001) {
      this._emitError(DavelinkError.fromPool(ErrorCode.NODE_AUTHENTICATION_FAILED, {
        nodeId: this.node.id,
        code,
        reason: reasonStr,
      }));
      return;
    }
    this._handleReconnect(`WebSocket closed: ${code} - ${reasonStr}`);
  }

  private _handleReconnect(reason: string): void {
    if (this.destroyed) return;
    const attempt = this.backoff.getAttempt();
    const maxRetries = this.node.maxRetryAttempts;
    if (attempt > 0 && attempt > maxRetries) {
      this.connecting = false;
      this._emitError(DavelinkError.fromPool(ErrorCode.NODE_MAX_RETRIES_EXCEEDED, {
        nodeId: this.node.id,
        reason,
        attempts: attempt,
      }));
      return;
    }
    this.reconnectAttempts = attempt;
    // Emit event with current attempt, THEN increment for next delay
    this._emit('reconnecting', attempt);
    const delay = this.backoff.getDelay();
    this.reconnectTimer = setTimeout(() => {
      this.connecting = false;
      this.connect(this.userId);
    }, delay);
  }

  private _handlePong(): void {
    this.pongTime = Date.now();
    this.latencyValue = Math.max(0, this.pongTime - this.lastPingTime);
    this.heartbeatAck = true;
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this.heartbeatAck = true;
    this.heartbeatInterval = setInterval(() => {
      if (!this.heartbeatAck) {
        this._safeTerminate();
        this._handleReconnect('Heartbeat timeout');
        return;
      }
      this.heartbeatAck = false;
      this.lastPingTime = Date.now();
      try {
        this.ws?.ping();
      } catch {
        this._handleReconnect('Failed to send heartbeat');
      }
    }, this.heartbeatTimer);
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private _flushMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.connected && this.ws?.readyState === WebSocket.OPEN) {
      const msg = this.messageQueue.shift();
      if (msg) this.send(msg);
    }
  }

  private _cleanup(): void {
    this._stopHeartbeat();
    this.connected = false;
    this.connecting = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.connectTimeout) {
      clearTimeout(this.connectTimeout);
      this.connectTimeout = null;
    }
    if (this.sessionTimeout) {
      clearTimeout(this.sessionTimeout);
      this.sessionTimeout = null;
    }
  }

  // FIXED: Safe terminate that prevents unhandled error events
  private _safeTerminate(ws?: WebSocket): void {
    const target = ws || this.ws;
    if (!target) return;

    // Remove all listeners to prevent unhandled error events
    target.removeAllListeners();

    // Add a noop error handler to catch any last-minute errors
    target.on('error', () => { /* intentionally ignored */ });

    try {
      if (target.readyState === WebSocket.CONNECTING || target.readyState === WebSocket.OPEN) {
        target.terminate();
      }
    } catch {
      // Ignore terminate errors
    }
  }

  private _emitError(error: Error): void {
    const errorListeners = this.listeners.get('error');
    if (errorListeners && errorListeners.size > 0) {
      const snapshot = Array.from(errorListeners);
      for (const listener of snapshot) {
        try {
          listener(error);
        } catch { /* ignore */ }
      }
    }
  }
}

export function createWebSocketClient(options: NodeOptions, userAgent?: string): WebSocketClient {
  return new WebSocketClient(options, userAgent);
}
