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
import { cosineSimilarity, normalize } from '../utils/similarity.js';
import { DeterministicEmbeddingProvider } from './embedding-provider.js';
import { SerialTaskQueue } from '../utils/serial-queue.js';
import { servicesLogger } from '../utils/logger.js';

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

// ── Working Memory ────────────────────────────────────────────────────────────
// Miller's Law: 7 ± 2 items in working memory at a time.
// Stores the most recently accessed neuron IDs (LRU order, newest last).
const WORKING_MEMORY_CAPACITY = 7;

/**
 * Query Service for semantic search
 */
export class QueryService {
  private graphManager: NeuronGraphManager;
  private merkleEngine: MerkleEngine;
  private chunkStore: IChunkStore;
  private neuronStore: INeuronStore;
  private embeddingProvider: QueryEmbeddingProvider;

  // ── Serial queue for Hebbian learning tasks (read-modify-write on synapses) ──
  private learningQueue = new SerialTaskQueue();

  // ── Working Memory (Miller's Law: 7 slots, LRU) ───────────────────────────
  private workingMemory: UUID[] = [];

  // ── Episodic buffer: groups of neurons per search episode ─────────────────
  private episodeBuffer: UUID[][] = [];
  private readonly MAX_EPISODES = 10;

  // ── Neuromodulation: dopamine-analog signal (0–1) ─────────────────────────
  // Rises on positive feedback, decays each search. Amplifies learning rate.
  // η_effective = η_base * (1 + dopamine * 0.5)
  private dopamineLevel: number = 0.1; // baseline (floor); rises on positive feedback
  private readonly DOPAMINE_DECAY = 0.9;  // per search query
  private readonly DOPAMINE_RISE  = 0.3;  // per positive feedback
  private readonly DOPAMINE_DROP  = 0.15; // per negative feedback

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

  // ── Working Memory API ────────────────────────────────────────────────────

  /** Current working memory contents (newest last) */
  getWorkingMemory(): UUID[] {
    return [...this.workingMemory];
  }

  /** Clear working memory (e.g., on topic change) */
  clearWorkingMemory(): void {
    this.workingMemory = [];
    this.episodeBuffer = [];
  }

  /** Current dopamine level (0–1) */
  getDopamineLevel(): number {
    return this.dopamineLevel;
  }

  /** Update working memory with newly accessed neurons (LRU eviction) */
  private updateWorkingMemory(neuronIds: UUID[]): void {
    for (const id of neuronIds) {
      // Remove if already present (move-to-end LRU)
      const idx = this.workingMemory.indexOf(id);
      if (idx !== -1) this.workingMemory.splice(idx, 1);
      this.workingMemory.push(id);
    }
    // Evict oldest if over capacity
    while (this.workingMemory.length > WORKING_MEMORY_CAPACITY) {
      this.workingMemory.shift();
    }
  }

  /** Compute max synapse weight from working memory to a candidate neuron */
  private async workingMemoryBoost(neuronId: UUID): Promise<number> {
    if (this.workingMemory.length === 0) return 0;
    const wmSet = new Set(this.workingMemory);
    const incoming = await this.neuronStore.getIncomingSynapses(neuronId);
    let max = 0;
    for (const s of incoming) {
      if (s.type !== 'INHIBITORY' && wmSet.has(s.sourceId) && s.weight > max) {
        max = s.weight;
      }
    }
    // Also check outgoing from working memory to this neuron
    const outgoing = await this.neuronStore.getOutgoingSynapses(neuronId);
    for (const s of outgoing) {
      if (s.type !== 'INHIBITORY' && wmSet.has(s.targetId) && s.weight > max) {
        max = s.weight;
      }
    }
    return max;
  }

  /**
   * Compute a simple TF-normalized keyword overlap score between query and content.
   * Returns a value in [0, 1] where 1 means all query terms appear frequently.
   */
  private computeKeywordScore(query: string, content: string): number {
    const stopWords = new Set([
      'the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
      'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
      'this', 'that', 'these', 'those', 'it', 'its', 'with', 'from', 'by',
      'as', 'not', 'but', 'also', 'more', 'than', 'such', 'which', 'can',
    ]);

    // Detect if query contains CJK characters (Korean, Chinese, Japanese)
    const hasCJK = /[\u3000-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(query);

    const normalize = hasCJK
      // For CJK: preserve Korean/CJK characters, lowercase Latin
      ? (text: string) => text.toLowerCase().replace(/[^\uac00-\ud7af\u3040-\u30ff\u4e00-\u9fff\w\s]/g, ' ')
      // For Latin: keep alphanumeric only
      : (text: string) => text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');

    const tokenize = (text: string) =>
      normalize(text).split(/\s+/).filter(w => w.length > 1 && !stopWords.has(w));

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return 0;

    const contentLower = normalize(content);
    const contentWords = contentLower.split(/\s+/);
    const contentLength = Math.max(contentWords.length, 1);

    // Compute TF for each query term in content
    let totalScore = 0;
    for (const term of queryTerms) {
      // Count occurrences with simple string matching
      let count = 0;
      let idx = contentLower.indexOf(term);
      while (idx !== -1) {
        count++;
        idx = contentLower.indexOf(term, idx + 1);
      }
      // TF with saturation (BM25-inspired)
      const k1 = 1.5;
      const tf = (count * (k1 + 1)) / (count + k1);
      // Binary presence boost: any term presence counts
      totalScore += count > 0 ? (0.5 + 0.5 * tf / (k1 + 1)) : 0;
    }

    return Math.min(1.0, totalScore / queryTerms.length);
  }

  /**
   * Search by text query with optional hybrid keyword reranking
   */
  async search(query: string, options: SearchOptions = {}): Promise<QueryResult[]> {
    const embedding = await this.embeddingProvider.embed(query);
    return this.searchByEmbedding(embedding, options, query);
  }

  /**
   * Search by embedding vector with optional hybrid reranking.
   *
   * Pipeline:
   *   1. Pattern completion (Hopfield refinement) — if index has >1 node
   *   2. HNSW semantic search
   *   3. BM25 keyword hybrid reranking
   *   4. Synapse-weight boost (Hebbian signal)
   *   5. Inhibitory penalty
   *   6. Working memory context boost
   *   7. Fire-and-forget: Hebbian reinforce + inhibit + episode encode
   *   8. Update working memory + decay dopamine
   */
  async searchByEmbedding(
    embedding: Embedding384,
    options: SearchOptions = {},
    queryText?: string
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

    // ── Step 0: Pattern Completion (Hopfield iteration) ───────────────────────
    // Refines the query embedding toward the nearest memory cluster.
    // Skipped when the index is empty (no neurons to converge toward).
    const { refined: refinedEmbedding } = await this.graphManager.patternComplete(
      embedding,
      k * 2,   // candidates per iteration
      3,       // iterations
      0.3      // alpha: retain 30% of original query, pull 70% toward memories
    );

    // Retrieve candidates for reranking
    const candidateCount = k * 2;
    const similar = await this.graphManager.findSimilar(refinedEmbedding, candidateCount, ef);

    // Gather candidates with optional keyword reranking
    const candidates: Array<{ neuron: NeuronNode; semanticScore: number; hybridScore: number }> = [];

    for (const { neuron, score } of similar) {
      // Apply filters
      if (score < threshold) continue;
      if (tags && !tags.some(t => neuron.metadata.tags.includes(t))) continue;
      if (sourceType && neuron.metadata.sourceType !== sourceType) continue;

      let hybridScore = score;

      // Hybrid reranking: combine semantic and keyword scores if query text provided
      if (queryText) {
        const content = await this.getContent(neuron);
        const keywordScore = this.computeKeywordScore(queryText, content);

        // Adaptive weighting: longer queries get more keyword weight (more specific)
        // Short queries (1-3 words): 85% semantic, 15% keyword
        // Medium queries (4-7 words): 75% semantic, 25% keyword
        // Long queries (8+ words): 65% semantic, 35% keyword
        const queryWordCount = queryText.trim().split(/\s+/).length;
        const keywordWeight = queryWordCount <= 3 ? 0.15 : queryWordCount <= 7 ? 0.25 : 0.35;
        const semanticWeight = 1 - keywordWeight;

        hybridScore = semanticWeight * score + keywordWeight * keywordScore;
      }

      candidates.push({ neuron, semanticScore: score, hybridScore });
    }

    // Re-sort by hybrid score and take top k
    candidates.sort((a, b) => b.hybridScore - a.hybridScore);
    const topCandidates = candidates.slice(0, k);

    // ── Synapse-weight boost (Hebbian reinforcement signal) ───────────────────
    // For each top candidate, look up the maximum synapse weight connecting it to
    // any of the other top candidates. A neuron that is strongly linked to its
    // co-retrieved peers gets a small score boost (max +10%), promoting
    // well-connected "hub" neurons that experience co-activation.
    //
    // Boost factor 0.10: keeps semantic score dominant while rewarding connectivity.
    const SYNAPSE_BOOST_FACTOR  = 0.10;
    // Inhibitory penalty factor 0.08: penalizes neurons suppressed by higher-ranked peers.
    // Lower than boost factor so inhibition doesn't override semantic relevance prematurely.
    const SYNAPSE_INHIBIT_FACTOR = 0.08;

    const peerIdSets = topCandidates.map(
      (_, idx) => new Set(topCandidates.filter((__, jdx) => jdx !== idx).map(c => c.neuron.id))
    );

    // ── Working memory boost factor (context continuity) ─────────────────────
    // Working memory boost: 0.15 — stronger than synapse boost (0.10) because
    // continuity with the current session context is highly informative.
    const WORKING_MEMORY_BOOST = 0.15;

    const boostedCandidates = await Promise.all(
      topCandidates.map(async ({ neuron, semanticScore, hybridScore }, idx) => {
        const [maxSynapseWeight, maxInhibitory, wmBoost] = await Promise.all([
          this.graphManager.maxCoActivationWeight(neuron.id, peerIdSets[idx]),
          this.graphManager.maxInhibitoryWeight(neuron.id, peerIdSets[idx]),
          this.workingMemoryBoost(neuron.id),
        ]);
        const boostedScore =
          hybridScore
          + SYNAPSE_BOOST_FACTOR   * maxSynapseWeight
          - SYNAPSE_INHIBIT_FACTOR * maxInhibitory
          + WORKING_MEMORY_BOOST   * wmBoost;
        return { neuron, semanticScore, hybridScore: boostedScore };
      })
    );

    // Re-sort after all adjustments
    boostedCandidates.sort((a, b) => b.hybridScore - a.hybridScore);
    const topIds = boostedCandidates.map(c => c.neuron.id);

    // ── Async learning: Hebbian + inhibition + episode encoding ──────────────
    // Guard: skip if fewer than 2 results (all three functions require length >= 2).
    // Tasks run serially to prevent lost-update on shared synapse records.
    if (topIds.length >= 2) {
      this.learningQueue.enqueueFireAndLog(
        () => this.graphManager.reinforceCoActivation(topIds),
        servicesLogger,
        'reinforceCoActivation'
      );
      this.learningQueue.enqueueFireAndLog(
        () => this.graphManager.inhibitCoActivation(topIds),
        servicesLogger,
        'inhibitCoActivation'
      );
      this.learningQueue.enqueueFireAndLog(
        () => this.graphManager.encodeEpisode(topIds),
        servicesLogger,
        'encodeEpisode'
      );
    }

    // ── Update working memory (LRU) ───────────────────────────────────────────
    this.updateWorkingMemory(topIds);

    // ── Episodic buffer: record this search episode ───────────────────────────
    if (topIds.length > 0) {
      this.episodeBuffer.push(topIds.slice());
      if (this.episodeBuffer.length > this.MAX_EPISODES) {
        this.episodeBuffer.shift(); // evict oldest episode
      }
    }

    // ── Dopamine decay (neuromodulation) ──────────────────────────────────────
    // Each search query slightly lowers the dopamine signal.
    // Floor at 0.1 so long sessions retain baseline learning amplification.
    this.dopamineLevel = Math.max(0.1, this.dopamineLevel * this.DOPAMINE_DECAY);

    // Build final results
    const results: QueryResult[] = [];
    for (const { neuron, hybridScore } of boostedCandidates) {
      const result: QueryResult = {
        neuron,
        score: hybridScore
      };

      if (includeContent) {
        result.content = await this.getContent(neuron);
      }
      if (includeProof) {
        const proof = await this.generateProof(neuron, 0);
        if (proof) result.proof = proof;
      }

      results.push(result);
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

  /**
   * Online embedding learning — adjust a neuron's embedding vector based on
   * user relevance feedback.
   *
   * Biological analogy: Long-Term Potentiation (LTP) / Long-Term Depression (LTD).
   * Positive feedback moves the neuron toward the query, negative moves it away.
   *
   * Formula: new_emb = L2_normalize(emb + α * direction * (query_emb - emb))
   *   direction = +1 for relevant, -1 for irrelevant
   *   α (learning rate) = 0.01  (small step — prevents catastrophic forgetting)
   *
   * @param neuronId  Target neuron to adjust
   * @param query     The query text that elicited the feedback
   * @param relevant  true → neuron should rank higher for this query
   *                  false → neuron should rank lower
   */
  async recordFeedback(
    neuronId: UUID,
    query: string,
    relevant: boolean
  ): Promise<{ neuronId: UUID; embeddingDrift: number; feedbackCount: number; dopamineLevel: number }> {
    // Neuromodulation: dopamine amplifies learning rate.
    // η_eff = α_base * (1 + dopamine * 0.5)
    // e.g. dopamine=0.8 → η_eff = 0.01 * 1.4 = 0.014
    const ALPHA = 0.01 * (1 + this.dopamineLevel * 0.5);

    const neuron = await this.neuronStore.getNeuron(neuronId);
    if (!neuron) throw new Error(`Neuron ${neuronId} not found`);

    const queryEmbedding = await this.embeddingProvider.embed(query);
    const direction = relevant ? 1 : -1;

    // Compute updated embedding: emb + α * direction * (query - emb)
    const updated = new Float32Array(384);
    for (let i = 0; i < 384; i++) {
      updated[i] = neuron.embedding[i] + ALPHA * direction * (queryEmbedding[i] - neuron.embedding[i]);
    }
    const newEmbedding = normalize(updated);

    // Measure how far the embedding has drifted from original
    const drift = Math.sqrt(
      Array.from(newEmbedding).reduce((sum, v, i) => sum + (v - neuron.embedding[i]) ** 2, 0)
    );

    const feedbackCount = (neuron.metadata.feedbackCount ?? 0) + 1;
    const embeddingDrift = (neuron.metadata.embeddingDrift ?? 0) + drift;

    // Update embedding in HNSW index + store
    await this.graphManager.updateNeuronEmbedding(neuronId, newEmbedding);

    // Record feedback metadata
    await this.neuronStore.updateNeuron(neuronId, {
      metadata: {
        ...neuron.metadata,
        feedbackCount,
        embeddingDrift,
        updatedAt: new Date().toISOString(),
      },
    });

    // ── Neuromodulation: adjust dopamine level ────────────────────────────────
    if (relevant) {
      // Positive feedback → dopamine rises (reward signal)
      this.dopamineLevel = Math.min(1.0, this.dopamineLevel + this.DOPAMINE_RISE);
    } else {
      // Negative feedback → dopamine drops slightly (prediction error)
      this.dopamineLevel = Math.max(0.0, this.dopamineLevel - this.DOPAMINE_DROP);
    }

    return {
      neuronId,
      embeddingDrift: drift,
      feedbackCount,
      dopamineLevel: this.dopamineLevel,
    };
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
