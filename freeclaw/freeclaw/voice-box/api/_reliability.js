// ─── V3 Enterprise Reliability ──────────────────────────────────
// Circuit breakers, retry strategies, graceful degradation,
// fallback chains, and health-aware routing.
import { logger, recordMetric, trackError } from './_observability.js';

// ─── Circuit Breaker ────────────────────────────────────────────
// State machine: CLOSED → OPEN → HALF_OPEN → CLOSED
const CIRCUIT_STATES = { CLOSED: 'closed', OPEN: 'open', HALF_OPEN: 'half_open' };

class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.nextAttempt = 0;

    // Configuration
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 3;
    this.timeout = options.timeout || 30000; // 30 seconds
    this.halfOpenMaxAttempts = options.halfOpenMaxAttempts || 3;
  }

  /**
   * Execute a function through the circuit breaker.
   * Falls back to fallback function if circuit is open.
   */
  async execute(fn, fallback = null) {
    if (this.state === CIRCUIT_STATES.OPEN) {
      if (Date.now() < this.nextAttempt) {
        logger.warn('circuit_breaker', 'circuit_open', {
          name: this.name,
          next_attempt: new Date(this.nextAttempt).toISOString(),
        });
        if (fallback) return fallback();
        throw new Error(`Circuit ${this.name} is open`);
      }
      this.state = CIRCUIT_STATES.HALF_OPEN;
      this.successCount = 0;
    }

    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Circuit ${this.name} timeout`)), this.timeout)
        ),
      ]);

      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure(error);
      if (fallback) return fallback();
      throw error;
    }
  }

  _onSuccess() {
    this.failureCount = 0;
    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = CIRCUIT_STATES.CLOSED;
        logger.info('circuit_breaker', 'circuit_closed', { name: this.name });
      }
    }
  }

  _onFailure(error) {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    trackError(error, { circuit: this.name });

    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.state = CIRCUIT_STATES.OPEN;
      this.nextAttempt = Date.now() + this.timeout;
      logger.warn('circuit_breaker', 'circuit_reopened', { name: this.name });
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = CIRCUIT_STATES.OPEN;
      this.nextAttempt = Date.now() + this.timeout;
      logger.error('circuit_breaker', 'circuit_opened', {
        name: this.name,
        failure_count: this.failureCount,
      });
    }
  }

  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failure_count: this.failureCount,
      success_count: this.successCount,
      last_failure: this.lastFailureTime ? new Date(this.lastFailureTime).toISOString() : null,
      next_attempt: this.nextAttempt ? new Date(this.nextAttempt).toISOString() : null,
    };
  }

  reset() {
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    this.nextAttempt = 0;
  }
}

// ─── Global Circuit Breakers ────────────────────────────────────
export const circuits = {
  supabase: new CircuitBreaker('supabase', { failureThreshold: 5, timeout: 10000 }),
  llm: new CircuitBreaker('llm', { failureThreshold: 3, timeout: 30000 }),
  toolExecution: new CircuitBreaker('tool_execution', { failureThreshold: 5, timeout: 15000 }),
};

// ─── Retry Strategy ─────────────────────────────────────────────
/**
 * Execute with exponential backoff retry.
 * @param {Function} fn - Function to execute
 * @param {Object} options - { maxRetries, baseDelay, maxDelay, retryOn, backoff }
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    retryOn = () => true,
    backoff = 'exponential', // 'exponential' | 'linear' | 'fixed'
    operation = 'unknown',
  } = options;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const start = Date.now();
      const result = await fn();
      recordMetric(`${operation}_retry`, Date.now() - start, true);
      return result;
    } catch (error) {
      lastError = error;
      recordMetric(`${operation}_retry`, 0, false);

      if (attempt === maxRetries || !retryOn(error)) {
        break;
      }

      // Calculate delay
      let delay;
      switch (backoff) {
        case 'linear':
          delay = baseDelay * (attempt + 1);
          break;
        case 'fixed':
          delay = baseDelay;
          break;
        default: // exponential
          delay = Math.min(baseDelay * Math.pow(2, attempt) + Math.random() * 1000, maxDelay);
      }

      logger.warn('retry', 'retrying_operation', {
        operation,
        attempt: attempt + 1,
        max_retries: maxRetries,
        delay_ms: delay,
        error: error.message,
      });

      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastError;
}

// ─── Fallback Chain ─────────────────────────────────────────────
/**
 * Execute a chain of fallback functions until one succeeds.
 * @param {Array<{name: string, fn: Function}>} chain - Ordered list of attempts
 * @param {string} operation - Operation name for metrics
 */
export async function withFallback(chain, operation = 'fallback') {
  const errors = [];

  for (const { name, fn } of chain) {
    try {
      const start = Date.now();
      const result = await fn();
      recordMetric(`${operation}_fallback`, Date.now() - start, true);
      return { result, source: name };
    } catch (error) {
      recordMetric(`${operation}_fallback`, 0, false);
      errors.push({ source: name, error: error.message });
      logger.warn('fallback', 'fallback_attempt_failed', {
        operation,
        source: name,
        error: error.message,
      });
    }
  }

  throw new Error(`All fallback sources failed for ${operation}: ${errors.map((e) => e.source).join(' → ')}`);
}

// ─── Graceful Degradation ───────────────────────────────────────
/**
 * Execute with graceful degradation — return partial results if full fails.
 * @param {Function} fn - Main function
 * @param {Function} degraded - Degraded function (simpler/faster)
 * @param {string} operation - Operation name
 */
export async function withDegradation(fn, degraded, operation = 'degrade') {
  try {
    const start = Date.now();
    const result = await fn();
    recordMetric(`${operation}_full`, Date.now() - start, true);
    return { result, degraded: false };
  } catch (error) {
    recordMetric(`${operation}_full`, 0, false);
    logger.warn('degradation', 'falling_back', { operation, error: error.message });

    try {
      const start = Date.now();
      const result = await degraded();
      recordMetric(`${operation}_degraded`, Date.now() - start, true);
      return { result, degraded: true };
    } catch (degradedError) {
      recordMetric(`${operation}_degraded`, 0, false);
      throw error; // Throw original error
    }
  }
}

// ─── Timeout Wrapper ────────────────────────────────────────────
/**
 * Execute with a timeout. Rejects if exceeded.
 */
export function withTimeout(fn, ms, operation = 'timeout') {
  return Promise.race([
    fn(),
    new Promise((_, reject) =>
      setTimeout(() => {
        reject(new Error(`Timeout after ${ms}ms for ${operation}`));
      }, ms)
    ),
  ]);
}

// ─── Bulkhead (Concurrency Limiter) ─────────────────────────────
/**
 * Limit concurrent executions of an operation.
 */
export class Bulkhead {
  constructor(name, maxConcurrent = 10) {
    this.name = name;
    this.maxConcurrent = maxConcurrent;
    this.current = 0;
    this.queue = [];
  }

  async execute(fn) {
    if (this.current >= this.maxConcurrent) {
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.current++;
    try {
      return await fn();
    } finally {
      this.current--;
      if (this.queue.length > 0) {
        this.queue.shift()();
      }
    }
  }

  getStatus() {
    return {
      name: this.name,
      current: this.current,
      max: this.maxConcurrent,
      queued: this.queue.length,
    };
  }
}

// ─── Health-Aware Router ────────────────────────────────────────
/**
 * Route requests to the healthiest provider/source.
 */
export async function healthRoute(routes, operation = 'route') {
  // Sort by health status and latency
  const scored = await Promise.all(
    routes.map(async ({ name, fn, healthCheck }) => {
      try {
        if (healthCheck) {
          const start = Date.now();
          const healthy = await healthCheck();
          const latency = Date.now() - start;
          return { name, fn, healthy, latency };
        }
        return { name, fn, healthy: true, latency: 0 };
      } catch {
        return { name, fn, healthy: false, latency: Infinity };
      }
    })
  );

  // Prefer healthy routes with lowest latency
  const sorted = scored
    .filter((r) => r.healthy)
    .sort((a, b) => a.latency - b.latency);

  if (sorted.length === 0) {
    throw new Error(`No healthy routes for ${operation}`);
  }

  return sorted[0].fn();
}

// ─── Get All Circuit Status ─────────────────────────────────────
export function getAllCircuitStatus() {
  return Object.fromEntries(
    Object.entries(circuits).map(([name, breaker]) => [name, breaker.getStatus()])
  );
}

export default {
  CircuitBreaker,
  circuits,
  withRetry,
  withFallback,
  withDegradation,
  withTimeout,
  Bulkhead,
  healthRoute,
  getAllCircuitStatus,
};
