/**
 * Probabilistic Store - Persistent storage for probabilistic ontology modules (SQLite)
 *
 * Handles persistence for:
 * - AttractorModel (미래 끌개)
 * - FourStageLearningSystem (4단계 학습)
 * - ProbabilisticNeuronManager (확률적 뉴런)
 * - DynamicEmbeddingManager (동적 차원)
 *
 * @module storage/probabilistic-store
 */

import { openDb, closeDb } from './db.js';
import type Database from 'better-sqlite3';

export interface ProbabilisticStoreOptions {
  dataDir: string;
}

export class ProbabilisticStore {
  private dataDir: string;
  private db: Database.Database | null = null;
  private initialized = false;

  private static readonly KEYS = {
    ATTRACTORS: 'probabilistic:attractors',
    LEARNING:   'probabilistic:learning',
    NEURONS:    'probabilistic:neurons',
    DIMENSIONS: 'probabilistic:dimensions',
    META:       'probabilistic:meta',
  };

  constructor(options: ProbabilisticStoreOptions) {
    this.dataDir = options.dataDir;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.db = openDb(this.dataDir);
    this.initialized = true;

    // Initialize meta if not present
    const existing = this.db.prepare(
      'SELECT 1 FROM probabilistic WHERE key = ?'
    ).get(ProbabilisticStore.KEYS.META);

    if (!existing) {
      this.db.prepare(
        'INSERT OR IGNORE INTO probabilistic (key, value) VALUES (?, ?)'
      ).run(ProbabilisticStore.KEYS.META, JSON.stringify({
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      }));
    }
  }

  async close(): Promise<void> {
    if (!this.initialized) return;
    closeDb(this.dataDir);
    this.db = null;
    this.initialized = false;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private getKey(key: string): object | null {
    const row = this.db!.prepare(
      'SELECT value FROM probabilistic WHERE key = ?'
    ).get(key) as { value: string } | undefined;
    if (!row) return null;
    try { return JSON.parse(row.value); } catch { return null; }
  }

  private putKey(key: string, data: object): void {
    this.db!.prepare(
      'INSERT OR REPLACE INTO probabilistic (key, value) VALUES (?, ?)'
    ).run(key, JSON.stringify({ ...data, savedAt: new Date().toISOString() }));
    this.updateMeta();
  }

  private updateMeta(): void {
    const existing = this.getKey(ProbabilisticStore.KEYS.META) as any ?? {
      version: '1.0.0', createdAt: new Date().toISOString(),
    };
    existing.lastUpdated = new Date().toISOString();
    this.db!.prepare(
      'INSERT OR REPLACE INTO probabilistic (key, value) VALUES (?, ?)'
    ).run(ProbabilisticStore.KEYS.META, JSON.stringify(existing));
  }

  // ── Attractor ─────────────────────────────────────────────────────────────

  async saveAttractors(data: object): Promise<void> {
    this.putKey(ProbabilisticStore.KEYS.ATTRACTORS, data);
  }

  async loadAttractors(): Promise<object | null> {
    return this.getKey(ProbabilisticStore.KEYS.ATTRACTORS);
  }

  // ── Learning ──────────────────────────────────────────────────────────────

  async saveLearning(data: object): Promise<void> {
    this.putKey(ProbabilisticStore.KEYS.LEARNING, data);
  }

  async loadLearning(): Promise<object | null> {
    return this.getKey(ProbabilisticStore.KEYS.LEARNING);
  }

  // ── Probabilistic Neurons ────────────────────────────────────────────────

  async saveNeurons(data: object): Promise<void> {
    this.putKey(ProbabilisticStore.KEYS.NEURONS, data);
  }

  async loadNeurons(): Promise<object | null> {
    return this.getKey(ProbabilisticStore.KEYS.NEURONS);
  }

  // ── Dimensions ────────────────────────────────────────────────────────────

  async saveDimensions(data: object): Promise<void> {
    this.putKey(ProbabilisticStore.KEYS.DIMENSIONS, data);
  }

  async loadDimensions(): Promise<object | null> {
    return this.getKey(ProbabilisticStore.KEYS.DIMENSIONS);
  }

  // ── Bulk ─────────────────────────────────────────────────────────────────

  async saveAll(states: {
    attractors?: object;
    learning?: object;
    neurons?: object;
    dimensions?: object;
  }): Promise<void> {
    const now = new Date().toISOString();
    const upsert = this.db!.prepare(
      'INSERT OR REPLACE INTO probabilistic (key, value) VALUES (?, ?)'
    );

    const doUpsert = this.db!.transaction((entries: Array<[string, object]>) => {
      for (const [key, data] of entries) {
        upsert.run(key, JSON.stringify({ ...data, savedAt: now }));
      }
    });

    const entries: Array<[string, object]> = [];
    if (states.attractors)  entries.push([ProbabilisticStore.KEYS.ATTRACTORS, states.attractors]);
    if (states.learning)    entries.push([ProbabilisticStore.KEYS.LEARNING,   states.learning]);
    if (states.neurons)     entries.push([ProbabilisticStore.KEYS.NEURONS,    states.neurons]);
    if (states.dimensions)  entries.push([ProbabilisticStore.KEYS.DIMENSIONS, states.dimensions]);

    if (entries.length > 0) {
      doUpsert(entries);
      this.updateMeta();
    }
  }

  async loadAll(): Promise<{
    attractors: object | null;
    learning: object | null;
    neurons: object | null;
    dimensions: object | null;
  }> {
    return {
      attractors: this.getKey(ProbabilisticStore.KEYS.ATTRACTORS),
      learning:   this.getKey(ProbabilisticStore.KEYS.LEARNING),
      neurons:    this.getKey(ProbabilisticStore.KEYS.NEURONS),
      dimensions: this.getKey(ProbabilisticStore.KEYS.DIMENSIONS),
    };
  }

  async clear(): Promise<void> {
    const keys = [
      ProbabilisticStore.KEYS.ATTRACTORS,
      ProbabilisticStore.KEYS.LEARNING,
      ProbabilisticStore.KEYS.NEURONS,
      ProbabilisticStore.KEYS.DIMENSIONS,
    ];
    const del = this.db!.prepare('DELETE FROM probabilistic WHERE key = ?');
    const doDelete = this.db!.transaction(() => {
      for (const key of keys) del.run(key);
    });
    doDelete();
    this.updateMeta();
  }

  async getMeta(): Promise<{ version: string; createdAt: string; lastUpdated: string }> {
    const data = this.getKey(ProbabilisticStore.KEYS.META) as any;
    return data ?? {
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
    };
  }

  async getStats(): Promise<{
    hasAttractors: boolean;
    hasLearning: boolean;
    hasNeurons: boolean;
    hasDimensions: boolean;
    lastUpdated: string;
  }> {
    const meta = await this.getMeta();
    return {
      hasAttractors: this.getKey(ProbabilisticStore.KEYS.ATTRACTORS) !== null,
      hasLearning:   this.getKey(ProbabilisticStore.KEYS.LEARNING)   !== null,
      hasNeurons:    this.getKey(ProbabilisticStore.KEYS.NEURONS)     !== null,
      hasDimensions: this.getKey(ProbabilisticStore.KEYS.DIMENSIONS)  !== null,
      lastUpdated:   meta.lastUpdated,
    };
  }
}

export function createProbabilisticStore(options: ProbabilisticStoreOptions): ProbabilisticStore {
  return new ProbabilisticStore(options);
}
