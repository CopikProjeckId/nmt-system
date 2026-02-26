/**
 * Metrics Overhead Benchmark Tests
 *
 * Measures the performance impact of metrics collection on system operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsCollector, getMetrics } from '../../src/utils/metrics.js';

describe('Metrics Overhead Benchmark', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = getMetrics();
    metrics.reset();
  });

  describe('Counter Overhead', () => {
    it('should measure increment overhead', () => {
      const iterations = 100000;

      // Baseline: empty loop
      const baselineStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        // no-op
      }
      const baselineTime = performance.now() - baselineStart;

      // With metrics increment
      const metricsStart = performance.now();
      for (let i = 0; i < iterations; i++) {
        metrics.increment('test_counter');
      }
      const metricsTime = performance.now() - metricsStart;

      const overheadPerOp = (metricsTime - baselineTime) / iterations;
      const overheadNs = overheadPerOp * 1000000; // convert to nanoseconds

      console.log(`Counter increment overhead: ${overheadNs.toFixed(2)}ns/op`);
      console.log(`Total time for ${iterations} increments: ${metricsTime.toFixed(2)}ms`);

      // Assert overhead is reasonable (< 1 microsecond per operation)
      expect(overheadPerOp).toBeLessThan(0.001); // < 1µs
    });

    it('should measure increment with labels overhead', () => {
      const iterations = 50000;
      const labels = { method: 'GET', status: '200' };

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        metrics.increment('http_requests', labels);
      }
      const elapsed = performance.now() - start;

      const perOp = elapsed / iterations;
      console.log(`Counter increment with labels: ${(perOp * 1000000).toFixed(2)}ns/op`);

      // With labels should still be < 5µs
      expect(perOp).toBeLessThan(0.005);
    });
  });

  describe('Histogram Overhead', () => {
    it('should measure histogram record overhead', () => {
      const iterations = 50000;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        metrics.histogram('request_duration', Math.random() * 1000);
      }
      const elapsed = performance.now() - start;

      const perOp = elapsed / iterations;
      console.log(`Histogram record overhead: ${(perOp * 1000000).toFixed(2)}ns/op`);

      // Histogram should be < 15µs per operation (includes array push + memory management)
      expect(perOp).toBeLessThan(0.015);
    });

    it('should measure timer overhead', () => {
      const iterations = 10000;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const stop = metrics.startTimer('operation');
        // Simulate minimal work
        stop();
      }
      const elapsed = performance.now() - start;

      const perOp = elapsed / iterations;
      console.log(`Timer (start + stop) overhead: ${(perOp * 1000000).toFixed(2)}ns/op`);

      // Timer should be < 10µs per operation (includes performance.now() calls)
      expect(perOp).toBeLessThan(0.01);
    });
  });

  describe('Gauge Overhead', () => {
    it('should measure gauge set overhead', () => {
      const iterations = 100000;

      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        metrics.gauge('active_connections', i % 100);
      }
      const elapsed = performance.now() - start;

      const perOp = elapsed / iterations;
      console.log(`Gauge set overhead: ${(perOp * 1000000).toFixed(2)}ns/op`);

      expect(perOp).toBeLessThan(0.001);
    });
  });

  describe('Snapshot Overhead', () => {
    it('should measure snapshot overhead with many metrics', () => {
      // Create many metrics
      for (let i = 0; i < 100; i++) {
        metrics.increment(`counter_${i}`);
        metrics.gauge(`gauge_${i}`, i);
        metrics.histogram(`histogram_${i}`, i);
      }

      const iterations = 1000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        metrics.snapshot();
      }
      const elapsed = performance.now() - start;

      const perOp = elapsed / iterations;
      console.log(`Snapshot overhead (300 metrics): ${perOp.toFixed(4)}ms/op`);

      // Snapshot should be < 1ms with 300 metrics
      expect(perOp).toBeLessThan(1);
    });
  });

  describe('Prometheus Export Overhead', () => {
    it('should measure Prometheus export overhead', () => {
      // Create metrics
      for (let i = 0; i < 50; i++) {
        metrics.increment(`http_requests_${i}`, { status: '200' });
        metrics.histogram(`duration_${i}`, Math.random() * 100);
      }

      const iterations = 100;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        metrics.toPrometheus();
      }
      const elapsed = performance.now() - start;

      const perOp = elapsed / iterations;
      console.log(`Prometheus export overhead (100 metrics): ${perOp.toFixed(4)}ms/op`);

      // Export should be < 5ms
      expect(perOp).toBeLessThan(5);
    });
  });

  describe('Memory Overhead', () => {
    it('should measure memory usage for histogram values', () => {
      // Record many values (histogram stores up to 10000)
      for (let i = 0; i < 15000; i++) {
        metrics.histogram('memory_test', Math.random() * 1000);
      }

      const data = metrics.getHistogram('memory_test');
      expect(data).not.toBeNull();
      // Should be capped at 10000
      expect(data!.count).toBeLessThanOrEqual(10000);

      console.log(`Histogram stores max ${data!.count} values (capped at 10000)`);
    });
  });

  describe('Concurrent Access Simulation', () => {
    it('should handle rapid concurrent-like updates', async () => {
      const operations = 10000;
      const promises: Promise<void>[] = [];

      const start = performance.now();

      for (let i = 0; i < operations; i++) {
        promises.push(
          new Promise<void>((resolve) => {
            metrics.increment('concurrent_counter');
            metrics.histogram('concurrent_histogram', Math.random() * 100);
            resolve();
          })
        );
      }

      await Promise.all(promises);
      const elapsed = performance.now() - start;

      console.log(`${operations} concurrent-like operations: ${elapsed.toFixed(2)}ms`);
      expect(metrics.getCounter('concurrent_counter')).toBe(operations);
    });
  });

  describe('Real-world Scenario', () => {
    it('should simulate API request tracking overhead', () => {
      const requestCount = 5000;

      const start = performance.now();

      for (let i = 0; i < requestCount; i++) {
        // Simulate tracking an API request
        const timer = metrics.startTimer('api_request_duration_ms', {
          method: i % 2 === 0 ? 'GET' : 'POST',
          path: '/api/neurons',
        });

        metrics.increment('api_requests_total', {
          method: i % 2 === 0 ? 'GET' : 'POST',
          status: i % 10 === 0 ? '500' : '200',
        });

        // Simulate some minimal work
        for (let j = 0; j < 100; j++) {
          Math.random();
        }

        timer();
      }

      const elapsed = performance.now() - start;
      const perRequest = elapsed / requestCount;

      console.log(`API request tracking overhead: ${(perRequest * 1000).toFixed(2)}µs/request`);
      console.log(`Total time for ${requestCount} requests: ${elapsed.toFixed(2)}ms`);

      // Should add less than 50µs overhead per request
      expect(perRequest).toBeLessThan(0.05);
    });
  });
});

describe('Metrics Accuracy', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = getMetrics();
    metrics.reset();
  });

  it('should maintain accurate counts under load', () => {
    const expected = 100000;

    for (let i = 0; i < expected; i++) {
      metrics.increment('accuracy_test');
    }

    expect(metrics.getCounter('accuracy_test')).toBe(expected);
  });

  it('should maintain accurate histogram statistics', () => {
    const values = [10, 20, 30, 40, 50];

    for (const v of values) {
      metrics.histogram('stats_test', v);
    }

    const data = metrics.getHistogram('stats_test');
    expect(data).not.toBeNull();
    expect(data!.count).toBe(5);
    expect(data!.sum).toBe(150);
    expect(data!.min).toBe(10);
    expect(data!.max).toBe(50);
  });
});
