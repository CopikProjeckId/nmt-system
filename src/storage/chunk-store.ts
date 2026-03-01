/**
 * Chunk Store - Content-Addressable Storage for Chunks
 * Metadata: SQLite (chunk_metadata table)
 * Data:     Filesystem at <dataDir>/chunks/<hash[0..1]>/<hash>
 * @module storage/chunk-store
 */

import Database from 'better-sqlite3';
import { openDb, closeDb } from './db.js';
import type { Chunk, SHA3Hash } from '../types/index.js';
import { verifyHash } from '../utils/hash.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Chunk store options
 */
export interface ChunkStoreOptions {
  dataDir: string;
  useCompression?: boolean;
}

/**
 * Raw row shape returned by better-sqlite3 for the chunk_metadata table
 */
interface ChunkMetaRow {
  hash: string;
  size: number;
  chunk_index: number;
  offset: number;
  fingerprint: number | null;
  ref_count: number;
  created_at: string;
}

/**
 * Content-Addressable Chunk Store
 * Uses SQLite for metadata and the file system for chunk data blobs.
 */
export class ChunkStore {
  private db!: Database.Database;
  private dataDir: string;
  private chunkDir: string;
  private initialized: boolean = false;

  constructor(options: ChunkStoreOptions) {
    this.dataDir = options.dataDir;
    this.chunkDir = path.join(options.dataDir, 'chunks');
  }

  /**
   * Initialize the store — opens the shared SQLite connection and ensures
   * the chunk data directory exists.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.chunkDir, { recursive: true });
    this.db = openDb(this.dataDir);
    this.initialized = true;
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (!this.initialized) return;
    closeDb(this.dataDir);
    this.initialized = false;
  }

  /**
   * WAL checkpoint to reclaim disk space and truncate the WAL file
   */
  async compact(): Promise<void> {
    if (!this.initialized) return;
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /**
   * Store a chunk (content-addressable).
   * If the chunk already exists the ref_count is incremented and no file write
   * is performed. Otherwise the data is written to disk and a metadata row is
   * inserted.
   */
  async put(chunk: Chunk): Promise<SHA3Hash> {
    this.ensureInitialized();

    const chunkHash = chunk.hash;

    const existing = this.getMetaRow(chunkHash);
    if (existing) {
      this.db
        .prepare<[string]>(
          'UPDATE chunk_metadata SET ref_count = ref_count + 1 WHERE hash = ?'
        )
        .run(chunkHash);
      return chunkHash;
    }

    // Write data file first so that a crash before the metadata insert leaves
    // the system in a state where a subsequent put() retries cleanly.
    const chunkPath = this.getChunkPath(chunkHash);
    await fs.mkdir(path.dirname(chunkPath), { recursive: true });
    await fs.writeFile(chunkPath, chunk.data);

    this.db
      .prepare<[string, number, number, number, number | null, string]>(`
        INSERT INTO chunk_metadata (hash, size, chunk_index, offset, fingerprint, ref_count, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `)
      .run(
        chunkHash,
        chunk.data.length,
        chunk.index,
        chunk.offset,
        chunk.fingerprint ?? null,
        new Date().toISOString()
      );

    return chunkHash;
  }

  /**
   * Store multiple chunks and return their hashes in order.
   */
  async putMany(chunks: Chunk[]): Promise<SHA3Hash[]> {
    const hashes: SHA3Hash[] = [];
    for (const chunk of chunks) {
      hashes.push(await this.put(chunk));
    }
    return hashes;
  }

  /**
   * Retrieve a chunk by hash.
   * Returns null when the metadata row is absent or the data file is missing.
   * Throws when the file exists but the hash does not match (corruption).
   */
  async get(chunkHash: SHA3Hash): Promise<Chunk | null> {
    this.ensureInitialized();

    const meta = this.getMetaRow(chunkHash);
    if (!meta) return null;

    const chunkPath = this.getChunkPath(chunkHash);

    try {
      const data = await fs.readFile(chunkPath);

      if (!verifyHash(data, chunkHash)) {
        throw new Error(`Chunk integrity verification failed: ${chunkHash}`);
      }

      return {
        index: meta.chunk_index,
        offset: meta.offset,
        data: Buffer.from(data),
        hash: chunkHash,
        fingerprint: meta.fingerprint ?? undefined,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Retrieve multiple chunks by hash (in order, null for any that are missing).
   */
  async getMany(hashes: SHA3Hash[]): Promise<(Chunk | null)[]> {
    return Promise.all(hashes.map(h => this.get(h)));
  }

  /**
   * Check whether a chunk exists (metadata row present).
   */
  async has(chunkHash: SHA3Hash): Promise<boolean> {
    this.ensureInitialized();
    return this.getMetaRow(chunkHash) !== null;
  }

  /**
   * Decrement ref_count. When ref_count reaches zero the data file and
   * metadata row are both removed. Returns false when the hash is not found.
   */
  async delete(chunkHash: SHA3Hash): Promise<boolean> {
    this.ensureInitialized();

    const meta = this.getMetaRow(chunkHash);
    if (!meta) return false;

    if (meta.ref_count <= 1) {
      // Physically remove the data file
      const chunkPath = this.getChunkPath(chunkHash);
      try {
        await fs.unlink(chunkPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
      this.db
        .prepare<[string]>('DELETE FROM chunk_metadata WHERE hash = ?')
        .run(chunkHash);
    } else {
      this.db
        .prepare<[string]>(
          'UPDATE chunk_metadata SET ref_count = ref_count - 1 WHERE hash = ?'
        )
        .run(chunkHash);
    }

    return true;
  }

  /**
   * Return all stored chunk hashes.
   */
  async getAllHashes(): Promise<SHA3Hash[]> {
    this.ensureInitialized();

    const rows = this.db
      .prepare<[], { hash: string }>('SELECT hash FROM chunk_metadata')
      .all();

    return rows.map(r => r.hash);
  }

  /**
   * Return aggregate storage statistics.
   */
  async getStats(): Promise<{
    totalChunks: number;
    totalSize: number;
    avgChunkSize: number;
  }> {
    this.ensureInitialized();

    const row = this.db
      .prepare<[], { total_chunks: number; total_size: number }>(`
        SELECT COUNT(*) AS total_chunks, COALESCE(SUM(size), 0) AS total_size
        FROM chunk_metadata
      `)
      .get()!;

    const totalChunks = row.total_chunks;
    const totalSize = row.total_size;

    return {
      totalChunks,
      totalSize,
      avgChunkSize: totalChunks > 0 ? Math.round(totalSize / totalChunks) : 0,
    };
  }

  /**
   * Verify the hash of every stored chunk data file.
   * Returns counts of valid chunks and lists of corrupted / missing hashes.
   */
  async verifyIntegrity(): Promise<{
    valid: number;
    corrupted: SHA3Hash[];
    missing: SHA3Hash[];
  }> {
    this.ensureInitialized();

    const rows = this.db
      .prepare<[], ChunkMetaRow>('SELECT * FROM chunk_metadata')
      .all();

    let valid = 0;
    const corrupted: SHA3Hash[] = [];
    const missing: SHA3Hash[] = [];

    for (const row of rows) {
      const chunkPath = this.getChunkPath(row.hash);
      try {
        const data = await fs.readFile(chunkPath);
        if (verifyHash(data, row.hash)) {
          valid++;
        } else {
          corrupted.push(row.hash);
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          missing.push(row.hash);
        } else {
          throw err;
        }
      }
    }

    return { valid, corrupted, missing };
  }

  /**
   * Remove all metadata rows whose ref_count is zero or below and delete
   * the associated data files. Returns the number of chunks collected.
   */
  async gc(): Promise<number> {
    this.ensureInitialized();

    const rows = this.db
      .prepare<[], { hash: string }>(
        'SELECT hash FROM chunk_metadata WHERE ref_count <= 0'
      )
      .all();

    for (const row of rows) {
      await this.delete(row.hash);
    }

    return rows.length;
  }

  // ==================== Private Helpers ====================

  /**
   * Return the filesystem path for a chunk's data file.
   * Files are sharded into sub-directories by the first two hex characters
   * of the hash to avoid excessive entries in a single directory.
   */
  private getChunkPath(chunkHash: SHA3Hash): string {
    const prefix = chunkHash.slice(0, 2);
    return path.join(this.chunkDir, prefix, chunkHash);
  }

  /**
   * Fetch a single metadata row by hash. Returns null when absent.
   */
  private getMetaRow(chunkHash: SHA3Hash): ChunkMetaRow | null {
    const row = this.db
      .prepare<[string], ChunkMetaRow>(
        'SELECT * FROM chunk_metadata WHERE hash = ?'
      )
      .get(chunkHash);

    return row ?? null;
  }

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
