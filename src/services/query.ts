/**
 * Query Service - Semantic search and retrieval
 * @module services/query
 */

import type {
  UUID,
  Embedding384,
  NeuronNode,
  SearchResult,
  Chunk,
  MerkleProof,
  IChunkStore,
  INeuronStore
} from '../types/index.js';
import { NeuronGraphManager } from '../core/neuron-graph.js';
import { MerkleEngine } from '../core/merkle-engine.js';
import { cosineSimilarity } from '../utils/similarity.js';
import { DeterministicEmbeddingProvider } from './embedding-provider.js';

/**
 * Query result with neuron and metadata
 */
export interface QueryResult {
  neuron: NeuronNode;
  score: number;
  content?: string;
  proof?: MerkleProof;
}

/**
 * Search options
 */
export interface SearchOptions {
  k?: number;
  ef?: number;
  threshold?: number;
  includeContent?: boolean;
  includeProof?: boolean;
  tags?: string[];
  sourceType?: string;
}

/**
 * Embedding provider interface
 */
export interface QueryEmbeddingProvider {
  embed(text: string): Promise<Embedding384>;
}

/**
 * Query Service for semantic search
 */
export class QueryService {
  private graphManager: NeuronGraphManager;
  private merkleEngine: MerkleEngine;
  private chunkStore: IChunkStore;
  private neuronStore: INeuronStore;
  private embeddingProvider: QueryEmbeddingProvider;

  constructor(
    graphManager: NeuronGraphManager,
    merkleEngine: MerkleEngine,
    chunkStore: IChunkStore,
    neuronStore: INeuronStore,
    embeddingProvider?: QueryEmbeddingProvider
  ) {
    this.graphManager = graphManager;
    this.merkleEngine = merkleEngine;
    this.chunkStore = chunkStore;
    this.neuronStore = neuronStore;
    this.embeddingProvider = embeddingProvider ?? new DeterministicEmbeddingProvider();
  }

  /**
   * Search by text query
   */
  async search(query: string, options: SearchOptions = {}): Promise<QueryResult[]> {
    const embedding = await this.embeddingProvider.embed(query);
    return this.searchByEmbedding(embedding, options);
  }

  /**
   * Search by embedding vector
   */
  async searchByEmbedding(
    embedding: Embedding384,
    options: SearchOptions = {}
  ): Promise<QueryResult[]> {
    const {
      k = 10,
      ef,
      threshold = 0,
      includeContent = false,
      includeProof = false,
      tags,
      sourceType
    } = options;

    // Get similar neurons from graph manager
    const similar = await this.graphManager.findSimilar(embedding, k * 2, ef);

    // Filter and transform results
    const results: QueryResult[] = [];

    for (const { neuron, score } of similar) {
      // Apply filters
      if (score < threshold) continue;
      if (tags && !tags.some(t => neuron.metadata.tags.includes(t))) continue;
      if (sourceType && neuron.metadata.sourceType !== sourceType) continue;

      const result: QueryResult = {
        neuron,
        score
      };

      // Include content if requested
      if (includeContent) {
        result.content = await this.getContent(neuron);
      }

      // Include proof if requested
      if (includeProof) {
        const proof = await this.generateProof(neuron, 0);
        if (proof) result.proof = proof;
      }

      results.push(result);

      if (results.length >= k) break;
    }

    return results;
  }

  /**
   * Search by neuron ID (find similar)
   */
  async searchSimilarTo(
    neuronId: UUID,
    options: SearchOptions = {}
  ): Promise<QueryResult[]> {
    const neuron = await this.graphManager.getNeuron(neuronId);
    if (!neuron) return [];

    return this.searchByEmbedding(neuron.embedding, {
      ...options,
      k: (options.k ?? 10) + 1 // Add 1 to account for self
    }).then(results => results.filter(r => r.neuron.id !== neuronId));
  }

  /**
   * Get neuron by ID
   */
  async getNeuron(id: UUID): Promise<NeuronNode | null> {
    return this.graphManager.getNeuron(id);
  }

  /**
   * Get neuron by Merkle root
   */
  async getNeuronByMerkleRoot(merkleRoot: string): Promise<NeuronNode | null> {
    return this.graphManager.getNeuronByMerkleRoot(merkleRoot);
  }

  /**
   * Get neuron content
   */
  async getContent(neuron: NeuronNode): Promise<string> {
    const chunks: Chunk[] = [];

    for (const hash of neuron.chunkHashes) {
      const chunk = await this.chunkStore.get(hash);
      if (chunk) {
        chunks.push(chunk);
      }
    }

    // Sort by index and merge
    chunks.sort((a, b) => a.index - b.index);
    const merged = Buffer.concat(chunks.map(c => c.data));

    return merged.toString('utf-8');
  }

  /**
   * Generate Merkle proof for a chunk
   */
  async generateProof(
    neuron: NeuronNode,
    chunkIndex: number
  ): Promise<MerkleProof | null> {
    if (chunkIndex < 0 || chunkIndex >= neuron.chunkHashes.length) {
      return null;
    }

    // Rebuild Merkle tree
    const tree = this.merkleEngine.buildTree(neuron.chunkHashes);

    // Generate proof
    return this.merkleEngine.generateProof(tree, chunkIndex);
  }

  /**
   * Compute similarity between two neurons
   */
  async computeSimilarity(neuronId1: UUID, neuronId2: UUID): Promise<number | null> {
    const neuron1 = await this.graphManager.getNeuron(neuronId1);
    const neuron2 = await this.graphManager.getNeuron(neuronId2);

    if (!neuron1 || !neuron2) return null;

    return cosineSimilarity(neuron1.embedding, neuron2.embedding);
  }

  /**
   * Get neurons by tags
   */
  async getNeuronsByTags(tags: string[]): Promise<NeuronNode[]> {
    const allIds = await this.neuronStore.getAllNeuronIds();
    const results: NeuronNode[] = [];

    for (const id of allIds) {
      const neuron = await this.neuronStore.getNeuron(id);
      if (neuron && tags.some(t => neuron.metadata.tags.includes(t))) {
        results.push(neuron);
      }
    }

    return results;
  }

  /**
   * Get neurons by source type
   */
  async getNeuronsBySourceType(sourceType: string): Promise<NeuronNode[]> {
    const allIds = await this.neuronStore.getAllNeuronIds();
    const results: NeuronNode[] = [];

    for (const id of allIds) {
      const neuron = await this.neuronStore.getNeuron(id);
      if (neuron && neuron.metadata.sourceType === sourceType) {
        results.push(neuron);
      }
    }

    return results;
  }

  /**
   * Get recently accessed neurons
   */
  async getRecentlyAccessed(limit: number = 10): Promise<NeuronNode[]> {
    const allIds = await this.neuronStore.getAllNeuronIds();
    const neurons: NeuronNode[] = [];

    for (const id of allIds) {
      const neuron = await this.neuronStore.getNeuron(id);
      if (neuron) neurons.push(neuron);
    }

    // Sort by last accessed
    neurons.sort((a, b) =>
      new Date(b.metadata.lastAccessed).getTime() -
      new Date(a.metadata.lastAccessed).getTime()
    );

    return neurons.slice(0, limit);
  }

  /**
   * Get most accessed neurons
   */
  async getMostAccessed(limit: number = 10): Promise<NeuronNode[]> {
    const allIds = await this.neuronStore.getAllNeuronIds();
    const neurons: NeuronNode[] = [];

    for (const id of allIds) {
      const neuron = await this.neuronStore.getNeuron(id);
      if (neuron) neurons.push(neuron);
    }

    // Sort by access count
    neurons.sort((a, b) => b.metadata.accessCount - a.metadata.accessCount);

    return neurons.slice(0, limit);
  }

  /**
   * Set embedding provider
   */
  setEmbeddingProvider(provider: QueryEmbeddingProvider): void {
    this.embeddingProvider = provider;
  }
}

/**
 * Create a QueryService instance
 */
export function createQueryService(
  graphManager: NeuronGraphManager,
  merkleEngine: MerkleEngine,
  chunkStore: IChunkStore,
  neuronStore: INeuronStore,
  embeddingProvider?: QueryEmbeddingProvider
): QueryService {
  return new QueryService(
    graphManager,
    merkleEngine,
    chunkStore,
    neuronStore,
    embeddingProvider
  );
}
