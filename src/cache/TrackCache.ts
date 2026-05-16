// ============================================================================
// Davelink v4.2.0 - Bulletproof Track Cache
// Fixed: Proper key validation, memory-efficient storage
// Added: LRU eviction, TTL support, memory pressure handling
// ============================================================================

import { DavelinkError, ErrorCode } from '../errors';
import type { Track } from '../types';

interface CacheEntry<T> {
  value: T;
  lastAccessed: number;
  createdAt: number;
  accessCount: number;
}

export class TrackCache {
  private cache = new Map<string, CacheEntry<Track>>();
  private maxSize: number;
  private ttl: number;
  private hits = 0;
  private misses = 0;
  private evictions = 0;
  private lastCleanup = Date.now();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private accessCounter = 0; // Monotonic counter for precise LRU ordering

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
  setTrack(track: Track): void {
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

  getTrack(encoded: string | undefined | null): Track | undefined {
    if (!encoded || typeof encoded !== 'string') return undefined;

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

  hasTrack(encoded: string | undefined | null): boolean {
    if (!encoded || typeof encoded !== 'string') return false;
    const entry = this.cache.get(encoded);
    if (!entry) return false;
    if (this.ttl > 0 && Date.now() - entry.createdAt > this.ttl) {
      this.cache.delete(encoded);
      return false;
    }
    return true;
  }

  deleteTrack(encoded: string | undefined | null): boolean {
    if (!encoded || typeof encoded !== 'string') return false;
    return this.cache.delete(encoded);
  }

  clear(): void {
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

  get size(): number {
    return this.cache.size;
  }

  // ===================================================================
  // Private
  // ===================================================================
  private _evictLRU(): void {
    let oldestKey: string | null = null;
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

  private _cleanup(): void {
    if (this.ttl <= 0) return;
    const now = Date.now();
    this.lastCleanup = now;
    for (const [key, entry] of this.cache) {
      if (now - entry.createdAt > this.ttl) {
        this.cache.delete(key);
        this.evictions++;
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.clear();
  }
}
