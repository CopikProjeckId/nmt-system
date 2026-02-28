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
  private compactionScheduler: import('../utils/compaction-scheduler.js').CompactionScheduler | null = null;

  constructor(options: CLIDashboardOptions = {}) {
    this.port = options.port ?? 3001;
    this.dataDir = options.dataDir ?? './data';

    this.app = express();

    // Middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(cors({
      origin: (origin, callback) => {
        // Allow same-origin (no origin header) and localhost variants
        if (!origin || origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
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

    const { getEmbeddingProvider } = await import('../services/embedding-provider.js');
    const embeddingProvider = await getEmbeddingProvider();

    const ingestionService = new IngestionService(
      chunkEngine, merkleEngine, graphManager, chunkStore, embeddingProvider
    );
    const queryService = new QueryService(
      graphManager, merkleEngine, chunkStore, neuronStore, embeddingProvider
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

    // Start background compaction scheduler
    const { CompactionScheduler } = await import('../utils/compaction-scheduler.js');
    const { ChunkStore } = await import('../storage/chunk-store.js');
    const { NeuronStore } = await import('../storage/neuron-store.js');
    this.compactionScheduler = new CompactionScheduler({
      hnswIndex: this.hnswIndex,
      stores: [
        this.chunkStore as unknown as { compact(): Promise<void> },
        this.neuronStore as unknown as { compact(): Promise<void> },
      ],
      tombstoneThreshold: 50,
      intervalMs: 5 * 60 * 1000,
    });
    this.compactionScheduler.start();

    console.log(`CLI Dashboard initialized (LevelDB: ${resolve(this.dataDir)})`);
  }

  /**
   * Initialize core engines and start listening on the configured port.
   */
  async start(): Promise<void> {
    await this.init();

    // Guard against fatal errors that bypass normal error handlers
    const emergencyShutdown = async (label: string, reason: unknown) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      console.error(`[nmt-dashboard] ${label}: ${msg}`);
      await this.stop().catch(() => {});
      process.exit(1);
    };

    process.on('uncaughtException',  (err)    => void emergencyShutdown('Fatal error', err));
    process.on('unhandledRejection', (reason) => void emergencyShutdown('Unhandled async error', reason));

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, () => {
        console.log(`NMT CLI Dashboard running at http://localhost:${this.port}`);
        console.log(`Data directory: ${path.resolve(this.dataDir)}`);
        resolve();
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(
            `Port ${this.port} is already in use.\n` +
            `  Try a different port: nmt dashboard -p ${this.port + 1}`
          ));
        } else {
          reject(err);
        }
      });
    });
  }

  /**
   * Gracefully shut down: persist HNSW index, close all stores, and stop the
   * HTTP server.
   */
  async stop(): Promise<void> {
    if (this.initialized) {
      this.compactionScheduler?.stop();

      // Final compaction before shutdown (flush any pending tombstones)
      if (this.hnswIndex.tombstoneCount > 0) {
        this.hnswIndex.compact();
      }

      try {
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
    // 11b. POST /feedback  body: {neuronId, query, relevant}
    //      Online embedding learning — move neuron toward/away from query
    // ----------------------------------------------------------------
    api.post('/feedback', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const { neuronId, query, relevant } = req.body;
        if (!neuronId || typeof neuronId !== 'string') {
          res.status(400).json({ error: 'neuronId (string) is required' });
          return;
        }
        if (!query || typeof query !== 'string' || query.trim().length === 0) {
          res.status(400).json({ error: 'query must be a non-empty string' });
          return;
        }
        if (typeof relevant !== 'boolean') {
          res.status(400).json({ error: 'relevant (boolean) is required' });
          return;
        }

        const result = await this.queryService.recordFeedback(neuronId, query, relevant);
        res.json({
          neuronId: result.neuronId,
          relevant,
          embeddingDrift: result.embeddingDrift,
          feedbackCount: result.feedbackCount,
          message: relevant
            ? 'Embedding moved toward query (LTP)'
            : 'Embedding moved away from query (LTD)',
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

    // ----------------------------------------------------------------
    // 14. GET /graph - Full graph data for visualization
    // ----------------------------------------------------------------
    api.get('/graph', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const neuronIds = await this.neuronStore.getAllNeuronIds();
        const nodes: Array<{ id: string; label: string; tags: string[] }> = [];
        const edges: Array<{ source: string; target: string; weight: number; type: string }> = [];

        for (const id of neuronIds) {
          const neuron = await this.neuronStore.getNeuron(id);
          if (neuron) {
            nodes.push({
              id: neuron.id,
              label: neuron.metadata.sourceType || 'unknown',
              tags: neuron.metadata.tags || [],
            });

            // Get synapses for edges
            const synapses = await this.neuronStore.getOutgoingSynapses(id);
            for (const synapse of synapses) {
              edges.push({
                source: synapse.sourceId,
                target: synapse.targetId,
                weight: synapse.weight,
                type: synapse.type,
              });
            }
          }
        }

        res.json({ nodes, edges, stats: { nodeCount: nodes.length, edgeCount: edges.length } });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 15. POST /inference/:type - Run inference
    // ----------------------------------------------------------------
    api.post('/inference/:type', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const { type } = req.params;
        const { neuronId, targetId } = req.body;
        // Cap depth to prevent DoS via unbounded graph traversal
        const rawDepth = typeof req.body.depth === 'number' ? req.body.depth : 3;
        const depth = Math.min(Math.max(1, rawDepth), 10);
        const MAX_RESULTS = 200;

        if (!neuronId) {
          return res.status(400).json({ error: 'neuronId is required' });
        }

        const neuron = await this.neuronStore.getNeuron(neuronId);
        if (!neuron) {
          return res.status(404).json({ error: 'Neuron not found' });
        }

        // Simple graph-based inference simulation
        const visited = new Set<string>();
        const results: Array<{ id: string; distance: number; path: string[] }> = [];

        const traverse = async (currentId: string, currentDepth: number, path: string[]) => {
          if (currentDepth > depth || visited.has(currentId) || results.length >= MAX_RESULTS) return;
          visited.add(currentId);

          const synapses = type === 'backward'
            ? await this.neuronStore.getIncomingSynapses(currentId)
            : await this.neuronStore.getOutgoingSynapses(currentId);
          for (const synapse of synapses) {
            const nextId = type === 'backward' ? synapse.sourceId : synapse.targetId;

            if (!visited.has(nextId)) {
              results.push({
                id: nextId,
                distance: currentDepth + 1,
                path: [...path, nextId],
              });
              await traverse(nextId, currentDepth + 1, [...path, nextId]);
            }
          }
        };

        await traverse(neuronId, 0, [neuronId]);

        return res.json({
          type,
          sourceId: neuronId,
          targetId: targetId || null,
          depth,
          results: results.slice(0, 50),
          totalFound: results.length,
        });
      } catch (err) {
        return next(err);
      }
    });

    // ----------------------------------------------------------------
    // 16. GET /attractors - List attractors from persistent store
    // ----------------------------------------------------------------
    api.get('/attractors', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();
        // Load attractors from probabilistic store if available
        const { ProbabilisticStore } = await import('../storage/probabilistic-store.js');
        const probStore = new ProbabilisticStore({ dataDir: this.dataDir });
        await probStore.init();
        const data = await probStore.loadAttractors();
        await probStore.close();

        if (data && typeof data === 'object' && 'attractors' in data) {
          res.json({ attractors: (data as { attractors: unknown[] }).attractors });
        } else {
          res.json({ attractors: [], message: 'No attractors persisted. Use: nmt attractor create' });
        }
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 17. GET /sync/status - Sync status
    // ----------------------------------------------------------------
    api.get('/sync/status', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();

        const neuronCount = (await this.neuronStore.getAllNeuronIds()).length;

        res.json({
          nodeId: 'local',
          sequence: 0,
          merkleRoot: null,
          neuronCount,
          lastSync: null,
          peers: [],
        });
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 18. GET /learning/stats - Learning statistics from persistent store
    // ----------------------------------------------------------------
    api.get('/learning/stats', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();
        const { ProbabilisticStore } = await import('../storage/probabilistic-store.js');
        const probStore = new ProbabilisticStore({ dataDir: this.dataDir });
        await probStore.init();
        const data = await probStore.loadLearning();
        await probStore.close();

        if (data && typeof data === 'object') {
          const d = data as Record<string, unknown>;
          res.json({
            sessions: d.sessions ?? 0,
            totalExtractions: d.totalExtracts ?? d.extracts ?? 0,
            patterns: d.patterns ?? 0,
            outcomes: d.outcomes ?? 0,
          });
        } else {
          res.json({ sessions: 0, totalExtractions: 0, patterns: 0, outcomes: 0 });
        }
      } catch (err) {
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 19. GET /probabilistic/stats - Probabilistic system stats from persistent store
    // ----------------------------------------------------------------
    api.get('/probabilistic/stats', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();
        const { ProbabilisticStore } = await import('../storage/probabilistic-store.js');
        const probStore = new ProbabilisticStore({ dataDir: this.dataDir });
        await probStore.init();
        const data = await probStore.loadNeurons();
        await probStore.close();

        if (data && typeof data === 'object') {
          const d = data as Record<string, unknown>;
          res.json({
            totalNeurons: d.totalNeurons ?? d.count ?? 0,
            withStates: d.withStates ?? 0,
            avgUncertainty: d.avgUncertainty ?? d.avgEntropy ?? 0,
            entangledPairs: d.entangledPairs ?? 0,
          });
        } else {
          res.json({ totalNeurons: 0, withStates: 0, avgUncertainty: 0, entangledPairs: 0 });
        }
      } catch (err) {
        next(err);
      }
    });

    // Valid DB driver types (allowlist to prevent user-supplied strings in error messages)
    const VALID_DB_DRIVERS = ['mysql', 'mariadb', 'mongodb'];

    // ----------------------------------------------------------------
    // 20. POST /db/connect - Test DB connection
    // ----------------------------------------------------------------
    api.post('/db/connect', async (req: Request, res: Response, next: NextFunction) => {
      let connector: import('../connectors/types.js').IDBConnector | null = null;
      try {
        const { driver, host, port, user, password, database, uri } = req.body;
        if (!driver || !VALID_DB_DRIVERS.includes(driver)) {
          res.status(400).json({ error: `Invalid driver. Must be one of: ${VALID_DB_DRIVERS.join(', ')}` });
          return;
        }
        if (!database && !uri) {
          res.status(400).json({ error: 'database (or uri for mongodb) is required' });
          return;
        }
        const { createConnector } = await import('../connectors/index.js');
        connector = await createConnector(driver);
        await connector.connect({ driver, host, port, user, password, database, uri });
        await connector.disconnect();
        connector = null;
        res.json({ connected: true, database, driver });
      } catch (err) {
        if (connector) {
          try { await connector.disconnect(); } catch { /* ignore cleanup error */ }
        }
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 21. POST /db/schema - Get external DB schema
    // ----------------------------------------------------------------
    api.post('/db/schema', async (req: Request, res: Response, next: NextFunction) => {
      let connector: import('../connectors/types.js').IDBConnector | null = null;
      try {
        const { driver, host, port, user, password, database, uri } = req.body;
        if (!driver || !VALID_DB_DRIVERS.includes(driver)) {
          res.status(400).json({ error: `Invalid driver. Must be one of: ${VALID_DB_DRIVERS.join(', ')}` });
          return;
        }
        const { createConnector } = await import('../connectors/index.js');
        connector = await createConnector(driver);
        await connector.connect({ driver, host, port, user, password, database, uri });
        const schema = await connector.getSchema();
        await connector.disconnect();
        connector = null;
        res.json(schema);
      } catch (err) {
        if (connector) {
          try { await connector.disconnect(); } catch { /* ignore cleanup error */ }
        }
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 22. POST /db/import - Import external DB rows into NMT
    // ----------------------------------------------------------------
    api.post('/db/import', async (req: Request, res: Response, next: NextFunction) => {
      let connector: import('../connectors/types.js').IDBConnector | null = null;
      try {
        this.ensureInitialized();
        const { connection, table, limit, batchSize, tags } = req.body;
        if (!connection?.driver || !VALID_DB_DRIVERS.includes(connection.driver) || !table) {
          res.status(400).json({ error: 'Valid connection.driver and table are required' });
          return;
        }
        const { createConnector } = await import('../connectors/index.js');
        const { DBBridgeService } = await import('../services/db-bridge.js');
        connector = await createConnector(connection.driver);
        await connector.connect(connection);
        const bridge = new DBBridgeService(connector, this.ingestionService, this.neuronStore);
        const result = await bridge.importTable({
          table,
          limit: limit ?? undefined,
          batchSize: batchSize ?? 1000,
          tags: tags ?? [],
          autoConnect: true,
        });
        await connector.disconnect();
        connector = null;
        res.json(result);
      } catch (err) {
        if (connector) {
          try { await connector.disconnect(); } catch { /* ignore cleanup error */ }
        }
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 23. POST /db/export - Export NMT neurons to external DB
    // ----------------------------------------------------------------
    api.post('/db/export', async (req: Request, res: Response, next: NextFunction) => {
      let connector: import('../connectors/types.js').IDBConnector | null = null;
      try {
        this.ensureInitialized();
        const { connection, table, tags, limit, includeEmbeddings, includeSynapses, restoreSourceData } = req.body;
        if (!connection?.driver || !VALID_DB_DRIVERS.includes(connection.driver)) {
          res.status(400).json({ error: `Invalid connection.driver. Must be one of: ${VALID_DB_DRIVERS.join(', ')}` });
          return;
        }
        const { createConnector } = await import('../connectors/index.js');
        const { DBBridgeService } = await import('../services/db-bridge.js');
        connector = await createConnector(connection.driver);
        await connector.connect(connection);
        const bridge = new DBBridgeService(connector, this.ingestionService, this.neuronStore);
        const result = await bridge.exportNeurons({
          table: table ?? 'nmt_neurons',
          tags: tags ?? undefined,
          limit: limit ?? undefined,
          includeEmbeddings: includeEmbeddings ?? true,
          includeSynapses: includeSynapses ?? true,
          restoreSourceData: restoreSourceData ?? false,
        });
        await connector.disconnect();
        connector = null;
        res.json(result);
      } catch (err) {
        if (connector) {
          try { await connector.disconnect(); } catch { /* ignore cleanup error */ }
        }
        next(err);
      }
    });

    // ----------------------------------------------------------------
    // 24. POST /db/disconnect - Disconnect (no-op, stateless)
    // ----------------------------------------------------------------
    api.post('/db/disconnect', (_req: Request, res: Response) => {
      res.json({ disconnected: true });
    });

    // ----------------------------------------------------------------
    // 25. POST /prune  body: {minWeight?, minActivations?, dryRun?}
    //     Synaptic pruning — remove weak/unused synapses
    // ----------------------------------------------------------------
    api.post('/prune', async (req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();
        const { minWeight = 0.05, minActivations = 2, dryRun = false } = req.body ?? {};

        // Validate inputs to prevent accidental mass-deletion
        if (typeof minWeight !== 'number' || isNaN(minWeight) || minWeight < 0 || minWeight > 1) {
          res.status(400).json({ error: 'minWeight must be a number in [0, 1]' });
          return;
        }
        if (typeof minActivations !== 'number' || !Number.isInteger(minActivations) || minActivations < 0) {
          res.status(400).json({ error: 'minActivations must be a non-negative integer' });
          return;
        }

        const result = await this.graphManager.pruneSynapses({ minWeight, minActivations, dryRun });
        res.json({
          dryRun,
          pruned: result.pruned,
          remaining: result.remaining,
          message: dryRun
            ? `Would prune ${result.pruned} synapses (${result.remaining} remaining)`
            : `Pruned ${result.pruned} synapses (${result.remaining} remaining)`,
        });
      } catch (err) { next(err); }
    });

    // ----------------------------------------------------------------
    // 26. GET /working-memory  — current working memory state
    // ----------------------------------------------------------------
    api.get('/working-memory', async (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();
        const ids = this.queryService.getWorkingMemory();
        const neurons = await Promise.all(
          ids.map(id => this.neuronStore.getNeuron(id))
        );
        res.json({
          capacity: 7,
          count: ids.length,
          dopamineLevel: this.queryService.getDopamineLevel(),
          items: neurons
            .filter(Boolean)
            .map((n: any) => ({
              neuronId: n.id,
              tags: n.metadata.tags,
              sourceType: n.metadata.sourceType,
              accessCount: n.metadata.accessCount,
            })),
        });
      } catch (err) { next(err); }
    });

    // ----------------------------------------------------------------
    // 27. DELETE /working-memory  — clear working memory
    // ----------------------------------------------------------------
    api.delete('/working-memory', (_req: Request, res: Response, next: NextFunction) => {
      try {
        this.ensureInitialized();
        this.queryService.clearWorkingMemory();
        res.json({ cleared: true, message: 'Working memory and episode buffer cleared' });
      } catch (err) { next(err); }
    });

    // Mount all API routes
    this.app.use('/api/v1', api);
  }

  /**
   * Serve the dashboard-lite static files and configure SPA fallback.
   */
  private setupStaticFiles(): void {
    // From dist/src/api/ go up 3 levels to package root
    const dashboardPath = path.join(__dirname, '../../../dashboard-lite');

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

    // Global error handler — sanitize messages to prevent leaking internal details
    this.app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
      // Sanitize log output: strip credentials from error messages
      const safeLog = err.message
        .replace(/password[=:]\s*\S+/gi, 'password=***')
        .replace(/mongodb:\/\/[^@]+@/gi, 'mongodb://***@');
      console.error('CLI Dashboard error:', safeLog);

      // Only expose known safe errors to clients
      const isClientError =
        err.message.includes('is required') ||
        err.message.includes('not found') ||
        err.message.includes('not initialized') ||
        err.message.includes('Invalid') ||
        err.message.includes('not installed') ||
        err.message.includes('Unsupported driver') ||
        err.message.includes('not allowed');

      res.status(isClientError ? 400 : 500).json({
        error: isClientError ? 'Bad Request' : 'Internal Server Error',
        message: isClientError ? err.message : 'An unexpected error occurred. Check server logs for details.',
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
