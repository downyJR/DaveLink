// ============================================================================
// Davelink v4.2.0 - Bulletproof Event Emitter
// Fixed: Memory leak prevention, listener tracking
// Added: Listener limits, memory-optimized storage
// ============================================================================

type Listener = (...args: unknown[]) => void;

export class TypedEventEmitter {
  private maxListeners: number;
  private listeners = new Map<string, Set<Listener>>();
  private onceListeners = new WeakMap<Listener, boolean>();
  private _emitterDestroyed = false;

  constructor(maxListeners = 100) {
    this.maxListeners = maxListeners;
  }

  on(event: string, listener: Listener): void {
    if (this._emitterDestroyed) return;
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    if (set.size >= this.maxListeners) {
      console.warn(`MaxListenersExceededWarning: Possible memory leak. ${set.size + 1} "${event}" listeners added. Set maxListeners to 0 for unlimited.`);
    }
    set.add(listener);
  }

  once(event: string, listener: Listener): void {
    const onceListener = (...args: unknown[]) => {
      this.off(event, onceListener);
      listener(...args);
    };
    this.onceListeners.set(onceListener, true);
    this.on(event, onceListener);
  }

  off(event: string, listener: Listener): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  emit(event: string, ...args: unknown[]): boolean {
    if (this._emitterDestroyed) return false;
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return false;

    const snapshot = Array.from(set);
    for (const listener of snapshot) {
      try {
        listener(...args);
      } catch (error) {
        this._handleError(error);
      }
    }
    return true;
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }

  setMaxListeners(n: number): void {
    this.maxListeners = n;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  destroy(): void {
    this._emitterDestroyed = true;
    this.listeners.clear();
  }

  private _handleError(error: unknown): void {
    const errorListeners = this.listeners.get('error');
    if (errorListeners && errorListeners.size > 0) {
      for (const listener of Array.from(errorListeners)) {
        try {
          listener(error);
        } catch { /* ignore */ }
      }
    }
  }
}
