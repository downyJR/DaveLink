// ============================================================================
// Davelink v4.2.0 - Bulletproof Error System
// Fixed: Pool reinitialization, proper recoverable flag handling
// Added: Circuit breaker errors, structured logging support
// ============================================================================

export enum ErrorCode {
  // Node errors
  NODE_NOT_FOUND = 'NODE_NOT_FOUND',
  NODE_CONNECTION_FAILED = 'NODE_CONNECTION_FAILED',
  NODE_AUTHENTICATION_FAILED = 'NODE_AUTHENTICATION_FAILED',
  NODE_DISCONNECTED = 'NODE_DISCONNECTED',
  NODE_MAX_RETRIES_EXCEEDED = 'NODE_MAX_RETRIES_EXCEEDED',
  NODE_ALREADY_EXISTS = 'NODE_ALREADY_EXISTS',
  NODE_CIRCUIT_OPEN = 'NODE_CIRCUIT_OPEN',
  // WebSocket errors
  WS_CONNECTION_FAILED = 'WS_CONNECTION_FAILED',
  WS_NOT_OPEN = 'WS_NOT_OPEN',
  WS_MESSAGE_ERROR = 'WS_MESSAGE_ERROR',
  WS_TIMEOUT = 'WS_TIMEOUT',
  WS_TERMINATE_ERROR = 'WS_TERMINATE_ERROR',
  // REST errors
  REST_REQUEST_FAILED = 'REST_REQUEST_FAILED',
  REST_TIMEOUT = 'REST_TIMEOUT',
  REST_RATE_LIMITED = 'REST_RATE_LIMITED',
  REST_NOT_FOUND = 'REST_NOT_FOUND',
  REST_CLIENT_DESTROYED = 'REST_CLIENT_DESTROYED',
  // Player errors
  PLAYER_NOT_FOUND = 'PLAYER_NOT_FOUND',
  PLAYER_ALREADY_EXISTS = 'PLAYER_ALREADY_EXISTS',
  PLAYER_NOT_CONNECTED = 'PLAYER_NOT_CONNECTED',
  PLAYER_VOICE_UPDATE_FAILED = 'PLAYER_VOICE_UPDATE_FAILED',
  PLAYER_NO_LAVA_SESSION = 'PLAYER_NO_LAVA_SESSION',
  PLAYER_DESTROYED = 'PLAYER_DESTROYED',
  PLAYER_MIGRATION_FAILED = 'PLAYER_MIGRATION_FAILED',
  // Track errors
  TRACK_LOAD_FAILED = 'TRACK_LOAD_FAILED',
  TRACK_NOT_FOUND = 'TRACK_NOT_FOUND',
  TRACK_DECODE_FAILED = 'TRACK_DECODE_FAILED',
  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_OPTION = 'INVALID_OPTION',
  MISSING_OPTION = 'MISSING_OPTION',
  // Plugin errors
  PLUGIN_ERROR = 'PLUGIN_ERROR',
  PLUGIN_LOAD_FAILED = 'PLUGIN_LOAD_FAILED',
  PLUGIN_INVALID = 'PLUGIN_INVALID',
  // Queue errors
  QUEUE_FULL = 'QUEUE_FULL',
  QUEUE_EMPTY = 'QUEUE_EMPTY',
  DUPLICATE_TRACK = 'DUPLICATE_TRACK',
  // Circuit breaker
  CIRCUIT_OPEN = 'CIRCUIT_OPEN',
  CIRCUIT_HALF_OPEN = 'CIRCUIT_HALF_OPEN',
  // Other
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  NOT_IMPLEMENTED = 'NOT_IMPLEMENTED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

// Error message templates with full context interpolation
export const ErrorMessages: Record<string, string> = {
  [ErrorCode.NODE_NOT_FOUND]: 'Node not found: {nodeId}',
  [ErrorCode.NODE_CONNECTION_FAILED]: 'Failed to connect to node: {reason}',
  [ErrorCode.NODE_AUTHENTICATION_FAILED]: 'Authentication failed for node: {nodeId}',
  [ErrorCode.NODE_DISCONNECTED]: 'Node disconnected: {nodeId} - {reason}',
  [ErrorCode.NODE_MAX_RETRIES_EXCEEDED]: 'Max retries exceeded for node: {nodeId}',
  [ErrorCode.NODE_ALREADY_EXISTS]: 'Node already exists: {nodeId}',
  [ErrorCode.NODE_CIRCUIT_OPEN]: 'Circuit breaker OPEN for node: {nodeId}',
  [ErrorCode.WS_CONNECTION_FAILED]: 'WebSocket connection failed: {reason}',
  [ErrorCode.WS_NOT_OPEN]: 'WebSocket is not open',
  [ErrorCode.WS_MESSAGE_ERROR]: 'WebSocket message error: {reason}',
  [ErrorCode.WS_TIMEOUT]: 'WebSocket timeout',
  [ErrorCode.WS_TERMINATE_ERROR]: 'WebSocket terminate error: {reason}',
  [ErrorCode.REST_REQUEST_FAILED]: 'REST request failed: {message}',
  [ErrorCode.REST_TIMEOUT]: 'REST request timeout after {timeout}ms',
  [ErrorCode.REST_RATE_LIMITED]: 'Rate limited, retry after {retryAfter}ms',
  [ErrorCode.REST_NOT_FOUND]: 'Resource not found: {path}',
  [ErrorCode.REST_CLIENT_DESTROYED]: 'REST client has been destroyed',
  [ErrorCode.PLAYER_NOT_FOUND]: 'Player not found for guild: {guildId}',
  [ErrorCode.PLAYER_ALREADY_EXISTS]: 'Player already exists for guild: {guildId}',
  [ErrorCode.PLAYER_NOT_CONNECTED]: 'Player not connected to voice channel: {guildId}',
  [ErrorCode.PLAYER_VOICE_UPDATE_FAILED]: 'Voice update failed: {reason}',
  [ErrorCode.PLAYER_NO_LAVA_SESSION]: 'No active Lavalink session for player: {guildId}',
  [ErrorCode.PLAYER_DESTROYED]: 'Player has been destroyed: {guildId}',
  [ErrorCode.PLAYER_MIGRATION_FAILED]: 'Player migration failed: {reason}',
  [ErrorCode.TRACK_LOAD_FAILED]: 'Failed to load track: {identifier}',
  [ErrorCode.TRACK_NOT_FOUND]: 'Track not found: {identifier}',
  [ErrorCode.TRACK_DECODE_FAILED]: 'Failed to decode track: {track}',
  [ErrorCode.VALIDATION_ERROR]: 'Validation error: {reason}',
  [ErrorCode.INVALID_OPTION]: 'Invalid option: {name}',
  [ErrorCode.MISSING_OPTION]: 'Missing required option: {name}',
  [ErrorCode.PLUGIN_ERROR]: 'Plugin error: {reason}',
  [ErrorCode.PLUGIN_LOAD_FAILED]: 'Failed to load plugin: {reason}',
  [ErrorCode.PLUGIN_INVALID]: 'Invalid plugin: {reason}',
  [ErrorCode.QUEUE_FULL]: 'Queue is full for guild: {guildId}',
  [ErrorCode.QUEUE_EMPTY]: 'Queue is empty for guild: {guildId}',
  [ErrorCode.DUPLICATE_TRACK]: 'Duplicate track in queue: {identifier}',
  [ErrorCode.CIRCUIT_OPEN]: 'Circuit breaker is OPEN for: {name}',
  [ErrorCode.CIRCUIT_HALF_OPEN]: 'Circuit breaker is HALF_OPEN for: {name}',
  [ErrorCode.UNKNOWN_ERROR]: 'Unknown error occurred',
  [ErrorCode.NOT_IMPLEMENTED]: 'Feature not implemented: {feature}',
  [ErrorCode.INTERNAL_ERROR]: 'Internal error: {reason}',
};

// ============================================================================
// Error Pool for Reuse
// ============================================================================
class ErrorPool {
  private pools = new Map<string, DavelinkError[]>();
  private maxPoolSize = 20;

  get(code: ErrorCode, context?: Record<string, unknown>, message?: string): DavelinkError {
    const pool = this.pools.get(code);
    if (pool && pool.length > 0) {
      const error = pool.pop()!;
      error.reinitialize(code, context, message);
      return error;
    }
    return new DavelinkError(code, context, message);
  }

  release(error: DavelinkError): void {
    const pool = this.pools.get(error.code);
    if (pool) {
      if (pool.length < this.maxPoolSize) {
        pool.push(error);
      }
    } else {
      this.pools.set(error.code, [error]);
    }
  }
}

const globalErrorPool = new ErrorPool();

// ============================================================================
// Main Error Class
// ============================================================================
export class DavelinkError extends Error {
  code: ErrorCode;
  context: Record<string, unknown>;
  timestamp: number;
  recoverable: boolean;

  constructor(code: ErrorCode, context?: Record<string, unknown>, message?: string) {
    const template = ErrorMessages[code] || ErrorMessages[ErrorCode.UNKNOWN_ERROR];
    const interpolated = DavelinkError.interpolate(template, context || {});
    super(message || interpolated);
    this.name = 'DavelinkError';
    this.code = code;
    this.context = context || {};
    this.timestamp = Date.now();
    this.recoverable = isRecoverableErrorCode(code);
    Error.captureStackTrace?.(this, DavelinkError);
  }

  reinitialize(code: ErrorCode, context?: Record<string, unknown>, message?: string): void {
    this.code = code;
    this.context = context || {};
    this.timestamp = Date.now();
    this.recoverable = isRecoverableErrorCode(code);
    const template = ErrorMessages[code] || ErrorMessages[ErrorCode.UNKNOWN_ERROR];
    this.message = message || DavelinkError.interpolate(template, context || {});
    // Reset stack trace for fresh error
    this.stack = undefined;
    Error.captureStackTrace?.(this, DavelinkError);
  }

  static fromPool(code: ErrorCode, context?: Record<string, unknown>, message?: string): DavelinkError {
    return globalErrorPool.get(code, context, message);
  }

  release(): void {
    globalErrorPool.release(this);
  }

  static interpolate(template: string, vars: Record<string, unknown>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value ?? ''));
    }
    // Clean up any remaining unreplaced placeholders
    result = result.replace(/\{[a-zA-Z_]+\}/g, '');
    // Clean up double spaces
    result = result.replace(/\s+/g, ' ');
    return result.trim();
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      timestamp: this.timestamp,
      recoverable: this.recoverable,
      stack: this.stack,
    };
  }
}

// ============================================================================
// Specialized Error Classes
// ============================================================================
export class NodeError extends DavelinkError {
  constructor(message: string, code: ErrorCode = ErrorCode.NODE_CONNECTION_FAILED, nodeId?: string, recoverable = true) {
    super(code, { nodeId, message });
    this.name = 'NodeError';
    this.recoverable = recoverable;
  }
}

export class PlayerError extends DavelinkError {
  constructor(message: string, code: ErrorCode = ErrorCode.PLAYER_NOT_FOUND, guildId?: string, recoverable = true) {
    super(code, { guildId, message });
    this.name = 'PlayerError';
    this.recoverable = recoverable;
  }
}

export class TrackError extends DavelinkError {
  constructor(message: string, code: ErrorCode = ErrorCode.TRACK_LOAD_FAILED, track?: string, recoverable = true) {
    super(code, { track, message });
    this.name = 'TrackError';
    this.recoverable = recoverable;
  }
}

export class RESTError extends DavelinkError {
  statusCode?: number;
  endpoint?: string;
  method?: string;
  constructor(message: string, code: ErrorCode = ErrorCode.REST_REQUEST_FAILED, statusCode?: number, endpoint?: string, method?: string) {
    super(code, { statusCode, endpoint, method, message });
    this.name = 'RESTError';
    this.statusCode = statusCode;
    this.endpoint = endpoint;
    this.method = method;
  }
}

export class WebSocketError extends DavelinkError {
  constructor(message: string, code: ErrorCode = ErrorCode.WS_CONNECTION_FAILED, nodeId?: string, recoverable = true) {
    super(code, { nodeId, message });
    this.name = 'WebSocketError';
    this.recoverable = recoverable;
  }
}

export class ValidationError extends DavelinkError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(ErrorCode.VALIDATION_ERROR, { ...context, message });
    this.name = 'ValidationError';
    this.recoverable = false;
  }
}

export class PluginError extends DavelinkError {
  constructor(message: string, pluginName?: string) {
    super(ErrorCode.PLUGIN_LOAD_FAILED, { pluginName, message });
    this.name = 'PluginError';
    this.recoverable = false;
  }
}

// ============================================================================
// Error Code Exports (backward compat)
// ============================================================================
export const ErrorCodes = ErrorCode;

// ============================================================================
// Helper Functions
// ============================================================================
const RECOVERABLE_CODES: ErrorCode[] = [
  ErrorCode.NODE_DISCONNECTED,
  ErrorCode.NODE_CONNECTION_FAILED,
  ErrorCode.WS_TIMEOUT,
  ErrorCode.REST_TIMEOUT,
  ErrorCode.REST_RATE_LIMITED,
  ErrorCode.WS_CONNECTION_FAILED,
  ErrorCode.PLAYER_NO_LAVA_SESSION,
  ErrorCode.CIRCUIT_HALF_OPEN,
];

function isRecoverableErrorCode(code: ErrorCode): boolean {
  return RECOVERABLE_CODES.includes(code);
}

export function isRecoverableError(error: unknown): boolean {
  if (error instanceof DavelinkError) {
    return error.recoverable;
  }
  return false;
}

export function fromRESTError(statusCode: number, body: Record<string, unknown>): DavelinkError {
  const codeMap: Record<number, ErrorCode> = {
    401: ErrorCode.NODE_AUTHENTICATION_FAILED,
    404: ErrorCode.REST_NOT_FOUND,
    429: ErrorCode.REST_RATE_LIMITED,
    500: ErrorCode.REST_REQUEST_FAILED,
    502: ErrorCode.REST_REQUEST_FAILED,
    503: ErrorCode.REST_REQUEST_FAILED,
  };
  const code = codeMap[statusCode] ?? ErrorCode.REST_REQUEST_FAILED;
  const retryAfter = typeof body.retryAfter === 'number' ? body.retryAfter : undefined;
  const message = body.message ? String(body.message) : undefined;
  return DavelinkError.fromPool(code, { statusCode, retryAfter, body: JSON.stringify(body).slice(0, 500) }, message);
}

export function fromWSCloseCode(code: number, reason: string): DavelinkError {
  switch (code) {
    case 1000:
      return DavelinkError.fromPool(ErrorCode.NODE_DISCONNECTED, { code, reason, intentional: true });
    case 4001:
      return DavelinkError.fromPool(ErrorCode.NODE_AUTHENTICATION_FAILED, { code, reason });
    case 4002:
    case 4003:
    case 4004:
    case 4005:
      return DavelinkError.fromPool(ErrorCode.WS_MESSAGE_ERROR, { code, reason });
    default:
      return DavelinkError.fromPool(ErrorCode.WS_CONNECTION_FAILED, { code, reason });
  }
}

export function assert(condition: boolean, code: ErrorCode, message: string): asserts condition {
  if (!condition) {
    throw DavelinkError.fromPool(code, { message });
  }
}

export function validateString(value: unknown, name: string, minLength = 1): void {
  if (typeof value !== 'string' || value.length < minLength) {
    throw DavelinkError.fromPool(ErrorCode.VALIDATION_ERROR, {
      name, value, minLength,
      message: `${name} must be a string with at least ${minLength} characters`,
    });
  }
}

export function validateRange(value: number, name: string, min: number, max: number): void {
  if (typeof value !== 'number' || isNaN(value) || value < min || value > max) {
    throw DavelinkError.fromPool(ErrorCode.VALIDATION_ERROR, {
      name, value, min, max,
      message: `${name} must be between ${min} and ${max}`,
    });
  }
}
