/**
 * EventBus Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  EventBus,
  getEventBus,
  resetEventBus,
  createEvent,
  type SystemEvent,
} from '../../src/events/event-bus.js';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('publish/subscribe', () => {
    it('should publish events to subscribers', () => {
      const handler = vi.fn();
      bus.subscribe('neuron:created', handler);

      const event = createEvent('neuron:created', 'test', { id: 'neuron-123' });
      bus.publish(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('should support wildcard subscription', () => {
      const handler = vi.fn();
      bus.subscribe('*', handler);

      bus.publish(createEvent('neuron:created', 'test', {}));
      bus.publish(createEvent('synapse:formed', 'test', {}));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = bus.subscribe('neuron:created', handler);

      bus.publish(createEvent('neuron:created', 'test', {}));
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      bus.publish(createEvent('neuron:created', 'test', {}));
      expect(handler).toHaveBeenCalledTimes(1); // Still 1, not called again
    });

    it('should subscribe to multiple event types', () => {
      const handler = vi.fn();
      bus.subscribeMany(['neuron:created', 'neuron:updated'], handler);

      bus.publish(createEvent('neuron:created', 'test', {}));
      bus.publish(createEvent('neuron:updated', 'test', {}));
      bus.publish(createEvent('neuron:deleted', 'test', {}));

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('should support subscribeOnce', () => {
      const handler = vi.fn();
      bus.subscribeOnce('neuron:created', handler);

      bus.publish(createEvent('neuron:created', 'test', {}));
      bus.publish(createEvent('neuron:created', 'test', {}));

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('event history', () => {
    it('should store events in history', () => {
      bus.publish(createEvent('neuron:created', 'test', { id: '1' }));
      bus.publish(createEvent('neuron:created', 'test', { id: '2' }));

      const history = bus.getEvents();
      expect(history).toHaveLength(2);
    });

    it('should limit history size', () => {
      const smallBus = new EventBus({ maxHistory: 5 });

      for (let i = 0; i < 10; i++) {
        smallBus.publish(createEvent('neuron:created', 'test', { id: i }));
      }

      const history = smallBus.getEvents();
      expect(history).toHaveLength(5);
      expect((history[0].payload as any).id).toBe(5);
    });

    it('should filter events by type', () => {
      bus.publish(createEvent('neuron:created', 'test', {}));
      bus.publish(createEvent('synapse:formed', 'test', {}));
      bus.publish(createEvent('neuron:updated', 'test', {}));

      const filtered = bus.getEvents({ types: ['neuron:created', 'neuron:updated'] });
      expect(filtered).toHaveLength(2);
    });

    it('should filter events by source', () => {
      bus.publish(createEvent('neuron:created', 'module-a', {}));
      bus.publish(createEvent('neuron:created', 'module-b', {}));

      const filtered = bus.getEvents({ source: 'module-a' });
      expect(filtered).toHaveLength(1);
    });

    it('should filter events by correlation ID', () => {
      bus.publish(createEvent('learning:progress', 'test', {}, 'session-1'));
      bus.publish(createEvent('learning:progress', 'test', {}, 'session-2'));
      bus.publish(createEvent('learning:complete', 'test', {}, 'session-1'));

      const correlated = bus.getCorrelatedEvents('session-1');
      expect(correlated).toHaveLength(2);
    });

    it('should get events since timestamp', () => {
      const t1 = new Date().toISOString();
      bus.publish(createEvent('neuron:created', 'test', {}));

      // Wait a bit
      const t2 = new Date(Date.now() + 10).toISOString();

      const events = bus.getEventsSince(t1);
      expect(events.length).toBeGreaterThanOrEqual(1);

      const noEvents = bus.getEventsSince(t2);
      expect(noEvents).toHaveLength(0);
    });

    it('should get recent events', () => {
      for (let i = 0; i < 10; i++) {
        bus.publish(createEvent('neuron:created', 'test', { id: i }));
      }

      const recent = bus.getRecentEvents(3);
      expect(recent).toHaveLength(3);
      expect((recent[0].payload as any).id).toBe(7);
    });

    it('should clear history', () => {
      bus.publish(createEvent('neuron:created', 'test', {}));
      bus.clearHistory();

      expect(bus.getEvents()).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return event statistics', () => {
      bus.publish(createEvent('neuron:created', 'test', {}));
      bus.publish(createEvent('neuron:created', 'test', {}));
      bus.publish(createEvent('synapse:formed', 'test', {}));

      const stats = bus.getStats();
      expect(stats.totalEvents).toBe(3);
      expect(stats.eventsByType['neuron:created']).toBe(2);
      expect(stats.eventsByType['synapse:formed']).toBe(1);
      expect(stats.oldestEvent).not.toBeNull();
      expect(stats.newestEvent).not.toBeNull();
    });
  });

  describe('waitFor', () => {
    it('should wait for a specific event', async () => {
      const promise = bus.waitFor('neuron:created');

      setTimeout(() => {
        bus.publish(createEvent('neuron:created', 'test', { id: 'waited' }));
      }, 10);

      const event = await promise;
      expect((event.payload as any).id).toBe('waited');
    });

    it('should timeout if event not received', async () => {
      const promise = bus.waitFor('neuron:created', { timeout: 50 });

      await expect(promise).rejects.toThrow('Timeout waiting for event');
    });

    it('should apply custom filter', async () => {
      const promise = bus.waitFor<{ id: string }>('neuron:created', {
        filter: (e) => e.payload.id === 'target',
      });

      setTimeout(() => {
        bus.publish(createEvent('neuron:created', 'test', { id: 'wrong' }));
        bus.publish(createEvent('neuron:created', 'test', { id: 'target' }));
      }, 10);

      const event = await promise;
      expect((event.payload as any).id).toBe('target');
    });
  });

  describe('createChild', () => {
    it('should forward events to parent with prefixed source', () => {
      const handler = vi.fn();
      bus.subscribe('neuron:created', handler);

      const child = bus.createChild('child-module');
      child.publish(createEvent('neuron:created', 'internal', { id: '1' }));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].source).toBe('child-module/internal');
    });
  });

  describe('createEvent helper', () => {
    it('should create a properly formatted event', () => {
      const event = createEvent('neuron:created', 'test-source', { foo: 'bar' }, 'corr-123');

      expect(event.type).toBe('neuron:created');
      expect(event.source).toBe('test-source');
      expect(event.payload).toEqual({ foo: 'bar' });
      expect(event.correlationId).toBe('corr-123');
      expect(event.timestamp).toBeDefined();
    });
  });

  describe('singleton', () => {
    beforeEach(() => {
      resetEventBus();
    });

    it('should return same instance', () => {
      const bus1 = getEventBus();
      const bus2 = getEventBus();
      expect(bus1).toBe(bus2);
    });

    it('should reset properly', () => {
      const bus1 = getEventBus();
      bus1.publish(createEvent('neuron:created', 'test', {}));

      resetEventBus();

      const bus2 = getEventBus();
      expect(bus2.getEvents()).toHaveLength(0);
    });
  });
});
