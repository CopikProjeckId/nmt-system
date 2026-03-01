/**
 * Neuron Store - Persistent storage for neurons and synapses using SQLite
 * @module storage/neuron-store
 */

import Database from 'better-sqlite3';
import { openDb, closeDb } from './db.js';
import type {
  UUID,
  NeuronNode,
  NeuronMetadata,
  Synapse,
  SynapseType,
  Embedding384,
  SourceColumnSchema,
  SourceForeignKey,
  SourceIndex,
  SourceCheckConstraint,
  SourceTrigger,
} from '../types/index.js';
import { generateUUID } from '../utils/uuid.js';

/**
 * Neuron store options
 */
export interface NeuronStoreOptions {
  dataDir: string;
}

/**
 * Raw row shape returned by better-sqlite3 for the neurons table
 */
interface NeuronRow {
  id: string;
  merkle_root: string;
  chunk_hashes: string;
  embedding: Buffer;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/**
 * Raw row shape returned by better-sqlite3 for the synapses table
 */
interface SynapseRow {
  id: string;
  source_id: string;
  target_id: string;
  type: string;
  weight: number;
  co_activation_count: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/**
 * Neuron and Synapse Storage backed by SQLite (better-sqlite3)
 */
export class NeuronStore {
  private db!: Database.Database;
  private dataDir: string;
  private initialized: boolean = false;

  constructor(options: NeuronStoreOptions) {
    this.dataDir = options.dataDir;
  }

  /**
   * Initialize the store — opens the shared SQLite connection
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.db = openDb(this.dataDir);
    this.initialized = true;
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (!this.initialized) return;
    closeDb(this.dataDir);
    this.initialized = false;
  }

  /**
   * WAL checkpoint to reclaim disk space and truncate the WAL file
   */
  async compact(): Promise<void> {
    if (!this.initialized) return;
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  // ==================== Neuron Operations ====================

  /**
   * Create and store a new neuron
   */
  async createNeuron(input: {
    embedding: Embedding384;
    chunkHashes: string[];
    merkleRoot: string;
    sourceType?: string;
    tags?: string[];
    sourceRow?: Record<string, unknown>;
    sourceColumns?: SourceColumnSchema[];
    sourceForeignKeys?: SourceForeignKey[];
    sourceIndexes?: SourceIndex[];
    sourceChecks?: SourceCheckConstraint[];
    sourceTriggers?: SourceTrigger[];
    sourceTable?: string;
    sourceEngine?: string;
    sourceCharset?: string;
    sourcePath?: string;
    sourceName?: string;
  }): Promise<NeuronNode> {
    this.ensureInitialized();

    const now = new Date().toISOString();
    const id = generateUUID();

    const metadata: NeuronMetadata = {
      createdAt: now,
      updatedAt: now,
      accessCount: 0,
      lastAccessed: now,
      sourceType: input.sourceType ?? 'unknown',
      tags: input.tags ?? [],
      ...(input.sourceRow !== undefined ? { sourceRow: input.sourceRow } : {}),
      ...(input.sourceColumns !== undefined ? { sourceColumns: input.sourceColumns } : {}),
      ...(input.sourceForeignKeys !== undefined ? { sourceForeignKeys: input.sourceForeignKeys } : {}),
      ...(input.sourceIndexes !== undefined ? { sourceIndexes: input.sourceIndexes } : {}),
      ...(input.sourceChecks !== undefined ? { sourceChecks: input.sourceChecks } : {}),
      ...(input.sourceTriggers !== undefined ? { sourceTriggers: input.sourceTriggers } : {}),
      ...(input.sourceTable !== undefined ? { sourceTable: input.sourceTable } : {}),
      ...(input.sourceEngine !== undefined ? { sourceEngine: input.sourceEngine } : {}),
      ...(input.sourceCharset !== undefined ? { sourceCharset: input.sourceCharset } : {}),
      ...(input.sourcePath !== undefined ? { sourcePath: input.sourcePath } : {}),
      ...(input.sourceName !== undefined ? { sourceName: input.sourceName } : {}),
    };

    const neuron: NeuronNode = {
      id,
      embedding: input.embedding,
      chunkHashes: input.chunkHashes,
      merkleRoot: input.merkleRoot,
      metadata,
      outgoingSynapses: [],
      incomingSynapses: [],
    };

    this.insertOrReplaceNeuron(neuron);
    return neuron;
  }

  /**
   * Upsert a neuron into the database
   */
  async putNeuron(neuron: NeuronNode): Promise<void> {
    this.ensureInitialized();
    this.insertOrReplaceNeuron(neuron);
  }

  /**
   * Get a neuron by ID
   */
  async getNeuron(id: UUID): Promise<NeuronNode | null> {
    this.ensureInitialized();

    const row = this.db
      .prepare<[string], NeuronRow>('SELECT * FROM neurons WHERE id = ?')
      .get(id);

    if (!row) return null;
    return this.rowToNeuron(row);
  }

  /**
   * Get neuron by Merkle root
   */
  async getNeuronByMerkleRoot(merkleRoot: string): Promise<NeuronNode | null> {
    this.ensureInitialized();

    const row = this.db
      .prepare<[string], NeuronRow>('SELECT * FROM neurons WHERE merkle_root = ? LIMIT 1')
      .get(merkleRoot);

    if (!row) return null;
    return this.rowToNeuron(row);
  }

  /**
   * Partially update a neuron — merges supplied fields and bumps updatedAt
   */
  async updateNeuron(id: UUID, updates: Partial<NeuronNode>): Promise<NeuronNode | null> {
    this.ensureInitialized();

    const neuron = await this.getNeuron(id);
    if (!neuron) return null;

    const updated: NeuronNode = {
      ...neuron,
      ...updates,
      id: neuron.id, // preserve identity
      metadata: {
        ...neuron.metadata,
        ...updates.metadata,
        updatedAt: new Date().toISOString(),
      },
    };

    this.insertOrReplaceNeuron(updated);
    return updated;
  }

  /**
   * Delete a neuron and all synapses that reference it
   */
  async deleteNeuron(id: UUID): Promise<boolean> {
    this.ensureInitialized();

    const neuron = await this.getNeuron(id);
    if (!neuron) return false;

    // Collect all synapse IDs that touch this neuron before deleting them
    const synapseRows = this.db
      .prepare<[string, string], { id: string }>(
        'SELECT id FROM synapses WHERE source_id = ? OR target_id = ?'
      )
      .all(id, id);

    // Delete each synapse individually so referencing neurons are updated
    for (const row of synapseRows) {
      await this.deleteSynapse(row.id);
    }

    // Delete the neuron row itself
    this.db.prepare<[string]>('DELETE FROM neurons WHERE id = ?').run(id);
    return true;
  }

  /**
   * Increment accessCount and update lastAccessed for a neuron
   */
  async recordAccess(id: UUID): Promise<void> {
    this.ensureInitialized();

    const neuron = await this.getNeuron(id);
    if (!neuron) return;

    neuron.metadata.accessCount++;
    neuron.metadata.lastAccessed = new Date().toISOString();
    neuron.metadata.updatedAt = new Date().toISOString();

    this.insertOrReplaceNeuron(neuron);
  }

  /**
   * Return all neuron IDs
   */
  async getAllNeuronIds(): Promise<UUID[]> {
    this.ensureInitialized();

    const rows = this.db
      .prepare<[], { id: string }>('SELECT id FROM neurons')
      .all();

    return rows.map(r => r.id);
  }

  /**
   * Return total neuron count
   */
  async getNeuronCount(): Promise<number> {
    this.ensureInitialized();

    const row = this.db
      .prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM neurons')
      .get()!;

    return row.cnt;
  }

  /**
   * Return all neurons for similarity scoring (HNSW is the primary path;
   * this is a full-scan fallback used when the index is unavailable)
   */
  async findSimilar(embedding: Embedding384, k: number): Promise<NeuronNode[]> {
    this.ensureInitialized();

    const rows = this.db
      .prepare<[], NeuronRow>('SELECT * FROM neurons')
      .all();

    const results: Array<{ neuron: NeuronNode; similarity: number }> = [];

    for (const row of rows) {
      try {
        const neuron = this.rowToNeuron(row);
        const neuronEmbedding = neuron.embedding;

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < embedding.length; i++) {
          dotProduct += embedding[i] * neuronEmbedding[i];
          normA += embedding[i] * embedding[i];
          normB += neuronEmbedding[i] * neuronEmbedding[i];
        }

        const denom = Math.sqrt(normA) * Math.sqrt(normB);
        const similarity = denom === 0 ? 0 : dotProduct / denom;

        results.push({ neuron, similarity });
      } catch {
        // Skip rows with corrupt data
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k).map(r => r.neuron);
  }

  // ==================== Synapse Operations ====================

  /**
   * Create a synapse between two neurons.
   * When bidirectional is true a second reverse synapse is also inserted.
   */
  async createSynapse(
    sourceId: UUID,
    targetId: UUID,
    type: SynapseType,
    weight: number = 1.0,
    bidirectional: boolean = false
  ): Promise<Synapse | null> {
    this.ensureInitialized();

    // Verify both neurons exist
    const source = await this.getNeuron(sourceId);
    const target = await this.getNeuron(targetId);
    if (!source || !target) return null;

    const now = new Date().toISOString();

    const synapse: Synapse = {
      id: generateUUID(),
      sourceId,
      targetId,
      type,
      weight,
      metadata: {
        createdAt: now,
        updatedAt: now,
        activationCount: 0,
        lastActivated: now,
        bidirectional,
      },
    };

    this.insertOrReplaceSynapse(synapse);

    if (bidirectional) {
      const reverseSynapse: Synapse = {
        id: generateUUID(),
        sourceId: targetId,
        targetId: sourceId,
        type,
        weight,
        metadata: {
          createdAt: now,
          updatedAt: now,
          activationCount: 0,
          lastActivated: now,
          bidirectional: true,
        },
      };
      await this.putSynapse(reverseSynapse);
    }

    return synapse;
  }

  /**
   * Upsert a synapse into the database
   */
  async putSynapse(synapse: Synapse): Promise<void> {
    this.ensureInitialized();
    this.insertOrReplaceSynapse(synapse);
  }

  /**
   * Get a synapse by ID
   */
  async getSynapse(id: UUID): Promise<Synapse | null> {
    this.ensureInitialized();

    const row = this.db
      .prepare<[string], SynapseRow>('SELECT * FROM synapses WHERE id = ?')
      .get(id);

    if (!row) return null;
    return this.rowToSynapse(row);
  }

  /**
   * Get all synapses originating from a neuron
   */
  async getOutgoingSynapses(neuronId: UUID): Promise<Synapse[]> {
    this.ensureInitialized();

    const rows = this.db
      .prepare<[string], SynapseRow>('SELECT * FROM synapses WHERE source_id = ?')
      .all(neuronId);

    return rows.map(r => this.rowToSynapse(r));
  }

  /**
   * Get all synapses targeting a neuron
   */
  async getIncomingSynapses(neuronId: UUID): Promise<Synapse[]> {
    this.ensureInitialized();

    const rows = this.db
      .prepare<[string], SynapseRow>('SELECT * FROM synapses WHERE target_id = ?')
      .all(neuronId);

    return rows.map(r => this.rowToSynapse(r));
  }

  /**
   * Update the weight of a synapse
   */
  async updateSynapseWeight(id: UUID, weight: number): Promise<Synapse | null> {
    this.ensureInitialized();

    const synapse = await this.getSynapse(id);
    if (!synapse) return null;

    const now = new Date().toISOString();
    synapse.weight = weight;
    synapse.metadata.updatedAt = now;

    this.insertOrReplaceSynapse(synapse);
    return synapse;
  }

  /**
   * Increment activationCount and update lastActivated for a synapse
   */
  async recordSynapseActivation(id: UUID): Promise<void> {
    this.ensureInitialized();

    const synapse = await this.getSynapse(id);
    if (!synapse) return;

    const now = new Date().toISOString();
    synapse.metadata.activationCount++;
    synapse.metadata.lastActivated = now;
    synapse.metadata.updatedAt = now;

    this.insertOrReplaceSynapse(synapse);
  }

  /**
   * Delete a synapse by ID
   */
  async deleteSynapse(id: UUID): Promise<boolean> {
    this.ensureInitialized();

    const info = this.db
      .prepare<[string]>('DELETE FROM synapses WHERE id = ?')
      .run(id);

    return info.changes > 0;
  }

  /**
   * Return total synapse count
   */
  async getSynapseCount(): Promise<number> {
    this.ensureInitialized();

    const row = this.db
      .prepare<[], { cnt: number }>('SELECT COUNT(*) AS cnt FROM synapses')
      .get()!;

    return row.cnt;
  }

  // ==================== Private Helpers ====================

  /**
   * INSERT OR REPLACE a neuron row — encodes embedding and metadata
   */
  private insertOrReplaceNeuron(neuron: NeuronNode): void {
    const embeddingBuf = Buffer.from(neuron.embedding.buffer);
    const now = new Date().toISOString();

    this.db
      .prepare<[string, string, string, Buffer, string, string, string]>(`
        INSERT OR REPLACE INTO neurons
          (id, merkle_root, chunk_hashes, embedding, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        neuron.id,
        neuron.merkleRoot,
        JSON.stringify(neuron.chunkHashes),
        embeddingBuf,
        JSON.stringify(neuron.metadata),
        neuron.metadata.createdAt ?? now,
        neuron.metadata.updatedAt ?? now
      );
  }

  /**
   * INSERT OR REPLACE a synapse row
   */
  private insertOrReplaceSynapse(synapse: Synapse): void {
    const now = new Date().toISOString();

    this.db
      .prepare<[string, string, string, string, number, number, string, string, string]>(`
        INSERT OR REPLACE INTO synapses
          (id, source_id, target_id, type, weight, co_activation_count, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        synapse.id,
        synapse.sourceId,
        synapse.targetId,
        synapse.type,
        synapse.weight,
        synapse.metadata.activationCount,
        JSON.stringify(synapse.metadata),
        synapse.metadata.createdAt ?? now,
        synapse.metadata.updatedAt ?? now
      );
  }

  /**
   * Convert a raw neurons table row into a NeuronNode
   */
  private rowToNeuron(row: NeuronRow): NeuronNode {
    const metadata: NeuronMetadata = JSON.parse(row.metadata);
    const chunkHashes: string[] = JSON.parse(row.chunk_hashes);

    // Buffer → Float32Array (use a copy so the Buffer can be GC'd)
    const embeddingBuf = Buffer.isBuffer(row.embedding)
      ? row.embedding
      : Buffer.from(row.embedding);
    const embeddingArray = new Float32Array(
      embeddingBuf.buffer,
      embeddingBuf.byteOffset,
      embeddingBuf.byteLength / Float32Array.BYTES_PER_ELEMENT
    );
    // Defensive copy — SQLite reuses internal buffers between rows
    const embedding = new Float32Array(embeddingArray);

    // outgoingSynapses / incomingSynapses are derived from the synapses table
    // (not stored redundantly in neurons) so we return empty arrays here.
    // Callers that need populated adjacency lists should call
    // getOutgoingSynapses / getIncomingSynapses separately.
    return {
      id: row.id,
      merkleRoot: row.merkle_root,
      chunkHashes,
      embedding,
      metadata,
      outgoingSynapses: [],
      incomingSynapses: [],
    };
  }

  /**
   * Convert a raw synapses table row into a Synapse
   */
  private rowToSynapse(row: SynapseRow): Synapse {
    const metadata = JSON.parse(row.metadata);
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      type: row.type as SynapseType,
      weight: row.weight,
      metadata,
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('NeuronStore not initialized. Call init() first.');
    }
  }
}

/**
 * Create a NeuronStore instance
 */
export function createNeuronStore(options: NeuronStoreOptions): NeuronStore {
  return new NeuronStore(options);
}
