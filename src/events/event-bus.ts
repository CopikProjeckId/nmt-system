/**
 * Event Bus - Central event infrastructure for NMT system
 *
 * Provides publish/subscribe functionality for system-wide events,
 * enabling loose coupling between modules.
 *
 * @module events/event-bus
 */

import { EventEmitter } from 'events';

/**
 * System event types
 */
export type SystemEventType =
  // Neuron events
  | 'neuron:created'
  | 'neuron:updated'
  | 'neuron:deleted'
  // Synapse events
  | 'synapse:formed'
  | 'synapse:updated'
  | 'synapse:removed'
  // Merkle events
  | 'merkle:root_changed'
  | 'merkle:proof_generated'
  | 'merkle:verified'
  // Learning events
  | 'learning:session_started'
  | 'learning:session_ended'
  | 'learning:extract'
  | 'learning:pattern'
  | 'learning:process'
  | 'learning:outcome'
  | 'learning:progress'
  | 'learning:complete'
  | 'learning:error'
  // Sync events
  | 'sync:state_changed'
  | 'sync:conflict'
  | 'sync:resolved'
  | 'sync:peer_connected'
  | 'sync:peer_disconnected'
  // Attractor events
  | 'attractor:created'
  | 'attractor:decayed'
  | 'attractor:activated'
  // Evolution events
  | 'evolution:started'
  | 'evolution:completed'
  | 'evolution:neuron_evolved';

/**
 * System event structure
 */
export interface SystemEvent<T = unknown> {
  /** Event type */
  type: SystemEventType;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Source module/component */
  source: string;
  /** Optional correlation ID for tracking related events */
  correlationId?: string;
  /** Event payload */
  payload: T;
}

/**
 * Event handler function type
 */
export type EventHandler<T = unknown> = (event: SystemEvent<T>) => void | Promise<void>;

/**
 * Event filter options
 */
export interface EventFilter {
  /** Filter by event type(s) */
  types?: SystemEventType[];
  /** Filter by source */
  source?: string;
  /** Filter by correlation ID */
  correlationId?: string;
  /** Filter events after this timestamp */
  after?: string;
  /** Filter events before this timestamp */
  before?: string;
}

/**
 * EventBus - Central event hub for the NMT system
 *
 * Features:
 * - Type-safe publish/subscribe
 * - Event history with configurable retention
 * - Event filtering and querying
 * - Async handler support
 *
 * @example
 * ```typescript
 * const bus = new EventBus();
 *
 * // Subscribe to events
 * bus.subscribe('learning:progress', (event) => {
 *   console.log(`Progress: ${event.payload.current}/${event.payload.total}`);
 * });
 *
 * // Publish an event
 * bus.publish({
 *   type: 'learning:progress',
 *   timestamp: new Date().toISOString(),
 *   source: 'learning-system',
 *   payload: { stage: 'extract', current: 5, total: 10 }
 * });
 * ```
 */
/**
 * EventBus configuration options
 */
export interface EventBusOptions {
  /** Maximum number of events to retain in history (default: 1000) */
  maxHistory?: number;
  /** Enable event history retention (default: true) */
  enableHistory?: boolean;
  /** Maximum payload size in bytes (default: 1MB) */
  maxPayloadSize?: number;
  /** Default timeout for waitFor() in ms (default: 30000) */
  defaultWaitTimeout?: number;
}

export class EventBus extends EventEmitter {
  private eventHistory: SystemEvent[] = [];
  private maxHistory: number;
  private historyEnabled: boolean;
  private maxPayloadSize: number;
  private defaultWaitTimeout: number;

  constructor(options?: EventBusOptions) {
    super();
    this.maxHistory = options?.maxHistory ?? 1000;
    this.historyEnabled = options?.enableHistory ?? true;
    this.maxPayloadSize = options?.maxPayloadSize ?? 1_000_000; // 1MB default
    this.defaultWaitTimeout = options?.defaultWaitTimeout ?? 30000; // 30 seconds
    this.setMaxListeners(100);
  }

  /**
   * Publish an event to all subscribers
   * @throws {Error} If payload exceeds maximum size limit
   */
  publish<T>(event: SystemEvent<T>): void {
    // Validate payload size to prevent DoS
    const payloadStr = JSON.stringify(event.payload);
    if (payloadStr.length > this.maxPayloadSize) {
      throw new Error(
        `Event payload exceeds maximum size (${payloadStr.length} > ${this.maxPayloadSize} bytes)`
      );
    }

    // Add to history if enabled
    if (this.historyEnabled) {
      this.eventHistory.push(event as SystemEvent);

      // Trim history efficiently using splice (avoids creating new array)
      if (this.eventHistory.length > this.maxHistory) {
        this.eventHistory.splice(0, this.eventHistory.length - this.maxHistory);
      }
    }

    // Emit to type-specific listeners
    this.emit(event.type, event);

    // Emit to wildcard listeners
    this.emit('*', event);
  }

  /**
   * Subscribe to a specific event type
   */
  subscribe<T>(
    type: SystemEventType | '*',
    handler: EventHandler<T>
  ): () => void {
    this.on(type, handler as EventHandler);

    // Return unsubscribe function
    return () => {
      this.off(type, handler as EventHandler);
    };
  }

  /**
   * Subscribe to multiple event types
   */
  subscribeMany<T>(
    types: SystemEventType[],
    handler: EventHandler<T>
  ): () => void {
    const unsubscribers = types.map(type => this.subscribe(type, handler));

    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }

  /**
   * Subscribe once - handler will be called at most once
   */
  subscribeOnce<T>(
    type: SystemEventType,
    handler: EventHandler<T>
  ): () => void {
    const wrappedHandler: EventHandler<T> = (event) => {
      this.off(type, wrappedHandler as EventHandler);
      return handler(event);
    };

    this.on(type, wrappedHandler as EventHandler);

    return () => {
      this.off(type, wrappedHandler as EventHandler);
    };
  }

  /**
   * Get events since a specific timestamp
   */
  getEventsSince(timestamp: string): SystemEvent[] {
    const cutoff = new Date(timestamp).getTime();
    return this.eventHistory.filter(
      event => new Date(event.timestamp).getTime() >= cutoff
    );
  }

  /**
   * Get events matching a filter
   */
  getEvents(filter?: EventFilter): SystemEvent[] {
    if (!filter) {
      return [...this.eventHistory];
    }

    return this.eventHistory.filter(event => {
      // Type filter
      if (filter.types && !filter.types.includes(event.type)) {
        return false;
      }

      // Source filter
      if (filter.source && event.source !== filter.source) {
        return false;
      }

      // Correlation ID filter
      if (filter.correlationId && event.correlationId !== filter.correlationId) {
        return false;
      }

      // Time range filter
      const eventTime = new Date(event.timestamp).getTime();

      if (filter.after && eventTime < new Date(filter.after).getTime()) {
        return false;
      }

      if (filter.before && eventTime > new Date(filter.before).getTime()) {
        return false;
      }

      return true;
    });
  }

  /**
   * Get the most recent N events
   */
  getRecentEvents(count: number): SystemEvent[] {
    return this.eventHistory.slice(-count);
  }

  /**
   * Get events by correlation ID
   */
  getCorrelatedEvents(correlationId: string): SystemEvent[] {
    return this.eventHistory.filter(
      event => event.correlationId === correlationId
    );
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get history statistics
   */
  getStats(): {
    totalEvents: number;
    eventsByType: Record<string, number>;
    oldestEvent: string | null;
    newestEvent: string | null;
  } {
    const eventsByType: Record<string, number> = {};

    for (const event of this.eventHistory) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    }

    return {
      totalEvents: this.eventHistory.length,
      eventsByType,
      oldestEvent: this.eventHistory[0]?.timestamp ?? null,
      newestEvent: this.eventHistory[this.eventHistory.length - 1]?.timestamp ?? null,
    };
  }

  /**
   * Wait for a specific event (with timeout protection)
   * @param type - Event type to wait for
   * @param options - Wait options including timeout and filter
   * @returns Promise that resolves with the matching event
   * @throws {Error} If timeout is exceeded (default: 30 seconds)
   */
  waitFor<T>(
    type: SystemEventType,
    options?: { timeout?: number; filter?: (event: SystemEvent<T>) => boolean }
  ): Promise<SystemEvent<T>> {
    return new Promise((resolve, reject) => {
      // Always use a timeout to prevent infinite waits
      const effectiveTimeout = options?.timeout ?? this.defaultWaitTimeout;

      const handler: EventHandler<T> = (event) => {
        // Apply custom filter if provided
        if (options?.filter && !options.filter(event)) {
          return;
        }

        clearTimeout(timeoutId);
        this.off(type, handler as EventHandler);
        resolve(event);
      };

      this.on(type, handler as EventHandler);

      // Set timeout (always, to prevent infinite waits)
      const timeoutId = setTimeout(() => {
        this.off(type, handler as EventHandler);
        reject(new Error(`Timeout waiting for event: ${type} (${effectiveTimeout}ms)`));
      }, effectiveTimeout);
    });
  }

  /**
   * Create a child bus that forwards events to this bus
   */
  createChild(sourcePrefix: string): EventBus {
    const child = new EventBus({
      maxHistory: this.maxHistory,
      enableHistory: false // Child doesn't maintain its own history
    });

    // Forward all events to parent with modified source
    child.subscribe('*', (event) => {
      this.publish({
        ...event,
        source: `${sourcePrefix}/${event.source}`,
      });
    });

    return child;
  }
}

/**
 * Create a singleton EventBus instance
 */
let globalEventBus: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus();
  }
  return globalEventBus;
}

/**
 * Reset the global EventBus (mainly for testing)
 */
export function resetEventBus(): void {
  if (globalEventBus) {
    globalEventBus.removeAllListeners();
    globalEventBus.clearHistory();
    globalEventBus = null;
  }
}

/**
 * Helper to create a typed event
 */
export function createEvent<T>(
  type: SystemEventType,
  source: string,
  payload: T,
  correlationId?: string
): SystemEvent<T> {
  return {
    type,
    timestamp: new Date().toISOString(),
    source,
    correlationId,
    payload,
  };
}
