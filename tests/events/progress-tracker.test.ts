/**
 * ProgressTracker Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ProgressTracker,
  createProgressTracker,
  getProgressTracker,
  resetProgressTracker,
} from '../../src/events/progress-tracker.js';
import { EventBus } from '../../src/events/event-bus.js';

describe('ProgressTracker', () => {
  let tracker: ProgressTracker;
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
    tracker = new ProgressTracker({ eventBus, throttleInterval: 0 });
  });

  describe('startTracking', () => {
    it('should initialize progress state', () => {
      const state = tracker.startTracking('session-1', 'processing', 100);

      expect(state.sessionId).toBe('session-1');
      expect(state.stage).toBe('processing');
      expect(state.current).toBe(0);
      expect(state.total).toBe(100);
      expect(state.percentage).toBe(0);
      expect(state.throughput).toBe(0);
    });

    it('should emit progress event', () => {
      const handler = vi.fn();
      eventBus.subscribe('learning:progress', handler);

      tracker.startTracking('session-1', 'processing', 100);

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should handle total of 0 gracefully', () => {
      const state = tracker.startTracking('session-1', 'processing', 0);
      expect(state.total).toBe(1); // Prevented division by zero
    });
  });

  describe('updateProgress', () => {
    it('should update progress state', () => {
      tracker.startTracking('session-1', 'processing', 100);
      const state = tracker.updateProgress('session-1', 50);

      expect(state).not.toBeNull();
      expect(state!.current).toBe(50);
      expect(state!.percentage).toBe(50);
    });

    it('should calculate throughput', async () => {
      tracker.startTracking('session-1', 'processing', 100);

      // Wait a bit to get measurable time
      await new Promise((resolve) => setTimeout(resolve, 50));

      const state = tracker.updateProgress('session-1', 10);

      expect(state).not.toBeNull();
      expect(state!.throughput).toBeGreaterThan(0);
    });

    it('should calculate ETA', async () => {
      tracker.startTracking('session-1', 'processing', 100);

      await new Promise((resolve) => setTimeout(resolve, 50));

      const state = tracker.updateProgress('session-1', 10);

      expect(state).not.toBeNull();
      expect(state!.eta).toBeGreaterThan(0);
    });

    it('should return null for unknown session', () => {
      const state = tracker.updateProgress('unknown', 50);
      expect(state).toBeNull();
    });

    it('should cap current at total', () => {
      tracker.startTracking('session-1', 'processing', 100);
      const state = tracker.updateProgress('session-1', 150);

      expect(state!.current).toBe(100);
      expect(state!.percentage).toBe(100);
    });

    it('should update message', () => {
      tracker.startTracking('session-1', 'processing', 100);
      const state = tracker.updateProgress('session-1', 50, 'Halfway done');

      expect(state!.message).toBe('Halfway done');
    });
  });

  describe('changeStage', () => {
    it('should change to new stage', () => {
      tracker.startTracking('session-1', 'stage1', 50);
      tracker.updateProgress('session-1', 50);

      const state = tracker.changeStage('session-1', 'stage2', 100);

      expect(state!.stage).toBe('stage2');
      expect(state!.current).toBe(0);
      expect(state!.total).toBe(100);
      expect(state!.percentage).toBe(0);
    });

    it('should reset throughput and ETA', () => {
      tracker.startTracking('session-1', 'stage1', 50);
      tracker.updateProgress('session-1', 25);

      const state = tracker.changeStage('session-1', 'stage2', 100);

      expect(state!.throughput).toBe(0);
      expect(state!.eta).toBe(0);
    });
  });

  describe('endTracking', () => {
    it('should finalize and remove session', () => {
      tracker.startTracking('session-1', 'processing', 100);
      tracker.updateProgress('session-1', 80);

      const finalState = tracker.endTracking('session-1');

      expect(finalState).not.toBeNull();
      expect(finalState!.current).toBe(100);
      expect(finalState!.percentage).toBe(100);
      expect(finalState!.eta).toBe(0);

      // Session should be removed
      expect(tracker.getProgress('session-1')).toBeNull();
    });

    it('should emit completion event', () => {
      const handler = vi.fn();
      eventBus.subscribe('learning:complete', handler);

      tracker.startTracking('session-1', 'processing', 100);
      tracker.endTracking('session-1');

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProgress', () => {
    it('should return current progress state', () => {
      tracker.startTracking('session-1', 'processing', 100);
      tracker.updateProgress('session-1', 30);

      const state = tracker.getProgress('session-1');

      expect(state).not.toBeNull();
      expect(state!.current).toBe(30);
    });

    it('should return null for unknown session', () => {
      expect(tracker.getProgress('unknown')).toBeNull();
    });
  });

  describe('getActiveSessions', () => {
    it('should return list of active sessions', () => {
      tracker.startTracking('session-1', 'processing', 100);
      tracker.startTracking('session-2', 'processing', 50);

      const sessions = tracker.getActiveSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions).toContain('session-1');
      expect(sessions).toContain('session-2');
    });
  });

  describe('isTracking', () => {
    it('should return true for active session', () => {
      tracker.startTracking('session-1', 'processing', 100);
      expect(tracker.isTracking('session-1')).toBe(true);
    });

    it('should return false for unknown session', () => {
      expect(tracker.isTracking('unknown')).toBe(false);
    });
  });

  describe('calculateETA', () => {
    it('should calculate ETA based on throughput', async () => {
      tracker.startTracking('session-1', 'processing', 100);

      await new Promise((resolve) => setTimeout(resolve, 50));
      tracker.updateProgress('session-1', 10);

      const eta = tracker.calculateETA('session-1');

      expect(eta).toBeGreaterThan(0);
    });

    it('should return 0 for unknown session', () => {
      expect(tracker.calculateETA('unknown')).toBe(0);
    });
  });

  describe('getFormattedETA', () => {
    it('should format seconds', async () => {
      // Create tracker without smoothing for predictable results
      const simpleTracker = new ProgressTracker({
        eventBus,
        throttleInterval: 0,
        smoothEta: false,
      });

      simpleTracker.startTracking('session-1', 'processing', 100);

      await new Promise((resolve) => setTimeout(resolve, 100));
      simpleTracker.updateProgress('session-1', 10);

      const formatted = simpleTracker.getFormattedETA('session-1');

      // Should be some format like "Xs" or "Xm Xs"
      expect(formatted).toMatch(/\d+(s|m|h)/);
    });

    it('should return Complete for finished session', () => {
      tracker.startTracking('session-1', 'processing', 100);
      tracker.updateProgress('session-1', 100);

      const formatted = tracker.getFormattedETA('session-1');
      expect(formatted).toBe('Complete');
    });
  });

  describe('throttling', () => {
    it('should throttle progress events', () => {
      const throttledTracker = new ProgressTracker({
        eventBus,
        throttleInterval: 100,
      });

      const handler = vi.fn();
      eventBus.subscribe('learning:progress', handler);

      throttledTracker.startTracking('session-1', 'processing', 100);

      // Rapid updates
      for (let i = 1; i <= 10; i++) {
        throttledTracker.updateProgress('session-1', i);
      }

      // Should have only 1 or 2 events due to throttling (start + maybe 1 update)
      expect(handler.mock.calls.length).toBeLessThan(10);
    });
  });

  describe('singleton', () => {
    beforeEach(() => {
      resetProgressTracker();
    });

    it('should return same instance', () => {
      const t1 = getProgressTracker();
      const t2 = getProgressTracker();
      expect(t1).toBe(t2);
    });

    it('should reset properly', () => {
      const t1 = getProgressTracker();
      t1.startTracking('session-1', 'test', 100);

      resetProgressTracker();

      const t2 = getProgressTracker();
      expect(t2.isTracking('session-1')).toBe(false);
    });
  });

  describe('createProgressTracker factory', () => {
    it('should create new instance with options', () => {
      const customTracker = createProgressTracker({
        eventBus,
        throttleInterval: 200,
        smoothEta: false,
      });

      expect(customTracker).toBeInstanceOf(ProgressTracker);
    });
  });
});
