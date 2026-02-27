/**
 * Embedding Provider - Xenova Transformers integration
 *
 * Provides semantic embeddings using Xenova/transformers.js
 * Model: all-MiniLM-L6-v2 (384 dimensions)
 *
 * @module services/embedding-provider
 */

import { createHash } from 'node:crypto';
import type { Embedding384 } from '../types/index.js';

/**
 * Embedding provider interface
 */
export interface IEmbeddingProvider {
  embed(text: string): Promise<Embedding384>;
  embedBatch(texts: string[]): Promise<Embedding384[]>;
  isReady(): boolean;
}

// Lazy-loaded pipeline
let _pipeline: any = null;
let _pipelinePromise: Promise<any> | null = null;

/**
 * Initialize the embedding pipeline
 */
async function getPipeline(): Promise<any> {
  if (_pipeline) return _pipeline;

  if (_pipelinePromise) return _pipelinePromise;

  _pipelinePromise = (async () => {
    const { pipeline } = await import('@xenova/transformers');
    _pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true,
    });
    return _pipeline;
  })();

  return _pipelinePromise;
}

/**
 * Xenova Embedding Provider
 *
 * Uses Xenova/transformers.js for high-quality semantic embeddings
 */
export class XenovaEmbeddingProvider implements IEmbeddingProvider {
  private ready: boolean = false;
  private initPromise: Promise<void> | null = null;
  private cache = new Map<string, Embedding384>();
  private readonly maxCacheSize = 1000;

  /**
   * Initialize the provider (lazy)
   */
  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      await getPipeline();
      this.ready = true;
    })();

    return this.initPromise;
  }

  /**
   * Check if provider is ready
   */
  isReady(): boolean {
    return this.ready;
  }

  /**
   * Generate embedding for a single text (with SHA-256 cache)
   */
  async embed(text: string): Promise<Embedding384> {
    const key = createHash('sha256').update(text).digest('hex');
    if (this.cache.has(key)) return this.cache.get(key)!;

    const embedding = await this._embed(text);

    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value as string;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, embedding);
    return embedding;
  }

  /**
   * Internal embedding computation (no cache)
   */
  private async _embed(text: string): Promise<Embedding384> {
    const pipe = await getPipeline();
    const output = await pipe(text, { pooling: 'mean', normalize: true });

    // Convert to Float32Array
    const embedding = new Float32Array(384);
    const data = output.data;

    for (let i = 0; i < 384; i++) {
      embedding[i] = data[i];
    }

    return embedding;
  }

  /**
   * Generate embeddings for multiple texts (batched)
   */
  async embedBatch(texts: string[]): Promise<Embedding384[]> {
    const pipe = await getPipeline();

    // Process in batches of 32 for memory efficiency
    const batchSize = 32;
    const results: Embedding384[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const outputs = await pipe(batch, { pooling: 'mean', normalize: true });

      for (let j = 0; j < batch.length; j++) {
        const embedding = new Float32Array(384);
        const startIdx = j * 384;

        for (let k = 0; k < 384; k++) {
          embedding[k] = outputs.data[startIdx + k];
        }

        results.push(embedding);
      }
    }

    return results;
  }
}

/**
 * Deterministic Embedding Provider (fallback)
 *
 * Creates pseudo-random but deterministic embeddings from text hash.
 * Used when Xenova is not available or for testing.
 */
export class DeterministicEmbeddingProvider implements IEmbeddingProvider {
  isReady(): boolean {
    return true;
  }

  async embed(text: string): Promise<Embedding384> {
    const embedding = new Float32Array(384);

    // Generate deterministic hash-based embedding
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) - hash) + text.charCodeAt(i);
      hash |= 0;
    }

    for (let i = 0; i < 384; i++) {
      hash = ((hash << 5) - hash) + i;
      hash |= 0;
      embedding[i] = (hash % 1000) / 1000 - 0.5;
    }

    // Normalize to unit vector
    let norm = 0;
    for (let i = 0; i < 384; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    for (let i = 0; i < 384; i++) {
      embedding[i] /= norm;
    }

    return embedding;
  }

  async embedBatch(texts: string[]): Promise<Embedding384[]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }
}

// Singleton instances
let _xenovaProvider: XenovaEmbeddingProvider | null = null;
let _deterministicProvider: DeterministicEmbeddingProvider | null = null;

/**
 * Get the Xenova embedding provider (singleton)
 */
export function getXenovaProvider(): XenovaEmbeddingProvider {
  if (!_xenovaProvider) {
    _xenovaProvider = new XenovaEmbeddingProvider();
  }
  return _xenovaProvider;
}

/**
 * Get the deterministic embedding provider (singleton)
 */
export function getDeterministicProvider(): DeterministicEmbeddingProvider {
  if (!_deterministicProvider) {
    _deterministicProvider = new DeterministicEmbeddingProvider();
  }
  return _deterministicProvider;
}

/**
 * Get the best available embedding provider
 *
 * Tries Xenova first, falls back to deterministic if unavailable
 */
export async function getEmbeddingProvider(): Promise<IEmbeddingProvider> {
  try {
    const xenova = getXenovaProvider();
    await xenova.init();
    return xenova;
  } catch {
    console.warn('Xenova not available, using deterministic embeddings');
    return getDeterministicProvider();
  }
}

/**
 * Quick embedding function using the best available provider
 */
export async function quickEmbed(text: string): Promise<Embedding384> {
  const provider = await getEmbeddingProvider();
  return provider.embed(text);
}
