/**
 * Metrics System - Performance and Health Monitoring
 *
 * Provides basic metrics collection for monitoring system performance.
 * Supports counters, gauges, and histograms.
 *
 * @module utils/metrics
 */

/**
 * Metric types
 */
export type MetricType = 'counter' | 'gauge' | 'histogram';

/**
 * Single metric entry
 */
export interface MetricEntry {
  name: string;
  type: MetricType;
  value: number;
  labels: Record<string, string>;
  timestamp: number;
}

/**
 * Histogram bucket
 */
export interface HistogramBucket {
  le: number;  // less than or equal
  count: number;
}

/**
 * Histogram data
 */
export interface HistogramData {
  buckets: HistogramBucket[];
  sum: number;
  count: number;
  min: number;
  max: number;
}

/**
 * Metric snapshot for export
 */
export interface MetricSnapshot {
  timestamp: string;
  uptime: number;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  histograms: Record<string, HistogramData>;
}

/**
 * Health check result
 */
export interface HealthCheck {
  name: string;
  healthy: boolean;
  message?: string;
  latency?: number;
}

/**
 * System health status
 */
export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: HealthCheck[];
  timestamp: string;
}

/**
 * Metrics Collector
 *
 * Collects and aggregates system metrics for monitoring.
 *
 * @example
 * ```typescript
 * const metrics = MetricsCollector.getInstance();
 *
 * // Increment a counter
 * metrics.increment('requests_total', { method: 'GET', path: '/api' });
 *
 * // Set a gauge
 * metrics.gauge('active_connections', 42);
 *
 * // Record a timing
 * metrics.histogram('request_duration_ms', 150);
 *
 * // Time an operation
 * const timer = metrics.startTimer('operation_duration_ms');
 * await performOperation();
 * timer();
 *
 * // Get snapshot
 * const snapshot = metrics.snapshot();
 * ```
 */
export class MetricsCollector {
  private static instance: MetricsCollector;

  // Storage
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, {
    values: number[];
    bucketBounds: number[];
  }> = new Map();

  // Health checks
  private healthChecks: Map<string, () => Promise<HealthCheck>> = new Map();

  // Timing
  private startTime: number = Date.now();

  // Default histogram buckets (latency in ms)
  private defaultBuckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Reset all metrics (useful for testing)
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.healthChecks.clear();
    this.startTime = Date.now();
  }

  // ==================== Counters ====================

  /**
   * Increment a counter
   *
   * @param name - Metric name
   * @param labels - Optional labels
   * @param value - Increment value (default: 1)
   */
  increment(name: string, labels?: Record<string, string>, value: number = 1): void {
    const key = this.buildKey(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
  }

  /**
   * Get counter value
   */
  getCounter(name: string, labels?: Record<string, string>): number {
    const key = this.buildKey(name, labels);
    return this.counters.get(key) ?? 0;
  }

  // ==================== Gauges ====================

  /**
   * Set a gauge value
   *
   * @param name - Metric name
   * @param value - Current value
   * @param labels - Optional labels
   */
  gauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    this.gauges.set(key, value);
  }

  /**
   * Get gauge value
   */
  getGauge(name: string, labels?: Record<string, string>): number {
    const key = this.buildKey(name, labels);
    return this.gauges.get(key) ?? 0;
  }

  /**
   * Increment a gauge
   */
  gaugeIncrement(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    const current = this.gauges.get(key) ?? 0;
    this.gauges.set(key, current + value);
  }

  /**
   * Decrement a gauge
   */
  gaugeDecrement(name: string, value: number = 1, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);
    const current = this.gauges.get(key) ?? 0;
    this.gauges.set(key, current - value);
  }

  // ==================== Histograms ====================

  /**
   * Record a histogram value
   *
   * @param name - Metric name
   * @param value - Observed value
   * @param labels - Optional labels
   */
  histogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.buildKey(name, labels);

    if (!this.histograms.has(key)) {
      this.histograms.set(key, {
        values: [],
        bucketBounds: this.defaultBuckets,
      });
    }

    const hist = this.histograms.get(key)!;
    hist.values.push(value);

    // Keep only last 10000 values to prevent memory issues
    if (hist.values.length > 10000) {
      hist.values = hist.values.slice(-10000);
    }
  }

  /**
   * Get histogram data
   */
  getHistogram(name: string, labels?: Record<string, string>): HistogramData | null {
    const key = this.buildKey(name, labels);
    const hist = this.histograms.get(key);

    if (!hist || hist.values.length === 0) {
      return null;
    }

    const sorted = [...hist.values].sort((a, b) => a - b);
    const buckets: HistogramBucket[] = [];
    let bucketIdx = 0;

    for (const bound of hist.bucketBounds) {
      let count = 0;
      while (bucketIdx < sorted.length && sorted[bucketIdx] <= bound) {
        count++;
        bucketIdx++;
      }
      buckets.push({ le: bound, count: (buckets[buckets.length - 1]?.count ?? 0) + count });
    }

    // +Inf bucket
    buckets.push({ le: Infinity, count: sorted.length });

    return {
      buckets,
      sum: hist.values.reduce((a, b) => a + b, 0),
      count: hist.values.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
  }

  /**
   * Start a timer and return a function to stop it
   */
  startTimer(name: string, labels?: Record<string, string>): () => number {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      this.histogram(name, duration, labels);
      return duration;
    };
  }

  /**
   * Time an async function
   */
  async timed<T>(
    name: string,
    fn: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<T> {
    const stop = this.startTimer(name, labels);
    try {
      return await fn();
    } finally {
      stop();
    }
  }

  // ==================== Health Checks ====================

  /**
   * Register a health check
   *
   * @param name - Check name
   * @param check - Async function that returns health status
   */
  registerHealthCheck(name: string, check: () => Promise<HealthCheck>): void {
    this.healthChecks.set(name, check);
  }

  /**
   * Unregister a health check
   */
  unregisterHealthCheck(name: string): void {
    this.healthChecks.delete(name);
  }

  /**
   * Run all health checks
   */
  async checkHealth(): Promise<SystemHealth> {
    const results: HealthCheck[] = [];
    let hasUnhealthy = false;
    let hasDegraded = false;

    for (const [name, check] of this.healthChecks) {
      try {
        const start = performance.now();
        const result = await check();
        result.latency = performance.now() - start;
        results.push(result);

        if (!result.healthy) {
          hasUnhealthy = true;
        }
      } catch (error) {
        results.push({
          name,
          healthy: false,
          message: error instanceof Error ? error.message : 'Check failed',
        });
        hasUnhealthy = true;
      }
    }

    // Check latencies for degraded status
    for (const check of results) {
      if (check.healthy && check.latency && check.latency > 1000) {
        hasDegraded = true;
      }
    }

    return {
      status: hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy',
      checks: results,
      timestamp: new Date().toISOString(),
    };
  }

  // ==================== Export ====================

  /**
   * Get a snapshot of all metrics
   */
  snapshot(): MetricSnapshot {
    const counters: Record<string, number> = {};
    const gauges: Record<string, number> = {};
    const histograms: Record<string, HistogramData> = {};

    for (const [key, value] of this.counters) {
      counters[key] = value;
    }

    for (const [key, value] of this.gauges) {
      gauges[key] = value;
    }

    for (const [key] of this.histograms) {
      const data = this.getHistogram(key);
      if (data) {
        histograms[key] = data;
      }
    }

    return {
      timestamp: new Date().toISOString(),
      uptime: Date.now() - this.startTime,
      counters,
      gauges,
      histograms,
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  toPrometheus(): string {
    const lines: string[] = [];

    // Counters
    for (const [key, value] of this.counters) {
      lines.push(`# TYPE ${key.split('{')[0]} counter`);
      lines.push(`${key} ${value}`);
    }

    // Gauges
    for (const [key, value] of this.gauges) {
      lines.push(`# TYPE ${key.split('{')[0]} gauge`);
      lines.push(`${key} ${value}`);
    }

    // Histograms
    for (const [key] of this.histograms) {
      const data = this.getHistogram(key);
      if (data) {
        const baseName = key.split('{')[0];
        lines.push(`# TYPE ${baseName} histogram`);

        for (const bucket of data.buckets) {
          const le = bucket.le === Infinity ? '+Inf' : bucket.le.toString();
          lines.push(`${baseName}_bucket{le="${le}"} ${bucket.count}`);
        }
        lines.push(`${baseName}_sum ${data.sum}`);
        lines.push(`${baseName}_count ${data.count}`);
      }
    }

    return lines.join('\n');
  }

  // ==================== Private ====================

  private buildKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }

    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');

    return `${name}{${labelStr}}`;
  }
}

// ==================== Convenience Functions ====================

/**
 * Get the global metrics instance
 */
export function getMetrics(): MetricsCollector {
  return MetricsCollector.getInstance();
}

/**
 * Increment a counter
 */
export function incrementCounter(
  name: string,
  labels?: Record<string, string>,
  value?: number
): void {
  getMetrics().increment(name, labels, value);
}

/**
 * Set a gauge
 */
export function setGauge(
  name: string,
  value: number,
  labels?: Record<string, string>
): void {
  getMetrics().gauge(name, value, labels);
}

/**
 * Record a histogram value
 */
export function recordHistogram(
  name: string,
  value: number,
  labels?: Record<string, string>
): void {
  getMetrics().histogram(name, value, labels);
}

/**
 * Start a timer
 */
export function startTimer(
  name: string,
  labels?: Record<string, string>
): () => number {
  return getMetrics().startTimer(name, labels);
}

// ==================== Pre-defined Metrics ====================

/**
 * Standard metric names used across the system
 */
export const MetricNames = {
  // API metrics
  API_REQUESTS_TOTAL: 'api_requests_total',
  API_REQUEST_DURATION_MS: 'api_request_duration_ms',
  API_ERRORS_TOTAL: 'api_errors_total',

  // Neuron metrics
  NEURONS_TOTAL: 'neurons_total',
  NEURONS_CREATED: 'neurons_created_total',
  NEURON_LOOKUPS: 'neuron_lookups_total',
  NEURON_LOOKUP_DURATION_MS: 'neuron_lookup_duration_ms',

  // Inference metrics
  INFERENCE_REQUESTS: 'inference_requests_total',
  INFERENCE_DURATION_MS: 'inference_duration_ms',

  // Learning metrics
  LEARNING_SESSIONS: 'learning_sessions_total',
  PATTERNS_LEARNED: 'patterns_learned_total',
  EXTRACTS_CREATED: 'extracts_created_total',

  // Attractor metrics
  ATTRACTORS_TOTAL: 'attractors_total',
  ATTRACTOR_ACTIVATIONS: 'attractor_activations_total',

  // Probabilistic metrics
  SUPERPOSITION_COLLAPSES: 'superposition_collapses_total',
  EVOLUTION_CYCLES: 'evolution_cycles_total',
  EVOLUTION_DURATION_MS: 'evolution_duration_ms',

  // System metrics
  MEMORY_USAGE_BYTES: 'memory_usage_bytes',
  ACTIVE_CONNECTIONS: 'active_connections',
} as const;
