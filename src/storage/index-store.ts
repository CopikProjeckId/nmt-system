/**
 * Index Store - HNSW Index Persistence
 * @module storage/index-store
 */

import { Level } from 'level';
import type { UUID, HNSWIndexData, HNSWParams } from '../types/index.js';
import { HNSWIndex } from '../core/hnsw-index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Index store options
 */
export interface IndexStoreOptions {
  dataDir: string;
  autoSaveInterval?: number; // ms, 0 to disable
}

/**
 * Serialized HNSW format for JSON storage
 */
interface SerializedHNSW {
  params: HNSWParams;
  entryPoint: UUID | null;
  nodes: Array<{
    id: UUID;
    embedding: number[];
    layer: number;
    connections: Record<string, string[]>;
  }>;
  layers: Array<{
    level: number;
    nodes: string[];
  }>;
}

/**
 * HNSW Index Persistence Store
 */
export class IndexStore {
  private db: Level<string, string>;
  private dataDir: string;
  private indexDir: string;
  private initialized: boolean = false;
  private autoSaveInterval: number;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private pendingSaves: Map<string, HNSWIndex> = new Map();

  constructor(options: IndexStoreOptions) {
    this.dataDir = options.dataDir;
    this.indexDir = path.join(this.dataDir, 'indices');
    this.autoSaveInterval = options.autoSaveInterval ?? 0;
    this.db = new Level(path.join(this.dataDir, 'index-meta'), {
      valueEncoding: 'json'
    });
  }

  /**
   * Initialize the store
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.indexDir, { recursive: true });
    await this.db.open();
    this.initialized = true;

    // Start auto-save timer if configured
    if (this.autoSaveInterval > 0) {
      this.autoSaveTimer = setInterval(() => {
        this.flushPendingSaves();
      }, this.autoSaveInterval);
    }
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    if (!this.initialized) return;

    // Stop auto-save timer
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    // Flush pending saves
    await this.flushPendingSaves();

    await this.db.close();
    this.initialized = false;
  }

  /**
   * Save an HNSW index
   * @param name - Index name
   * @param index - HNSW index instance
   */
  async save(name: string, index: HNSWIndex): Promise<void> {
    this.ensureInitialized();

    const serialized = this.serializeIndex(index);
    const indexPath = this.getIndexPath(name);

    // Write index data to file
    await fs.writeFile(indexPath, JSON.stringify(serialized, null, 2));

    // Store metadata
    const metadata = {
      name,
      nodeCount: index.size,
      savedAt: new Date().toISOString(),
      params: serialized.params
    };
    await this.db.put(`index:${name}`, JSON.stringify(metadata));
  }

  /**
   * Queue an index for auto-save
   * @param name - Index name
   * @param index - HNSW index instance
   */
  queueSave(name: string, index: HNSWIndex): void {
    this.pendingSaves.set(name, index);
  }

  /**
   * Load an HNSW index
   * @param name - Index name
   * @returns Loaded index or null if not found
   */
  async load(name: string): Promise<HNSWIndex | null> {
    this.ensureInitialized();

    const indexPath = this.getIndexPath(name);

    try {
      const data = await fs.readFile(indexPath, 'utf-8');
      const serialized: SerializedHNSW = JSON.parse(data);
      return this.deserializeIndex(serialized);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Check if an index exists
   * @param name - Index name
   */
  async exists(name: string): Promise<boolean> {
    this.ensureInitialized();

    try {
      await fs.access(this.getIndexPath(name));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Delete an index
   * @param name - Index name
   */
  async delete(name: string): Promise<boolean> {
    this.ensureInitialized();

    try {
      await fs.unlink(this.getIndexPath(name));
      await this.db.del(`index:${name}`);
      this.pendingSaves.delete(name);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  /**
   * List all saved indices
   */
  async list(): Promise<Array<{
    name: string;
    nodeCount: number;
    savedAt: string;
    params: HNSWParams;
  }>> {
    this.ensureInitialized();

    const indices: Array<{
      name: string;
      nodeCount: number;
      savedAt: string;
      params: HNSWParams;
    }> = [];

    for await (const [key, value] of this.db.iterator()) {
      if (key.startsWith('index:')) {
        indices.push(JSON.parse(value));
      }
    }

    return indices;
  }

  /**
   * Get index metadata
   * @param name - Index name
   */
  async getMetadata(name: string): Promise<{
    name: string;
    nodeCount: number;
    savedAt: string;
    params: HNSWParams;
  } | null> {
    this.ensureInitialized();

    try {
      const value = await this.db.get(`index:${name}`);
      return JSON.parse(value);
    } catch (err) {
      if ((err as any).code === 'LEVEL_NOT_FOUND') {
        return null;
      }
      throw err;
    }
  }

  /**
   * Create a backup of an index
   * @param name - Index name
   * @param backupName - Backup name
   */
  async backup(name: string, backupName?: string): Promise<string> {
    this.ensureInitialized();

    const indexPath = this.getIndexPath(name);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const actualBackupName = backupName ?? `${name}-backup-${timestamp}`;
    const backupPath = this.getIndexPath(actualBackupName);

    await fs.copyFile(indexPath, backupPath);

    // Copy metadata
    const metadata = await this.getMetadata(name);
    if (metadata) {
      metadata.name = actualBackupName;
      await this.db.put(`index:${actualBackupName}`, JSON.stringify(metadata));
    }

    return actualBackupName;
  }

  /**
   * Restore an index from backup
   * @param backupName - Backup name
   * @param targetName - Target index name (optional, defaults to original)
   */
  async restore(backupName: string, targetName?: string): Promise<boolean> {
    this.ensureInitialized();

    const backupPath = this.getIndexPath(backupName);
    const actualTargetName = targetName ?? backupName.replace(/-backup-.*$/, '');
    const targetPath = this.getIndexPath(actualTargetName);

    try {
      await fs.copyFile(backupPath, targetPath);

      const metadata = await this.getMetadata(backupName);
      if (metadata) {
        metadata.name = actualTargetName;
        metadata.savedAt = new Date().toISOString();
        await this.db.put(`index:${actualTargetName}`, JSON.stringify(metadata));
      }

      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Flush all pending saves
   */
  private async flushPendingSaves(): Promise<void> {
    const saves = Array.from(this.pendingSaves.entries());
    this.pendingSaves.clear();

    for (const [name, index] of saves) {
      try {
        await this.save(name, index);
      } catch (err) {
        console.error(`Failed to auto-save index ${name}:`, err);
        // Re-queue for next attempt
        this.pendingSaves.set(name, index);
      }
    }
  }

  /**
   * Serialize HNSW index for storage
   */
  private serializeIndex(index: HNSWIndex): SerializedHNSW {
    const data = index.serialize();

    return {
      params: data.params,
      entryPoint: data.entryPoint,
      nodes: data.nodes.map(node => ({
        id: node.id,
        embedding: Array.from(node.embedding),
        layer: node.layer,
        connections: this.serializeConnections(node.connections)
      })),
      layers: data.layers.map(layer => ({
        level: layer.level,
        nodes: Array.from(layer.nodes)
      }))
    };
  }

  /**
   * Deserialize HNSW index from storage
   */
  private deserializeIndex(data: SerializedHNSW): HNSWIndex {
    const indexData = {
      params: data.params,
      entryPoint: data.entryPoint,
      nodes: data.nodes.map(node => ({
        id: node.id,
        embedding: new Float32Array(node.embedding),
        layer: node.layer,
        connections: this.deserializeConnections(node.connections)
      })),
      layers: data.layers.map(layer => ({
        level: layer.level,
        nodes: new Set(layer.nodes)
      }))
    };

    return HNSWIndex.deserialize(indexData);
  }

  /**
   * Serialize connections Map to plain object
   */
  private serializeConnections(connections: Map<number, Set<UUID>>): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [layer, conns] of connections) {
      result[layer.toString()] = Array.from(conns);
    }
    return result;
  }

  /**
   * Deserialize connections from plain object to Map
   */
  private deserializeConnections(data: Record<string, string[]>): Map<number, Set<UUID>> {
    const result = new Map<number, Set<UUID>>();
    for (const [layer, conns] of Object.entries(data)) {
      result.set(parseInt(layer), new Set(conns));
    }
    return result;
  }

  /**
   * Get index file path
   */
  private getIndexPath(name: string): string {
    return path.join(this.indexDir, `${name}.json`);
  }

  /**
   * Ensure store is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('IndexStore not initialized. Call init() first.');
    }
  }
}

/**
 * Create an IndexStore instance
 */
export function createIndexStore(options: IndexStoreOptions): IndexStore {
  return new IndexStore(options);
}
