/**
 * Neuron Store - Persistent storage for neurons and synapses
 * @module storage/neuron-store
 */

import { Level } from 'level';
import type {
  UUID,
  NeuronNode,
  Synapse,
  SynapseType,
  Embedding384,
  NeuronType,
  SourceColumnSchema,
  SourceForeignKey,
  SourceIndex,
  SourceCheckConstraint,
  SourceTrigger,
} from '../types/index.js';
import { generateUUID } from '../utils/uuid.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Neuron store options
 */
export interface NeuronStoreOptions {
  dataDir: string;
}

/**
 * Serialized neuron format for storage
 */
interface SerializedNeuron {
  id: UUID;
  embedding: number[];
  chunkHashes: string[];
  merkleRoot: string;
  metadata: {
    createdAt: string;
    updatedAt: string;
    accessCount: number;
    lastAccessed: string;
    sourceType: string;
    tags: string[];
    neuronType?: NeuronType;
    ttl?: number;
    expiresAt?: number;
    importance?: number;
    verifiedAt?: string;
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
  };
  outgoingSynapses: UUID[];
  incomingSynapses: UUID[];
}

/**
 * Serialized synapse format for storage
 */
interface SerializedSynapse {
  id: UUID;
  sourceId: UUID;
  targetId: UUID;
  type: SynapseType;
  weight: number;
  metadata: {
    createdAt: string;
    updatedAt: string;
    activationCount: number;
    lastActivated: string;
    bidirectional: boolean;
  };
}

/**
 * Neuron and Synapse Storage
 */
export class NeuronStore {
  private neuronDb: Level<string, string>;
  private synapseDb: Level<string, string>;
  private dataDir: string;
  private initialized: boolean = false;

  constructor(options: NeuronStoreOptions) {
    this.dataDir = options.dataDir;
    this.neuronDb = new Level(path.join(this.dataDir, 'neurons'), {
      valueEncoding: 'json'
    });
    this.synapseDb = new Level(path.join(this.dataDir, 'synapses'), {
      valueEncoding: 'json'
    });
  }

  /**
   * Initialize the store
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.dataDir, { recursive: true });
    await this.neuronDb.open();
    await this.synapseDb.open();
    this.initialized = true;
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (!this.initialized) return;
    await this.neuronDb.close();
    await this.synapseDb.close();
    this.initialized = false;
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
    const neuron: NeuronNode = {
      id: generateUUID(),
      embedding: input.embedding,
      chunkHashes: input.chunkHashes,
      merkleRoot: input.merkleRoot,
      metadata: {
        createdAt: now,
        updatedAt: now,
        accessCount: 0,
        lastAccessed: now,
        sourceType: input.sourceType ?? 'unknown',
        tags: input.tags ?? [],
        ...(input.sourceRow ? { sourceRow: input.sourceRow } : {}),
        ...(input.sourceColumns ? { sourceColumns: input.sourceColumns } : {}),
        ...(input.sourceForeignKeys ? { sourceForeignKeys: input.sourceForeignKeys } : {}),
        ...(input.sourceIndexes ? { sourceIndexes: input.sourceIndexes } : {}),
        ...(input.sourceChecks ? { sourceChecks: input.sourceChecks } : {}),
        ...(input.sourceTriggers ? { sourceTriggers: input.sourceTriggers } : {}),
        ...(input.sourceTable ? { sourceTable: input.sourceTable } : {}),
        ...(input.sourceEngine ? { sourceEngine: input.sourceEngine } : {}),
        ...(input.sourceCharset ? { sourceCharset: input.sourceCharset } : {}),
        ...(input.sourcePath ? { sourcePath: input.sourcePath } : {}),
        ...(input.sourceName ? { sourceName: input.sourceName } : {}),
      },
      outgoingSynapses: [],
      incomingSynapses: []
    };

    await this.putNeuron(neuron);
    return neuron;
  }

  /**
   * Store a neuron
   */
  async putNeuron(neuron: NeuronNode): Promise<void> {
    this.ensureInitialized();

    const serialized = this.serializeNeuron(neuron);
    await this.neuronDb.put(`neuron:${neuron.id}`, JSON.stringify(serialized));

    // Index by merkle root for lookup
    await this.neuronDb.put(`root:${neuron.merkleRoot}`, neuron.id);
  }

  /**
   * Get a neuron by ID
   */
  async getNeuron(id: UUID): Promise<NeuronNode | null> {
    this.ensureInitialized();

    try {
      const value = await this.neuronDb.get(`neuron:${id}`);
      const serialized: SerializedNeuron = JSON.parse(value);
      return this.deserializeNeuron(serialized);
    } catch (err) {
      if ((err as any).code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get neuron by Merkle root
   */
  async getNeuronByMerkleRoot(merkleRoot: string): Promise<NeuronNode | null> {
    this.ensureInitialized();

    try {
      const id = await this.neuronDb.get(`root:${merkleRoot}`);
      return this.getNeuron(id);
    } catch (err) {
      if ((err as any).code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Update a neuron
   */
  async updateNeuron(id: UUID, updates: Partial<NeuronNode>): Promise<NeuronNode | null> {
    this.ensureInitialized();

    const neuron = await this.getNeuron(id);
    if (!neuron) return null;

    const updated: NeuronNode = {
      ...neuron,
      ...updates,
      id: neuron.id, // Preserve ID
      metadata: {
        ...neuron.metadata,
        ...updates.metadata,
        updatedAt: new Date().toISOString()
      }
    };

    await this.putNeuron(updated);
    return updated;
  }

  /**
   * Delete a neuron and its synapses
   */
  async deleteNeuron(id: UUID): Promise<boolean> {
    this.ensureInitialized();

    const neuron = await this.getNeuron(id);
    if (!neuron) return false;

    // Delete all outgoing synapses
    for (const synapseId of neuron.outgoingSynapses) {
      await this.deleteSynapse(synapseId);
    }

    // Delete all incoming synapses
    for (const synapseId of neuron.incomingSynapses) {
      await this.deleteSynapse(synapseId);
    }

    // Delete neuron
    await this.neuronDb.del(`neuron:${id}`);
    await this.neuronDb.del(`root:${neuron.merkleRoot}`);

    return true;
  }

  /**
   * Record an access to a neuron
   */
  async recordAccess(id: UUID): Promise<void> {
    this.ensureInitialized();

    const neuron = await this.getNeuron(id);
    if (!neuron) return;

    neuron.metadata.accessCount++;
    neuron.metadata.lastAccessed = new Date().toISOString();

    await this.putNeuron(neuron);
  }

  /**
   * Get all neuron IDs
   */
  async getAllNeuronIds(): Promise<UUID[]> {
    this.ensureInitialized();

    const ids: UUID[] = [];
    for await (const key of this.neuronDb.keys()) {
      if (key.startsWith('neuron:')) {
        ids.push(key.slice(7));
      }
    }
    return ids;
  }

  /**
   * Get neuron count
   */
  async getNeuronCount(): Promise<number> {
    this.ensureInitialized();

    let count = 0;
    for await (const key of this.neuronDb.keys()) {
      if (key.startsWith('neuron:')) {
        count++;
      }
    }
    return count;
  }

  // ==================== Synapse Operations ====================

  /**
   * Create a synapse between two neurons
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
        bidirectional
      }
    };

    // Store synapse
    await this.putSynapse(synapse);

    // Update neuron connections
    source.outgoingSynapses.push(synapse.id);
    target.incomingSynapses.push(synapse.id);

    await this.putNeuron(source);
    await this.putNeuron(target);

    // Create reverse synapse if bidirectional
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
          bidirectional: true
        }
      };
      await this.putSynapse(reverseSynapse);

      target.outgoingSynapses.push(reverseSynapse.id);
      source.incomingSynapses.push(reverseSynapse.id);

      await this.putNeuron(source);
      await this.putNeuron(target);
    }

    return synapse;
  }

  /**
   * Store a synapse
   */
  async putSynapse(synapse: Synapse): Promise<void> {
    this.ensureInitialized();

    const serialized = this.serializeSynapse(synapse);
    await this.synapseDb.put(`synapse:${synapse.id}`, JSON.stringify(serialized));

    // Index by source and target
    await this.synapseDb.put(`source:${synapse.sourceId}:${synapse.id}`, synapse.id);
    await this.synapseDb.put(`target:${synapse.targetId}:${synapse.id}`, synapse.id);
  }

  /**
   * Get a synapse by ID
   */
  async getSynapse(id: UUID): Promise<Synapse | null> {
    this.ensureInitialized();

    try {
      const value = await this.synapseDb.get(`synapse:${id}`);
      const serialized: SerializedSynapse = JSON.parse(value);
      return this.deserializeSynapse(serialized);
    } catch (err) {
      if ((err as any).code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Get all synapses from a neuron
   * Optimized: Uses range query instead of full scan - O(k) instead of O(n)
   */
  async getOutgoingSynapses(neuronId: UUID): Promise<Synapse[]> {
    this.ensureInitialized();

    const synapses: Synapse[] = [];
    const prefix = `source:${neuronId}:`;

    // Range query: only scan keys with matching prefix
    for await (const [key] of this.synapseDb.iterator({
      gte: prefix,
      lt: prefix + '\xFF'  // '\xFF' is the highest byte, so this covers all keys with prefix
    })) {
      const synapseId = key.slice(prefix.length);
      const synapse = await this.getSynapse(synapseId);
      if (synapse) synapses.push(synapse);
    }
    return synapses;
  }

  /**
   * Get all synapses to a neuron
   * Optimized: Uses range query instead of full scan - O(k) instead of O(n)
   */
  async getIncomingSynapses(neuronId: UUID): Promise<Synapse[]> {
    this.ensureInitialized();

    const synapses: Synapse[] = [];
    const prefix = `target:${neuronId}:`;

    // Range query: only scan keys with matching prefix
    for await (const [key] of this.synapseDb.iterator({
      gte: prefix,
      lt: prefix + '\xFF'
    })) {
      const synapseId = key.slice(prefix.length);
      const synapse = await this.getSynapse(synapseId);
      if (synapse) synapses.push(synapse);
    }
    return synapses;
  }

  /**
   * Update synapse weight
   */
  async updateSynapseWeight(id: UUID, weight: number): Promise<Synapse | null> {
    this.ensureInitialized();

    const synapse = await this.getSynapse(id);
    if (!synapse) return null;

    synapse.weight = weight;
    synapse.metadata.updatedAt = new Date().toISOString();

    await this.putSynapse(synapse);
    return synapse;
  }

  /**
   * Record synapse activation
   */
  async recordSynapseActivation(id: UUID): Promise<void> {
    this.ensureInitialized();

    const synapse = await this.getSynapse(id);
    if (!synapse) return;

    synapse.metadata.activationCount++;
    synapse.metadata.lastActivated = new Date().toISOString();

    await this.putSynapse(synapse);
  }

  /**
   * Delete a synapse
   */
  async deleteSynapse(id: UUID): Promise<boolean> {
    this.ensureInitialized();

    const synapse = await this.getSynapse(id);
    if (!synapse) return false;

    // Remove from indices
    await this.synapseDb.del(`synapse:${id}`);
    await this.synapseDb.del(`source:${synapse.sourceId}:${id}`);
    await this.synapseDb.del(`target:${synapse.targetId}:${id}`);

    // Update neurons
    const source = await this.getNeuron(synapse.sourceId);
    const target = await this.getNeuron(synapse.targetId);

    if (source) {
      source.outgoingSynapses = source.outgoingSynapses.filter(s => s !== id);
      await this.putNeuron(source);
    }

    if (target) {
      target.incomingSynapses = target.incomingSynapses.filter(s => s !== id);
      await this.putNeuron(target);
    }

    return true;
  }

  /**
   * Get synapse count
   */
  async getSynapseCount(): Promise<number> {
    this.ensureInitialized();

    let count = 0;
    for await (const key of this.synapseDb.keys()) {
      if (key.startsWith('synapse:')) {
        count++;
      }
    }
    return count;
  }

  /**
   * Find neurons similar to a given embedding
   */
  async findSimilar(embedding: Embedding384, k: number): Promise<NeuronNode[]> {
    this.ensureInitialized();

    const results: Array<{ neuron: NeuronNode; similarity: number }> = [];

    for await (const [key, value] of this.neuronDb.iterator()) {
      if (!key.startsWith('neuron:')) continue;

      try {
        const serialized = JSON.parse(value) as SerializedNeuron;
        const neuronEmbedding = new Float32Array(serialized.embedding);

        // Calculate cosine similarity
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < embedding.length; i++) {
          dotProduct += embedding[i] * neuronEmbedding[i];
          normA += embedding[i] * embedding[i];
          normB += neuronEmbedding[i] * neuronEmbedding[i];
        }

        const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));

        results.push({
          neuron: this.deserializeNeuron(serialized),
          similarity,
        });
      } catch {
        // Skip invalid entries
      }
    }

    // Sort by similarity and return top k
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, k).map(r => r.neuron);
  }

  // ==================== Serialization ====================

  private serializeNeuron(neuron: NeuronNode): SerializedNeuron {
    return {
      id: neuron.id,
      embedding: Array.from(neuron.embedding),
      chunkHashes: neuron.chunkHashes,
      merkleRoot: neuron.merkleRoot,
      metadata: neuron.metadata,
      outgoingSynapses: neuron.outgoingSynapses,
      incomingSynapses: neuron.incomingSynapses
    };
  }

  private deserializeNeuron(data: SerializedNeuron): NeuronNode {
    return {
      id: data.id,
      embedding: new Float32Array(data.embedding),
      chunkHashes: data.chunkHashes,
      merkleRoot: data.merkleRoot,
      metadata: data.metadata,
      outgoingSynapses: data.outgoingSynapses,
      incomingSynapses: data.incomingSynapses
    };
  }

  private serializeSynapse(synapse: Synapse): SerializedSynapse {
    return {
      id: synapse.id,
      sourceId: synapse.sourceId,
      targetId: synapse.targetId,
      type: synapse.type,
      weight: synapse.weight,
      metadata: synapse.metadata
    };
  }

  private deserializeSynapse(data: SerializedSynapse): Synapse {
    return {
      id: data.id,
      sourceId: data.sourceId,
      targetId: data.targetId,
      type: data.type,
      weight: data.weight,
      metadata: data.metadata
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
