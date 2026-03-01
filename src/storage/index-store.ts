/**
 * Index Store - HNSW Index Persistence (SQLite)
 * @module storage/index-store
 */

import { openDb, closeDb } from './db.js';
import type { UUID, HNSWParams } from '../types/index.js';
import { HNSWIndex } from '../core/hnsw-index.js';
import type Database from 'better-sqlite3';

export interface IndexStoreOptions {
  dataDir: string;
  autoSaveInterval?: number; // ms, 0 to disable
}

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

export class IndexStore {
  private dataDir: string;
  private db: Database.Database | null = null;
  private autoSaveInterval: number;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private pendingSaves: Map<string, HNSWIndex> = new Map();
  private initialized = false;

  constructor(options: IndexStoreOptions) {
    this.dataDir = options.dataDir;
    this.autoSaveInterval = options.autoSaveInterval ?? 0;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.db = openDb(this.dataDir);
    this.initialized = true;

    if (this.autoSaveInterval > 0) {
      this.autoSaveTimer = setInterval(() => {
        void this.flushPendingSaves();
      }, this.autoSaveInterval);
    }
  }

  async close(): Promise<void> {
    if (!this.initialized) return;

    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    await this.flushPendingSaves();
    closeDb(this.dataDir);
    this.db = null;
    this.initialized = false;
  }

  async save(name: string, index: HNSWIndex): Promise<void> {
    this.ensureInitialized();
    const serialized = this.serializeIndex(index);
    const data = JSON.stringify(serialized);
    const now = new Date().toISOString();

    this.db!.prepare(
      `INSERT OR REPLACE INTO hnsw_indices (name, data, node_count, params, saved_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(name, data, index.size, JSON.stringify(serialized.params), now);
  }

  queueSave(name: string, index: HNSWIndex): void {
    this.pendingSaves.set(name, index);
  }

  async load(name: string): Promise<HNSWIndex | null> {
    this.ensureInitialized();
    const row = this.db!.prepare(
      'SELECT data FROM hnsw_indices WHERE name = ?'
    ).get(name) as { data: string } | undefined;

    if (!row) return null;

    try {
      const serialized: SerializedHNSW = JSON.parse(row.data);
      return this.deserializeIndex(serialized);
    } catch {
      return null;
    }
  }

  async exists(name: string): Promise<boolean> {
    this.ensureInitialized();
    const row = this.db!.prepare(
      'SELECT 1 FROM hnsw_indices WHERE name = ?'
    ).get(name);
    return row !== undefined;
  }

  async delete(name: string): Promise<boolean> {
    this.ensureInitialized();
    const info = this.db!.prepare(
      'DELETE FROM hnsw_indices WHERE name = ?'
    ).run(name);
    this.pendingSaves.delete(name);
    return info.changes > 0;
  }

  async list(): Promise<Array<{
    name: string;
    nodeCount: number;
    savedAt: string;
    params: HNSWParams;
  }>> {
    this.ensureInitialized();
    const rows = this.db!.prepare(
      'SELECT name, node_count, params, saved_at FROM hnsw_indices ORDER BY saved_at DESC'
    ).all() as Array<{ name: string; node_count: number; params: string; saved_at: string }>;

    return rows.map(r => ({
      name: r.name,
      nodeCount: r.node_count,
      savedAt: r.saved_at,
      params: JSON.parse(r.params) as HNSWParams,
    }));
  }

  async getMetadata(name: string): Promise<{
    name: string;
    nodeCount: number;
    savedAt: string;
    params: HNSWParams;
  } | null> {
    this.ensureInitialized();
    const row = this.db!.prepare(
      'SELECT name, node_count, params, saved_at FROM hnsw_indices WHERE name = ?'
    ).get(name) as { name: string; node_count: number; params: string; saved_at: string } | undefined;

    if (!row) return null;
    return {
      name: row.name,
      nodeCount: row.node_count,
      savedAt: row.saved_at,
      params: JSON.parse(row.params) as HNSWParams,
    };
  }

  async backup(name: string, backupName?: string): Promise<string> {
    this.ensureInitialized();
    const row = this.db!.prepare(
      'SELECT data, node_count, params FROM hnsw_indices WHERE name = ?'
    ).get(name) as { data: string; node_count: number; params: string } | undefined;

    if (!row) throw new Error(`Index '${name}' not found`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const actualBackupName = backupName ?? `${name}-backup-${timestamp}`;
    const now = new Date().toISOString();

    this.db!.prepare(
      `INSERT OR REPLACE INTO hnsw_indices (name, data, node_count, params, saved_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(actualBackupName, row.data, row.node_count, row.params, now);

    return actualBackupName;
  }

  async restore(backupName: string, targetName?: string): Promise<boolean> {
    this.ensureInitialized();
    const row = this.db!.prepare(
      'SELECT data, node_count, params FROM hnsw_indices WHERE name = ?'
    ).get(backupName) as { data: string; node_count: number; params: string } | undefined;

    if (!row) return false;

    const actualTargetName = targetName ?? backupName.replace(/-backup-.*$/, '');
    const now = new Date().toISOString();

    this.db!.prepare(
      `INSERT OR REPLACE INTO hnsw_indices (name, data, node_count, params, saved_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(actualTargetName, row.data, row.node_count, row.params, now);

    return true;
  }

  private async flushPendingSaves(): Promise<void> {
    const saves = Array.from(this.pendingSaves.entries());
    this.pendingSaves.clear();

    for (const [name, index] of saves) {
      try {
        await this.save(name, index);
      } catch (err) {
        console.error(`Failed to auto-save index ${name}:`, err);
        this.pendingSaves.set(name, index);
      }
    }
  }

  private serializeIndex(index: HNSWIndex): SerializedHNSW {
    const data = index.serialize();
    return {
      params: data.params,
      entryPoint: data.entryPoint,
      nodes: data.nodes.map(node => ({
        id: node.id,
        embedding: Array.from(node.embedding),
        layer: node.layer,
        connections: this.serializeConnections(node.connections),
      })),
      layers: data.layers.map(layer => ({
        level: layer.level,
        nodes: Array.from(layer.nodes),
      })),
    };
  }

  private deserializeIndex(data: SerializedHNSW): HNSWIndex {
    const indexData = {
      params: data.params,
      entryPoint: data.entryPoint,
      nodes: data.nodes.map(node => ({
        id: node.id,
        embedding: new Float32Array(node.embedding),
        layer: node.layer,
        connections: this.deserializeConnections(node.connections),
      })),
      layers: data.layers.map(layer => ({
        level: layer.level,
        nodes: new Set(layer.nodes),
      })),
    };
    return HNSWIndex.deserialize(indexData);
  }

  private serializeConnections(connections: Map<number, Set<UUID>>): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const [layer, conns] of connections) {
      result[layer.toString()] = Array.from(conns);
    }
    return result;
  }

  private deserializeConnections(data: Record<string, string[]>): Map<number, Set<UUID>> {
    const result = new Map<number, Set<UUID>>();
    for (const [layer, conns] of Object.entries(data)) {
      result.set(parseInt(layer), new Set(conns));
    }
    return result;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('IndexStore not initialized. Call init() first.');
    }
  }
}

export function createIndexStore(options: IndexStoreOptions): IndexStore {
  return new IndexStore(options);
}
