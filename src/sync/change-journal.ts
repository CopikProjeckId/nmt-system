/**
 * Change Journal - Write-ahead log for state changes
 *
 * Tracks all state changes with sequence numbers and vector clocks
 * for synchronization and rollback support.
 *
 * @module sync/change-journal
 */

import { Level } from 'level';
import type { VectorClock, SerializedClock } from './vector-clock.js';

/**
 * Types of entities that can be changed
 */
export type ChangeEntityType =
  | 'neuron'
  | 'synapse'
  | 'attractor'
  | 'pattern'
  | 'process'
  | 'dimension'
  | 'embedding';

/**
 * Types of operations
 */
export type ChangeOperation = 'create' | 'update' | 'delete';

/**
 * A single change entry in the journal
 */
export interface ChangeEntry {
  /** Monotonic sequence number */
  sequence: number;
  /** Type of entity being changed */
  type: ChangeEntityType;
  /** Operation performed */
  operation: ChangeOperation;
  /** ID of the entity */
  entityId: string;
  /** Change data (null for delete) */
  data: unknown;
  /** Vector clock at time of change */
  vectorClock: SerializedClock;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Node that made the change */
  nodeId: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Input for appending a change (without sequence)
 */
export type ChangeInput = Omit<ChangeEntry, 'sequence'>;

/**
 * Journal statistics
 */
export interface JournalStats {
  /** Total number of entries */
  totalEntries: number;
  /** Latest sequence number */
  latestSequence: number;
  /** Oldest sequence number */
  oldestSequence: number;
  /** Entries by type */
  byType: Record<string, number>;
  /** Entries by operation */
  byOperation: Record<string, number>;
}

/**
 * ChangeJournal - Persistent write-ahead log
 *
 * Features:
 * - Monotonic sequence numbers
 * - Vector clock tracking
 * - Range queries
 * - Compaction (remove old entries)
 *
 * @example
 * ```typescript
 * const journal = new ChangeJournal(db, 'node-1');
 * await journal.init();
 *
 * const seq = await journal.append({
 *   type: 'neuron',
 *   operation: 'create',
 *   entityId: 'neuron-123',
 *   data: { content: 'Hello' },
 *   vectorClock: clock.toJSON(),
 *   timestamp: new Date().toISOString(),
 *   nodeId: 'node-1'
 * });
 *
 * const entries = await journal.getAfterSequence(0);
 * ```
 */
export class ChangeJournal {
  private db: Level<string, string>;
  private nodeId: string;
  private currentSequence: number = 0;
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;
  private appendLock: Promise<void> = Promise.resolve();

  private static readonly PREFIX = 'journal:';
  private static readonly META_KEY = 'journal:meta';

  constructor(db: Level<string, string>, nodeId: string) {
    this.db = db;
    this.nodeId = nodeId;
  }

  /**
   * Initialize the journal
   * Thread-safe: concurrent calls will wait for the same initialization
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // If initialization is already in progress, wait for it
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this._doInit();
    await this.initPromise;
  }

  /**
   * Internal initialization logic
   */
  private async _doInit(): Promise<void> {
    try {
      const meta = await this.db.get(ChangeJournal.META_KEY);
      try {
        const parsed = JSON.parse(meta);
        this.currentSequence = parsed.currentSequence ?? 0;
      } catch (parseError) {
        // Corrupted metadata - log and reset
        console.error('Journal metadata corrupted, resetting:', parseError);
        this.currentSequence = 0;
        await this.saveMeta();
      }
    } catch (error: any) {
      // Check if it's "not found" error (expected for new journal)
      if (error.code === 'LEVEL_NOT_FOUND' || error.notFound) {
        this.currentSequence = 0;
        await this.saveMeta();
      } else {
        // Unexpected error - reset promise so init can be retried
        this.initPromise = null;
        throw error;
      }
    }

    this.initialized = true;
  }

  /**
   * Append a new change entry (thread-safe)
   * @returns The assigned sequence number
   */
  async append(entry: ChangeInput): Promise<number> {
    // Serialize append operations to prevent race conditions
    const previousLock = this.appendLock;
    let releaseLock: () => void = () => {};
    this.appendLock = new Promise<void>(resolve => { releaseLock = resolve; });

    try {
      await previousLock;

      if (!this.initialized) {
        await this.init();
      }

      this.currentSequence++;
      const sequence = this.currentSequence;

      const fullEntry: ChangeEntry = {
        ...entry,
        sequence,
      };

      const key = this.sequenceKey(sequence);
      await this.db.put(key, JSON.stringify(fullEntry));
      await this.saveMeta();

      return sequence;
    } finally {
      releaseLock();
    }
  }

  /**
   * Append multiple entries atomically
   */
  async appendBatch(entries: ChangeInput[]): Promise<number[]> {
    if (!this.initialized) {
      await this.init();
    }

    const sequences: number[] = [];
    const batch = this.db.batch();

    for (const entry of entries) {
      this.currentSequence++;
      const sequence = this.currentSequence;
      sequences.push(sequence);

      const fullEntry: ChangeEntry = {
        ...entry,
        sequence,
      };

      batch.put(this.sequenceKey(sequence), JSON.stringify(fullEntry));
    }

    batch.put(ChangeJournal.META_KEY, JSON.stringify({
      currentSequence: this.currentSequence,
      nodeId: this.nodeId,
    }));

    await batch.write();

    return sequences;
  }

  /**
   * Get a specific entry by sequence number
   * @returns The entry or null if not found
   * @throws {Error} If entry is corrupted
   */
  async get(sequence: number): Promise<ChangeEntry | null> {
    try {
      const data = await this.db.get(this.sequenceKey(sequence));
      try {
        return JSON.parse(data);
      } catch (parseError) {
        throw new Error(`Corrupted journal entry at sequence ${sequence}`);
      }
    } catch (error: any) {
      // "Not found" errors return null
      if (error.code === 'LEVEL_NOT_FOUND' || error.notFound) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get entries in a sequence range (inclusive)
   * Uses LevelDB iterator for efficient range queries
   */
  async getRange(fromSeq: number, toSeq: number): Promise<ChangeEntry[]> {
    const entries: ChangeEntry[] = [];

    // Use LevelDB range iterator for efficiency
    for await (const [key, value] of this.db.iterator({
      gte: this.sequenceKey(fromSeq),
      lte: this.sequenceKey(toSeq),
    })) {
      if (key === ChangeJournal.META_KEY) continue;

      try {
        const entry: ChangeEntry = JSON.parse(value);
        entries.push(entry);
      } catch (parseError) {
        console.error(`Corrupted journal entry at ${key}:`, parseError);
        // Continue processing other entries
      }
    }

    return entries;
  }

  /**
   * Get all entries after a sequence number
   */
  async getAfterSequence(seq: number): Promise<ChangeEntry[]> {
    return this.getRange(seq + 1, this.currentSequence);
  }

  /**
   * Get entries by entity ID
   */
  async getByEntity(entityId: string): Promise<ChangeEntry[]> {
    const entries: ChangeEntry[] = [];

    for await (const [key, value] of this.db.iterator({
      gte: ChangeJournal.PREFIX,
      lt: ChangeJournal.PREFIX + '\xFF',
    })) {
      if (key === ChangeJournal.META_KEY) continue;

      const entry: ChangeEntry = JSON.parse(value);
      if (entry.entityId === entityId) {
        entries.push(entry);
      }
    }

    return entries.sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Get entries by type
   */
  async getByType(type: ChangeEntityType): Promise<ChangeEntry[]> {
    const entries: ChangeEntry[] = [];

    for await (const [key, value] of this.db.iterator({
      gte: ChangeJournal.PREFIX,
      lt: ChangeJournal.PREFIX + '\xFF',
    })) {
      if (key === ChangeJournal.META_KEY) continue;

      const entry: ChangeEntry = JSON.parse(value);
      if (entry.type === type) {
        entries.push(entry);
      }
    }

    return entries.sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Get the latest sequence number
   */
  async getLatestSequence(): Promise<number> {
    if (!this.initialized) {
      await this.init();
    }
    return this.currentSequence;
  }

  /**
   * Get the oldest sequence number (after compaction)
   */
  async getOldestSequence(): Promise<number> {
    let oldest = this.currentSequence;

    for await (const [key] of this.db.iterator({
      gte: ChangeJournal.PREFIX,
      lt: ChangeJournal.PREFIX + '\xFF',
      limit: 1,
    })) {
      if (key === ChangeJournal.META_KEY) continue;
      const seq = this.parseSequenceKey(key);
      if (seq !== null && seq < oldest) {
        oldest = seq;
      }
    }

    return oldest;
  }

  /**
   * Compact the journal by removing entries before a sequence
   */
  async compact(beforeSeq: number): Promise<number> {
    let deleted = 0;
    const batch = this.db.batch();

    for await (const [key] of this.db.iterator({
      gte: ChangeJournal.PREFIX,
      lt: ChangeJournal.PREFIX + '\xFF',
    })) {
      if (key === ChangeJournal.META_KEY) continue;

      const seq = this.parseSequenceKey(key);
      if (seq !== null && seq < beforeSeq) {
        batch.del(key);
        deleted++;
      }
    }

    await batch.write();
    return deleted;
  }

  /**
   * Get journal statistics
   */
  async getStats(): Promise<JournalStats> {
    const stats: JournalStats = {
      totalEntries: 0,
      latestSequence: this.currentSequence,
      oldestSequence: this.currentSequence,
      byType: {},
      byOperation: {},
    };

    let first = true;

    for await (const [key, value] of this.db.iterator({
      gte: ChangeJournal.PREFIX,
      lt: ChangeJournal.PREFIX + '\xFF',
    })) {
      if (key === ChangeJournal.META_KEY) continue;

      const entry: ChangeEntry = JSON.parse(value);
      stats.totalEntries++;

      if (first || entry.sequence < stats.oldestSequence) {
        stats.oldestSequence = entry.sequence;
        first = false;
      }

      stats.byType[entry.type] = (stats.byType[entry.type] ?? 0) + 1;
      stats.byOperation[entry.operation] = (stats.byOperation[entry.operation] ?? 0) + 1;
    }

    return stats;
  }

  /**
   * Clear all journal entries
   */
  async clear(): Promise<void> {
    const batch = this.db.batch();

    for await (const [key] of this.db.iterator({
      gte: ChangeJournal.PREFIX,
      lt: ChangeJournal.PREFIX + '\xFF',
    })) {
      batch.del(key);
    }

    await batch.write();
    this.currentSequence = 0;
    await this.saveMeta();
  }

  /**
   * Check if journal has entries
   */
  async hasEntries(): Promise<boolean> {
    return this.currentSequence > 0;
  }

  private sequenceKey(seq: number): string {
    // Pad sequence for correct lexicographic ordering
    return `${ChangeJournal.PREFIX}${seq.toString().padStart(16, '0')}`;
  }

  private parseSequenceKey(key: string): number | null {
    if (!key.startsWith(ChangeJournal.PREFIX)) return null;
    const seqStr = key.slice(ChangeJournal.PREFIX.length);
    const seq = parseInt(seqStr, 10);
    return isNaN(seq) ? null : seq;
  }

  private async saveMeta(): Promise<void> {
    await this.db.put(ChangeJournal.META_KEY, JSON.stringify({
      currentSequence: this.currentSequence,
      nodeId: this.nodeId,
      updatedAt: new Date().toISOString(),
    }));
  }
}

/**
 * Create a ChangeJournal instance
 */
export function createChangeJournal(
  db: Level<string, string>,
  nodeId: string
): ChangeJournal {
  return new ChangeJournal(db, nodeId);
}
