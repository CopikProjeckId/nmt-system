/**
 * Chunk Engine - Data segmentation and reassembly
 * @module core/chunk-engine
 */

import type { Chunk, ChunkOptions } from '../types/index.js';
import { hash } from '../utils/hash.js';

/** Default chunk size: 4KB */
const DEFAULT_CHUNK_SIZE = 4096;

/** Default overlap between chunks */
const DEFAULT_OVERLAP = 256;

/** CDC minimum chunk size */
const CDC_MIN_CHUNK = 2048;

/** CDC maximum chunk size */
const CDC_MAX_CHUNK = 65536;

/** Rabin fingerprint polynomial */
const RABIN_POLYNOMIAL = 0x3DA3358B4DC173n;

/** Rabin fingerprint mask for boundary detection */
const RABIN_MASK = 0x1FFFn;

/** Rabin window size */
const RABIN_WINDOW = 48;

/**
 * ChunkEngine class for data segmentation
 */
export class ChunkEngine {
  private options: Required<ChunkOptions>;

  constructor(options: ChunkOptions = {}) {
    this.options = {
      chunkSize: options.chunkSize ?? DEFAULT_CHUNK_SIZE,
      overlap: options.overlap ?? DEFAULT_OVERLAP,
      useCDC: options.useCDC ?? false,
      minChunkSize: options.minChunkSize ?? CDC_MIN_CHUNK,
      maxChunkSize: options.maxChunkSize ?? CDC_MAX_CHUNK
    };
  }

  /**
   * Chunk data using the configured method
   * @param data - Data to chunk
   * @returns Array of chunks
   */
  chunk(data: Buffer): Chunk[] {
    if (this.options.useCDC) {
      return this.cdcChunk(data);
    }
    return this.fixedChunk(data);
  }

  /**
   * Fixed-size chunking
   * @param data - Data to chunk
   * @param size - Chunk size (default from options)
   * @returns Array of chunks
   */
  fixedChunk(data: Buffer, size?: number): Chunk[] {
    const chunkSize = size ?? this.options.chunkSize;
    const chunks: Chunk[] = [];

    for (let offset = 0; offset < data.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, data.length);
      const chunkData = data.subarray(offset, end);

      chunks.push({
        index: chunks.length,
        offset,
        data: Buffer.from(chunkData),
        hash: hash(chunkData)
      });
    }

    return chunks;
  }

  /**
   * Content-Defined Chunking using Rabin fingerprints
   * @param data - Data to chunk
   * @returns Array of variable-size chunks
   */
  cdcChunk(data: Buffer): Chunk[] {
    const chunks: Chunk[] = [];
    const { minChunkSize, maxChunkSize } = this.options;

    let fingerprint = 0n;
    let chunkStart = 0;

    for (let i = 0; i < data.length; i++) {
      // Update fingerprint with rolling hash
      fingerprint = this.updateFingerprint(fingerprint, data[i]);
      const chunkLength = i - chunkStart + 1;

      // Check boundary conditions
      const isBoundary = (fingerprint & RABIN_MASK) === 0n;
      const meetsMinSize = chunkLength >= minChunkSize;
      const exceedsMaxSize = chunkLength >= maxChunkSize;
      const isEndOfData = i === data.length - 1;

      if ((isBoundary && meetsMinSize) || exceedsMaxSize || isEndOfData) {
        const chunkData = data.subarray(chunkStart, i + 1);

        chunks.push({
          index: chunks.length,
          offset: chunkStart,
          data: Buffer.from(chunkData),
          hash: hash(chunkData),
          fingerprint: Number(fingerprint & 0xFFFFFFFFn)
        });

        chunkStart = i + 1;
        fingerprint = 0n;
      }
    }

    return chunks;
  }

  /**
   * Update Rabin fingerprint with new byte
   */
  private updateFingerprint(fingerprint: bigint, byte: number): bigint {
    return ((fingerprint << 1n) ^ BigInt(byte)) % RABIN_POLYNOMIAL;
  }

  /**
   * Merge chunks back into original data
   * @param chunks - Array of chunks in order
   * @returns Merged buffer
   */
  merge(chunks: Chunk[]): Buffer {
    // Sort by index to ensure correct order
    const sorted = [...chunks].sort((a, b) => a.index - b.index);

    // Calculate total size
    const totalSize = sorted.reduce((sum, c) => sum + c.data.length, 0);
    const result = Buffer.allocUnsafe(totalSize);

    let position = 0;
    for (const chunk of sorted) {
      chunk.data.copy(result, position);
      position += chunk.data.length;
    }

    return result;
  }

  /**
   * Verify chunk integrity
   * @param chunk - Chunk to verify
   * @returns true if hash matches
   */
  verifyChunk(chunk: Chunk): boolean {
    return hash(chunk.data) === chunk.hash;
  }

  /**
   * Verify all chunks in array
   * @param chunks - Chunks to verify
   * @returns true if all hashes match
   */
  verifyAllChunks(chunks: Chunk[]): boolean {
    return chunks.every(chunk => this.verifyChunk(chunk));
  }

  /**
   * Find duplicate chunks by hash
   * @param chunks - Chunks to deduplicate
   * @returns Deduplication result
   */
  deduplicate(chunks: Chunk[]): {
    unique: Chunk[];
    duplicates: Map<string, number[]>;
    savedBytes: number;
  } {
    const hashToIndices = new Map<string, number[]>();
    const unique: Chunk[] = [];
    let savedBytes = 0;

    for (const chunk of chunks) {
      const indices = hashToIndices.get(chunk.hash);
      if (indices) {
        indices.push(chunk.index);
        savedBytes += chunk.data.length;
      } else {
        hashToIndices.set(chunk.hash, [chunk.index]);
        unique.push(chunk);
      }
    }

    const duplicates = new Map<string, number[]>();
    for (const [h, indices] of hashToIndices) {
      if (indices.length > 1) {
        duplicates.set(h, indices);
      }
    }

    return { unique, duplicates, savedBytes };
  }

  /**
   * Get chunk statistics
   */
  getStats(chunks: Chunk[]): {
    count: number;
    totalSize: number;
    avgSize: number;
    minSize: number;
    maxSize: number;
  } {
    if (chunks.length === 0) {
      return { count: 0, totalSize: 0, avgSize: 0, minSize: 0, maxSize: 0 };
    }

    const sizes = chunks.map(c => c.data.length);
    const totalSize = sizes.reduce((a, b) => a + b, 0);

    return {
      count: chunks.length,
      totalSize,
      avgSize: Math.round(totalSize / chunks.length),
      minSize: Math.min(...sizes),
      maxSize: Math.max(...sizes)
    };
  }
}

/**
 * Create a ChunkEngine instance with default options
 */
export function createChunkEngine(options?: ChunkOptions): ChunkEngine {
  return new ChunkEngine(options);
}
