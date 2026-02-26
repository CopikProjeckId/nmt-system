/**
 * VectorClock Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VectorClock, createVectorClock } from '../../src/sync/vector-clock.js';

describe('VectorClock', () => {
  describe('basic operations', () => {
    it('should create empty clock', () => {
      const clock = new VectorClock('node-1');
      expect(clock.isEmpty()).toBe(true);
      expect(clock.size()).toBe(0);
    });

    it('should increment clock', () => {
      const clock = new VectorClock('node-1');
      const newClock = clock.increment('node-1');

      expect(newClock.get('node-1')).toBe(1);
      expect(clock.get('node-1')).toBe(0); // Original unchanged
    });

    it('should tick in place', () => {
      const clock = new VectorClock('node-1');
      clock.tick('node-1');
      clock.tick('node-1');

      expect(clock.get('node-1')).toBe(2);
    });

    it('should get/set values', () => {
      const clock = new VectorClock('node-1');
      clock.set('node-1', 5);
      clock.set('node-2', 3);

      expect(clock.get('node-1')).toBe(5);
      expect(clock.get('node-2')).toBe(3);
      expect(clock.get('unknown')).toBe(0);
    });
  });

  describe('merge', () => {
    it('should merge clocks taking max values', () => {
      const clock1 = new VectorClock('node-1');
      clock1.set('node-1', 5);
      clock1.set('node-2', 2);

      const clock2 = new VectorClock('node-2');
      clock2.set('node-1', 3);
      clock2.set('node-2', 4);
      clock2.set('node-3', 1);

      const merged = clock1.merge(clock2);

      expect(merged.get('node-1')).toBe(5);
      expect(merged.get('node-2')).toBe(4);
      expect(merged.get('node-3')).toBe(1);
    });

    it('should update in place', () => {
      const clock1 = new VectorClock('node-1');
      clock1.set('node-1', 5);

      const clock2 = new VectorClock('node-2');
      clock2.set('node-1', 3);
      clock2.set('node-2', 4);

      clock1.update(clock2);

      expect(clock1.get('node-1')).toBe(5);
      expect(clock1.get('node-2')).toBe(4);
    });
  });

  describe('compare', () => {
    it('should return equal for identical clocks', () => {
      const clock1 = new VectorClock('node-1');
      clock1.set('node-1', 3);
      clock1.set('node-2', 2);

      const clock2 = new VectorClock('node-2');
      clock2.set('node-1', 3);
      clock2.set('node-2', 2);

      expect(clock1.compare(clock2)).toBe('equal');
      expect(clock1.equals(clock2)).toBe(true);
    });

    it('should detect before relationship', () => {
      const clock1 = new VectorClock('node-1');
      clock1.set('node-1', 1);
      clock1.set('node-2', 2);

      const clock2 = new VectorClock('node-2');
      clock2.set('node-1', 2);
      clock2.set('node-2', 3);

      expect(clock1.compare(clock2)).toBe('before');
      expect(clock1.happenedBefore(clock2)).toBe(true);
    });

    it('should detect after relationship', () => {
      const clock1 = new VectorClock('node-1');
      clock1.set('node-1', 5);
      clock1.set('node-2', 4);

      const clock2 = new VectorClock('node-2');
      clock2.set('node-1', 3);
      clock2.set('node-2', 2);

      expect(clock1.compare(clock2)).toBe('after');
      expect(clock1.happenedAfter(clock2)).toBe(true);
    });

    it('should detect concurrent relationship', () => {
      const clock1 = new VectorClock('node-1');
      clock1.set('node-1', 5);
      clock1.set('node-2', 2);

      const clock2 = new VectorClock('node-2');
      clock2.set('node-1', 3);
      clock2.set('node-2', 4);

      expect(clock1.compare(clock2)).toBe('concurrent');
      expect(clock1.isConcurrentWith(clock2)).toBe(true);
    });

    it('should handle missing nodes', () => {
      const clock1 = new VectorClock('node-1');
      clock1.set('node-1', 5);

      const clock2 = new VectorClock('node-2');
      clock2.set('node-2', 3);

      expect(clock1.compare(clock2)).toBe('concurrent');
    });
  });

  describe('dominates', () => {
    it('should return true when clock is >= in all dimensions', () => {
      const clock1 = new VectorClock('node-1');
      clock1.set('node-1', 5);
      clock1.set('node-2', 3);

      const clock2 = new VectorClock('node-2');
      clock2.set('node-1', 3);
      clock2.set('node-2', 2);

      expect(clock1.dominates(clock2)).toBe(true);
    });

    it('should return false for concurrent clocks', () => {
      const clock1 = new VectorClock('node-1');
      clock1.set('node-1', 5);
      clock1.set('node-2', 1);

      const clock2 = new VectorClock('node-2');
      clock2.set('node-1', 3);
      clock2.set('node-2', 4);

      expect(clock1.dominates(clock2)).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should serialize to JSON', () => {
      const clock = new VectorClock('node-1');
      clock.set('node-1', 5);
      clock.set('node-2', 3);

      const json = clock.toJSON();

      expect(json).toEqual({ 'node-1': 5, 'node-2': 3 });
    });

    it('should deserialize from JSON', () => {
      const json = { 'node-1': 5, 'node-2': 3 };
      const clock = VectorClock.fromJSON(json, 'node-1');

      expect(clock.get('node-1')).toBe(5);
      expect(clock.get('node-2')).toBe(3);
    });

    it('should create clock with initial values', () => {
      const clock = new VectorClock('node-1', { 'node-1': 2, 'node-2': 4 });

      expect(clock.get('node-1')).toBe(2);
      expect(clock.get('node-2')).toBe(4);
    });
  });

  describe('utility methods', () => {
    it('should get all nodes', () => {
      const clock = new VectorClock('node-1');
      clock.set('node-1', 1);
      clock.set('node-2', 2);
      clock.set('node-3', 3);

      const nodes = clock.getNodes();

      expect(nodes).toHaveLength(3);
      expect(nodes).toContain('node-1');
      expect(nodes).toContain('node-2');
      expect(nodes).toContain('node-3');
    });

    it('should calculate sum', () => {
      const clock = new VectorClock('node-1');
      clock.set('node-1', 5);
      clock.set('node-2', 3);
      clock.set('node-3', 2);

      expect(clock.sum()).toBe(10);
    });

    it('should clone correctly', () => {
      const clock = new VectorClock('node-1');
      clock.set('node-1', 5);

      const clone = clock.clone();
      clone.tick('node-1');

      expect(clock.get('node-1')).toBe(5);
      expect(clone.get('node-1')).toBe(6);
    });

    it('should convert to string', () => {
      const clock = new VectorClock('node-1');
      clock.set('node-1', 2);
      clock.set('node-2', 3);

      const str = clock.toString();

      expect(str).toContain('node-1:2');
      expect(str).toContain('node-2:3');
    });
  });

  describe('createVectorClock factory', () => {
    it('should create clock with node ID', () => {
      const clock = createVectorClock('node-1');
      clock.tick();

      expect(clock.get('node-1')).toBe(1);
    });
  });
});
