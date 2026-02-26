/**
 * Probabilistic Store - Persistent storage for probabilistic ontology modules
 *
 * Handles persistence for:
 * - AttractorModel (미래 끌개)
 * - FourStageLearningSystem (4단계 학습)
 * - ProbabilisticNeuronManager (확률적 뉴런)
 * - DynamicEmbeddingManager (동적 차원)
 *
 * @module storage/probabilistic-store
 */

import { Level } from 'level';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface ProbabilisticStoreOptions {
  dataDir: string;
}

/**
 * Unified storage for all probabilistic ontology modules
 */
export class ProbabilisticStore {
  private db: Level<string, string>;
  private dataDir: string;
  private initialized: boolean = false;

  // Storage keys
  private static readonly KEYS = {
    ATTRACTORS: 'probabilistic:attractors',
    LEARNING: 'probabilistic:learning',
    NEURONS: 'probabilistic:neurons',
    DIMENSIONS: 'probabilistic:dimensions',
    META: 'probabilistic:meta',
  };

  constructor(options: ProbabilisticStoreOptions) {
    this.dataDir = options.dataDir;
    this.db = new Level(path.join(this.dataDir, 'probabilistic'), {
      valueEncoding: 'json'
    });
  }

  /**
   * Initialize store
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.dataDir, { recursive: true });
    await this.db.open();
    this.initialized = true;

    // Initialize meta if not exists
    try {
      await this.db.get(ProbabilisticStore.KEYS.META);
    } catch {
      await this.db.put(ProbabilisticStore.KEYS.META, JSON.stringify({
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      }));
    }
  }

  /**
   * Close store
   */
  async close(): Promise<void> {
    if (!this.initialized) return;
    await this.db.close();
    this.initialized = false;
  }

  // ==================== Attractor Storage ====================

  /**
   * Save attractor model state
   */
  async saveAttractors(data: object): Promise<void> {
    await this.db.put(
      ProbabilisticStore.KEYS.ATTRACTORS,
      JSON.stringify({
        ...data,
        savedAt: new Date().toISOString(),
      })
    );
    await this.updateMeta();
  }

  /**
   * Load attractor model state
   */
  async loadAttractors(): Promise<object | null> {
    try {
      const data = await this.db.get(ProbabilisticStore.KEYS.ATTRACTORS);
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  // ==================== Learning Storage ====================

  /**
   * Save learning system state
   */
  async saveLearning(data: object): Promise<void> {
    await this.db.put(
      ProbabilisticStore.KEYS.LEARNING,
      JSON.stringify({
        ...data,
        savedAt: new Date().toISOString(),
      })
    );
    await this.updateMeta();
  }

  /**
   * Load learning system state
   */
  async loadLearning(): Promise<object | null> {
    try {
      const data = await this.db.get(ProbabilisticStore.KEYS.LEARNING);
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  // ==================== Probabilistic Neurons Storage ====================

  /**
   * Save probabilistic neurons state
   */
  async saveNeurons(data: object): Promise<void> {
    await this.db.put(
      ProbabilisticStore.KEYS.NEURONS,
      JSON.stringify({
        ...data,
        savedAt: new Date().toISOString(),
      })
    );
    await this.updateMeta();
  }

  /**
   * Load probabilistic neurons state
   */
  async loadNeurons(): Promise<object | null> {
    try {
      const data = await this.db.get(ProbabilisticStore.KEYS.NEURONS);
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  // ==================== Dimensions Storage ====================

  /**
   * Save dynamic dimensions state
   */
  async saveDimensions(data: object): Promise<void> {
    await this.db.put(
      ProbabilisticStore.KEYS.DIMENSIONS,
      JSON.stringify({
        ...data,
        savedAt: new Date().toISOString(),
      })
    );
    await this.updateMeta();
  }

  /**
   * Load dynamic dimensions state
   */
  async loadDimensions(): Promise<object | null> {
    try {
      const data = await this.db.get(ProbabilisticStore.KEYS.DIMENSIONS);
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  // ==================== Bulk Operations ====================

  /**
   * Save all probabilistic module states
   */
  async saveAll(states: {
    attractors?: object;
    learning?: object;
    neurons?: object;
    dimensions?: object;
  }): Promise<void> {
    const batch = this.db.batch();

    if (states.attractors) {
      batch.put(ProbabilisticStore.KEYS.ATTRACTORS, JSON.stringify({
        ...states.attractors,
        savedAt: new Date().toISOString(),
      }));
    }

    if (states.learning) {
      batch.put(ProbabilisticStore.KEYS.LEARNING, JSON.stringify({
        ...states.learning,
        savedAt: new Date().toISOString(),
      }));
    }

    if (states.neurons) {
      batch.put(ProbabilisticStore.KEYS.NEURONS, JSON.stringify({
        ...states.neurons,
        savedAt: new Date().toISOString(),
      }));
    }

    if (states.dimensions) {
      batch.put(ProbabilisticStore.KEYS.DIMENSIONS, JSON.stringify({
        ...states.dimensions,
        savedAt: new Date().toISOString(),
      }));
    }

    await batch.write();
    await this.updateMeta();
  }

  /**
   * Load all probabilistic module states
   */
  async loadAll(): Promise<{
    attractors: object | null;
    learning: object | null;
    neurons: object | null;
    dimensions: object | null;
  }> {
    const [attractors, learning, neurons, dimensions] = await Promise.all([
      this.loadAttractors(),
      this.loadLearning(),
      this.loadNeurons(),
      this.loadDimensions(),
    ]);

    return { attractors, learning, neurons, dimensions };
  }

  /**
   * Clear all probabilistic data
   */
  async clear(): Promise<void> {
    const batch = this.db.batch();
    batch.del(ProbabilisticStore.KEYS.ATTRACTORS);
    batch.del(ProbabilisticStore.KEYS.LEARNING);
    batch.del(ProbabilisticStore.KEYS.NEURONS);
    batch.del(ProbabilisticStore.KEYS.DIMENSIONS);
    await batch.write();
    await this.updateMeta();
  }

  // ==================== Meta Operations ====================

  private async updateMeta(): Promise<void> {
    const meta = await this.getMeta();
    meta.lastUpdated = new Date().toISOString();
    await this.db.put(ProbabilisticStore.KEYS.META, JSON.stringify(meta));
  }

  async getMeta(): Promise<{
    version: string;
    createdAt: string;
    lastUpdated: string;
  }> {
    try {
      const data = await this.db.get(ProbabilisticStore.KEYS.META);
      return JSON.parse(data);
    } catch {
      return {
        version: '1.0.0',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
      };
    }
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    hasAttractors: boolean;
    hasLearning: boolean;
    hasNeurons: boolean;
    hasDimensions: boolean;
    lastUpdated: string;
  }> {
    const meta = await this.getMeta();
    const [attractors, learning, neurons, dimensions] = await Promise.all([
      this.loadAttractors(),
      this.loadLearning(),
      this.loadNeurons(),
      this.loadDimensions(),
    ]);

    return {
      hasAttractors: attractors !== null,
      hasLearning: learning !== null,
      hasNeurons: neurons !== null,
      hasDimensions: dimensions !== null,
      lastUpdated: meta.lastUpdated,
    };
  }
}

export function createProbabilisticStore(options: ProbabilisticStoreOptions): ProbabilisticStore {
  return new ProbabilisticStore(options);
}
