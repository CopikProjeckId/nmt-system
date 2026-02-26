/**
 * CLI Dashboard Server - Lightweight Express server for the NMT admin dashboard.
 *
 * Operates directly on local LevelDB without requiring Redis or the full API server.
 * Reuses the same bootstrap pattern as bin/nmt.ts for core engine initialization.
 *
 * @module api/cli-server
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import http from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import type { IChunkStore, INeuronStore, NeuronNode, Synapse } from '../types/index.js';
import type { ChunkEngine } from '../core/chunk-engine.js';
import type { MerkleEngine } from '../core/merkle-engine.js';
import type { HNSWIndex } from '../core/hnsw-index.js';
import type { NeuronGraphManager as GraphManager } from '../core/neuron-graph.js';
import type { IndexStore } from '../storage/index-store.js';
import type { IngestionService } from '../services/ingestion.js';
import type { QueryService, QueryResult } from '../services/query.js';
import type { VerificationService, VerificationResult } from '../services/verify.js';

/** Simplified neuron info for list responses */
interface NeuronListItem {
  id: string;
  merkleRoot: string;
  chunks: number;
  sourceType?: string;
  tags?: string[];
  createdAt?: string;
  accessCount?: number;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * CLI Dashboard server options
 */
export interface CLIDashboardOptions {
  port?: number;
  dataDir?: string;
}

/**
 * CLI Dashboard Server
 *
 * A lightweight Express server that bootstraps NMT core engines directly
 * against the local LevelDB storage, providing 13 API endpoints for the
 * dashboard-lite admin interface.
 */
export class CLIDashboardServer {
  private app: Express;
  private server: http.Server | null = null;
  private port: number;
  private dataDir: string;
  private startTime: number = Date.now();

  // Core engines (initialized via init(), accessed via ensureInitialized())
  private chunkEngine!: ChunkEngine;
  private merkleEngine!: MerkleEngine;
  private hnswIndex!: HNSWIndex;
  private graphManager!: GraphManager;

  // Stores
  private chunkStore!: IChunkStore;
  private neuronStore!: INeuronStore;
  private indexStore!: IndexStore;

  // Services
  private ingestionService!: IngestionService;
  private queryService!: QueryService;
  private verifyService!: VerificationService;

  private initialized: boolean = false;

  constructor(options: CLIDashboardOptions = {}) {
    this.port = options.port ?? 3001;
    this.dataDir = options.dataDir ?? './data';

    this.app = express();

    // Middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }));

    this.setupRoutes();
    this.setupStaticFiles();
    this.setupErrorHandling();
  }

  /**
   * Initialize all core engines, stores, and services.
   * Uses dynamic imports to bootstrap the same components as bin/nmt.ts,
   * forcing LevelDB backend so no Redis connection is required.
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    // Dynamic imports (same pattern as bin/nmt.ts lines 147-212)
    const { ChunkEngine } = await import('../core/chunk-engine.js');
    const { MerkleEngine } = await import('../core/merkle-engine.js');
    const { HNSWIndex } = await import('../core/hnsw-index.js');
    const { NeuronGraphManager } = await import('../core/neuron-graph.js');
    const { createStores, getStorageConfig } = await import('../storage/index.js');
    const { IngestionService } = await import('../services/ingestion.js');
    const { QueryService } = await import('../services/query.js');
    const { VerificationService } = await import('../services/verify.js');

    // Ensure data directory exists
    const dataDir = resolve(this.dataDir);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Force LevelDB backend (no Redis required)
    const storageConfig = getStorageConfig();
    storageConfig.dataDir = this.dataDir;
    storageConfig.backend = 'leveldb';

    const { chunkStore, neuronStore, indexStore } = createStores(storageConfig);
    await chunkStore.init();
    await neuronStore.init();
    await indexStore.init();

    // Core engines
    const chunkEngine = new ChunkEngine();
    const merkleEngine = new MerkleEngine();

    // Load HNSW (IndexStore.load returns HNSWIndex instance directly)
    let hnswIndex: InstanceType<typeof HNSWIndex>;
    try {
      const loaded = await indexStore.load('main');
      hnswIndex = (loaded as InstanceType<typeof HNSWIndex>) ?? new HNSWIndex();
    } catch {
      hnswIndex = new HNSWIndex();
    }

    const graphManager = new NeuronGraphManager({
      neuronStore,
      hnswIndex,
    });

    const ingestionService = new IngestionService(
      chunkEngine, merkleEngine, graphManager, chunkStore
    );
    const queryService = new QueryService(
      graphManager, merkleEngine, chunkStore, neuronStore
    );
    const verifyService = new VerificationService(
      merkleEngine, chunkStore, neuronStore
    );

    // Store all references
    this.chunkEngine = chunkEngine;
    this.merkleEngine = merkleEngine;
    this.hnswIndex = hnswIndex;
    this.graphManager = graphManager;
    this.chunkStore = chunkStore;
    this.neuronStore = neuronStore;
    this.indexStore = indexStore;
    this.ingestionService = ingestionService;
    this.queryService = queryService;
    this.verifyService = verifyService;

    this.initialized = true;
    this.startTime = Date.now();

    console.log(`CLI Dashboard initialized (LevelDB: ${resolve(this.dataDir)})`);
  }

  /**
   * Initialize core engines and start listening on the configured port.
   */
  async start(): Promise<void> {
    await this.init();

    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`NMT CLI Dashboard running at http://localhost:${this.port}`);
        console.log(`Data directory: ${path.resolve(this.dataDir)}`);
        resolve();
      });
    });
  }

  /**
   * Gracefully shut down: persist HNSW index, close all stores, and stop the
   * HTTP server.
   */
  async stop(): Promise<void> {
    if (this.initialized) {
      try {
        // IndexStore.save() takes HNSWIndex instance directly (handles serialization internally)
        await this.indexStore.save('main', this.hnswIndex);
      } catch {
        // Ignore save errors during shutdown
      }

      try { await this.chunkStore.close(); } catch { /* ignore */ }
      try { await this.neuronStore.close(); } catch { /* ignore */ }
      try { await this.indexStore.close(); } catch { /* ignore */ }

      this.initialized = false;
    }

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    console.log('CLI Dashboard stopped.');
  }

  /**
   * Get the Express application instance (useful for testing).
   */
  getApp(): Express {
    return this.app;
  }

  /**
   * Set up all 13 API endpoints under /api/v1.
   */
  private setupRoutes(): void {
    const api = express.Router();

    // ----------------------------------------------------------------
    // 1. GET /health
    // ----------------------------------------------------------------
    api.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        dataDir: resolve(this.dataDir),
      });
    });

    // ----------------------------------------------------------------
    // 2. GET /stats
    // ----------------------------------------------------------------
    api.get('/stats', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const neuronCount = await this.neuronStore.getNeuronCount();
        const synapseCount = await this.neuronStore.getSynapseCount();
        const chunkStats = await this.chunkStore.getStats();
        const hnswStats = this.hnswIndex.getStats();

        res.json({
          neurons: neuronCount,
          synapses: synapseCount,
          chunks: {
            total: chunkStats.totalChunks,
            totalSize: chunkStats.totalSize,
            avgSize: chunkStats.avgChunkSize,
          },
          hnsw: {
            totalNodes: hnswStats.totalNodes,
            maxLayer: hnswStats.maxLayer,
          },
          storage: {
            backend: 'leveldb',
            dataDir: resolve(this.dataDir),
          },
        });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 3. GET /neurons?limit=50&offset=0
    // ----------------------------------------------------------------
    api.get('/neurons', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);
        const offset = parseInt(req.query.offset as string) || 0;

        const allIds = await this.neuronStore.getAllNeuronIds();
        const total = allIds.length;
        const pagedIds = allIds.slice(offset, offset + limit);

        const neurons: NeuronListItem[] = [];
        for (const id of pagedIds) {
          const n = await this.neuronStore.getNeuron(id);
          if (n) {
            neurons.push({
              id: n.id,
              merkleRoot: n.merkleRoot,
              chunks: n.chunkHashes.length,
              sourceType: n.metadata.sourceType,
              tags: n.metadata.tags,
              createdAt: n.metadata.createdAt,
              accessCount: n.metadata.accessCount,
            });
          }
        }

        res.json({ total, neurons });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 4. GET /neurons/:id
    // ----------------------------------------------------------------
    api.get('/neurons/:id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const neuron = await this.neuronStore.getNeuron(req.params.id as string);
        if (!neuron) {
          res.status(404).json({ error: 'Neuron not found' });
          return;
        }

        let outCount = 0;
        let inCount = 0;
        try {
          const outgoing = await this.neuronStore.getOutgoingSynapses(neuron.id);
          const incoming = await this.neuronStore.getIncomingSynapses(neuron.id);
          outCount = outgoing?.length ?? 0;
          inCount = incoming?.length ?? 0;
        } catch {
          // Synapse info may not be available
        }

        res.json({
          id: neuron.id,
          merkleRoot: neuron.merkleRoot,
          chunkHashes: neuron.chunkHashes,
          sourceType: neuron.metadata.sourceType,
          tags: neuron.metadata.tags,
          createdAt: neuron.metadata.createdAt,
          updatedAt: neuron.metadata.updatedAt,
          lastAccessed: neuron.metadata.lastAccessed,
          accessCount: neuron.metadata.accessCount,
          synapses: {
            outgoing: outCount,
            incoming: inCount,
          },
        });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 5. GET /neurons/:id/content
    // ----------------------------------------------------------------
    api.get('/neurons/:id/content', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const neuron = await this.neuronStore.getNeuron(req.params.id as string);
        if (!neuron) {
          res.status(404).json({ error: 'Neuron not found' });
          return;
        }

        let content: string;
        try {
          content = await this.queryService.getContent(neuron);
        } catch {
          content = '(unable to reconstruct content)';
        }

        res.json({ id: neuron.id, content });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 6. DELETE /neurons/:id
    // ----------------------------------------------------------------
    api.delete('/neurons/:id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const deleted = await this.graphManager.deleteNeuron(req.params.id as string);
        if (!deleted) {
          res.status(404).json({ error: 'Neuron not found' });
          return;
        }

        res.json({ deleted: true });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 7. POST /search  body: {query, k?, includeContent?}
    // ----------------------------------------------------------------
    api.post('/search', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const { query, k, includeContent } = req.body;
        if (!query || typeof query !== 'string') {
          res.status(400).json({ error: 'query string is required' });
          return;
        }

        const results = await this.queryService.search(query, {
          k: k ?? 10,
          includeContent: includeContent ?? false,
        });

        res.json({
          query,
          count: results.length,
          results: results.map((r: QueryResult) => ({
            neuronId: r.neuron.id,
            score: r.score,
            tags: r.neuron.metadata.tags,
            sourceType: r.neuron.metadata.sourceType,
            ...(r.content !== undefined ? { content: r.content } : {}),
          })),
        });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 8. POST /ingest  body: {text, sourceType?, tags?}
    // ----------------------------------------------------------------
    api.post('/ingest', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const { text, sourceType, tags } = req.body;
        if (!text || typeof text !== 'string') {
          res.status(400).json({ error: 'text string is required' });
          return;
        }

        const neuron = await this.ingestionService.ingestText(text, {
          sourceType: sourceType || 'dashboard',
          tags: Array.isArray(tags) ? tags : [],
          autoConnect: true,
        });

        res.status(201).json({
          neuronId: neuron.id,
          merkleRoot: neuron.merkleRoot,
          chunks: neuron.chunkHashes.length,
          tags: neuron.metadata.tags,
          sourceType: neuron.metadata.sourceType,
        });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 9. GET /verify
    // ----------------------------------------------------------------
    api.get('/verify', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const result = await this.verifyService.verifyAll();

        res.json({
          total: result.total,
          valid: result.valid,
          invalid: result.invalid,
          results: result.results.map((r: VerificationResult) => ({
            neuronId: r.neuronId,
            valid: r.valid,
            errors: r.errors,
          })),
        });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 10. GET /verify/:id
    // ----------------------------------------------------------------
    api.get('/verify/:id', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const result = await this.verifyService.verifyNeuron(req.params.id as string);

        res.json(result);
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 11. GET /neurons/:id/synapses
    // ----------------------------------------------------------------
    api.get('/neurons/:id/synapses', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const neuron = await this.neuronStore.getNeuron(req.params.id as string);
        if (!neuron) {
          res.status(404).json({ error: 'Neuron not found' });
          return;
        }

        let outgoing: Synapse[] = [];
        let incoming: Synapse[] = [];
        try {
          outgoing = await this.neuronStore.getOutgoingSynapses(neuron.id);
        } catch {
          outgoing = [];
        }
        try {
          incoming = await this.neuronStore.getIncomingSynapses(neuron.id);
        } catch {
          incoming = [];
        }

        res.json({
          outgoing: outgoing.map((s: Synapse) => ({
            id: s.id,
            targetId: s.targetId,
            type: s.type,
            weight: s.weight,
            createdAt: s.metadata.createdAt,
          })),
          incoming: incoming.map((s: Synapse) => ({
            id: s.id,
            sourceId: s.sourceId,
            type: s.type,
            weight: s.weight,
            createdAt: s.metadata.createdAt,
          })),
        });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 12. POST /neurons/:id/tags  body: {tags: string[]}
    // ----------------------------------------------------------------
    api.post('/neurons/:id/tags', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const { tags } = req.body;
        if (!Array.isArray(tags)) {
          res.status(400).json({ error: 'tags must be a string array' });
          return;
        }

        const neuron = await this.neuronStore.getNeuron(req.params.id as string);
        if (!neuron) {
          res.status(404).json({ error: 'Neuron not found' });
          return;
        }

        // Merge new tags with existing, deduplicate
        const existingTags: string[] = neuron.metadata.tags || [];
        const mergedTags = [...new Set([...existingTags, ...tags])];

        // updateNeuron(id, partialUpdates)
        const updated = await this.neuronStore.updateNeuron(neuron.id, {
          metadata: { ...neuron.metadata, tags: mergedTags },
        });

        res.json({
          id: neuron.id,
          tags: updated?.metadata?.tags ?? mergedTags,
          sourceType: neuron.metadata.sourceType,
          updatedAt: updated?.metadata?.updatedAt,
        });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 13. GET /tags
    // ----------------------------------------------------------------
    api.get('/tags', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const allIds = await this.neuronStore.getAllNeuronIds();
        const tagCounts = new Map<string, number>();

        for (const id of allIds) {
          const neuron = await this.neuronStore.getNeuron(id);
          if (neuron && neuron.metadata.tags) {
            for (const tag of neuron.metadata.tags) {
              tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
            }
          }
        }

        const tags = Array.from(tagCounts.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count);

        res.json({ tags });
      } catch (err) {
        next(err);
      }
    });

    // Mount all API routes
    this.app.use('/api/v1', api);
  }

  /**
   * Serve the dashboard-lite static files and configure SPA fallback.
   */
  private setupStaticFiles(): void {
    const dashboardPath = path.join(__dirname, '../../dashboard-lite');

    this.app.use(express.static(dashboardPath));

    // SPA fallback: non-API routes serve index.html
    this.app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api/')) {
        return next();
      }

      const indexPath = path.join(dashboardPath, 'index.html');
      if (existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        next();
      }
    });
  }

  /**
   * Set up error handling middleware: 404 for unmatched API routes and a
   * global error handler that returns structured JSON.
   */
  private setupErrorHandling(): void {
    // 404 handler for API routes that were not matched
    this.app.use('/api/', (_req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not Found',
        message: 'The requested API endpoint does not exist.',
      });
    });

    // Global error handler
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      console.error('CLI Dashboard error:', err.message);

      res.status(500).json({
        error: 'Internal Server Error',
        message: err.message,
      });
    });
  }

  /**
   * Guard that throws if core engines have not been initialized yet.
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('CLI Dashboard server not initialized. Call init() or start() first.');
    }
  }
}

/**
 * Factory function: create, initialize, and start a CLIDashboardServer.
 */
export async function createCLIDashboardServer(
  options?: CLIDashboardOptions
): Promise<CLIDashboardServer> {
  const server = new CLIDashboardServer(options);
  await server.start();
  return server;
}
