"use strict";
// ============================================================================
// Davelink v4.2.0 - Bulletproof Event Emitter
// Fixed: Memory leak prevention, listener tracking
// Added: Listener limits, memory-optimized storage
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.TypedEventEmitter = void 0;
class TypedEventEmitter {
    maxListeners;
    listeners = new Map();
    onceListeners = new WeakMap();
    _emitterDestroyed = false;
    constructor(maxListeners = 100) {
        this.maxListeners = maxListeners;
    }
    on(event, listener) {
        if (this._emitterDestroyed)
            return;
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        const set = this.listeners.get(event);
        if (set.size >= this.maxListeners) {
            console.warn(`MaxListenersExceededWarning: Possible memory leak. ${set.size + 1} "${event}" listeners added. Set maxListeners to 0 for unlimited.`);
        }
        set.add(listener);
    }
    once(event, listener) {
        const onceListener = (...args) => {
            this.off(event, onceListener);
            listener(...args);
        };
        this.onceListeners.set(onceListener, true);
        this.on(event, onceListener);
    }
    off(event, listener) {
        const set = this.listeners.get(event);
        if (!set)
            return;
        set.delete(listener);
        if (set.size === 0) {
            this.listeners.delete(event);
        }
    }
    emit(event, ...args) {
        if (this._emitterDestroyed)
            return false;
        const set = this.listeners.get(event);
        if (!set || set.size === 0)
            return false;
        const snapshot = Array.from(set);
        for (const listener of snapshot) {
            try {
                listener(...args);
            }
            catch (error) {
                this._handleError(error);
            }
        }
        return true;
    }
    removeAllListeners(event) {
        if (event) {
            this.listeners.delete(event);
        }
        else {
            this.listeners.clear();
        }
    }
    setMaxListeners(n) {
        this.maxListeners = n;
    }
    listenerCount(event) {
        return this.listeners.get(event)?.size ?? 0;
    }
    eventNames() {
        return Array.from(this.listeners.keys());
    }
    destroy() {
        this._emitterDestroyed = true;
        this.listeners.clear();
    }
    _handleError(error) {
        const errorListeners = this.listeners.get('error');
        if (errorListeners && errorListeners.size > 0) {
            for (const listener of Array.from(errorListeners)) {
                try {
                    listener(error);
                }
                catch { /* ignore */ }
            }
        }
    }
}
exports.TypedEventEmitter = TypedEventEmitter;
//# sourceMappingURL=EventEmitter.js.map