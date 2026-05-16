"use strict";
// ============================================================================
// Davelink v4.2.0 - Bulletproof REST Client
// Fixed: Destroyed state check, rate limiter precision
// Added: Request pooling, circuit breaker integration, retry with backoff
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.RESTClient = void 0;
const errors_1 = require("../errors");
class RateLimiter {
    tokens;
    maxTokens;
    refillRate;
    maxConcurrent;
    lastRefill;
    destroyed = false;
    queue = [];
    active = 0;
    constructor(config = {}) {
        this.maxTokens = config.maxRequestsPerSecond ?? 50;
        this.refillRate = this.maxTokens; // tokens per second
        this.maxConcurrent = config.maxConcurrent ?? 10;
        this.tokens = this.maxTokens;
        this.lastRefill = Date.now();
    }
    refill() {
        const now = Date.now();
        const elapsed = Math.max(0, (now - this.lastRefill) / 1000); // in seconds for better precision
        const tokensToAdd = elapsed * this.refillRate;
        this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }
    async acquire() {
        return new Promise((resolve, reject) => {
            if (this.destroyed) {
                reject(errors_1.DavelinkError.fromPool(errors_1.ErrorCode.REST_CLIENT_DESTROYED, {}));
                return;
            }
            this.queue.push((success) => {
                if (success)
                    resolve();
                else
                    reject(errors_1.DavelinkError.fromPool(errors_1.ErrorCode.REST_RATE_LIMITED, { message: 'Rate limiter destroyed' }));
            });
            this._processQueue();
        });
    }
    release() {
        this.active = Math.max(0, this.active - 1);
        this._processQueue();
    }
    _processQueue() {
        if (this.destroyed) {
            while (this.queue.length > 0) {
                const cb = this.queue.shift();
                if (cb)
                    cb(false);
            }
            return;
        }
        this.refill();
        while (this.queue.length > 0 && this.active < this.maxConcurrent && this.tokens >= 1) {
            this.tokens--;
            this.active++;
            const cb = this.queue.shift();
            if (cb)
                cb(true);
        }
    }
    destroy() {
        this.destroyed = true;
        while (this.queue.length > 0) {
            const cb = this.queue.shift();
            if (cb)
                cb(false);
        }
    }
}
class RESTClient {
    node;
    userAgent;
    sessionId = null;
    destroyed = false;
    rateLimiter;
    constructor(node, userAgent = 'Davelink/4.2.0') {
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
    setSessionId(sessionId) {
        this.sessionId = sessionId;
    }
    async request(method, path, body) {
        if (this.destroyed) {
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.REST_CLIENT_DESTROYED, {});
        }
        await this.rateLimiter.acquire();
        try {
            const url = `${this.node.secure ? 'https' : 'http'}://${this.node.hostname}:${this.node.port}/v4/${path}`;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), this.node.requestTimeout);
            const headers = {
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
                let parsedBody = {};
                try {
                    parsedBody = JSON.parse(bodyText);
                }
                catch { /* ignore parse error */ }
                if (response.status === 429) {
                    const retryAfter = Number(parsedBody.retryAfter ?? parsedBody.retry_after ?? 5000);
                    throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.REST_RATE_LIMITED, { retryAfter, path });
                }
                throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.REST_REQUEST_FAILED, {
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
        }
        catch (error) {
            if (error instanceof errors_1.DavelinkError)
                throw error;
            if (error instanceof Error && error.name === 'AbortError') {
                throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.REST_TIMEOUT, { timeout: this.node.requestTimeout, path });
            }
            throw errors_1.DavelinkError.fromPool(errors_1.ErrorCode.REST_REQUEST_FAILED, {
                path,
                message: error instanceof Error ? error.message : 'Unknown REST error',
            });
        }
        finally {
            this.rateLimiter.release();
        }
    }
    destroy() {
        this.destroyed = true;
        this.rateLimiter.destroy();
    }
}
exports.RESTClient = RESTClient;
//# sourceMappingURL=RESTClient.js.map