/**
 * Vector Clock - Logical clock for distributed systems
 *
 * Provides causal ordering for events across multiple nodes.
 * Used for conflict detection and resolution in state synchronization.
 *
 * @module sync/vector-clock
 */

/**
 * Comparison result between two vector clocks
 */
export type ClockComparison = 'before' | 'after' | 'concurrent' | 'equal';

/**
 * Serialized vector clock format
 */
export type SerializedClock = Record<string, number>;

/**
 * VectorClock - Lamport-style vector clock implementation
 *
 * Vector clocks track causality in distributed systems:
 * - If clock A happened-before clock B, compare returns 'before'
 * - If clock B happened-before clock A, compare returns 'after'
 * - If neither happened-before the other, they are 'concurrent'
 *
 * @example
 * ```typescript
 * const clockA = new VectorClock('node-a');
 * clockA.increment('node-a');
 * clockA.increment('node-a');
 *
 * const clockB = new VectorClock('node-b');
 * clockB.increment('node-b');
 *
 * // Clocks are concurrent (no causal relationship)
 * console.log(clockA.compare(clockB)); // 'concurrent'
 *
 * // Merge creates a clock that dominates both
 * const merged = clockA.merge(clockB);
 * console.log(merged.compare(clockA)); // 'after'
 * ```
 */
export class VectorClock {
  private clock: Map<string, number>;
  private nodeId: string | null;

  constructor(nodeId?: string, initial?: SerializedClock) {
    this.nodeId = nodeId ?? null;
    this.clock = new Map();

    if (initial) {
      for (const [key, value] of Object.entries(initial)) {
        this.clock.set(key, value);
      }
    }
  }

  /**
   * Increment the clock for a specific node
   * Returns a new VectorClock (immutable operation)
   */
  increment(nodeId?: string): VectorClock {
    const id = nodeId ?? this.nodeId;
    if (!id) {
      throw new Error('Node ID required for increment');
    }

    const newClock = new VectorClock(this.nodeId ?? undefined, this.toJSON());
    newClock.clock.set(id, (newClock.clock.get(id) ?? 0) + 1);
    return newClock;
  }

  /**
   * Increment in place (mutable operation)
   */
  tick(nodeId?: string): void {
    const id = nodeId ?? this.nodeId;
    if (!id) {
      throw new Error('Node ID required for tick');
    }
    this.clock.set(id, (this.clock.get(id) ?? 0) + 1);
  }

  /**
   * Get the timestamp for a specific node
   */
  get(nodeId: string): number {
    return this.clock.get(nodeId) ?? 0;
  }

  /**
   * Set the timestamp for a specific node
   * @throws {Error} If value is negative or not an integer
   */
  set(nodeId: string, value: number): void {
    if (value < 0) {
      throw new Error('Vector clock values must be non-negative');
    }
    if (!Number.isInteger(value)) {
      throw new Error('Vector clock values must be integers');
    }
    this.clock.set(nodeId, value);
  }

  /**
   * Merge with another vector clock
   * Returns a new clock with max values from both (immutable)
   */
  merge(other: VectorClock): VectorClock {
    const newClock = new VectorClock(this.nodeId ?? undefined);

    // Add all keys from this clock
    for (const [nodeId, timestamp] of this.clock) {
      newClock.clock.set(nodeId, timestamp);
    }

    // Merge with other clock (take max)
    for (const [nodeId, timestamp] of other.clock) {
      const current = newClock.clock.get(nodeId) ?? 0;
      newClock.clock.set(nodeId, Math.max(current, timestamp));
    }

    return newClock;
  }

  /**
   * Merge in place (mutable operation)
   */
  update(other: VectorClock): void {
    for (const [nodeId, timestamp] of other.clock) {
      const current = this.clock.get(nodeId) ?? 0;
      this.clock.set(nodeId, Math.max(current, timestamp));
    }
  }

  /**
   * Compare this clock with another
   *
   * @returns
   * - 'before': this happened before other
   * - 'after': this happened after other
   * - 'concurrent': neither happened before the other
   * - 'equal': clocks are identical
   */
  compare(other: VectorClock): ClockComparison {
    let thisGreater = false;
    let otherGreater = false;

    // Get all unique node IDs
    const allNodes = new Set([
      ...this.clock.keys(),
      ...other.clock.keys(),
    ]);

    for (const nodeId of allNodes) {
      const thisValue = this.clock.get(nodeId) ?? 0;
      const otherValue = other.clock.get(nodeId) ?? 0;

      if (thisValue > otherValue) {
        thisGreater = true;
      } else if (otherValue > thisValue) {
        otherGreater = true;
      }

      // Early exit if already concurrent
      if (thisGreater && otherGreater) {
        return 'concurrent';
      }
    }

    if (thisGreater && !otherGreater) {
      return 'after';
    } else if (otherGreater && !thisGreater) {
      return 'before';
    } else {
      return 'equal';
    }
  }

  /**
   * Check if this clock happened before or concurrent with other
   */
  happenedBefore(other: VectorClock): boolean {
    return this.compare(other) === 'before';
  }

  /**
   * Check if this clock happened after or concurrent with other
   */
  happenedAfter(other: VectorClock): boolean {
    return this.compare(other) === 'after';
  }

  /**
   * Check if two events are concurrent (no causal relationship)
   */
  isConcurrentWith(other: VectorClock): boolean {
    return this.compare(other) === 'concurrent';
  }

  /**
   * Check if this clock dominates (is >= in all dimensions)
   */
  dominates(other: VectorClock): boolean {
    const comparison = this.compare(other);
    return comparison === 'after' || comparison === 'equal';
  }

  /**
   * Get all node IDs in this clock
   */
  getNodes(): string[] {
    return Array.from(this.clock.keys());
  }

  /**
   * Get the total sum of all timestamps (for debugging)
   */
  sum(): number {
    let total = 0;
    for (const value of this.clock.values()) {
      total += value;
    }
    return total;
  }

  /**
   * Get the size (number of nodes)
   */
  size(): number {
    return this.clock.size;
  }

  /**
   * Check if clock is empty (all zeros or no entries)
   */
  isEmpty(): boolean {
    if (this.clock.size === 0) return true;
    for (const value of this.clock.values()) {
      if (value > 0) return false;
    }
    return true;
  }

  /**
   * Create a copy of this clock
   */
  clone(): VectorClock {
    return new VectorClock(this.nodeId ?? undefined, this.toJSON());
  }

  /**
   * Serialize to JSON-friendly format
   */
  toJSON(): SerializedClock {
    const result: SerializedClock = {};
    for (const [key, value] of this.clock) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Create from serialized format
   */
  static fromJSON(data: SerializedClock, nodeId?: string): VectorClock {
    return new VectorClock(nodeId, data);
  }

  /**
   * Create an empty clock for a node
   */
  static create(nodeId: string): VectorClock {
    return new VectorClock(nodeId);
  }

  /**
   * String representation for debugging
   */
  toString(): string {
    const parts: string[] = [];
    const sortedKeys = Array.from(this.clock.keys()).sort();
    for (const key of sortedKeys) {
      parts.push(`${key}:${this.clock.get(key)}`);
    }
    return `VectorClock{${parts.join(', ')}}`;
  }

  /**
   * Check equality with another clock
   */
  equals(other: VectorClock): boolean {
    return this.compare(other) === 'equal';
  }
}

/**
 * Create a new VectorClock instance
 */
export function createVectorClock(nodeId?: string): VectorClock {
  return new VectorClock(nodeId);
}
