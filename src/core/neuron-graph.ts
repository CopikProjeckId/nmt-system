/**
 * Neuron Graph Manager - Graph operations and traversal
 * @module core/neuron-graph
 */

import type {
  UUID,
  NeuronNode,
  Synapse,
  SynapseType,
  Embedding384,
  TraversalStrategy,
  NeuronPath,
  SearchResult,
  INeuronStore,
  SourceColumnSchema,
  SourceForeignKey,
  SourceIndex,
  SourceCheckConstraint,
  SourceTrigger,
} from '../types/index.js';
import { HNSWIndex } from './hnsw-index.js';
import { cosineSimilarity, normalize } from '../utils/similarity.js';

/**
 * Neuron Graph Manager options
 */
export interface NeuronGraphOptions {
  neuronStore: INeuronStore;
  hnswIndex: HNSWIndex;
  semanticThreshold?: number;
  maxTraversalDepth?: number;
}

/**
 * Create neuron input
 */
export interface CreateNeuronInput {
  embedding: Embedding384;
  chunkHashes: string[];
  merkleRoot: string;
  sourceType?: string;
  tags?: string[];
  autoConnect?: boolean;
  connectionThreshold?: number;
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
}

/**
 * Traversal result
 */
export interface TraversalResult {
  paths: NeuronPath[];
  visited: Set<UUID>;
  totalWeight: number;
}

/**
 * Neuron Graph Manager
 * Handles neuron creation, connection, and graph traversal
 */
export class NeuronGraphManager {
  private store: INeuronStore;
  private index: HNSWIndex;
  private semanticThreshold: number;
  private maxTraversalDepth: number;

  constructor(options: NeuronGraphOptions) {
    this.store = options.neuronStore;
    this.index = options.hnswIndex;
    this.semanticThreshold = options.semanticThreshold ?? 0.7;
    this.maxTraversalDepth = options.maxTraversalDepth ?? 10;
  }

  /**
   * Create a new neuron
   */
  async createNeuron(input: CreateNeuronInput): Promise<NeuronNode> {
    // Create and store neuron
    const neuron = await this.store.createNeuron({
      embedding: input.embedding,
      chunkHashes: input.chunkHashes,
      merkleRoot: input.merkleRoot,
      sourceType: input.sourceType,
      tags: input.tags,
      sourceRow: input.sourceRow,
      sourceColumns: input.sourceColumns,
      sourceForeignKeys: input.sourceForeignKeys,
      sourceIndexes: input.sourceIndexes,
      sourceChecks: input.sourceChecks,
      sourceTriggers: input.sourceTriggers,
      sourceTable: input.sourceTable,
      sourceEngine: input.sourceEngine,
      sourceCharset: input.sourceCharset,
      sourcePath: input.sourcePath,
      sourceName: input.sourceName,
    });

    // Add to HNSW index
    this.index.insert(neuron.id, neuron.embedding);

    // Auto-connect to similar neurons if enabled
    if (input.autoConnect !== false) {
      await this.autoConnect(
        neuron.id,
        input.connectionThreshold ?? this.semanticThreshold
      );
    }

    return neuron;
  }

  /**
   * Get a neuron by ID
   */
  async getNeuron(id: UUID): Promise<NeuronNode | null> {
    return this.store.getNeuron(id);
  }

  /**
   * Get a neuron by Merkle root
   */
  async getNeuronByMerkleRoot(merkleRoot: string): Promise<NeuronNode | null> {
    return this.store.getNeuronByMerkleRoot(merkleRoot);
  }

  /**
   * Delete a neuron
   */
  async deleteNeuron(id: UUID): Promise<boolean> {
    // Remove from index
    this.index.delete(id);

    // Delete from store (also removes synapses)
    return this.store.deleteNeuron(id);
  }

  /**
   * Connect two neurons with a synapse
   */
  async connect(
    sourceId: UUID,
    targetId: UUID,
    type: SynapseType,
    weight?: number,
    bidirectional?: boolean
  ): Promise<Synapse | null> {
    return this.store.createSynapse(
      sourceId,
      targetId,
      type,
      weight,
      bidirectional
    );
  }

  /**
   * Disconnect two neurons
   */
  async disconnect(synapseId: UUID): Promise<boolean> {
    return this.store.deleteSynapse(synapseId);
  }

  /**
   * Find similar neurons using HNSW index
   */
  async findSimilar(
    embedding: Embedding384,
    k: number = 10,
    ef?: number
  ): Promise<Array<{ neuron: NeuronNode; score: number }>> {
    const results = this.index.search(embedding, k, ef);
    const neurons: Array<{ neuron: NeuronNode; score: number }> = [];

    for (const result of results) {
      const neuron = await this.store.getNeuron(result.id);
      if (neuron) {
        neurons.push({ neuron, score: result.score });
        await this.store.recordAccess(neuron.id);
      }
    }

    return neurons;
  }

  /**
   * Find a near-duplicate neuron by embedding similarity.
   * Returns the closest existing neuron if its score meets the threshold, null otherwise.
   */
  async findDuplicate(
    embedding: Embedding384,
    threshold: number = 0.95
  ): Promise<NeuronNode | null> {
    const results = this.index.search(embedding, 1);
    if (results.length === 0) return null;
    if (results[0].score < threshold) return null;
    return this.store.getNeuron(results[0].id);
  }

  /**
   * Merge new tags into an existing neuron without overwriting existing ones.
   * No-ops if the neuron is not found or there are no new tags to add.
   */
  async mergeTags(neuronId: UUID, newTags: string[]): Promise<void> {
    if (newTags.length === 0) return;
    const neuron = await this.store.getNeuron(neuronId);
    if (!neuron) return;
    const existing = new Set(neuron.metadata.tags);
    if (!newTags.some(t => !existing.has(t))) return; // nothing new
    const mergedTags = [...new Set([...neuron.metadata.tags, ...newTags])];
    await this.store.updateNeuron(neuronId, {
      metadata: {
        ...neuron.metadata,
        tags: mergedTags,
        updatedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Find similar neurons to an existing neuron
   */
  async findSimilarTo(
    neuronId: UUID,
    k: number = 10
  ): Promise<Array<{ neuron: NeuronNode; score: number }>> {
    const neuron = await this.store.getNeuron(neuronId);
    if (!neuron) return [];

    const results = await this.findSimilar(neuron.embedding, k + 1);

    // Filter out the source neuron
    return results.filter(r => r.neuron.id !== neuronId).slice(0, k);
  }

  /**
   * Auto-connect neuron to similar neurons
   */
  async autoConnect(
    neuronId: UUID,
    threshold: number = this.semanticThreshold
  ): Promise<Synapse[]> {
    const neuron = await this.store.getNeuron(neuronId);
    if (!neuron) return [];

    const similar = await this.findSimilar(neuron.embedding, 20);
    const synapses: Synapse[] = [];

    for (const { neuron: target, score } of similar) {
      if (target.id === neuronId) continue;
      if (score < threshold) continue;

      // Check if connection already exists
      const existing = await this.getConnection(neuronId, target.id);
      if (existing) continue;

      const synapse = await this.connect(
        neuronId,
        target.id,
        'SEMANTIC',
        score,
        true
      );

      if (synapse) {
        synapses.push(synapse);
      }
    }

    return synapses;
  }

  /**
   * Get connection between two neurons
   */
  async getConnection(sourceId: UUID, targetId: UUID): Promise<Synapse | null> {
    const synapses = await this.store.getOutgoingSynapses(sourceId);
    return synapses.find((s: Synapse) => s.targetId === targetId) ?? null;
  }

  /**
   * Traverse the graph from a starting neuron
   */
  async traverse(
    startId: UUID,
    strategy: TraversalStrategy = 'BFS',
    maxDepth: number = this.maxTraversalDepth,
    filter?: (neuron: NeuronNode, synapse: Synapse) => boolean
  ): Promise<TraversalResult> {
    const visited = new Set<UUID>();
    const paths: NeuronPath[] = [];
    let totalWeight = 0;

    switch (strategy) {
      case 'BFS':
        await this.bfsTraverse(startId, maxDepth, visited, paths, filter);
        break;
      case 'DFS':
        await this.dfsTraverse(startId, maxDepth, visited, paths, { path: [], synapses: [], weight: 0 }, filter);
        break;
      case 'WEIGHTED':
        await this.weightedTraverse(startId, maxDepth, visited, paths, filter);
        break;
      case 'RANDOM_WALK':
        await this.randomWalkTraverse(startId, maxDepth, visited, paths);
        break;
    }

    // Calculate total weight
    for (const path of paths) {
      totalWeight += path.totalWeight;
    }

    return { paths, visited, totalWeight };
  }

  /**
   * Find shortest path between two neurons
   */
  async findPath(
    sourceId: UUID,
    targetId: UUID,
    maxDepth: number = this.maxTraversalDepth
  ): Promise<NeuronPath | null> {
    const visited = new Set<UUID>();
    const queue: Array<{
      id: UUID;
      path: UUID[];
      synapses: Synapse[];
      weight: number;
    }> = [{ id: sourceId, path: [sourceId], synapses: [], weight: 0 }];

    visited.add(sourceId);

    while (queue.length > 0) {
      const { id, path, synapses, weight } = queue.shift()!;

      if (id === targetId) {
        const neurons: NeuronNode[] = [];
        for (const nodeId of path) {
          const neuron = await this.store.getNeuron(nodeId);
          if (neuron) neurons.push(neuron);
        }

        return {
          neurons,
          synapses,
          totalWeight: weight
        };
      }

      if (path.length >= maxDepth) continue;

      const outgoing = await this.store.getOutgoingSynapses(id);
      for (const synapse of outgoing) {
        if (visited.has(synapse.targetId)) continue;
        visited.add(synapse.targetId);

        queue.push({
          id: synapse.targetId,
          path: [...path, synapse.targetId],
          synapses: [...synapses, synapse],
          weight: weight + synapse.weight
        });
      }
    }

    return null;
  }

  /**
   * Get graph statistics
   */
  async getStats(): Promise<{
    neuronCount: number;
    synapseCount: number;
    indexStats: {
      totalNodes: number;
      layerDistribution: Map<number, number>;
      maxLayer: number;
    };
  }> {
    const neuronCount = await this.store.getNeuronCount();
    const synapseCount = await this.store.getSynapseCount();
    const indexStats = this.index.getStats();

    return {
      neuronCount,
      synapseCount,
      indexStats: {
        totalNodes: indexStats.totalNodes,
        layerDistribution: indexStats.layerDistribution,
        maxLayer: indexStats.maxLayer
      }
    };
  }

  /**
   * Get connected components
   */
  async getConnectedComponents(): Promise<Set<UUID>[]> {
    const allIds = await this.store.getAllNeuronIds();
    const visited = new Set<UUID>();
    const components: Set<UUID>[] = [];

    for (const id of allIds) {
      if (visited.has(id)) continue;

      const component = new Set<UUID>();
      const stack = [id];

      while (stack.length > 0) {
        const current = stack.pop()!;
        if (visited.has(current)) continue;

        visited.add(current);
        component.add(current);

        // Get all connected neurons
        const outgoing = await this.store.getOutgoingSynapses(current);
        const incoming = await this.store.getIncomingSynapses(current);

        for (const synapse of outgoing) {
          if (!visited.has(synapse.targetId)) {
            stack.push(synapse.targetId);
          }
        }

        for (const synapse of incoming) {
          if (!visited.has(synapse.sourceId)) {
            stack.push(synapse.sourceId);
          }
        }
      }

      components.push(component);
    }

    return components;
  }

  /**
   * Strengthen synapse (Hebbian learning)
   */
  async strengthenSynapse(
    synapseId: UUID,
    amount: number = 0.1
  ): Promise<Synapse | null> {
    const synapse = await this.store.getSynapse(synapseId);
    if (!synapse) return null;

    const newWeight = Math.min(1.0, synapse.weight + amount);
    return this.store.updateSynapseWeight(synapseId, newWeight);
  }

  /**
   * Weaken synapse
   */
  async weakenSynapse(
    synapseId: UUID,
    amount: number = 0.1
  ): Promise<Synapse | null> {
    const synapse = await this.store.getSynapse(synapseId);
    if (!synapse) return null;

    const newWeight = Math.max(0.0, synapse.weight - amount);
    return this.store.updateSynapseWeight(synapseId, newWeight);
  }

  /**
   * Hebbian co-activation reinforcement.
   *
   * When a set of neurons are retrieved together in the same search query,
   * the synapses connecting them are strengthened using the soft-ceiling rule:
   *   w_new = w + η * (1 - w)
   * This ensures weights approach 1.0 asymptotically and never exceed it.
   *
   * @param neuronIds  IDs of co-activated neurons (e.g. top-k search results)
   * @param eta        Hebbian learning rate (default: 0.05)
   */
  async reinforceCoActivation(
    neuronIds: UUID[],
    eta: number = 0.05
  ): Promise<void> {
    if (neuronIds.length < 2) return;

    // Check all ordered pairs (i → j)
    for (let i = 0; i < neuronIds.length; i++) {
      for (let j = 0; j < neuronIds.length; j++) {
        if (i === j) continue;
        const synapse = await this.getConnection(neuronIds[i], neuronIds[j]);
        if (!synapse) continue;

        // Soft-ceiling Hebbian: w += η * (1 - w)
        const newWeight = Math.min(1.0, synapse.weight + eta * (1 - synapse.weight));
        await this.store.updateSynapseWeight(synapse.id, newWeight);
        await this.store.recordSynapseActivation(synapse.id);
      }
    }
  }

  /**
   * Compute the maximum synapse weight from a given neuron to any of the
   * co-retrieved neurons. Used to boost search scores for well-connected results.
   *
   * @param neuronId      Source neuron
   * @param peerIds       Set of peer neuron IDs in the same result set
   * @returns             Max weight [0, 1], or 0 if no connecting synapses found
   */
  async maxCoActivationWeight(
    neuronId: UUID,
    peerIds: Set<UUID>
  ): Promise<number> {
    const outgoing = await this.store.getOutgoingSynapses(neuronId);
    let max = 0;
    for (const s of outgoing) {
      if (s.type !== 'INHIBITORY' && peerIds.has(s.targetId) && s.weight > max) {
        max = s.weight;
      }
    }
    return max;
  }

  /**
   * Competitive inhibition: strengthen INHIBITORY synapses from higher-ranked
   * neurons toward lower-ranked neurons that are semantically similar.
   *
   * Biological analogy: Winner-Take-All inhibition. When neuron A consistently
   * outranks neuron B in the same search, A inhibits B to prevent redundant
   * results. This promotes search result diversity over time.
   *
   * Formula (soft floor): w -= η * (1 - |w|)  →  weight approaches -1.0
   *
   * @param rankedNeuronIds  Neuron IDs sorted best-first (index 0 = winner)
   * @param eta              Inhibitory learning rate (default: 0.03)
   */
  async inhibitCoActivation(
    rankedNeuronIds: UUID[],
    eta: number = 0.03
  ): Promise<void> {
    if (rankedNeuronIds.length < 2) return;

    // Winner → Loser: higher-rank inhibits lower-rank.
    // Limit to top-3 winners to prevent O(k²) synapse explosion:
    // k=10 uncapped → 45 pairs/search; capped at winner<3 → max 27 pairs/search.
    const MAX_WINNERS = 3;
    for (let winner = 0; winner < Math.min(MAX_WINNERS, rankedNeuronIds.length - 1); winner++) {
      for (let loser = winner + 1; loser < rankedNeuronIds.length; loser++) {
        const winnerId = rankedNeuronIds[winner];
        const loserId  = rankedNeuronIds[loser];

        // Find existing INHIBITORY synapse (winner → loser)
        const synapses = await this.store.getOutgoingSynapses(winnerId);
        const existing = synapses.find(
          (s: Synapse) => s.targetId === loserId && s.type === 'INHIBITORY'
        );

        if (existing) {
          // Deepen inhibition: w -= η * (1 - |w|), floor at -1.0
          const newWeight = Math.max(-1.0, existing.weight - eta * (1 - Math.abs(existing.weight)));
          await this.store.updateSynapseWeight(existing.id, newWeight);
          await this.store.recordSynapseActivation(existing.id);
        } else {
          // Create new INHIBITORY synapse with small initial inhibition
          await this.store.createSynapse(winnerId, loserId, 'INHIBITORY', -0.05, false);
        }
      }
    }
  }

  /**
   * Get the maximum absolute inhibitory weight targeting a neuron from any of
   * the given peer neurons. Used to compute the inhibitory penalty in search.
   *
   * @param neuronId  Target neuron (potentially inhibited)
   * @param peerIds   Set of peer neuron IDs (potential inhibitors)
   * @returns         Max |weight| of INHIBITORY synapses from peers, or 0
   */
  async maxInhibitoryWeight(
    neuronId: UUID,
    peerIds: Set<UUID>
  ): Promise<number> {
    const incoming = await this.store.getIncomingSynapses(neuronId);
    let max = 0;
    for (const s of incoming) {
      if (s.type === 'INHIBITORY' && peerIds.has(s.sourceId)) {
        const absW = Math.abs(s.weight);
        if (absW > max) max = absW;
      }
    }
    return max;
  }

  /**
   * Update a neuron's embedding vector (online learning).
   * Deletes and re-inserts the node in the HNSW index to reflect the new vector.
   *
   * @param neuronId     Target neuron
   * @param newEmbedding New (already L2-normalized) embedding
   */
  async updateNeuronEmbedding(
    neuronId: UUID,
    newEmbedding: Embedding384
  ): Promise<void> {
    await this.store.updateNeuron(neuronId, { embedding: newEmbedding });
    // forceDelete performs immediate structural removal (not soft-delete),
    // freeing the slot so insert can safely re-add the node.
    this.index.forceDelete(neuronId);
    try {
      this.index.insert(neuronId, newEmbedding);
    } catch {
      // Guard against edge-case double-insert: clear and retry
      this.index.forceDelete(neuronId);
      this.index.insert(neuronId, newEmbedding);
    }
  }

  /**
   * Synaptic pruning — remove structurally weak and unused synapses.
   *
   * Biological analogy: adolescent synaptic pruning — the brain eliminates
   * ~50% of synapses formed in childhood, keeping only used pathways.
   * This sharpens signal/noise ratio and reduces metabolic cost.
   *
   * Pruning criteria (both conditions must hold):
   *   - Excitatory:  weight < minWeight   AND activationCount < minActivations
   *   - Inhibitory:  |weight| < minWeight AND activationCount < minActivations
   *
   * @param minWeight        Minimum weight to keep (default: 0.05)
   * @param minActivations   Minimum activation count to keep (default: 2)
   * @param dryRun           If true, count candidates without deleting
   * @returns                Number of synapses pruned (or candidates in dryRun)
   */
  async pruneSynapses(options: {
    minWeight?: number;
    minActivations?: number;
    dryRun?: boolean;
  } = {}): Promise<{ pruned: number; remaining: number }> {
    const {
      minWeight    = 0.05,
      minActivations = 2,
      dryRun       = false,
    } = options;

    const allNeuronIds = await this.store.getAllNeuronIds();
    const visitedSynapseIds = new Set<UUID>();
    let pruned = 0;
    let remaining = 0;

    for (const neuronId of allNeuronIds) {
      const outgoing = await this.store.getOutgoingSynapses(neuronId);

      for (const synapse of outgoing) {
        if (visitedSynapseIds.has(synapse.id)) continue;
        visitedSynapseIds.add(synapse.id);

        const absWeight   = Math.abs(synapse.weight);
        const activations = synapse.metadata.activationCount;
        const shouldPrune = absWeight < minWeight && activations < minActivations;

        if (shouldPrune) {
          if (!dryRun) await this.store.deleteSynapse(synapse.id);
          pruned++;
        } else {
          remaining++;
        }
      }
    }

    return { pruned, remaining };
  }

  /**
   * Hopfield-style iterative pattern completion.
   *
   * Biological analogy: associative pattern completion in hippocampus/cortex.
   * A partial or noisy cue converges to the stored memory by iteratively
   * moving the query embedding toward the centroid of retrieved memories.
   *
   * Algorithm (per iteration):
   *   1. Search top-k with current embedding
   *   2. Compute score-weighted centroid of retrieved embeddings
   *   3. Blend: q_new = normalize(α*q_old + (1-α)*centroid)
   *   4. Repeat
   *
   * @param embedding   Initial (possibly noisy/partial) query embedding
   * @param k           Number of candidates per iteration
   * @param iterations  Refinement iterations (default: 3)
   * @param alpha       Retention weight for original query (default: 0.3)
   * @returns           Refined embedding and convergence delta
   */
  async patternComplete(
    embedding: Embedding384,
    k: number = 10,
    iterations: number = 3,
    alpha: number = 0.3
  ): Promise<{ refined: Embedding384; delta: number }> {
    let current = embedding;
    let delta = 0;

    for (let iter = 0; iter < iterations; iter++) {
      const results = this.index.search(current, k);
      if (results.length === 0) break;

      // Only use above-average scoring neurons for centroid.
      // Using all k neurons in a small index would pull toward global mean,
      // defeating convergence. Keeping the top half ensures the attractor
      // is specific to the query cluster.
      const meanScore = results.reduce((s, r) => s + r.score, 0) / results.length;
      const topResults = results.filter(r => r.score >= meanScore);

      // Score-weighted centroid of selected neurons
      const centroid = new Float32Array(384);
      let totalScore = 0;
      for (const r of topResults) {
        const neuron = await this.store.getNeuron(r.id);
        if (!neuron) continue;
        for (let d = 0; d < 384; d++) {
          centroid[d] += r.score * neuron.embedding[d];
        }
        totalScore += r.score;
      }
      if (totalScore === 0) break;
      for (let d = 0; d < 384; d++) centroid[d] /= totalScore;

      // Blend: retain alpha of original, pull (1-alpha) toward centroid
      const blended = new Float32Array(384);
      for (let d = 0; d < 384; d++) {
        blended[d] = alpha * current[d] + (1 - alpha) * centroid[d];
      }
      const refined = normalize(blended);

      // Measure convergence (L2 distance between iterations)
      delta = Math.sqrt(
        Array.from(refined).reduce((s, v, i) => s + (v - current[i]) ** 2, 0)
      );
      current = refined;

      if (delta < 1e-4) break; // Converged
    }

    return { refined: current, delta };
  }

  /**
   * Build episodic memory: create TEMPORAL synapses between neurons accessed
   * together in the same search episode. This encodes the "context chain"
   * of a reasoning session, analogous to hippocampal sequence encoding.
   *
   * @param episodeNeuronIds  Ordered list of neuron IDs in one episode
   * @param maxDistance       Max positional distance to link (default: 2)
   */
  async encodeEpisode(
    episodeNeuronIds: UUID[],
    maxDistance: number = 2
  ): Promise<void> {
    if (episodeNeuronIds.length < 2) return;

    for (let i = 0; i < episodeNeuronIds.length; i++) {
      for (let j = i + 1; j <= Math.min(i + maxDistance, episodeNeuronIds.length - 1); j++) {
        const srcId = episodeNeuronIds[i];
        const tgtId = episodeNeuronIds[j];

        // Skip if TEMPORAL synapse already exists
        const existing = await this.getConnection(srcId, tgtId);
        if (existing?.type === 'TEMPORAL') {
          // Strengthen existing temporal link
          const newW = Math.min(1.0, existing.weight + 0.05 * (1 - existing.weight));
          await this.store.updateSynapseWeight(existing.id, newW);
          await this.store.recordSynapseActivation(existing.id);
        } else if (!existing) {
          // Create new TEMPORAL synapse — initial weight decays with distance
          const distance = j - i; // relative distance (1 or 2), not absolute index
          const initialWeight = 0.3 / distance; // closer = stronger
          await this.store.createSynapse(srcId, tgtId, 'TEMPORAL', initialWeight, false);
        }
      }
    }
  }

  // ==================== Private Traversal Methods ====================

  private async bfsTraverse(
    startId: UUID,
    maxDepth: number,
    visited: Set<UUID>,
    paths: NeuronPath[],
    filter?: (neuron: NeuronNode, synapse: Synapse) => boolean
  ): Promise<void> {
    const queue: Array<{
      id: UUID;
      depth: number;
      path: UUID[];
      synapses: Synapse[];
      weight: number;
    }> = [{ id: startId, depth: 0, path: [startId], synapses: [], weight: 0 }];

    visited.add(startId);

    while (queue.length > 0) {
      const { id, depth, path, synapses, weight } = queue.shift()!;

      if (depth >= maxDepth) {
        const neurons = await this.getNeuronsForPath(path);
        paths.push({ neurons, synapses, totalWeight: weight });
        continue;
      }

      const outgoing = await this.store.getOutgoingSynapses(id);
      let hasUnvisited = false;

      for (const synapse of outgoing) {
        if (visited.has(synapse.targetId)) continue;

        const target = await this.store.getNeuron(synapse.targetId);
        if (!target) continue;

        if (filter && !filter(target, synapse)) continue;

        visited.add(synapse.targetId);
        hasUnvisited = true;

        queue.push({
          id: synapse.targetId,
          depth: depth + 1,
          path: [...path, synapse.targetId],
          synapses: [...synapses, synapse],
          weight: weight + synapse.weight
        });
      }

      // Leaf node
      if (!hasUnvisited && depth > 0) {
        const neurons = await this.getNeuronsForPath(path);
        paths.push({ neurons, synapses, totalWeight: weight });
      }
    }
  }

  private async dfsTraverse(
    id: UUID,
    maxDepth: number,
    visited: Set<UUID>,
    paths: NeuronPath[],
    currentPath: { path: UUID[]; synapses: Synapse[]; weight: number },
    filter?: (neuron: NeuronNode, synapse: Synapse) => boolean
  ): Promise<void> {
    if (currentPath.path.length === 0) {
      currentPath = { path: [id], synapses: [], weight: 0 };
    }

    visited.add(id);

    if (currentPath.path.length > maxDepth) {
      const neurons = await this.getNeuronsForPath(currentPath.path);
      paths.push({
        neurons,
        synapses: currentPath.synapses,
        totalWeight: currentPath.weight
      });
      return;
    }

    const outgoing = await this.store.getOutgoingSynapses(id);
    let hasUnvisited = false;

    for (const synapse of outgoing) {
      if (visited.has(synapse.targetId)) continue;

      const target = await this.store.getNeuron(synapse.targetId);
      if (!target) continue;

      if (filter && !filter(target, synapse)) continue;

      hasUnvisited = true;

      await this.dfsTraverse(
        synapse.targetId,
        maxDepth,
        visited,
        paths,
        {
          path: [...currentPath.path, synapse.targetId],
          synapses: [...currentPath.synapses, synapse],
          weight: currentPath.weight + synapse.weight
        },
        filter
      );
    }

    // Leaf node
    if (!hasUnvisited && currentPath.path.length > 1) {
      const neurons = await this.getNeuronsForPath(currentPath.path);
      paths.push({
        neurons,
        synapses: currentPath.synapses,
        totalWeight: currentPath.weight
      });
    }
  }

  private async weightedTraverse(
    startId: UUID,
    maxDepth: number,
    visited: Set<UUID>,
    paths: NeuronPath[],
    filter?: (neuron: NeuronNode, synapse: Synapse) => boolean
  ): Promise<void> {
    // Binary heap-based priority queue for O(log n) operations
    type PQItem = {
      id: UUID;
      depth: number;
      path: UUID[];
      synapses: Synapse[];
      weight: number;
    };

    // Max-heap implementation (higher weight = higher priority)
    const heap: PQItem[] = [];

    const heapPush = (item: PQItem) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = Math.floor((i - 1) / 2);
        if (heap[parent].weight >= heap[i].weight) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    };

    const heapPop = (): PQItem | undefined => {
      if (heap.length === 0) return undefined;
      const result = heap[0];
      const last = heap.pop()!;
      if (heap.length > 0) {
        heap[0] = last;
        let i = 0;
        while (true) {
          const left = 2 * i + 1;
          const right = 2 * i + 2;
          let largest = i;
          if (left < heap.length && heap[left].weight > heap[largest].weight) largest = left;
          if (right < heap.length && heap[right].weight > heap[largest].weight) largest = right;
          if (largest === i) break;
          [heap[i], heap[largest]] = [heap[largest], heap[i]];
          i = largest;
        }
      }
      return result;
    };

    heapPush({ id: startId, depth: 0, path: [startId], synapses: [], weight: 0 });
    visited.add(startId);

    while (heap.length > 0) {
      const { id, depth, path, synapses, weight } = heapPop()!;

      if (depth >= maxDepth) {
        const neurons = await this.getNeuronsForPath(path);
        paths.push({ neurons, synapses, totalWeight: weight });
        continue;
      }

      const outgoing = await this.store.getOutgoingSynapses(id);
      let hasUnvisited = false;

      for (const synapse of outgoing) {
        if (visited.has(synapse.targetId)) continue;

        const target = await this.store.getNeuron(synapse.targetId);
        if (!target) continue;

        if (filter && !filter(target, synapse)) continue;

        visited.add(synapse.targetId);
        hasUnvisited = true;

        heapPush({
          id: synapse.targetId,
          depth: depth + 1,
          path: [...path, synapse.targetId],
          synapses: [...synapses, synapse],
          weight: weight + synapse.weight
        });
      }

      if (!hasUnvisited && depth > 0) {
        const neurons = await this.getNeuronsForPath(path);
        paths.push({ neurons, synapses, totalWeight: weight });
      }
    }
  }

  private async randomWalkTraverse(
    startId: UUID,
    maxSteps: number,
    visited: Set<UUID>,
    paths: NeuronPath[]
  ): Promise<void> {
    let currentId = startId;
    const path: UUID[] = [startId];
    const synapses: Synapse[] = [];
    let totalWeight = 0;

    visited.add(startId);

    for (let step = 0; step < maxSteps; step++) {
      const outgoing = await this.store.getOutgoingSynapses(currentId);
      if (outgoing.length === 0) break;

      // Weight-biased random selection — use only excitatory (positive-weight) synapses
      // INHIBITORY synapses have negative weights and would break the roulette algorithm
      const excitatory = outgoing.filter((syn: Synapse) => syn.weight > 0);
      if (excitatory.length === 0) break; // only inhibitory connections, nowhere to go

      const totalSynapseWeight = excitatory.reduce((s: number, syn: Synapse) => s + syn.weight, 0);
      let random = Math.random() * totalSynapseWeight;

      let selectedSynapse: Synapse | null = null;
      for (const synapse of excitatory) {
        random -= synapse.weight;
        if (random <= 0) {
          selectedSynapse = synapse;
          break;
        }
      }

      // Fallback to random selection if no synapse selected
      const finalSynapse: Synapse = selectedSynapse ?? outgoing[Math.floor(Math.random() * outgoing.length)];

      currentId = finalSynapse.targetId;
      path.push(currentId);
      synapses.push(finalSynapse);
      totalWeight += finalSynapse.weight;
      visited.add(currentId);
    }

    const neurons = await this.getNeuronsForPath(path);
    paths.push({ neurons, synapses, totalWeight });
  }

  private async getNeuronsForPath(path: UUID[]): Promise<NeuronNode[]> {
    const neurons: NeuronNode[] = [];
    for (const id of path) {
      const neuron = await this.store.getNeuron(id);
      if (neuron) neurons.push(neuron);
    }
    return neurons;
  }
}

/**
 * Create a NeuronGraphManager instance
 */
export function createNeuronGraphManager(
  options: NeuronGraphOptions
): NeuronGraphManager {
  return new NeuronGraphManager(options);
}
