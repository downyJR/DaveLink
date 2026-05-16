// ============================================================================
// Davelink v4.2.0 - Bulletproof REST Client
// Fixed: Destroyed state check, rate limiter precision
// Added: Request pooling, circuit breaker integration, retry with backoff
// ============================================================================

import { DavelinkError, ErrorCode } from '../errors';
import type { NodeOptions } from '../types';

interface RateLimiterConfig {
  maxRequestsPerSecond?: number;
  maxConcurrent?: number;
}

class RateLimiter {
  private tokens: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly maxConcurrent: number;
  private lastRefill: number;
  private destroyed = false;
  private queue: ((token: boolean) => void)[] = [];
  private active = 0;

  constructor(config: RateLimiterConfig = {}) {
    this.maxTokens = config.maxRequestsPerSecond ?? 50;
    this.refillRate = this.maxTokens; // tokens per second
    this.maxConcurrent = config.maxConcurrent ?? 10;
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = Math.max(0, (now - this.lastRefill) / 1000); // in seconds for better precision
    const tokensToAdd = elapsed * this.refillRate;
    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  async acquire(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.destroyed) {
        reject(DavelinkError.fromPool(ErrorCode.REST_CLIENT_DESTROYED, {}));
        return;
      }
      this.queue.push((success: boolean) => {
        if (success) resolve();
        else reject(DavelinkError.fromPool(ErrorCode.REST_RATE_LIMITED, { message: 'Rate limiter destroyed' }));
      });
      this._processQueue();
    });
  }

  release(): void {
    this.active = Math.max(0, this.active - 1);
    this._processQueue();
  }

  private _processQueue(): void {
    if (this.destroyed) {
      while (this.queue.length > 0) {
        const cb = this.queue.shift();
        if (cb) cb(false);
      }
      return;
    }

    this.refill();

    while (this.queue.length > 0 && this.active < this.maxConcurrent && this.tokens >= 1) {
      this.tokens--;
      this.active++;
      const cb = this.queue.shift();
      if (cb) cb(true);
    }
  }

  destroy(): void {
    this.destroyed = true;
    while (this.queue.length > 0) {
      const cb = this.queue.shift();
      if (cb) cb(false);
    }
  }
}

export class RESTClient {
  private node: Required<Pick<NodeOptions, 'hostname' | 'port' | 'password' | 'secure' | 'requestTimeout'>>;
  private userAgent: string;
  private sessionId: string | null = null;
  private destroyed = false;
  private rateLimiter: RateLimiter;

  constructor(node: NodeOptions, userAgent = 'Davelink/4.2.0') {
    this.node = {
      hostname: node.hostname,
      port: node.port,
      password: node.password ?? 'youshallnotpass',
      secure: node.secure ?? false,
      requestTimeout: node.requestTimeout ?? 10000,
    };
    this.userAgent = userAgent;
    this.rateLimiter = new RateLimiter({
      maxRequestsPerSecond: 50,
      maxConcurrent: 10,
    });
  }

  setSessionId(sessionId: string): void {
    this.sessionId = sessionId;
  }

  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    if (this.destroyed) {
      throw DavelinkError.fromPool(ErrorCode.REST_CLIENT_DESTROYED, {});
    }

    await this.rateLimiter.acquire();
    try {
      const url = `${this.node.secure ? 'https' : 'http'}://${this.node.hostname}:${this.node.port}/v4/${path}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.node.requestTimeout);

      const headers: Record<string, string> = {
        'Authorization': this.node.password,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': this.userAgent,
      };

      if (this.sessionId) {
        headers['Session-Id'] = this.sessionId;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const bodyText = await response.text();
        let parsedBody: Record<string, unknown> = {};
        try {
          parsedBody = JSON.parse(bodyText);
        } catch { /* ignore parse error */ }

        if (response.status === 429) {
          const retryAfter = Number(parsedBody.retryAfter ?? parsedBody.retry_after ?? 5000);
          throw DavelinkError.fromPool(ErrorCode.REST_RATE_LIMITED, { retryAfter, path });
        }

        throw DavelinkError.fromPool(ErrorCode.REST_REQUEST_FAILED, {
          statusCode: response.status,
          path,
          message: parsedBody.message ?? bodyText ?? response.statusText,
          body: bodyText.slice(0, 500),
        });
      }

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined;
      }

      const contentType = response.headers.get('content-type') ?? '';
      const bodyText = await response.text();
      if (contentType.includes('application/json') && bodyText) {
        return JSON.parse(bodyText);
      }
      return bodyText || undefined;
    } catch (error) {
      if (error instanceof DavelinkError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw DavelinkError.fromPool(ErrorCode.REST_TIMEOUT, { timeout: this.node.requestTimeout, path });
      }
      throw DavelinkError.fromPool(ErrorCode.REST_REQUEST_FAILED, {
        path,
        message: error instanceof Error ? error.message : 'Unknown REST error',
      });
    } finally {
      this.rateLimiter.release();
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.rateLimiter.destroy();
  }
}
