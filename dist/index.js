"use strict";
// ============================================================================
// Davelink v4.2.0 - The Ultimate Lavalink Client
// TypeScript-first, memory-optimized, bulletproof audio
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.description = exports.name = exports.VERSION = exports.assert = exports.validateRange = exports.validateString = exports.isRecoverableError = exports.fromWSCloseCode = exports.fromRESTError = exports.PluginError = exports.ValidationError = exports.WebSocketError = exports.RESTError = exports.TrackError = exports.PlayerError = exports.NodeError = exports.ErrorMessages = exports.ErrorCodes = exports.ErrorCode = exports.DavelinkError = exports.TrackCache = exports.RESTClient = exports.createWebSocketClient = exports.WebSocketClient = exports.PlayerManager = exports.Player = exports.Node = exports.TypedEventEmitter = exports.createBenchmark = exports.NodeStore = exports.DavelinkManager = void 0;
exports.formatDuration = formatDuration;
exports.parseSearchQuery = parseSearchQuery;
// Core
var Davelink_1 = require("./Davelink");
Object.defineProperty(exports, "DavelinkManager", { enumerable: true, get: function () { return Davelink_1.DavelinkManager; } });
Object.defineProperty(exports, "NodeStore", { enumerable: true, get: function () { return Davelink_1.NodeStore; } });
Object.defineProperty(exports, "createBenchmark", { enumerable: true, get: function () { return Davelink_1.createBenchmark; } });
var EventEmitter_1 = require("./core/EventEmitter");
Object.defineProperty(exports, "TypedEventEmitter", { enumerable: true, get: function () { return EventEmitter_1.TypedEventEmitter; } });
// Node
var Node_1 = require("./node/Node");
Object.defineProperty(exports, "Node", { enumerable: true, get: function () { return Node_1.Node; } });
// Player
var Player_1 = require("./player/Player");
Object.defineProperty(exports, "Player", { enumerable: true, get: function () { return Player_1.Player; } });
Object.defineProperty(exports, "PlayerManager", { enumerable: true, get: function () { return Player_1.PlayerManager; } });
// WebSocket
var WebSocketClient_1 = require("./ws/WebSocketClient");
Object.defineProperty(exports, "WebSocketClient", { enumerable: true, get: function () { return WebSocketClient_1.WebSocketClient; } });
Object.defineProperty(exports, "createWebSocketClient", { enumerable: true, get: function () { return WebSocketClient_1.createWebSocketClient; } });
// REST
var RESTClient_1 = require("./rest/RESTClient");
Object.defineProperty(exports, "RESTClient", { enumerable: true, get: function () { return RESTClient_1.RESTClient; } });
// Cache
var TrackCache_1 = require("./cache/TrackCache");
Object.defineProperty(exports, "TrackCache", { enumerable: true, get: function () { return TrackCache_1.TrackCache; } });
// Errors
var errors_1 = require("./errors");
Object.defineProperty(exports, "DavelinkError", { enumerable: true, get: function () { return errors_1.DavelinkError; } });
Object.defineProperty(exports, "ErrorCode", { enumerable: true, get: function () { return errors_1.ErrorCode; } });
Object.defineProperty(exports, "ErrorCodes", { enumerable: true, get: function () { return errors_1.ErrorCodes; } });
Object.defineProperty(exports, "ErrorMessages", { enumerable: true, get: function () { return errors_1.ErrorMessages; } });
Object.defineProperty(exports, "NodeError", { enumerable: true, get: function () { return errors_1.NodeError; } });
Object.defineProperty(exports, "PlayerError", { enumerable: true, get: function () { return errors_1.PlayerError; } });
Object.defineProperty(exports, "TrackError", { enumerable: true, get: function () { return errors_1.TrackError; } });
Object.defineProperty(exports, "RESTError", { enumerable: true, get: function () { return errors_1.RESTError; } });
Object.defineProperty(exports, "WebSocketError", { enumerable: true, get: function () { return errors_1.WebSocketError; } });
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return errors_1.ValidationError; } });
Object.defineProperty(exports, "PluginError", { enumerable: true, get: function () { return errors_1.PluginError; } });
Object.defineProperty(exports, "fromRESTError", { enumerable: true, get: function () { return errors_1.fromRESTError; } });
Object.defineProperty(exports, "fromWSCloseCode", { enumerable: true, get: function () { return errors_1.fromWSCloseCode; } });
Object.defineProperty(exports, "isRecoverableError", { enumerable: true, get: function () { return errors_1.isRecoverableError; } });
Object.defineProperty(exports, "validateString", { enumerable: true, get: function () { return errors_1.validateString; } });
Object.defineProperty(exports, "validateRange", { enumerable: true, get: function () { return errors_1.validateRange; } });
Object.defineProperty(exports, "assert", { enumerable: true, get: function () { return errors_1.assert; } });
// Version
exports.VERSION = '4.2.0';
// Package info
exports.name = 'davelink';
exports.description = 'High-performance Lavalink client for Node.js';
// Helper to format duration
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
        return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
// Helper to parse search queries
function parseSearchQuery(query) {
    const match = query.match(/^([a-z]+)search:(.+)$/i);
    if (match) {
        return { source: match[1].toLowerCase(), query: match[2] };
    }
    return { source: 'yt', query };
}
//# sourceMappingURL=index.js.map