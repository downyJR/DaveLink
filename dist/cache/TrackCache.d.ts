import type { Track } from '../types';
export declare class TrackCache {
    private cache;
    private maxSize;
    private ttl;
    private hits;
    private misses;
    private evictions;
    private lastCleanup;
    private cleanupInterval;
    private accessCounter;
    constructor(maxSize?: number, ttl?: number);
    setTrack(track: Track): void;
    getTrack(encoded: string | undefined | null): Track | undefined;
    hasTrack(encoded: string | undefined | null): boolean;
    deleteTrack(encoded: string | undefined | null): boolean;
    clear(): void;
    getStats(): {
        trackCache: {
            size: number;
            maxSize: number;
            hits: number;
            misses: number;
            hitRate: number;
            evictions: number;
            memoryEstimate: number;
            memoryEstimateBytes: number;
        };
        totalMemoryEstimate: number;
    };
    get size(): number;
    private _evictLRU;
    private _cleanup;
    destroy(): void;
}
//# sourceMappingURL=TrackCache.d.ts.map