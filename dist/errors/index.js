"use strict";
// ============================================================================
// Davelink v4.2.0 - Bulletproof Error System
// Fixed: Pool reinitialization, proper recoverable flag handling
// Added: Circuit breaker errors, structured logging support
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrorCodes = exports.PluginError = exports.ValidationError = exports.WebSocketError = exports.RESTError = exports.TrackError = exports.PlayerError = exports.NodeError = exports.DavelinkError = exports.ErrorMessages = exports.ErrorCode = void 0;
exports.isRecoverableError = isRecoverableError;
exports.fromRESTError = fromRESTError;
exports.fromWSCloseCode = fromWSCloseCode;
exports.assert = assert;
exports.validateString = validateString;
exports.validateRange = validateRange;
var ErrorCode;
(function (ErrorCode) {
    // Node errors
    ErrorCode["NODE_NOT_FOUND"] = "NODE_NOT_FOUND";
    ErrorCode["NODE_CONNECTION_FAILED"] = "NODE_CONNECTION_FAILED";
    ErrorCode["NODE_AUTHENTICATION_FAILED"] = "NODE_AUTHENTICATION_FAILED";
    ErrorCode["NODE_DISCONNECTED"] = "NODE_DISCONNECTED";
    ErrorCode["NODE_MAX_RETRIES_EXCEEDED"] = "NODE_MAX_RETRIES_EXCEEDED";
    ErrorCode["NODE_ALREADY_EXISTS"] = "NODE_ALREADY_EXISTS";
    ErrorCode["NODE_CIRCUIT_OPEN"] = "NODE_CIRCUIT_OPEN";
    // WebSocket errors
    ErrorCode["WS_CONNECTION_FAILED"] = "WS_CONNECTION_FAILED";
    ErrorCode["WS_NOT_OPEN"] = "WS_NOT_OPEN";
    ErrorCode["WS_MESSAGE_ERROR"] = "WS_MESSAGE_ERROR";
    ErrorCode["WS_TIMEOUT"] = "WS_TIMEOUT";
    ErrorCode["WS_TERMINATE_ERROR"] = "WS_TERMINATE_ERROR";
    // REST errors
    ErrorCode["REST_REQUEST_FAILED"] = "REST_REQUEST_FAILED";
    ErrorCode["REST_TIMEOUT"] = "REST_TIMEOUT";
    ErrorCode["REST_RATE_LIMITED"] = "REST_RATE_LIMITED";
    ErrorCode["REST_NOT_FOUND"] = "REST_NOT_FOUND";
    ErrorCode["REST_CLIENT_DESTROYED"] = "REST_CLIENT_DESTROYED";
    // Player errors
    ErrorCode["PLAYER_NOT_FOUND"] = "PLAYER_NOT_FOUND";
    ErrorCode["PLAYER_ALREADY_EXISTS"] = "PLAYER_ALREADY_EXISTS";
    ErrorCode["PLAYER_NOT_CONNECTED"] = "PLAYER_NOT_CONNECTED";
    ErrorCode["PLAYER_VOICE_UPDATE_FAILED"] = "PLAYER_VOICE_UPDATE_FAILED";
    ErrorCode["PLAYER_NO_LAVA_SESSION"] = "PLAYER_NO_LAVA_SESSION";
    ErrorCode["PLAYER_DESTROYED"] = "PLAYER_DESTROYED";
    ErrorCode["PLAYER_MIGRATION_FAILED"] = "PLAYER_MIGRATION_FAILED";
    // Track errors
    ErrorCode["TRACK_LOAD_FAILED"] = "TRACK_LOAD_FAILED";
    ErrorCode["TRACK_NOT_FOUND"] = "TRACK_NOT_FOUND";
    ErrorCode["TRACK_DECODE_FAILED"] = "TRACK_DECODE_FAILED";
    // Validation errors
    ErrorCode["VALIDATION_ERROR"] = "VALIDATION_ERROR";
    ErrorCode["INVALID_OPTION"] = "INVALID_OPTION";
    ErrorCode["MISSING_OPTION"] = "MISSING_OPTION";
    // Plugin errors
    ErrorCode["PLUGIN_ERROR"] = "PLUGIN_ERROR";
    ErrorCode["PLUGIN_LOAD_FAILED"] = "PLUGIN_LOAD_FAILED";
    ErrorCode["PLUGIN_INVALID"] = "PLUGIN_INVALID";
    // Queue errors
    ErrorCode["QUEUE_FULL"] = "QUEUE_FULL";
    ErrorCode["QUEUE_EMPTY"] = "QUEUE_EMPTY";
    ErrorCode["DUPLICATE_TRACK"] = "DUPLICATE_TRACK";
    // Circuit breaker
    ErrorCode["CIRCUIT_OPEN"] = "CIRCUIT_OPEN";
    ErrorCode["CIRCUIT_HALF_OPEN"] = "CIRCUIT_HALF_OPEN";
    // Other
    ErrorCode["UNKNOWN_ERROR"] = "UNKNOWN_ERROR";
    ErrorCode["NOT_IMPLEMENTED"] = "NOT_IMPLEMENTED";
    ErrorCode["INTERNAL_ERROR"] = "INTERNAL_ERROR";
})(ErrorCode || (exports.ErrorCode = ErrorCode = {}));
// Error message templates with full context interpolation
exports.ErrorMessages = {
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
    pools = new Map();
    maxPoolSize = 20;
    get(code, context, message) {
        const pool = this.pools.get(code);
        if (pool && pool.length > 0) {
            const error = pool.pop();
            error.reinitialize(code, context, message);
            return error;
        }
        return new DavelinkError(code, context, message);
    }
    release(error) {
        const pool = this.pools.get(error.code);
        if (pool) {
            if (pool.length < this.maxPoolSize) {
                pool.push(error);
            }
        }
        else {
            this.pools.set(error.code, [error]);
        }
    }
}
const globalErrorPool = new ErrorPool();
// ============================================================================
// Main Error Class
// ============================================================================
class DavelinkError extends Error {
    code;
    context;
    timestamp;
    recoverable;
    constructor(code, context, message) {
        const template = exports.ErrorMessages[code] || exports.ErrorMessages[ErrorCode.UNKNOWN_ERROR];
        const interpolated = DavelinkError.interpolate(template, context || {});
        super(message || interpolated);
        this.name = 'DavelinkError';
        this.code = code;
        this.context = context || {};
        this.timestamp = Date.now();
        this.recoverable = isRecoverableErrorCode(code);
        Error.captureStackTrace?.(this, DavelinkError);
    }
    reinitialize(code, context, message) {
        this.code = code;
        this.context = context || {};
        this.timestamp = Date.now();
        this.recoverable = isRecoverableErrorCode(code);
        const template = exports.ErrorMessages[code] || exports.ErrorMessages[ErrorCode.UNKNOWN_ERROR];
        this.message = message || DavelinkError.interpolate(template, context || {});
        // Reset stack trace for fresh error
        this.stack = undefined;
        Error.captureStackTrace?.(this, DavelinkError);
    }
    static fromPool(code, context, message) {
        return globalErrorPool.get(code, context, message);
    }
    release() {
        globalErrorPool.release(this);
    }
    static interpolate(template, vars) {
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
    toJSON() {
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
exports.DavelinkError = DavelinkError;
// ============================================================================
// Specialized Error Classes
// ============================================================================
class NodeError extends DavelinkError {
    constructor(message, code = ErrorCode.NODE_CONNECTION_FAILED, nodeId, recoverable = true) {
        super(code, { nodeId, message });
        this.name = 'NodeError';
        this.recoverable = recoverable;
    }
}
exports.NodeError = NodeError;
class PlayerError extends DavelinkError {
    constructor(message, code = ErrorCode.PLAYER_NOT_FOUND, guildId, recoverable = true) {
        super(code, { guildId, message });
        this.name = 'PlayerError';
        this.recoverable = recoverable;
    }
}
exports.PlayerError = PlayerError;
class TrackError extends DavelinkError {
    constructor(message, code = ErrorCode.TRACK_LOAD_FAILED, track, recoverable = true) {
        super(code, { track, message });
        this.name = 'TrackError';
        this.recoverable = recoverable;
    }
}
exports.TrackError = TrackError;
class RESTError extends DavelinkError {
    statusCode;
    endpoint;
    method;
    constructor(message, code = ErrorCode.REST_REQUEST_FAILED, statusCode, endpoint, method) {
        super(code, { statusCode, endpoint, method, message });
        this.name = 'RESTError';
        this.statusCode = statusCode;
        this.endpoint = endpoint;
        this.method = method;
    }
}
exports.RESTError = RESTError;
class WebSocketError extends DavelinkError {
    constructor(message, code = ErrorCode.WS_CONNECTION_FAILED, nodeId, recoverable = true) {
        super(code, { nodeId, message });
        this.name = 'WebSocketError';
        this.recoverable = recoverable;
    }
}
exports.WebSocketError = WebSocketError;
class ValidationError extends DavelinkError {
    constructor(message, context) {
        super(ErrorCode.VALIDATION_ERROR, { ...context, message });
        this.name = 'ValidationError';
        this.recoverable = false;
    }
}
exports.ValidationError = ValidationError;
class PluginError extends DavelinkError {
    constructor(message, pluginName) {
        super(ErrorCode.PLUGIN_LOAD_FAILED, { pluginName, message });
        this.name = 'PluginError';
        this.recoverable = false;
    }
}
exports.PluginError = PluginError;
// ============================================================================
// Error Code Exports (backward compat)
// ============================================================================
exports.ErrorCodes = ErrorCode;
// ============================================================================
// Helper Functions
// ============================================================================
const RECOVERABLE_CODES = [
    ErrorCode.NODE_DISCONNECTED,
    ErrorCode.NODE_CONNECTION_FAILED,
    ErrorCode.WS_TIMEOUT,
    ErrorCode.REST_TIMEOUT,
    ErrorCode.REST_RATE_LIMITED,
    ErrorCode.WS_CONNECTION_FAILED,
    ErrorCode.PLAYER_NO_LAVA_SESSION,
    ErrorCode.CIRCUIT_HALF_OPEN,
];
function isRecoverableErrorCode(code) {
    return RECOVERABLE_CODES.includes(code);
}
function isRecoverableError(error) {
    if (error instanceof DavelinkError) {
        return error.recoverable;
    }
    return false;
}
function fromRESTError(statusCode, body) {
    const codeMap = {
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
function fromWSCloseCode(code, reason) {
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
function assert(condition, code, message) {
    if (!condition) {
        throw DavelinkError.fromPool(code, { message });
    }
}
function validateString(value, name, minLength = 1) {
    if (typeof value !== 'string' || value.length < minLength) {
        throw DavelinkError.fromPool(ErrorCode.VALIDATION_ERROR, {
            name, value, minLength,
            message: `${name} must be a string with at least ${minLength} characters`,
        });
    }
}
function validateRange(value, name, min, max) {
    if (typeof value !== 'number' || isNaN(value) || value < min || value > max) {
        throw DavelinkError.fromPool(ErrorCode.VALIDATION_ERROR, {
            name, value, min, max,
            message: `${name} must be between ${min} and ${max}`,
        });
    }
}
//# sourceMappingURL=index.js.map