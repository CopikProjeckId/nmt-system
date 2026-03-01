/**
 * Change Journal - Write-ahead log for state changes (SQLite)
 *
 * Tracks all state changes with sequence numbers and vector clocks
 * for synchronization and rollback support.
 *
 * @module sync/change-journal
 */

import { openDb } from '../storage/db.js';
import type Database from 'better-sqlite3';
import type { VectorClock, SerializedClock } from './vector-clock.js';

export type ChangeEntityType =
  | 'neuron'
  | 'synapse'
  | 'attractor'
  | 'pattern'
  | 'process'
  | 'dimension'
  | 'embedding';

export type ChangeOperation = 'create' | 'update' | 'delete';

export interface ChangeEntry {
  sequence: number;
  type: ChangeEntityType;
  operation: ChangeOperation;
  entityId: string;
  data: unknown;
  vectorClock: SerializedClock;
  timestamp: string;
  nodeId: string;
  metadata?: Record<string, unknown>;
}

export type ChangeInput = Omit<ChangeEntry, 'sequence'>;

export interface JournalStats {
  totalEntries: number;
  latestSequence: number;
  oldestSequence: number;
  byType: Record<string, number>;
  byOperation: Record<string, number>;
}

/**
 * ChangeJournal - Persistent write-ahead log backed by SQLite.
 *
 * Uses the `journal` table (sequence INTEGER PRIMARY KEY, entry TEXT NOT NULL).
 * better-sqlite3 is synchronous, so no async lock chain is needed.
 */
export class ChangeJournal {
  private db: Database.Database;
  private nodeId: string;
  private currentSequence: number = 0;
  private initialized = false;

  // Prepared statements (set in init)
  private stmtInsert!: Database.Statement;
  private stmtGet!: Database.Statement;
  private stmtRange!: Database.Statement;
  private stmtAll!: Database.Statement;
  private stmtMax!: Database.Statement;
  private stmtMin!: Database.Statement;
  private stmtDeleteBefore!: Database.Statement;
  private stmtCount!: Database.Statement;

  constructor(dataDir: string, nodeId: string) {
    this.db = openDb(dataDir);
    this.nodeId = nodeId;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    // Restore current sequence from DB
    const row = this.db.prepare('SELECT MAX(sequence) as max FROM journal').get() as
      { max: number | null };
    this.currentSequence = row?.max ?? 0;

    // Prepare statements
    this.stmtInsert      = this.db.prepare('INSERT INTO journal (sequence, entry) VALUES (?, ?)');
    this.stmtGet         = this.db.prepare('SELECT entry FROM journal WHERE sequence = ?');
    this.stmtRange       = this.db.prepare('SELECT entry FROM journal WHERE sequence >= ? AND sequence <= ? ORDER BY sequence');
    this.stmtAll         = this.db.prepare('SELECT entry FROM journal ORDER BY sequence');
    this.stmtMax         = this.db.prepare('SELECT MAX(sequence) as max FROM journal');
    this.stmtMin         = this.db.prepare('SELECT MIN(sequence) as min FROM journal');
    this.stmtDeleteBefore = this.db.prepare('DELETE FROM journal WHERE sequence < ?');
    this.stmtCount       = this.db.prepare('SELECT COUNT(*) as cnt FROM journal');

    this.initialized = true;
  }

  async append(entry: ChangeInput): Promise<number> {
    if (!this.initialized) await this.init();

    const nextSequence = this.currentSequence + 1;
    const fullEntry: ChangeEntry = { ...entry, sequence: nextSequence };

    this.stmtInsert.run(nextSequence, JSON.stringify(fullEntry));
    this.currentSequence = nextSequence;
    return nextSequence;
  }

  async appendBatch(entries: ChangeInput[]): Promise<number[]> {
    if (!this.initialized) await this.init();

    const sequences: number[] = [];
    const doInsert = this.db.transaction(() => {
      for (const entry of entries) {
        const seq = ++this.currentSequence;
        sequences.push(seq);
        this.stmtInsert.run(seq, JSON.stringify({ ...entry, sequence: seq }));
      }
    });
    doInsert();
    return sequences;
  }

  async get(sequence: number): Promise<ChangeEntry | null> {
    if (!this.initialized) await this.init();
    const row = this.stmtGet.get(sequence) as { entry: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.entry); } catch { return null; }
  }

  async getRange(fromSeq: number, toSeq: number): Promise<ChangeEntry[]> {
    if (!this.initialized) await this.init();
    const rows = this.stmtRange.all(fromSeq, toSeq) as Array<{ entry: string }>;
    return rows.flatMap(r => {
      try { return [JSON.parse(r.entry) as ChangeEntry]; } catch { return []; }
    });
  }

  async getAfterSequence(seq: number): Promise<ChangeEntry[]> {
    return this.getRange(seq + 1, this.currentSequence);
  }

  async getByEntity(entityId: string): Promise<ChangeEntry[]> {
    if (!this.initialized) await this.init();
    const rows = this.stmtAll.all() as Array<{ entry: string }>;
    return rows
      .flatMap(r => { try { return [JSON.parse(r.entry) as ChangeEntry]; } catch { return []; } })
      .filter(e => e.entityId === entityId)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async getByType(type: ChangeEntityType): Promise<ChangeEntry[]> {
    if (!this.initialized) await this.init();
    const rows = this.stmtAll.all() as Array<{ entry: string }>;
    return rows
      .flatMap(r => { try { return [JSON.parse(r.entry) as ChangeEntry]; } catch { return []; } })
      .filter(e => e.type === type)
      .sort((a, b) => a.sequence - b.sequence);
  }

  async getLatestSequence(): Promise<number> {
    if (!this.initialized) await this.init();
    return this.currentSequence;
  }

  async getOldestSequence(): Promise<number> {
    if (!this.initialized) await this.init();
    const row = this.stmtMin.get() as { min: number | null };
    return row?.min ?? this.currentSequence;
  }

  async compact(beforeSeq: number): Promise<number> {
    if (!this.initialized) await this.init();
    const info = this.stmtDeleteBefore.run(beforeSeq);
    return info.changes;
  }

  async getStats(): Promise<JournalStats> {
    if (!this.initialized) await this.init();
    const rows = this.stmtAll.all() as Array<{ entry: string }>;
    const entries = rows.flatMap(r => {
      try { return [JSON.parse(r.entry) as ChangeEntry]; } catch { return []; }
    });

    const byType: Record<string, number> = {};
    const byOperation: Record<string, number> = {};

    for (const e of entries) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      byOperation[e.operation] = (byOperation[e.operation] ?? 0) + 1;
    }

    const minRow = this.stmtMin.get() as { min: number | null };

    return {
      totalEntries: entries.length,
      latestSequence: this.currentSequence,
      oldestSequence: minRow?.min ?? this.currentSequence,
      byType,
      byOperation,
    };
  }

  async clear(): Promise<void> {
    if (!this.initialized) await this.init();
    this.db.prepare('DELETE FROM journal').run();
    this.currentSequence = 0;
  }

  async hasEntries(): Promise<boolean> {
    return this.currentSequence > 0;
  }
}

export function createChangeJournal(dataDir: string, nodeId: string): ChangeJournal {
  return new ChangeJournal(dataDir, nodeId);
}
