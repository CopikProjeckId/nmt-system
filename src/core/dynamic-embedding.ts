/**
 * Dynamic Embedding System - Infinite Dimension Expansion
 *
 * Based on Probabilistic Ontology Framework:
 * - Embeddings are not fixed at 384 dimensions
 * - New concepts can expand the embedding space
 * - Dimensions are semantic, not arbitrary
 *
 * @module core/dynamic-embedding
 */

import type { UUID } from '../types/index.js';
import { cosineSimilarity } from '../utils/similarity.js';

/**
 * Dynamic embedding that can grow
 */
export interface DynamicEmbedding {
  id: UUID;
  dimensions: Map<string, number>;  // dimension_name -> value
  baseDimension: number;            // Original fixed dimension count
  createdAt: string;
  expandedAt?: string;
}

/**
 * Dimension metadata
 */
export interface DimensionInfo {
  name: string;
  description: string;
  createdAt: string;
  sourceNeuronId?: UUID;
  semanticCategory: string;
  usageCount: number;
}

/**
 * Embedding expansion result
 */
export interface ExpansionResult {
  originalDimensions: number;
  newDimensions: number;
  addedDimensions: string[];
  reason: string;
}

/**
 * Dynamic Embedding Manager Options
 */
export interface DynamicEmbeddingOptions {
  baseDimension?: number;
  maxDimensions?: number;
  expansionThreshold?: number;
  enableAutoExpansion?: boolean;
}

/**
 * Dynamic Embedding Manager - Infinite Dimension Expansion
 *
 * Manages embeddings that can dynamically expand when new concepts
 * cannot be adequately represented in current dimensions. This enables
 * the system to grow its semantic space organically.
 *
 * Key Concepts:
 * - **Base Dimensions**: Initial 384 dimensions covering standard semantics
 * - **Dimension Expansion**: New dimensions added for novel concepts
 * - **Semantic Categories**: Dimensions organized by type (semantic, syntactic, etc.)
 * - **Auto-Expansion**: System automatically expands when similarity is too low
 *
 * @example
 * ```typescript
 * const manager = new DynamicEmbeddingManager({
 *   baseDimension: 384,
 *   maxDimensions: 10000,
 *   enableAutoExpansion: true
 * });
 *
 * // Create dynamic embedding from fixed array
 * const dynEmb = manager.createFromFixed('emb-1', fixedEmbedding);
 *
 * // Auto-expand for new concept
 * const expansion = manager.autoExpand(dynEmb, 'quantum computing applications');
 * if (expansion) {
 *   console.log(`Added ${expansion.addedDimensions.length} dimensions`);
 * }
 *
 * // Calculate similarity between dynamic embeddings
 * const sim = manager.similarity(dynEmbA, dynEmbB);
 *
 * // Get dimensions by category
 * const semanticDims = manager.getDimensionsByCategory('semantic');
 * ```
 *
 * @see {@link DynamicEmbedding} for embedding structure
 * @see {@link DimensionInfo} for dimension metadata
 */
export class DynamicEmbeddingManager {
  private baseDimension: number;
  private maxDimensions: number;
  private expansionThreshold: number;
  private autoExpansion: boolean;

  // Dimension registry
  private dimensionRegistry: Map<string, DimensionInfo> = new Map();
  private dimensionOrder: string[] = [];

  // Embedding storage
  private embeddings: Map<UUID, DynamicEmbedding> = new Map();

  // Semantic categories for dimension organization
  private semanticCategories: Map<string, Set<string>> = new Map();

  constructor(options: DynamicEmbeddingOptions = {}) {
    this.baseDimension = options.baseDimension ?? 384;
    this.maxDimensions = options.maxDimensions ?? 10000;
    this.expansionThreshold = options.expansionThreshold ?? 0.3;
    this.autoExpansion = options.enableAutoExpansion ?? true;

    // Initialize base dimensions
    this.initializeBaseDimensions();
  }

  /**
   * Create a dynamic embedding from a fixed-size array.
   *
   * Maps each element of the fixed array to a named dimension,
   * enabling future expansion while maintaining compatibility
   * with standard embedding operations.
   *
   * @param id - Unique identifier for the embedding
   * @param fixedEmbedding - Standard fixed-size Float32Array embedding
   * @returns New DynamicEmbedding with named dimensions
   *
   * @example
   * ```typescript
   * const fixed = new Float32Array(384).fill(0.1);
   * const dynamic = manager.createFromFixed('my-embedding', fixed);
   * console.log(`Dimensions: ${dynamic.dimensions.size}`);
   * ```
   */
  createFromFixed(id: UUID, fixedEmbedding: Float32Array): DynamicEmbedding {
    const dimensions = new Map<string, number>();

    // Map fixed dimensions to named dimensions
    for (let i = 0; i < Math.min(fixedEmbedding.length, this.baseDimension); i++) {
      const dimName = this.dimensionOrder[i] ?? `base_${i}`;
      dimensions.set(dimName, fixedEmbedding[i]);
    }

    const embedding: DynamicEmbedding = {
      id,
      dimensions,
      baseDimension: fixedEmbedding.length,
      createdAt: new Date().toISOString()
    };

    this.embeddings.set(id, embedding);
    return embedding;
  }

  /**
   * Convert dynamic embedding to fixed-size array.
   *
   * Projects the dynamic embedding back to a fixed-size array,
   * useful for compatibility with standard ML operations.
   *
   * @param embedding - The dynamic embedding to convert
   * @param targetSize - Optional target size (defaults to current dimension count)
   * @returns Fixed-size Float32Array embedding
   *
   * @example
   * ```typescript
   * const fixed = manager.toFixed(dynamicEmbedding, 384);
   * // Use with standard similarity functions
   * const sim = cosineSimilarity(fixed, otherFixed);
   * ```
   */
  toFixed(embedding: DynamicEmbedding, targetSize?: number): Float32Array {
    const size = targetSize ?? this.getCurrentDimensionCount();
    const result = new Float32Array(size);

    let idx = 0;
    for (const dimName of this.dimensionOrder) {
      if (idx >= size) break;
      result[idx] = embedding.dimensions.get(dimName) ?? 0;
      idx++;
    }

    return result;
  }

  /**
   * Expand embedding with new dimensions.
   *
   * Manually adds new dimensions to an embedding. Use this when
   * you need explicit control over dimension expansion. For
   * automatic expansion, use {@link autoExpand} instead.
   *
   * @param embedding - The embedding to expand
   * @param newDimensions - Map of dimension names to values
   * @param reason - Human-readable reason for expansion
   * @returns Expansion result with statistics
   *
   * @example
   * ```typescript
   * const result = manager.expandEmbedding(
   *   myEmbedding,
   *   new Map([['quantum_coherence', 0.8], ['superposition', 0.6]]),
   *   'Quantum computing concepts'
   * );
   * console.log(`Added: ${result.addedDimensions.join(', ')}`);
   * ```
   */
  expandEmbedding(
    embedding: DynamicEmbedding,
    newDimensions: Map<string, number>,
    reason: string
  ): ExpansionResult {
    const originalCount = embedding.dimensions.size;
    const addedDimensions: string[] = [];

    for (const [dimName, value] of newDimensions) {
      if (!embedding.dimensions.has(dimName)) {
        // Register new dimension if not exists
        if (!this.dimensionRegistry.has(dimName)) {
          this.registerDimension(dimName, {
            name: dimName,
            description: `Auto-expanded: ${reason}`,
            createdAt: new Date().toISOString(),
            sourceNeuronId: embedding.id,
            semanticCategory: this.inferCategory(dimName),
            usageCount: 0
          });
        }

        embedding.dimensions.set(dimName, value);
        addedDimensions.push(dimName);

        // Update usage count
        const info = this.dimensionRegistry.get(dimName);
        if (info) {
          info.usageCount++;
        }
      }
    }

    if (addedDimensions.length > 0) {
      embedding.expandedAt = new Date().toISOString();
    }

    return {
      originalDimensions: originalCount,
      newDimensions: embedding.dimensions.size,
      addedDimensions,
      reason
    };
  }

  /**
   * Check if embedding needs expansion for a concept
   */
  needsExpansion(
    embedding: DynamicEmbedding,
    conceptVector: Float32Array,
    similarityThreshold?: number
  ): boolean {
    const threshold = similarityThreshold ?? this.expansionThreshold;

    // Convert to fixed for comparison
    const fixed = this.toFixed(embedding, conceptVector.length);

    // Calculate similarity
    const similarity = cosineSimilarity(fixed, conceptVector);

    // If similarity is too low, current dimensions may be insufficient
    return similarity < threshold;
  }

  /**
   * Auto-expand embedding based on concept requirements.
   *
   * Automatically extracts semantic dimensions from a concept
   * description and adds them to the embedding. Respects the
   * maximum dimension limit.
   *
   * @param embedding - The embedding to expand
   * @param conceptDescription - Text describing the new concept
   * @param conceptVector - Optional vector representing the concept
   * @returns Expansion result, or null if disabled/at limit
   *
   * @example
   * ```typescript
   * const result = manager.autoExpand(
   *   embedding,
   *   'Machine learning optimization techniques including gradient descent and backpropagation'
   * );
   *
   * if (result) {
   *   console.log(`Now have ${result.newDimensions} dimensions`);
   * }
   * ```
   */
  autoExpand(
    embedding: DynamicEmbedding,
    conceptDescription: string,
    conceptVector?: Float32Array
  ): ExpansionResult | null {
    if (!this.autoExpansion) return null;

    // Check dimension limit
    if (this.getCurrentDimensionCount() >= this.maxDimensions) {
      return null;
    }

    // Extract semantic dimensions from concept
    const newDimensions = this.extractSemanticDimensions(conceptDescription, conceptVector);

    if (newDimensions.size === 0) {
      return null;
    }

    return this.expandEmbedding(
      embedding,
      newDimensions,
      `Auto-expansion for concept: ${conceptDescription.substring(0, 50)}`
    );
  }

  /**
   * Register a new dimension.
   *
   * Adds a new dimension to the global registry. Each dimension
   * has metadata including semantic category and usage tracking.
   *
   * @param name - Unique dimension name
   * @param info - Dimension metadata including category and description
   *
   * @example
   * ```typescript
   * manager.registerDimension('temporal_causality', {
   *   name: 'temporal_causality',
   *   description: 'Cause-effect relationships over time',
   *   createdAt: new Date().toISOString(),
   *   semanticCategory: 'causal',
   *   usageCount: 0
   * });
   * ```
   */
  registerDimension(name: string, info: DimensionInfo): void {
    if (!this.dimensionRegistry.has(name)) {
      this.dimensionRegistry.set(name, info);
      this.dimensionOrder.push(name);

      // Add to semantic category
      if (!this.semanticCategories.has(info.semanticCategory)) {
        this.semanticCategories.set(info.semanticCategory, new Set());
      }
      this.semanticCategories.get(info.semanticCategory)!.add(name);
    }
  }

  /**
   * Get dimensions by semantic category
   */
  getDimensionsByCategory(category: string): string[] {
    return Array.from(this.semanticCategories.get(category) ?? []);
  }

  /**
   * Calculate similarity between two dynamic embeddings.
   *
   * Computes cosine similarity over the union of all dimensions.
   * Missing dimensions in either embedding are treated as 0.
   *
   * @param a - First dynamic embedding
   * @param b - Second dynamic embedding
   * @returns Cosine similarity (-1 to 1)
   *
   * @example
   * ```typescript
   * const sim = manager.similarity(embeddingA, embeddingB);
   * console.log(`Similarity: ${(sim * 100).toFixed(1)}%`);
   * ```
   */
  similarity(a: DynamicEmbedding, b: DynamicEmbedding): number {
    // Get union of all dimensions
    const allDimensions = new Set([...a.dimensions.keys(), ...b.dimensions.keys()]);

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (const dim of allDimensions) {
      const valA = a.dimensions.get(dim) ?? 0;
      const valB = b.dimensions.get(dim) ?? 0;

      dotProduct += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    if (magnitude === 0) return 0;

    return dotProduct / magnitude;
  }

  /**
   * Project embedding to a subspace of specific dimensions
   */
  project(embedding: DynamicEmbedding, dimensionNames: string[]): Map<string, number> {
    const projected = new Map<string, number>();

    for (const dimName of dimensionNames) {
      if (embedding.dimensions.has(dimName)) {
        projected.set(dimName, embedding.dimensions.get(dimName)!);
      }
    }

    return projected;
  }

  /**
   * Get the current total dimension count
   */
  getCurrentDimensionCount(): number {
    return this.dimensionOrder.length;
  }

  /**
   * Get embedding by ID
   */
  getEmbedding(id: UUID): DynamicEmbedding | undefined {
    return this.embeddings.get(id);
  }

  /**
   * Get statistics
   */
  getStats(): {
    totalDimensions: number;
    baseDimensions: number;
    expandedDimensions: number;
    categories: number;
    embeddings: number;
  } {
    return {
      totalDimensions: this.dimensionOrder.length,
      baseDimensions: this.baseDimension,
      expandedDimensions: Math.max(0, this.dimensionOrder.length - this.baseDimension),
      categories: this.semanticCategories.size,
      embeddings: this.embeddings.size
    };
  }

  /**
   * Serialize dimension registry for persistence.
   *
   * Converts the dimension registry, order, and categories to
   * a JSON-serializable format.
   *
   * @returns Serialized dimension state
   * @see {@link loadDimensions} for restoring state
   */
  serializeDimensions(): object {
    return {
      order: this.dimensionOrder,
      registry: Object.fromEntries(this.dimensionRegistry),
      categories: Object.fromEntries(
        Array.from(this.semanticCategories.entries()).map(
          ([k, v]) => [k, Array.from(v)]
        )
      )
    };
  }

  /**
   * Load dimension registry from serialized data
   */
  loadDimensions(data: {
    order: string[];
    registry: Record<string, DimensionInfo>;
    categories: Record<string, string[]>;
  }): void {
    this.dimensionOrder = data.order;
    this.dimensionRegistry = new Map(Object.entries(data.registry));
    this.semanticCategories = new Map(
      Object.entries(data.categories).map(
        ([k, v]) => [k, new Set(v)]
      )
    );
  }

  /**
   * Serialize all embeddings for persistence.
   *
   * Converts all stored embeddings to a JSON-serializable format.
   * Dimension Maps are converted to plain objects.
   *
   * @returns Serialized embeddings array
   * @see {@link loadEmbeddings} for restoring state
   */
  serializeEmbeddings(): object {
    const embeddingsArray = [];
    for (const [id, embedding] of this.embeddings) {
      embeddingsArray.push({
        id,
        dimensions: Object.fromEntries(embedding.dimensions),
        baseDimension: embedding.baseDimension,
        createdAt: embedding.createdAt,
        expandedAt: embedding.expandedAt
      });
    }
    return { embeddings: embeddingsArray };
  }

  /**
   * Load embeddings from serialized data
   */
  loadEmbeddings(data: {
    embeddings: Array<{
      id: string;
      dimensions: Record<string, number>;
      baseDimension: number;
      createdAt: string;
      expandedAt?: string;
    }>;
  }): void {
    this.embeddings.clear();
    for (const embData of data.embeddings ?? []) {
      this.embeddings.set(embData.id, {
        id: embData.id,
        dimensions: new Map(Object.entries(embData.dimensions)),
        baseDimension: embData.baseDimension,
        createdAt: embData.createdAt,
        expandedAt: embData.expandedAt
      });
    }
  }

  /**
   * Serialize complete state (dimensions + embeddings).
   *
   * Convenience method that serializes both the dimension registry
   * and all stored embeddings in a single call.
   *
   * @returns Complete serialized state
   * @see {@link loadAll} for restoring state
   */
  serializeAll(): object {
    return {
      dimensions: this.serializeDimensions(),
      embeddings: this.serializeEmbeddings()
    };
  }

  /**
   * Load complete state (dimensions + embeddings)
   */
  loadAll(data: {
    dimensions: {
      order: string[];
      registry: Record<string, DimensionInfo>;
      categories: Record<string, string[]>;
    };
    embeddings: {
      embeddings: Array<any>;
    };
  }): void {
    if (data.dimensions) {
      this.loadDimensions(data.dimensions);
    }
    if (data.embeddings) {
      this.loadEmbeddings(data.embeddings);
    }
  }

  // ==================== Private Methods ====================

  private initializeBaseDimensions(): void {
    // Initialize semantic base dimensions
    const baseCategories = [
      { category: 'semantic', count: 128, prefix: 'sem' },
      { category: 'syntactic', count: 64, prefix: 'syn' },
      { category: 'contextual', count: 96, prefix: 'ctx' },
      { category: 'relational', count: 64, prefix: 'rel' },
      { category: 'abstract', count: 32, prefix: 'abs' }
    ];

    let dimIndex = 0;
    for (const { category, count, prefix } of baseCategories) {
      for (let i = 0; i < count && dimIndex < this.baseDimension; i++) {
        const dimName = `${prefix}_${i}`;
        this.registerDimension(dimName, {
          name: dimName,
          description: `Base ${category} dimension ${i}`,
          createdAt: new Date().toISOString(),
          semanticCategory: category,
          usageCount: 0
        });
        dimIndex++;
      }
    }
  }

  private inferCategory(dimensionName: string): string {
    // Infer semantic category from dimension name
    const prefixes: Record<string, string> = {
      'sem': 'semantic',
      'syn': 'syntactic',
      'ctx': 'contextual',
      'rel': 'relational',
      'abs': 'abstract',
      'temp': 'temporal',
      'cause': 'causal',
      'goal': 'goal-oriented',
      'prob': 'probabilistic'
    };

    for (const [prefix, category] of Object.entries(prefixes)) {
      if (dimensionName.startsWith(prefix)) {
        return category;
      }
    }

    return 'extended';
  }

  private extractSemanticDimensions(
    conceptDescription: string,
    conceptVector?: Float32Array
  ): Map<string, number> {
    const newDimensions = new Map<string, number>();

    // Extract keywords from description
    const keywords = this.extractKeywords(conceptDescription);

    // Create dimensions for significant keywords
    for (const keyword of keywords) {
      const dimName = `ext_${keyword.toLowerCase().replace(/\s+/g, '_')}`;

      if (!this.dimensionRegistry.has(dimName)) {
        // Calculate initial value based on keyword importance
        const value = this.calculateKeywordImportance(keyword, conceptDescription);
        newDimensions.set(dimName, value);
      }
    }

    return newDimensions;
  }

  private extractKeywords(text: string): string[] {
    // Simple keyword extraction
    const words = text
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2);

    // Remove common words
    const stopwords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
      'would', 'could', 'should', 'may', 'might', 'must', 'can',
      '이', '가', '은', '는', '을', '를', '의', '에', '에서', '와', '과'
    ]);

    return words.filter(w => !stopwords.has(w)).slice(0, 10);
  }

  private calculateKeywordImportance(keyword: string, context: string): number {
    // TF-IDF-like importance calculation
    const frequency = (context.match(new RegExp(keyword, 'gi')) || []).length;
    const normalizedFreq = Math.min(1, frequency / 10);

    // Keyword length bonus (longer words tend to be more specific)
    const lengthBonus = Math.min(1, keyword.length / 10);

    return (normalizedFreq * 0.7 + lengthBonus * 0.3);
  }
}

/**
 * Create a DynamicEmbeddingManager instance
 */
export function createDynamicEmbeddingManager(
  options?: DynamicEmbeddingOptions
): DynamicEmbeddingManager {
  return new DynamicEmbeddingManager(options);
}
