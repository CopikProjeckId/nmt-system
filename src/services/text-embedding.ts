/**
 * Text Embedding Service
 *
 * Provides multiple embedding strategies:
 * 1. Xenova transformers (local neural network) - high quality
 * 2. External API (OpenAI, Cohere, etc.) - most accurate
 * 3. TF-IDF + SVD - local, no external dependencies
 * 4. Semantic hash - fast fallback
 *
 * @module services/text-embedding
 */

import type { Embedding384 } from '../types/index.js';
import { getXenovaProvider, getDeterministicProvider, type IEmbeddingProvider } from './embedding-provider.js';

/**
 * Embedding provider configuration
 */
export interface EmbeddingProviderConfig {
  type: 'xenova' | 'openai' | 'cohere' | 'local' | 'hybrid';
  apiKey?: string;
  modelId?: string;
  baseUrl?: string;
  dimension?: number;
}

/**
 * Embedding request
 */
export interface EmbeddingRequest {
  text: string;
  contextEmbedding?: Embedding384;
  metadata?: Record<string, unknown>;
}

/**
 * Embedding response
 */
export interface EmbeddingResponse {
  embedding: Embedding384;
  provider: string;
  model?: string;
  tokenCount?: number;
  cached?: boolean;
}

/**
 * Term frequency record
 */
interface TermFrequency {
  term: string;
  tf: number;
  idf: number;
  tfidf: number;
}

/**
 * Text Embedding Service
 *
 * Generates semantic embeddings for text using multiple strategies.
 */
export class TextEmbeddingService {
  private config: EmbeddingProviderConfig;
  private vocabulary: Map<string, number> = new Map();
  private idfValues: Map<string, number> = new Map();
  private documentCount: number = 0;
  private embeddingDimension: number;

  // Caching
  private cache: Map<string, EmbeddingResponse> = new Map();
  private maxCacheSize: number = 10000;

  // Word vectors (lightweight semantic representation)
  private wordVectors: Map<string, Float32Array> = new Map();

  constructor(config: Partial<EmbeddingProviderConfig> = {}) {
    this.config = {
      type: config.type ?? 'local',
      apiKey: config.apiKey,
      modelId: config.modelId,
      baseUrl: config.baseUrl,
      dimension: config.dimension ?? 384
    };
    this.embeddingDimension = this.config.dimension!;

    // Initialize with common word vectors
    this.initializeWordVectors();
  }

  /**
   * Generate embedding for text
   */
  async embed(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const cacheKey = this.getCacheKey(request.text);

    // Check cache
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      return { ...cached, cached: true };
    }

    let response: EmbeddingResponse;

    switch (this.config.type) {
      case 'xenova':
        response = await this.embedWithXenova(request);
        break;
      case 'openai':
        response = await this.embedWithOpenAI(request);
        break;
      case 'cohere':
        response = await this.embedWithCohere(request);
        break;
      case 'hybrid':
        response = await this.embedHybrid(request);
        break;
      case 'local':
      default:
        response = await this.embedLocal(request);
        break;
    }

    // Cache result
    this.cacheEmbedding(cacheKey, response);

    return response;
  }

  /**
   * Xenova transformers embedding (local neural network)
   */
  private async embedWithXenova(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    try {
      const provider = getXenovaProvider();
      await provider.init();
      const embedding = await provider.embed(request.text);

      return {
        embedding,
        provider: 'xenova',
        model: 'all-MiniLM-L6-v2',
        tokenCount: request.text.split(/\s+/).length
      };
    } catch (error) {
      // Fallback to local if Xenova fails
      console.warn('Xenova embedding failed, falling back to local:', error);
      return this.embedLocal(request);
    }
  }

  /**
   * Batch embed multiple texts
   */
  async embedBatch(texts: string[]): Promise<EmbeddingResponse[]> {
    // For API providers, batch requests are more efficient
    if (this.config.type === 'openai' || this.config.type === 'cohere') {
      return this.batchEmbedAPI(texts);
    }

    // For local, process in parallel
    return Promise.all(texts.map(text => this.embed({ text })));
  }

  /**
   * Update vocabulary with new documents (for TF-IDF)
   */
  updateVocabulary(documents: string[]): void {
    const termDocFreq = new Map<string, number>();

    for (const doc of documents) {
      const terms = this.tokenize(doc);
      const uniqueTerms = new Set(terms);

      for (const term of uniqueTerms) {
        termDocFreq.set(term, (termDocFreq.get(term) ?? 0) + 1);

        if (!this.vocabulary.has(term)) {
          this.vocabulary.set(term, this.vocabulary.size);
        }
      }
    }

    this.documentCount += documents.length;

    // Update IDF values
    for (const [term, df] of termDocFreq) {
      const idf = Math.log((this.documentCount + 1) / (df + 1)) + 1;
      this.idfValues.set(term, idf);
    }
  }

  /**
   * Local embedding using TF-IDF + semantic projection
   */
  private async embedLocal(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const text = request.text;
    const tokens = this.tokenize(text);

    // Calculate TF-IDF weights
    const tfidf = this.calculateTFIDF(tokens);

    // Build embedding using multiple strategies
    const embedding = new Float32Array(this.embeddingDimension);

    // Strategy 1: Weighted word vector average (50% weight)
    const wordVectorEmbed = this.weightedWordVectorAverage(tokens, tfidf);
    for (let i = 0; i < this.embeddingDimension; i++) {
      embedding[i] += wordVectorEmbed[i] * 0.5;
    }

    // Strategy 2: Character n-gram hash (25% weight)
    const ngramEmbed = this.characterNgramEmbedding(text);
    for (let i = 0; i < this.embeddingDimension; i++) {
      embedding[i] += ngramEmbed[i] * 0.25;
    }

    // Strategy 3: Positional encoding (15% weight)
    const posEmbed = this.positionalEncoding(tokens);
    for (let i = 0; i < this.embeddingDimension; i++) {
      embedding[i] += posEmbed[i] * 0.15;
    }

    // Strategy 4: Context blending (10% weight if available)
    if (request.contextEmbedding) {
      for (let i = 0; i < this.embeddingDimension; i++) {
        embedding[i] += request.contextEmbedding[i] * 0.1;
      }
    } else {
      // Add semantic category encoding instead
      const categoryEmbed = this.semanticCategoryEncoding(text);
      for (let i = 0; i < this.embeddingDimension; i++) {
        embedding[i] += categoryEmbed[i] * 0.1;
      }
    }

    // L2 normalize
    this.normalize(embedding);

    return {
      embedding,
      provider: 'local',
      model: 'tfidf-semantic',
      tokenCount: tokens.length
    };
  }

  /**
   * Hybrid embedding: try best available, fallback to local
   *
   * Priority:
   * 1. OpenAI API (if apiKey configured)
   * 2. Xenova transformers (local neural network)
   * 3. TF-IDF + semantic analysis (pure local)
   */
  private async embedHybrid(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    // Try API first if configured
    if (this.config.apiKey) {
      try {
        return await this.embedWithOpenAI(request);
      } catch {
        // Continue to fallbacks
      }
    }

    // Try Xenova neural network
    try {
      return await this.embedWithXenova(request);
    } catch {
      // Continue to fallbacks
    }

    // Final fallback: local TF-IDF
    return this.embedLocal(request);
  }

  /**
   * OpenAI API embedding
   */
  private async embedWithOpenAI(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const response = await fetch(this.config.baseUrl ?? 'https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.modelId ?? 'text-embedding-3-small',
        input: request.text,
        dimensions: this.embeddingDimension
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.statusText}`);
    }

    const data = await response.json() as {
      data: Array<{ embedding: number[] }>;
      usage: { total_tokens: number };
    };

    return {
      embedding: new Float32Array(data.data[0].embedding),
      provider: 'openai',
      model: this.config.modelId ?? 'text-embedding-3-small',
      tokenCount: data.usage.total_tokens
    };
  }

  /**
   * Cohere API embedding
   */
  private async embedWithCohere(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    if (!this.config.apiKey) {
      throw new Error('Cohere API key not configured');
    }

    const response = await fetch(this.config.baseUrl ?? 'https://api.cohere.ai/v1/embed', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.config.modelId ?? 'embed-english-v3.0',
        texts: [request.text],
        input_type: 'search_document'
      })
    });

    if (!response.ok) {
      throw new Error(`Cohere API error: ${response.statusText}`);
    }

    const data = await response.json() as {
      embeddings: number[][];
      meta: { api_version: { version: string } };
    };

    // Resize if needed
    let embedding: Embedding384 = new Float32Array(data.embeddings[0]) as Embedding384;
    if (embedding.length !== this.embeddingDimension) {
      embedding = this.resizeEmbedding(embedding, this.embeddingDimension) as Embedding384;
    }

    return {
      embedding,
      provider: 'cohere',
      model: this.config.modelId ?? 'embed-english-v3.0'
    };
  }

  /**
   * Batch API embedding - sends texts in a single API request where possible
   */
  private async batchEmbedAPI(texts: string[]): Promise<EmbeddingResponse[]> {
    if (texts.length === 0) return [];

    // OpenAI supports batch embedding natively
    if (this.config.type === 'openai' && this.config.apiKey) {
      const response = await fetch(this.config.baseUrl ?? 'https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.modelId ?? 'text-embedding-3-small',
          input: texts,
          dimensions: this.embeddingDimension
        })
      });

      if (!response.ok) {
        throw new Error(`OpenAI batch API error: ${response.statusText}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>;
        usage: { total_tokens: number };
      };

      // Sort by index to maintain input order
      const sorted = data.data.sort((a, b) => a.index - b.index);
      const tokensPerItem = Math.ceil(data.usage.total_tokens / texts.length);

      return sorted.map(item => ({
        embedding: new Float32Array(item.embedding) as Embedding384,
        provider: 'openai' as const,
        model: this.config.modelId ?? 'text-embedding-3-small',
        tokenCount: tokensPerItem
      }));
    }

    // Cohere supports batch via `texts` array
    if (this.config.type === 'cohere' && this.config.apiKey) {
      const response = await fetch(this.config.baseUrl ?? 'https://api.cohere.ai/v1/embed', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.config.modelId ?? 'embed-english-v3.0',
          texts,
          input_type: 'search_document'
        })
      });

      if (!response.ok) {
        throw new Error(`Cohere batch API error: ${response.statusText}`);
      }

      const data = await response.json() as {
        embeddings: number[][];
      };

      return data.embeddings.map(emb => {
        let embedding: Embedding384 = new Float32Array(emb) as Embedding384;
        if (embedding.length !== this.embeddingDimension) {
          embedding = this.resizeEmbedding(embedding, this.embeddingDimension) as Embedding384;
        }
        return {
          embedding,
          provider: 'cohere' as const,
          model: this.config.modelId ?? 'embed-english-v3.0'
        };
      });
    }

    // Fallback: process individually for local/unknown providers
    return Promise.all(texts.map(text => this.embed({ text })));
  }

  // ==================== Embedding Strategies ====================

  /**
   * Calculate TF-IDF for tokens
   */
  private calculateTFIDF(tokens: string[]): Map<string, number> {
    const termFreq = new Map<string, number>();

    // Calculate term frequency
    for (const token of tokens) {
      termFreq.set(token, (termFreq.get(token) ?? 0) + 1);
    }

    // Calculate TF-IDF
    const tfidf = new Map<string, number>();
    for (const [term, tf] of termFreq) {
      const normalizedTf = tf / tokens.length;
      const idf = this.idfValues.get(term) ?? Math.log(100); // Default IDF for new terms
      tfidf.set(term, normalizedTf * idf);
    }

    return tfidf;
  }

  /**
   * Weighted average of word vectors
   */
  private weightedWordVectorAverage(
    tokens: string[],
    weights: Map<string, number>
  ): Float32Array {
    const embedding = new Float32Array(this.embeddingDimension);
    let totalWeight = 0;

    for (const token of tokens) {
      const weight = weights.get(token) ?? 0.1;
      const vector = this.getWordVector(token);

      for (let i = 0; i < this.embeddingDimension; i++) {
        embedding[i] += vector[i] * weight;
      }
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      for (let i = 0; i < this.embeddingDimension; i++) {
        embedding[i] /= totalWeight;
      }
    }

    return embedding;
  }

  /**
   * Character n-gram embedding
   */
  private characterNgramEmbedding(text: string): Float32Array {
    const embedding = new Float32Array(this.embeddingDimension);
    const ngrams = this.extractNgrams(text, 3, 5);

    for (const ngram of ngrams) {
      const hash = this.hashString(ngram);
      const index = Math.abs(hash) % this.embeddingDimension;
      const value = ((hash >> 16) & 0xFFFF) / 65535 - 0.5;
      embedding[index] += value;
    }

    // Smooth with rolling average
    const smoothed = new Float32Array(this.embeddingDimension);
    const window = 3;
    for (let i = 0; i < this.embeddingDimension; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - window); j <= Math.min(this.embeddingDimension - 1, i + window); j++) {
        sum += embedding[j];
        count++;
      }
      smoothed[i] = sum / count;
    }

    return smoothed;
  }

  /**
   * Positional encoding (transformer-style)
   */
  private positionalEncoding(tokens: string[]): Float32Array {
    const embedding = new Float32Array(this.embeddingDimension);
    const maxLength = Math.min(tokens.length, 512);

    for (let pos = 0; pos < maxLength; pos++) {
      const token = tokens[pos];
      const tokenHash = this.hashString(token);

      for (let i = 0; i < this.embeddingDimension; i++) {
        const angle = pos / Math.pow(10000, (2 * (i >> 1)) / this.embeddingDimension);

        if (i % 2 === 0) {
          embedding[i] += Math.sin(angle) * (1 / (pos + 1));
        } else {
          embedding[i] += Math.cos(angle) * (1 / (pos + 1));
        }

        // Add token-specific perturbation
        embedding[i] += ((tokenHash >> (i % 32)) & 1) * 0.01 / (pos + 1);
      }
    }

    return embedding;
  }

  /**
   * Semantic category encoding
   */
  private semanticCategoryEncoding(text: string): Float32Array {
    const embedding = new Float32Array(this.embeddingDimension);
    const lowerText = text.toLowerCase();

    // Category indicators with learned-like weights
    const categories = [
      { pattern: /\b(because|therefore|thus|hence|so)\b/g, dim: 0, weight: 0.3 },
      { pattern: /\b(if|when|unless|while|although)\b/g, dim: 48, weight: 0.3 },
      { pattern: /\b(is|are|was|were|be|being)\b/g, dim: 96, weight: 0.2 },
      { pattern: /\b(can|could|may|might|should|would)\b/g, dim: 144, weight: 0.25 },
      { pattern: /\b(first|then|next|finally|after)\b/g, dim: 192, weight: 0.25 },
      { pattern: /\b(but|however|although|despite|yet)\b/g, dim: 240, weight: 0.3 },
      { pattern: /\b(all|every|any|some|none)\b/g, dim: 288, weight: 0.2 },
      { pattern: /\b(more|less|most|least|very)\b/g, dim: 336, weight: 0.2 },
    ];

    for (const cat of categories) {
      const matches = lowerText.match(cat.pattern);
      if (matches) {
        const count = matches.length;
        for (let i = 0; i < 48; i++) {
          const angle = (i / 48) * Math.PI * 2;
          embedding[cat.dim + i] += Math.sin(angle + count) * cat.weight * Math.log(count + 1);
        }
      }
    }

    // Language detection (Korean vs English)
    const koreanChars = (lowerText.match(/[\uAC00-\uD7AF]/g) ?? []).length;
    const totalChars = text.length;
    const koreanRatio = totalChars > 0 ? koreanChars / totalChars : 0;

    // Add language indicator
    for (let i = 0; i < 16; i++) {
      embedding[i] += (koreanRatio - 0.5) * 0.1;
    }

    return embedding;
  }

  // ==================== Helper Methods ====================

  /**
   * Initialize common word vectors
   */
  private initializeWordVectors(): void {
    // Pre-computed semantic directions for common words
    // These simulate learned word embeddings
    const semanticGroups: Record<string, { direction: number; spread: number }> = {
      // Tech terms
      'code': { direction: 0, spread: 0.2 },
      'function': { direction: 0.1, spread: 0.15 },
      'variable': { direction: 0.05, spread: 0.15 },
      'class': { direction: 0.08, spread: 0.18 },
      'method': { direction: 0.12, spread: 0.15 },
      'type': { direction: 0.15, spread: 0.2 },
      'error': { direction: 0.5, spread: 0.25 },
      'bug': { direction: 0.52, spread: 0.2 },
      'fix': { direction: 0.55, spread: 0.18 },
      'test': { direction: 0.3, spread: 0.2 },

      // Concepts
      'learn': { direction: 0.7, spread: 0.25 },
      'understand': { direction: 0.72, spread: 0.2 },
      'know': { direction: 0.68, spread: 0.22 },
      'think': { direction: 0.65, spread: 0.25 },
      'idea': { direction: 0.75, spread: 0.3 },

      // Actions
      'create': { direction: 0.25, spread: 0.2 },
      'build': { direction: 0.27, spread: 0.18 },
      'make': { direction: 0.28, spread: 0.22 },
      'use': { direction: 0.35, spread: 0.25 },
      'get': { direction: 0.4, spread: 0.3 },
      'set': { direction: 0.42, spread: 0.25 },

      // Relations
      'is': { direction: 0.9, spread: 0.4 },
      'has': { direction: 0.88, spread: 0.35 },
      'with': { direction: 0.85, spread: 0.38 },
      'from': { direction: 0.82, spread: 0.35 },
      'to': { direction: 0.95, spread: 0.45 },
    };

    for (const [word, { direction, spread }] of Object.entries(semanticGroups)) {
      this.wordVectors.set(word, this.generateSemanticVector(direction, spread));
    }
  }

  /**
   * Generate a semantic vector from direction and spread
   */
  private generateSemanticVector(direction: number, spread: number): Float32Array {
    const vector = new Float32Array(this.embeddingDimension);
    const baseAngle = direction * Math.PI * 2;

    for (let i = 0; i < this.embeddingDimension; i++) {
      const dimAngle = (i / this.embeddingDimension) * Math.PI * 2;
      const distance = Math.abs(Math.sin(dimAngle - baseAngle));
      vector[i] = Math.exp(-distance / spread) * (Math.cos(dimAngle + baseAngle) * 0.5 + 0.5);
    }

    this.normalize(vector);
    return vector;
  }

  /**
   * Get or generate word vector
   */
  private getWordVector(word: string): Float32Array {
    const lower = word.toLowerCase();

    if (this.wordVectors.has(lower)) {
      return this.wordVectors.get(lower)!;
    }

    // Generate deterministic vector from word hash
    const vector = new Float32Array(this.embeddingDimension);
    const hash = this.hashString(lower);

    for (let i = 0; i < this.embeddingDimension; i++) {
      const subHash = this.hashString(`${lower}_${i}`);
      vector[i] = ((subHash & 0xFFFF) / 32768) - 1;
    }

    this.normalize(vector);
    this.wordVectors.set(lower, vector);
    return vector;
  }

  /**
   * Tokenize text
   */
  private tokenize(text: string): string[] {
    // Handle both English and Korean
    return text
      .toLowerCase()
      .replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  /**
   * Extract character n-grams
   */
  private extractNgrams(text: string, minN: number, maxN: number): string[] {
    const ngrams: string[] = [];
    const chars = text.toLowerCase().replace(/\s+/g, '_');

    for (let n = minN; n <= maxN; n++) {
      for (let i = 0; i <= chars.length - n; i++) {
        ngrams.push(chars.slice(i, i + n));
      }
    }

    return ngrams;
  }

  /**
   * Hash string to number
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

  /**
   * L2 normalize embedding
   */
  private normalize(embedding: Float32Array): void {
    let norm = 0;
    for (let i = 0; i < embedding.length; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= norm;
      }
    }
  }

  /**
   * Resize embedding to target dimension
   */
  private resizeEmbedding(embedding: Float32Array, targetDim: number): Float32Array {
    if (embedding.length === targetDim) return embedding;

    const result = new Float32Array(targetDim);

    if (embedding.length > targetDim) {
      // Downsample: average groups
      const ratio = embedding.length / targetDim;
      for (let i = 0; i < targetDim; i++) {
        let sum = 0;
        const start = Math.floor(i * ratio);
        const end = Math.floor((i + 1) * ratio);
        for (let j = start; j < end; j++) {
          sum += embedding[j];
        }
        result[i] = sum / (end - start);
      }
    } else {
      // Upsample: interpolate
      const ratio = (embedding.length - 1) / (targetDim - 1);
      for (let i = 0; i < targetDim; i++) {
        const srcIdx = i * ratio;
        const lower = Math.floor(srcIdx);
        const upper = Math.min(lower + 1, embedding.length - 1);
        const frac = srcIdx - lower;
        result[i] = embedding[lower] * (1 - frac) + embedding[upper] * frac;
      }
    }

    this.normalize(result);
    return result;
  }

  /**
   * Cache key for text
   */
  private getCacheKey(text: string): string {
    return `${this.config.type}:${this.hashString(text)}`;
  }

  /**
   * Cache embedding
   */
  private cacheEmbedding(key: string, response: EmbeddingResponse): void {
    if (this.cache.size >= this.maxCacheSize) {
      // Remove oldest entries (FIFO)
      const keys = [...this.cache.keys()];
      for (let i = 0; i < keys.length / 10; i++) {
        this.cache.delete(keys[i]);
      }
    }
    this.cache.set(key, response);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get statistics
   */
  getStats(): {
    vocabularySize: number;
    cacheSize: number;
    wordVectorCount: number;
    documentCount: number;
  } {
    return {
      vocabularySize: this.vocabulary.size,
      cacheSize: this.cache.size,
      wordVectorCount: this.wordVectors.size,
      documentCount: this.documentCount
    };
  }

  /**
   * Serialize state for persistence
   */
  serialize(): object {
    return {
      vocabulary: Object.fromEntries(this.vocabulary),
      idfValues: Object.fromEntries(this.idfValues),
      documentCount: this.documentCount,
      config: this.config
    };
  }

  /**
   * Load state from serialized data
   */
  load(data: any): void {
    if (data.vocabulary) {
      this.vocabulary = new Map(Object.entries(data.vocabulary));
    }
    if (data.idfValues) {
      this.idfValues = new Map(Object.entries(data.idfValues));
    }
    if (data.documentCount) {
      this.documentCount = data.documentCount;
    }
    if (data.config) {
      this.config = { ...this.config, ...data.config };
    }
  }
}

/**
 * Create a TextEmbeddingService instance
 */
export function createTextEmbeddingService(
  config?: Partial<EmbeddingProviderConfig>
): TextEmbeddingService {
  return new TextEmbeddingService(config);
}
