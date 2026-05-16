"use strict";
// ============================================================================
// Davelink v4.2.0 - Bulletproof Track Cache
// Fixed: Proper key validation, memory-efficient storage
// Added: LRU eviction, TTL support, memory pressure handling
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrackCache = void 0;
class TrackCache {
    cache = new Map();
    maxSize;
    ttl;
    hits = 0;
    misses = 0;
    evictions = 0;
    lastCleanup = Date.now();
    cleanupInterval = null;
    accessCounter = 0; // Monotonic counter for precise LRU ordering
    constructor(maxSize = 1000, ttl = 3600000) {
        this.maxSize = maxSize;
        this.ttl = ttl;
        // Periodic cleanup
        this.cleanupInterval = setInterval(() => this._cleanup(), Math.min(ttl / 2, 300000));
        // Allow process to exit even if cleanup is pending
        if (this.cleanupInterval.unref) {
            this.cleanupInterval.unref();
        }
    }
    // ===================================================================
    // Core Operations
    // ===================================================================
    setTrack(track) {
        if (!track || typeof track.encoded !== 'string' || track.encoded.length === 0) {
            return; // Silently skip invalid tracks
        }
        // Evict oldest if at capacity
        if (this.cache.size >= this.maxSize && !this.cache.has(track.encoded)) {
            this._evictLRU();
        }
        const now = Date.now();
        const existing = this.cache.get(track.encoded);
        this.cache.set(track.encoded, {
            value: track,
            lastAccessed: ++this.accessCounter, // Monotonic counter for precise ordering
            createdAt: existing?.createdAt ?? now,
            accessCount: (existing?.accessCount ?? 0) + 1,
        });
    }
    getTrack(encoded) {
        if (!encoded || typeof encoded !== 'string')
            return undefined;
        const entry = this.cache.get(encoded);
        if (!entry) {
            this.misses++;
            return undefined;
        }
        // Check TTL
        if (this.ttl > 0 && Date.now() - entry.createdAt > this.ttl) {
            this.cache.delete(encoded);
            this.misses++;
            return undefined;
        }
        // Update access stats with monotonic counter to prevent ties
        entry.lastAccessed = ++this.accessCounter;
        entry.accessCount++;
        this.hits++;
        return entry.value;
    }
    hasTrack(encoded) {
        if (!encoded || typeof encoded !== 'string')
            return false;
        const entry = this.cache.get(encoded);
        if (!entry)
            return false;
        if (this.ttl > 0 && Date.now() - entry.createdAt > this.ttl) {
            this.cache.delete(encoded);
            return false;
        }
        return true;
    }
    deleteTrack(encoded) {
        if (!encoded || typeof encoded !== 'string')
            return false;
        return this.cache.delete(encoded);
    }
    clear() {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
        this.evictions = 0;
    }
    // ===================================================================
    // Stats
    // ===================================================================
    getStats() {
        let memoryEstimate = 0;
        for (const [key, entry] of this.cache) {
            memoryEstimate += key.length * 2 + 200 + JSON.stringify(entry.value).length * 2;
        }
        return {
            trackCache: {
                size: this.cache.size,
                maxSize: this.maxSize,
                hits: this.hits,
                misses: this.misses,
                hitRate: this.hits + this.misses > 0 ? (this.hits / (this.hits + this.misses)) : 0,
                evictions: this.evictions,
                memoryEstimate: Math.round(memoryEstimate / 1024),
                memoryEstimateBytes: memoryEstimate,
            },
            totalMemoryEstimate: Math.round(memoryEstimate / 1024),
        };
    }
    get size() {
        return this.cache.size;
    }
    // ===================================================================
    // Private
    // ===================================================================
    _evictLRU() {
        let oldestKey = null;
        let oldestAccess = Infinity;
        for (const [key, entry] of this.cache) {
            if (entry.lastAccessed < oldestAccess) {
                oldestAccess = entry.lastAccessed;
                oldestKey = key;
            }
        }
        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.evictions++;
        }
    }
    _cleanup() {
        if (this.ttl <= 0)
            return;
        const now = Date.now();
        this.lastCleanup = now;
        for (const [key, entry] of this.cache) {
            if (now - entry.createdAt > this.ttl) {
                this.cache.delete(key);
                this.evictions++;
            }
        }
    }
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
        this.clear();
    }
}
exports.TrackCache = TrackCache;
//# sourceMappingURL=TrackCache.js.map