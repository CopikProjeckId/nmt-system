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
  INeuronStore
} from '../types/index.js';
import { HNSWIndex } from './hnsw-index.js';
import { cosineSimilarity } from '../utils/similarity.js';

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
      tags: input.tags
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

      // Weight-biased random selection
      const totalSynapseWeight = outgoing.reduce((s: number, syn: Synapse) => s + syn.weight, 0);
      let random = Math.random() * totalSynapseWeight;

      let selectedSynapse: Synapse | null = null;
      for (const synapse of outgoing) {
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
