/**
 * Progress Tracker - Real-time progress tracking with ETA calculation
 *
 * Provides progress monitoring for long-running operations like learning sessions.
 *
 * @module events/progress-tracker
 */

import type { UUID } from '../types/index.js';
import { EventBus, createEvent, type SystemEvent } from './event-bus.js';

/**
 * Progress state for a tracked operation
 */
export interface ProgressState {
  /** Unique session/operation ID */
  sessionId: UUID;
  /** Current stage name */
  stage: string;
  /** Number of items processed */
  current: number;
  /** Total items to process */
  total: number;
  /** Start time (ms since epoch) */
  startTime: number;
  /** Last update time (ms since epoch) */
  lastUpdateTime: number;
  /** Items processed per second */
  throughput: number;
  /** Estimated time remaining (ms) */
  eta: number;
  /** Progress percentage (0-100) */
  percentage: number;
  /** Optional status message */
  message?: string;
}

/**
 * Progress update event payload
 */
export interface ProgressEventPayload {
  sessionId: UUID;
  stage: string;
  current: number;
  total: number;
  percentage: number;
  throughput: number;
  eta: number;
  message?: string;
}

/**
 * Progress tracker options
 */
export interface ProgressTrackerOptions {
  /** EventBus for publishing events */
  eventBus?: EventBus;
  /** Minimum interval between progress events (ms) */
  throttleInterval?: number;
  /** Enable automatic ETA smoothing */
  smoothEta?: boolean;
}

/**
 * ProgressTracker - Track and report progress of long-running operations
 *
 * Features:
 * - Real-time progress updates
 * - Throughput calculation (items/sec)
 * - ETA estimation with smoothing
 * - Multi-stage tracking
 * - Throttled event emission
 *
 * @example
 * ```typescript
 * const tracker = new ProgressTracker({ eventBus });
 *
 * // Start tracking
 * tracker.startTracking('session-123', 'processing', 100);
 *
 * // Update progress
 * for (let i = 0; i < 100; i++) {
 *   await processItem(i);
 *   tracker.updateProgress('session-123', i + 1);
 * }
 *
 * // End tracking
 * const finalState = tracker.endTracking('session-123');
 * console.log(`Completed in ${finalState.throughput.toFixed(2)} items/sec`);
 * ```
 */
export class ProgressTracker {
  private sessions: Map<UUID, ProgressState> = new Map();
  private eventBus: EventBus | null;
  private throttleInterval: number;
  private smoothEta: boolean;
  private lastEmitTime: Map<UUID, number> = new Map();
  private etaHistory: Map<UUID, number[]> = new Map();

  constructor(options?: ProgressTrackerOptions) {
    this.eventBus = options?.eventBus ?? null;
    this.throttleInterval = options?.throttleInterval ?? 100; // 100ms default
    this.smoothEta = options?.smoothEta ?? true;
  }

  /**
   * Start tracking progress for a session
   */
  startTracking(
    sessionId: UUID,
    stage: string,
    total: number,
    message?: string
  ): ProgressState {
    const now = Date.now();

    const state: ProgressState = {
      sessionId,
      stage,
      current: 0,
      total: Math.max(total, 1), // Prevent division by zero
      startTime: now,
      lastUpdateTime: now,
      throughput: 0,
      eta: 0,
      percentage: 0,
      message,
    };

    this.sessions.set(sessionId, state);
    this.etaHistory.set(sessionId, []);

    this.emitProgressEvent(state, true);

    return state;
  }

  /**
   * Update progress for a session
   */
  updateProgress(
    sessionId: UUID,
    current: number,
    message?: string
  ): ProgressState | null {
    const state = this.sessions.get(sessionId);

    if (!state) {
      return null;
    }

    const now = Date.now();
    const elapsed = now - state.startTime;

    // Update state
    state.current = Math.min(current, state.total);
    state.lastUpdateTime = now;

    // Calculate throughput (items per second)
    if (elapsed > 0) {
      state.throughput = (state.current / elapsed) * 1000;
    }

    // Calculate percentage
    state.percentage = (state.current / state.total) * 100;

    // Calculate ETA
    if (state.throughput > 0) {
      const remaining = state.total - state.current;
      const rawEta = (remaining / state.throughput) * 1000;

      if (this.smoothEta) {
        state.eta = this.calculateSmoothedEta(sessionId, rawEta);
      } else {
        state.eta = rawEta;
      }
    }

    if (message !== undefined) {
      state.message = message;
    }

    // Emit event (throttled)
    this.emitProgressEvent(state);

    return state;
  }

  /**
   * Change the current stage
   */
  changeStage(
    sessionId: UUID,
    newStage: string,
    total: number,
    message?: string
  ): ProgressState | null {
    const state = this.sessions.get(sessionId);

    if (!state) {
      return null;
    }

    // Reset for new stage but keep session
    state.stage = newStage;
    state.current = 0;
    state.total = Math.max(total, 1);
    state.startTime = Date.now();
    state.lastUpdateTime = state.startTime;
    state.throughput = 0;
    state.eta = 0;
    state.percentage = 0;
    state.message = message;

    // Reset ETA history for new stage
    this.etaHistory.set(sessionId, []);

    this.emitProgressEvent(state, true);

    return state;
  }

  /**
   * End tracking for a session
   */
  endTracking(sessionId: UUID): ProgressState | null {
    const state = this.sessions.get(sessionId);

    if (!state) {
      return null;
    }

    // Final update
    state.current = state.total;
    state.percentage = 100;
    state.eta = 0;

    const elapsed = Date.now() - state.startTime;
    if (elapsed > 0) {
      state.throughput = (state.total / elapsed) * 1000;
    }

    // Emit final event
    this.emitProgressEvent(state, true);

    // Emit completion event
    if (this.eventBus) {
      this.eventBus.publish(createEvent(
        'learning:complete',
        'progress-tracker',
        {
          sessionId,
          stage: state.stage,
          totalItems: state.total,
          duration: elapsed,
          throughput: state.throughput,
        }
      ));
    }

    // Clean up
    this.sessions.delete(sessionId);
    this.lastEmitTime.delete(sessionId);
    this.etaHistory.delete(sessionId);

    return state;
  }

  /**
   * Get current progress for a session
   */
  getProgress(sessionId: UUID): ProgressState | null {
    return this.sessions.get(sessionId) ?? null;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): UUID[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check if a session is being tracked
   */
  isTracking(sessionId: UUID): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Calculate ETA for a session
   */
  calculateETA(sessionId: UUID): number {
    const state = this.sessions.get(sessionId);

    if (!state || state.throughput === 0) {
      return 0;
    }

    const remaining = state.total - state.current;
    return (remaining / state.throughput) * 1000;
  }

  /**
   * Get formatted time remaining
   */
  getFormattedETA(sessionId: UUID): string {
    const eta = this.calculateETA(sessionId);

    if (eta <= 0) {
      return 'Complete';
    }

    const seconds = Math.floor(eta / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Set the event bus (for deferred initialization)
   */
  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus;
  }

  /**
   * Calculate smoothed ETA using exponential moving average
   */
  private calculateSmoothedEta(sessionId: UUID, rawEta: number): number {
    const history = this.etaHistory.get(sessionId);

    if (!history) {
      return rawEta;
    }

    // Keep last 5 ETA values
    history.push(rawEta);
    if (history.length > 5) {
      history.shift();
    }

    // Exponential weighted average (more recent values have higher weight)
    let totalWeight = 0;
    let weightedSum = 0;

    for (let i = 0; i < history.length; i++) {
      const weight = Math.pow(2, i); // 1, 2, 4, 8, 16
      weightedSum += history[i] * weight;
      totalWeight += weight;
    }

    return weightedSum / totalWeight;
  }

  /**
   * Emit progress event (with throttling)
   */
  private emitProgressEvent(state: ProgressState, force: boolean = false): void {
    if (!this.eventBus) {
      return;
    }

    const now = Date.now();
    const lastEmit = this.lastEmitTime.get(state.sessionId) ?? 0;

    // Throttle events unless forced
    if (!force && now - lastEmit < this.throttleInterval) {
      return;
    }

    this.lastEmitTime.set(state.sessionId, now);

    const payload: ProgressEventPayload = {
      sessionId: state.sessionId,
      stage: state.stage,
      current: state.current,
      total: state.total,
      percentage: state.percentage,
      throughput: state.throughput,
      eta: state.eta,
      message: state.message,
    };

    this.eventBus.publish(createEvent(
      'learning:progress',
      'progress-tracker',
      payload,
      state.sessionId
    ));
  }
}

/**
 * Create a progress tracker instance
 */
export function createProgressTracker(options?: ProgressTrackerOptions): ProgressTracker {
  return new ProgressTracker(options);
}

/**
 * Singleton progress tracker
 */
let globalProgressTracker: ProgressTracker | null = null;

export function getProgressTracker(): ProgressTracker {
  if (!globalProgressTracker) {
    globalProgressTracker = new ProgressTracker();
  }
  return globalProgressTracker;
}

export function resetProgressTracker(): void {
  globalProgressTracker = null;
}
