/**
 * Unit Tests - Metrics System
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MetricsCollector,
  getMetrics,
  incrementCounter,
  setGauge,
  recordHistogram,
  startTimer,
  MetricNames,
} from '../../src/utils/metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = MetricsCollector.getInstance();
    metrics.reset();
  });

  describe('Counters', () => {
    it('should increment counter', () => {
      metrics.increment('test_counter');
      expect(metrics.getCounter('test_counter')).toBe(1);

      metrics.increment('test_counter');
      expect(metrics.getCounter('test_counter')).toBe(2);
    });

    it('should increment by custom value', () => {
      metrics.increment('test_counter', undefined, 5);
      expect(metrics.getCounter('test_counter')).toBe(5);
    });

    it('should support labels', () => {
      metrics.increment('requests', { method: 'GET' });
      metrics.increment('requests', { method: 'POST' });
      metrics.increment('requests', { method: 'GET' });

      expect(metrics.getCounter('requests', { method: 'GET' })).toBe(2);
      expect(metrics.getCounter('requests', { method: 'POST' })).toBe(1);
    });

    it('should return 0 for non-existent counter', () => {
      expect(metrics.getCounter('non_existent')).toBe(0);
    });
  });

  describe('Gauges', () => {
    it('should set gauge value', () => {
      metrics.gauge('connections', 10);
      expect(metrics.getGauge('connections')).toBe(10);

      metrics.gauge('connections', 15);
      expect(metrics.getGauge('connections')).toBe(15);
    });

    it('should increment gauge', () => {
      metrics.gauge('connections', 10);
      metrics.gaugeIncrement('connections', 5);
      expect(metrics.getGauge('connections')).toBe(15);
    });

    it('should decrement gauge', () => {
      metrics.gauge('connections', 10);
      metrics.gaugeDecrement('connections', 3);
      expect(metrics.getGauge('connections')).toBe(7);
    });

    it('should support labels', () => {
      metrics.gauge('cpu', 50, { core: '0' });
      metrics.gauge('cpu', 60, { core: '1' });

      expect(metrics.getGauge('cpu', { core: '0' })).toBe(50);
      expect(metrics.getGauge('cpu', { core: '1' })).toBe(60);
    });
  });

  describe('Histograms', () => {
    it('should record histogram values', () => {
      metrics.histogram('duration', 10);
      metrics.histogram('duration', 20);
      metrics.histogram('duration', 30);

      const data = metrics.getHistogram('duration');
      expect(data).not.toBeNull();
      expect(data!.count).toBe(3);
      expect(data!.sum).toBe(60);
      expect(data!.min).toBe(10);
      expect(data!.max).toBe(30);
    });

    it('should populate buckets correctly', () => {
      metrics.histogram('latency', 5);
      metrics.histogram('latency', 15);
      metrics.histogram('latency', 150);

      const data = metrics.getHistogram('latency');
      expect(data).not.toBeNull();

      // Values <= 5 (bucket le=5)
      const bucket5 = data!.buckets.find(b => b.le === 5);
      expect(bucket5!.count).toBe(1);

      // Values <= 25 (bucket le=25)
      const bucket25 = data!.buckets.find(b => b.le === 25);
      expect(bucket25!.count).toBe(2);

      // All values (bucket le=+Inf)
      const bucketInf = data!.buckets.find(b => b.le === Infinity);
      expect(bucketInf!.count).toBe(3);
    });

    it('should return null for non-existent histogram', () => {
      expect(metrics.getHistogram('non_existent')).toBeNull();
    });
  });

  describe('Timer', () => {
    it('should measure duration', async () => {
      const stop = metrics.startTimer('operation');

      // Simulate some work
      await new Promise(resolve => setTimeout(resolve, 10));

      const duration = stop();
      expect(duration).toBeGreaterThan(0);

      const data = metrics.getHistogram('operation');
      expect(data).not.toBeNull();
      expect(data!.count).toBe(1);
    });

    it('should time async functions', async () => {
      const result = await metrics.timed('async_op', async () => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return 'done';
      });

      expect(result).toBe('done');

      const data = metrics.getHistogram('async_op');
      expect(data).not.toBeNull();
      expect(data!.count).toBe(1);
    });
  });

  describe('Health Checks', () => {
    it('should register and run health checks', async () => {
      metrics.registerHealthCheck('database', async () => ({
        name: 'database',
        healthy: true,
        message: 'Connected',
      }));

      const health = await metrics.checkHealth();
      expect(health.status).toBe('healthy');
      expect(health.checks).toHaveLength(1);
      expect(health.checks[0].healthy).toBe(true);
    });

    it('should report unhealthy status', async () => {
      metrics.registerHealthCheck('failing', async () => ({
        name: 'failing',
        healthy: false,
        message: 'Connection lost',
      }));

      const health = await metrics.checkHealth();
      expect(health.status).toBe('unhealthy');
    });

    it('should handle check errors', async () => {
      metrics.registerHealthCheck('error', async () => {
        throw new Error('Check failed');
      });

      const health = await metrics.checkHealth();
      expect(health.status).toBe('unhealthy');
      expect(health.checks[0].message).toBe('Check failed');
    });

    it('should unregister health checks', async () => {
      metrics.registerHealthCheck('temp', async () => ({
        name: 'temp',
        healthy: true,
      }));

      metrics.unregisterHealthCheck('temp');

      const health = await metrics.checkHealth();
      expect(health.checks).toHaveLength(0);
    });
  });

  describe('Snapshot', () => {
    it('should return all metrics', () => {
      metrics.increment('requests');
      metrics.gauge('connections', 5);
      metrics.histogram('duration', 100);

      const snapshot = metrics.snapshot();

      expect(snapshot.counters['requests']).toBe(1);
      expect(snapshot.gauges['connections']).toBe(5);
      expect(snapshot.histograms['duration']).toBeDefined();
      expect(snapshot.uptime).toBeGreaterThanOrEqual(0);
      expect(snapshot.timestamp).toBeDefined();
    });
  });

  describe('Prometheus Export', () => {
    it('should export in Prometheus format', () => {
      metrics.increment('http_requests_total', { method: 'GET' });
      metrics.gauge('active_users', 10);
      metrics.histogram('request_duration', 50);
      metrics.histogram('request_duration', 100);

      const prometheus = metrics.toPrometheus();

      expect(prometheus).toContain('http_requests_total');
      expect(prometheus).toContain('active_users 10');
      expect(prometheus).toContain('request_duration_sum');
      expect(prometheus).toContain('request_duration_count 2');
    });
  });
});

describe('Convenience Functions', () => {
  beforeEach(() => {
    getMetrics().reset();
  });

  it('incrementCounter should work', () => {
    incrementCounter('test');
    expect(getMetrics().getCounter('test')).toBe(1);
  });

  it('setGauge should work', () => {
    setGauge('test', 42);
    expect(getMetrics().getGauge('test')).toBe(42);
  });

  it('recordHistogram should work', () => {
    recordHistogram('test', 100);
    const data = getMetrics().getHistogram('test');
    expect(data!.count).toBe(1);
  });

  it('startTimer should work', async () => {
    const stop = startTimer('test');
    await new Promise(resolve => setTimeout(resolve, 5));
    stop();

    const data = getMetrics().getHistogram('test');
    expect(data!.count).toBe(1);
  });
});

describe('MetricNames', () => {
  it('should have standard metric names', () => {
    expect(MetricNames.API_REQUESTS_TOTAL).toBe('api_requests_total');
    expect(MetricNames.NEURONS_TOTAL).toBe('neurons_total');
    expect(MetricNames.INFERENCE_DURATION_MS).toBe('inference_duration_ms');
  });
});
