/**
 * Chunk Store - Content-Addressable Storage for Chunks
 * @module storage/chunk-store
 */

import { Level } from 'level';
import type { Chunk, SHA3Hash } from '../types/index.js';
import { hash, verifyHash } from '../utils/hash.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Chunk storage options
 */
export interface ChunkStoreOptions {
  dataDir: string;
  useCompression?: boolean;
}

/**
 * Chunk metadata stored in LevelDB
 */
interface ChunkMetadata {
  hash: SHA3Hash;
  size: number;
  index: number;
  offset: number;
  fingerprint?: number;
  createdAt: string;
  refCount: number;
}

/**
 * Content-Addressable Chunk Store
 * Uses LevelDB for metadata and file system for chunk data
 */
export class ChunkStore {
  private db: Level<string, string>;
  private dataDir: string;
  private chunkDir: string;
  private initialized: boolean = false;

  constructor(options: ChunkStoreOptions) {
    this.dataDir = options.dataDir;
    this.chunkDir = path.join(this.dataDir, 'chunks');
    this.db = new Level(path.join(this.dataDir, 'chunk-meta'), {
      valueEncoding: 'json'
    });
  }

  /**
   * Initialize the store
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Ensure directories exist
    await fs.mkdir(this.chunkDir, { recursive: true });
    await this.db.open();
    this.initialized = true;
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (!this.initialized) return;
    await this.db.close();
    this.initialized = false;
  }

  /**
   * Trigger LevelDB compaction to reclaim disk space after bulk deletes.
   */
  async compact(): Promise<void> {
    if (!this.initialized) return;
    const db = this.db as any;
    if (typeof db.compactRange === 'function') {
      await new Promise<void>((res, rej) =>
        db.compactRange('\x00', '\xff', {}, (err: Error | null) => err ? rej(err) : res())
      );
    }
  }

  /**
   * Store a chunk (content-addressable)
   * @param chunk - Chunk to store
   * @returns Hash of stored chunk
   */
  async put(chunk: Chunk): Promise<SHA3Hash> {
    this.ensureInitialized();

    const chunkHash = chunk.hash;

    // Check if chunk already exists
    const existing = await this.getMetadata(chunkHash);
    if (existing) {
      // Increment reference count
      existing.refCount++;
      await this.db.put(`meta:${chunkHash}`, JSON.stringify(existing));
      return chunkHash;
    }

    // Store chunk data to file
    const chunkPath = this.getChunkPath(chunkHash);
    await fs.mkdir(path.dirname(chunkPath), { recursive: true });
    await fs.writeFile(chunkPath, chunk.data);

    // Store metadata
    const metadata: ChunkMetadata = {
      hash: chunkHash,
      size: chunk.data.length,
      index: chunk.index,
      offset: chunk.offset,
      fingerprint: chunk.fingerprint,
      createdAt: new Date().toISOString(),
      refCount: 1
    };

    await this.db.put(`meta:${chunkHash}`, JSON.stringify(metadata));

    return chunkHash;
  }

  /**
   * Store multiple chunks
   * @param chunks - Chunks to store
   * @returns Array of stored hashes
   */
  async putMany(chunks: Chunk[]): Promise<SHA3Hash[]> {
    const hashes: SHA3Hash[] = [];
    for (const chunk of chunks) {
      const h = await this.put(chunk);
      hashes.push(h);
    }
    return hashes;
  }

  /**
   * Retrieve a chunk by hash
   * @param chunkHash - Hash of chunk to retrieve
   * @returns Chunk or null if not found
   */
  async get(chunkHash: SHA3Hash): Promise<Chunk | null> {
    this.ensureInitialized();

    const metadata = await this.getMetadata(chunkHash);
    if (!metadata) return null;

    try {
      const chunkPath = this.getChunkPath(chunkHash);
      const data = await fs.readFile(chunkPath);

      // Verify integrity
      if (!verifyHash(data, chunkHash)) {
        throw new Error(`Chunk integrity verification failed: ${chunkHash}`);
      }

      return {
        index: metadata.index,
        offset: metadata.offset,
        data: Buffer.from(data),
        hash: chunkHash,
        fingerprint: metadata.fingerprint
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Retrieve multiple chunks by hash
   * @param hashes - Array of chunk hashes
   * @returns Array of chunks (in order, null for missing)
   */
  async getMany(hashes: SHA3Hash[]): Promise<(Chunk | null)[]> {
    return Promise.all(hashes.map(h => this.get(h)));
  }

  /**
   * Check if a chunk exists
   * @param chunkHash - Hash to check
   */
  async has(chunkHash: SHA3Hash): Promise<boolean> {
    this.ensureInitialized();
    const metadata = await this.getMetadata(chunkHash);
    return metadata !== null;
  }

  /**
   * Delete a chunk (decrements reference count)
   * @param chunkHash - Hash of chunk to delete
   * @returns true if chunk was deleted, false if not found
   */
  async delete(chunkHash: SHA3Hash): Promise<boolean> {
    this.ensureInitialized();

    const metadata = await this.getMetadata(chunkHash);
    if (!metadata) return false;

    metadata.refCount--;

    if (metadata.refCount <= 0) {
      // Actually delete the chunk
      const chunkPath = this.getChunkPath(chunkHash);
      try {
        await fs.unlink(chunkPath);
      } catch (err) {
        // Ignore if file doesn't exist
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
      await this.db.del(`meta:${chunkHash}`);
    } else {
      // Just update ref count
      await this.db.put(`meta:${chunkHash}`, JSON.stringify(metadata));
    }

    return true;
  }

  /**
   * Get all chunk hashes
   */
  async getAllHashes(): Promise<SHA3Hash[]> {
    this.ensureInitialized();

    const hashes: SHA3Hash[] = [];
    for await (const key of this.db.keys()) {
      if (key.startsWith('meta:')) {
        hashes.push(key.slice(5));
      }
    }
    return hashes;
  }

  /**
   * Get storage statistics
   */
  async getStats(): Promise<{
    totalChunks: number;
    totalSize: number;
    avgChunkSize: number;
  }> {
    this.ensureInitialized();

    let totalChunks = 0;
    let totalSize = 0;

    for await (const [key, value] of this.db.iterator()) {
      if (key.startsWith('meta:')) {
        const metadata: ChunkMetadata = JSON.parse(value);
        totalChunks++;
        totalSize += metadata.size;
      }
    }

    return {
      totalChunks,
      totalSize,
      avgChunkSize: totalChunks > 0 ? Math.round(totalSize / totalChunks) : 0
    };
  }

  /**
   * Verify integrity of all stored chunks
   */
  async verifyIntegrity(): Promise<{
    valid: number;
    corrupted: SHA3Hash[];
    missing: SHA3Hash[];
  }> {
    this.ensureInitialized();

    let valid = 0;
    const corrupted: SHA3Hash[] = [];
    const missing: SHA3Hash[] = [];

    for await (const [key, value] of this.db.iterator()) {
      if (!key.startsWith('meta:')) continue;

      const metadata: ChunkMetadata = JSON.parse(value);
      const chunkPath = this.getChunkPath(metadata.hash);

      try {
        const data = await fs.readFile(chunkPath);
        if (verifyHash(data, metadata.hash)) {
          valid++;
        } else {
          corrupted.push(metadata.hash);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          missing.push(metadata.hash);
        } else {
          throw err;
        }
      }
    }

    return { valid, corrupted, missing };
  }

  /**
   * Garbage collect unreferenced chunks
   */
  async gc(): Promise<number> {
    this.ensureInitialized();

    const toDelete: SHA3Hash[] = [];

    for await (const [key, value] of this.db.iterator()) {
      if (!key.startsWith('meta:')) continue;

      const metadata: ChunkMetadata = JSON.parse(value);
      if (metadata.refCount <= 0) {
        toDelete.push(metadata.hash);
      }
    }

    for (const h of toDelete) {
      await this.delete(h);
    }

    return toDelete.length;
  }

  /**
   * Get chunk path from hash (sharded by first 2 chars)
   */
  private getChunkPath(chunkHash: SHA3Hash): string {
    const prefix = chunkHash.slice(0, 2);
    return path.join(this.chunkDir, prefix, chunkHash);
  }

  /**
   * Get chunk metadata
   */
  private async getMetadata(chunkHash: SHA3Hash): Promise<ChunkMetadata | null> {
    try {
      const value = await this.db.get(`meta:${chunkHash}`);
      return JSON.parse(value);
    } catch (err) {
      if ((err as any).code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Ensure store is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('ChunkStore not initialized. Call init() first.');
    }
  }
}

/**
 * Create a ChunkStore instance
 */
export function createChunkStore(options: ChunkStoreOptions): ChunkStore {
  return new ChunkStore(options);
}
